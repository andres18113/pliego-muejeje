"""Prepare pending digital editions offline; never mutate the active catalog/registry."""
from __future__ import annotations

import argparse
import collections
import copy
import csv
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import unicodedata

from cover_catalog import category_slug, metadata_errors, read_manifest, write_json
import prepare_covers_loader


def canonical(text):
    return " ".join(unicodedata.normalize("NFC", text).split()).casefold()


def author_key(name):
    # Reversible catalogue spelling convention, not a similarity/name guess.
    parts = name.split(",")
    if len(parts) == 2 and all(x.strip() for x in parts):
        name = parts[1].strip() + " " + parts[0].strip()
    return canonical(name)


def authors_from_inventory(authors):
    result = []
    for author in authors:
        for literal in author["nombre"].split(";"):
            if not literal.strip():
                raise ValueError("La lista literal de autores contiene un nombre vacío.")
            result.append({"nombre": literal.strip(), "orden": len(result) + 1})
    return result


def validate_snapshot(snapshot):
    if snapshot.get("schema") != "pliego-catalog-readonly-snapshot-v1" or snapshot.get("complete") is not True or snapshot.get("scope") != "ALL_STATES":
        raise ValueError("Se requiere una instantánea completa, incluidos registros inactivos.")
    for items, counter in [("books", "book_count"), ("editions", "edition_count"), ("publishers", "publisher_count"), ("authors", "authors_count"), ("categories", "categories_count")]:
        if not isinstance(snapshot.get(items), list) or len(snapshot[items]) != snapshot.get(counter):
            raise ValueError("La instantánea tiene paginación incompleta: " + items)


def resolve_work(book, snapshot):
    validate_snapshot(snapshot)
    wanted = tuple(author_key(a["nombre"]) for a in authors_from_inventory(book["autores"]))
    title_matches = [b for b in snapshot["books"] if canonical(b["title"]) == canonical(book["titulo"])]
    exact = [b for b in title_matches if tuple(author_key(a["name"]) for a in sorted(b["authors_json"], key=lambda a: a["order"])) == wanted
             and canonical(b.get("subtitle") or "") == canonical(book.get("subtitulo") or "")]
    evidence = {"catalog_search_scope": "ALL_STATES", "snapshot_book_count": snapshot["book_count"],
                "rule": "Exact NFC/case/whitespace title, subtitle and ordered authors; only literal surname-comma-name inversion",
                "same_title_book_ids": [str(b["book_id"]) for b in title_matches]}
    if len(exact) == 1:
        found = exact[0]
        return {"action": "REUSE_EXISTING_WORK", "bookId": str(found["book_id"]), "book_state": found["state"],
                "matched_author_names": [a["name"] for a in sorted(found["authors_json"], key=lambda a: a["order"])], "evidence": evidence}
    # Orthographic resemblance can only HOLD a candidate, never merge it.
    weak = lambda t: re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFD", t).encode("ascii", "ignore").decode().casefold()).strip()
    variants = [b for b in snapshot["books"] if weak(b["title"]) == weak(book["titulo"])]
    if exact or title_matches or variants:
        return {"action": "PENDING_IDENTITY", "bookId": None, "reason": "Coincidencia de título/variante sin correspondencia única de autoría y subtítulo.",
                "potential_book_ids": [str(b["book_id"]) for b in variants], "evidence": evidence}
    return {"action": "CREATE_NEW_WORK", "bookId": None, "status": "PROPOSED_NOT_CREATED",
            "reason": "Título ausente en el catálogo completo; autoría literal conservada. Revalidar la instantánea antes de crear.", "evidence": evidence}


def prepare_record(raw, candidate_id, snapshot, allow_demo=False, allow_demo_price=False, verified_metadata=None):
    record = copy.deepcopy(raw)
    raw_authorship = "; ".join(a["nombre"] for a in raw["libro"]["autores"])
    record["libro"]["autores"] = authors_from_inventory(raw["libro"]["autores"])
    work = resolve_work(record["libro"], snapshot)
    if work["action"] == "REUSE_EXISTING_WORK":
        for author, matched_name in zip(record["libro"]["autores"], work["matched_author_names"]):
            author["nombre"] = matched_name
    author_bindings = []
    for author in record["libro"]["autores"]:
        matches = [a for a in snapshot["authors"] if author_key(a["name"]) == author_key(author["nombre"])]
        if len(matches) == 1:
            author["nombre"] = matches[0]["name"]
        author_bindings.append({"name": author["nombre"], "order": author["orden"],
            "authorId": str(matches[0]["author_id"]) if len(matches) == 1 else None,
            "action": "REUSE_EXISTING_AUTHOR" if len(matches) == 1 else "PENDING_AUTHOR_IDENTITY" if matches else "PROPOSE_AUTHOR_FROM_INVENTORY"})
    work_identity = json.dumps([canonical(record["libro"]["titulo"]), canonical(record["libro"].get("subtitulo") or ""),
        [author_key(a["nombre"]) for a in record["libro"]["autores"]]], ensure_ascii=False)
    work["proposal_key"] = "work-" + hashlib.sha256(work_identity.encode()).hexdigest()[:16]
    verified_metadata = verified_metadata or {}
    resolution = verified_metadata.get("identity_resolution", {})
    same_title = [b for b in snapshot["books"] if canonical(b["title"]) == canonical(record["libro"]["titulo"])]
    wanted_authors = sorted(author_key(a["nombre"]) for a in record["libro"]["autores"])
    distinct_authors = all(sorted(author_key(a["name"]) for a in b["authors_json"]) != wanted_authors for b in same_title)
    if (work["action"] == "PENDING_IDENTITY" and resolution.get("action") == "CREATE_NEW_WORK"
            and resolution.get("confirmed_distinct_authorship") is True and distinct_authors
            and resolution.get("source_url") and resolution.get("observed_text")):
        work.update(action="CREATE_NEW_WORK", status="PROPOSED_NOT_CREATED",
                    reason="Fuente primaria identifica otra obra con autoría distinta; no se fusiona con el homónimo.")
        work["evidence"]["primary_identity_resolution"] = copy.deepcopy(resolution)
    provenance = {}
    for field in ["editorial", "idioma", "precio", "isbn13", "ebookFileFormat", "audioDurationSeconds", "narrators"]:
        value = record["edicion"].get(field)
        provenance["edicion." + field] = {"kind": "REAL_FROM_INVENTORY" if value not in (None, [], "") else "MISSING", "source": "operational_inventory" if value not in (None, [], "") else None}
    for field, allowed in [("editorial", {"REAL_SOURCE"}), ("idioma", {"VERIFIED", "INFERRED_UNEQUIVOCAL"})]:
        proof = verified_metadata.get("evidence", {}).get(field, {})
        value = verified_metadata.get(field)
        reference = proof.get("source_url") or proof.get("source_path")
        if isinstance(value, str) and value.strip() and proof.get("kind") in allowed and reference and proof.get("observed_text"):
            record["edicion"][field] = value
            provenance["edicion." + field] = {**copy.deepcopy(proof), "source": reference, "real_source_claim": True}
    if allow_demo_price and record["edicion"].get("precio") is None:
        fmt = record["edicion"]["formato"]
        cents, slots = (499, 21) if fmt == "EBOOK" else (799, 28)
        seed = "PLIEGO-DEMO-PRICE-v1\n" + fmt + "\n" + candidate_id
        cents += 100 * (int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16) % slots)
        record["edicion"]["precio"] = f"{cents // 100}.{cents % 100:02d}"
        provenance["edicion.precio"] = {"kind": "SIMULATED/DEMO", "source": "User-authorized academic demonstration pricing", "currency": "USD",
            "algorithm": "v1; UTF8(PLIEGO-DEMO-PRICE-v1,newline,format,newline,candidate_id); first 8 SHA256 hex digits mod 21/28; EBOOK 4.99+bucket, AUDIOBOOK 7.99+bucket USD",
            "real_source_claim": False, "commercial_price_claim": False,
            "authorization": "docs/audit/digital-editions-preparation-2026-10-04/demo-price-authorization.json"}
    if record["edicion"]["formato"] == "AUDIOBOOK" and allow_demo:
        duration = 900 + int(hashlib.sha256(("PLIEGO-DEMO-AUDIO-v1\n" + candidate_id).encode()).hexdigest()[:8], 16) % 6301
        for field, value in [("audioDurationSeconds", duration), ("narrators", ["Narrador DEMO PLIEGO (sin identidad bibliográfica)"])]:
            if record["edicion"].get(field) in (None, []):
                record["edicion"][field] = value
                provenance["edicion." + field] = {"kind": "SIMULATED/DEMO", "source": "Academic demonstration explicitly authorized by user",
                    "algorithm": "v1; seed = UTF-8 of PLIEGO-DEMO-AUDIO-v1, newline, candidate_id; seconds = 900 + int(SHA256(seed).hexdigest()[:8], 16) % 6301; fixed labelled DEMO narrator",
                    "real_source_claim": False, "limitation": "No real value was available in consulted inventories; institutional sources could not be read."}
    record["edicion"]["inventarioInicial"] = None
    simulated = any(p["kind"] == "SIMULATED/DEMO" for p in provenance.values())
    audio_simulated = any(provenance["edicion." + f]["kind"] == "SIMULATED/DEMO" for f in ["audioDurationSeconds", "narrators"])
    audio_type = "NOT_APPLICABLE"
    if record["edicion"]["formato"] == "AUDIOBOOK":
        audio_type = "SIMULATED/DEMO" if audio_simulated else "REAL_FROM_INVENTORY" if record["edicion"].get("audioDurationSeconds") and record["edicion"].get("narrators") else "PENDING_REAL"
    record["preparacion"] = {"schema": "pliego-digital-edition-preparation-v1", "candidate_id": candidate_id,
        "publication_status": "PENDING", "work": work, "author_bindings": author_bindings, "raw_authorship": raw_authorship, "field_provenance": provenance,
        "stock_action": "NONE_DIGITAL", "sku_status": "PROPOSED_NOT_RESERVED",
        "audio_metadata_type": audio_type, "demo_public_label_required": simulated, "demo_price_authorized": allow_demo_price,
        "price_metadata_type": provenance["edicion.precio"]["kind"], "metadata_blockers": copy.deepcopy(verified_metadata.get("blockers", []))}
    return record


def readiness_errors(record):
    errors = ["STAGING_METADATA_INVALID: " + e for e in metadata_errors(record)]
    prep, edition = record["preparacion"], record["edicion"]
    errors.extend(prep.get("metadata_blockers", []))
    if prep["work"]["action"] == "PENDING_IDENTITY":
        errors.append("WORK_IDENTITY_PENDING")
    if prep["work"].get("book_state") not in (None, "ACTIVE"):
        errors.append("EXISTING_WORK_NOT_ACTIVE")
    if any(a["action"] == "PENDING_AUTHOR_IDENTITY" for a in prep["author_bindings"]):
        errors.append("AUTHOR_IDENTITY_PENDING")
    try:
        if not isinstance(edition.get("precio"), str) or not re.fullmatch(r"[0-9]{1,9}\.[0-9]{2}", edition["precio"]):
            raise InvalidOperation
        price = Decimal(str(edition.get("precio")))
        if not price.is_finite() or not Decimal("0") < price <= Decimal("999999999.99") or price != price.quantize(Decimal("0.01")):
            raise InvalidOperation
    except InvalidOperation:
        errors.append("REAL_PRICE_MISSING_OR_INVALID")
    price_source = prep["field_provenance"].get("edicion.precio", {})
    accepted_price = price_source.get("kind") == "REAL" or (price_source.get("kind") == "SIMULATED/DEMO" and prep.get("demo_price_authorized") is True and price_source.get("commercial_price_claim") is False)
    if not accepted_price or not price_source.get("source"):
        errors.append("PRICE_SOURCE_MISSING")
    if price_source.get("currency") != "USD":
        errors.append("PRICE_CURRENCY_NOT_VERIFIED_USD")
    for field in ["editorial", "idioma"]:
        if prep["field_provenance"]["edicion." + field]["kind"] == "MISSING":
            errors.append("REAL_SOURCE_MISSING: edicion." + field)
    return errors


def propose_skus(candidates, baseline, database_skus, preserve_assignment_count=None):
    """Invoke the existing allocator only inside a disposable private dataset."""
    with tempfile.TemporaryDirectory(prefix="pliego-digital-sku-proposals-") as directory:
        root = Path(directory)
        write_json(root / "sku-registry.json", baseline)
        grouped = collections.defaultdict(list)
        for item in candidates:
            record = copy.deepcopy(item["record"])
            record["edicion"]["sku"] = None
            record["portadaArchivo"] = "portadas/" + item["image"].name
            staging = root / item["planned_staging"]
            destination = staging.parent / record["portadaArchivo"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(item["image"], destination)
            record["preparation_candidate_id"] = item["candidate_id"]
            grouped[staging].append(record)
        for path, records in grouped.items():
            write_json(path, {"libros": records})
        prepare_covers_loader.module.prepare_covers(root)
        registry = json.loads((root / "sku-registry.json").read_text())
        protected = len(baseline["assignments"]) if preserve_assignment_count is None else preserve_assignment_count
        assert registry["assignments"][:protected] == baseline["assignments"][:protected]
        proposals = {}
        for path in grouped:
            normalized = json.loads((root / "generated/json" / path.relative_to(root)).read_text())
            for record in normalized["libros"]:
                sku = record["edicion"]["sku"]
                if sku in database_skus:
                    raise ValueError("El SKU propuesto ya existe en la base de datos: " + sku)
                proposals[record["preparation_candidate_id"]] = sku
        return proposals, registry


def csv_output(path, items, fields):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader(); writer.writerows(items)


def prepare_batch(repo, snapshot_path, sources_path, output, allow_demo=False, allow_demo_price=False, metadata_path=None):
    snapshot = json.loads(snapshot_path.read_text()); validate_snapshot(snapshot)
    sources = json.loads(sources_path.read_text())
    observations = {s["url"]: s for s in sources["observations"]}
    metadata = {}
    if metadata_path is not None:
        verified = json.loads(metadata_path.read_text())
        metadata = {item["candidate_id"]: item for item in verified["records"]}
        if len(metadata) != len(verified["records"]):
            raise ValueError("Hay candidatos duplicados en la evidencia bibliográfica.")
    report_path = repo / "covers/generated/digital-batch/reports/normalization-report.json"
    report = json.loads(report_path.read_text())
    baseline_path = repo / "covers/sku-registry.json"
    baseline = json.loads(baseline_path.read_text())
    candidates = []
    for pending in report["pending_records"]:
        context, raw = pending["context"], pending["record"]
        if context["status"] != "METADATOS_PENDIENTES":
            raise ValueError("El lote solo admite candidatos con WebP válido, sin REVISION_ENCUADRE.")
        ident = Path(context["staging_file"]).stem
        image = repo / "covers" / context["pending_image"]
        if hashlib.sha256(image.read_bytes()).hexdigest() != context["sha256"]:
            raise ValueError("El WebP no coincide con el reporte: " + ident)
        prepared = prepare_record(raw, ident, snapshot, allow_demo, allow_demo_price, metadata.get(ident))
        if metadata_path:
            prepared["preparacion"]["metadata_evidence_sha256"] = hashlib.sha256(metadata_path.read_bytes()).hexdigest()
        source = {"inventory": "covers/" + context["inventory"], "row": context["row"], "source_url": context["source_label"],
                  "source_access": observations[context["source_label"]]["status"], "original_file": context["original_file"],
                  "cover_file": "covers/" + context["pending_image"], "cover_sha256": context["sha256"], "inventory_sha256": hashlib.sha256((repo / "covers" / context["inventory"]).read_bytes()).hexdigest()}
        prepared["preparacion"]["source"] = source
        prepared["preparacion"]["field_provenance"].update({"libro.titulo": {"kind": "REAL_FROM_INVENTORY", **source},
            "libro.autores": {"kind": "REAL_FROM_INVENTORY", "raw_value": prepared["preparacion"]["raw_authorship"], "transform": "Literal semicolon separation; matched catalogue spelling only for exact existing author/work identity", **source},
            "libro.categorias": {"kind": "REAL_FROM_INVENTORY", **source},
            "edicion.formato": {"kind": "BATCH_CLASSIFICATION", "source": source["inventory"]}})
        category = raw["libro"]["categorias"][0]
        matching_categories = [c for c in snapshot["categories"] if canonical(c["name"]) == canonical(category)]
        prepared["preparacion"]["category_binding"] = {"name": category, "categoryId": str(matching_categories[0]["category_id"]) if len(matching_categories) == 1 else None,
            "action": "REUSE_EXISTING_CATEGORY" if len(matching_categories) == 1 else "PROPOSE_CATEGORY_FROM_INVENTORY"}
        family, folder = Path(context["staging_file"]).parts[:2]
        candidates.append({"candidate_id": ident, "record": prepared, "image": image, "planned_staging": family + "/" + folder + "/staging.json"})
    if len(candidates) != 259 or collections.Counter(c["record"]["edicion"]["formato"] for c in candidates) != {"EBOOK": 142, "AUDIOBOOK": 117}:
        raise ValueError("El lote esperado requiere exactamente 142 EBOOK y 117 AUDIOBOOK.")
    allocation_base = baseline
    prior_manifest = output / "manifest-pending.json"
    if (output / "sku-registry-proposed.json").exists():
        previous = json.loads(prior_manifest.read_text())
        if previous["active_registry_sha256"] != hashlib.sha256(baseline_path.read_bytes()).hexdigest():
            raise ValueError("Cambió el registro activo: revisar las propuestas antes de recalcular.")
        allocation_base = json.loads((output / "sku-registry-proposed.json").read_text())
    proposals, registry = propose_skus(candidates, allocation_base, {e["sku"] for e in snapshot["editions"]}, len(baseline["assignments"]))
    new_assignments = {a["sku"]: a for a in registry["assignments"][len(baseline["assignments"]):]}
    stages, pending_rows, covers, audio_rows, price_rows, work_rows = collections.defaultdict(list), [], [], [], [], []
    for item in candidates:
        record, image = item["record"], item["image"]
        sku = proposals[item["candidate_id"]]; record["edicion"]["sku"] = sku
        stage = output / "staging" / item["planned_staging"]
        record["portadaArchivo"] = Path(os.path.relpath(image, stage.parent)).as_posix()
        local_source_key = stage.relative_to(output).as_posix() + "#" + record["portadaArchivo"]
        if local_source_key not in new_assignments[sku]["source_keys"]:
            new_assignments[sku]["source_keys"].append(local_source_key)
        new_assignments[sku]["source_keys"].sort()
        record["preparacion"]["planned_staging"] = item["planned_staging"]
        record["preparacion"]["snapshot_sha256"] = hashlib.sha256(snapshot_path.read_bytes()).hexdigest()
        record["preparacion"]["readiness_errors"] = readiness_errors(record)
        record["preparacion"]["ready_for_future_publication"] = not record["preparacion"]["readiness_errors"]
        stages[stage].append(record)
        prep, edition = record["preparacion"], record["edicion"]
        row = {"candidate_id": item["candidate_id"], "format": edition["formato"], "title": record["libro"]["titulo"], "authors": "; ".join(a["nombre"] for a in record["libro"]["autores"]),
            "work_action": prep["work"]["action"], "bookId": prep["work"].get("bookId"), "proposed_sku": sku, "publication_status": "PENDING",
            "editorial": edition.get("editorial"), "idioma": edition.get("idioma"), "precio": edition.get("precio"),
            "missing_real_fields": ";".join(f for f in ["editorial", "idioma"] if edition.get(f) is None),
            "missing_required_fields": ";".join(f for f in ["editorial", "idioma", "precio"] if edition.get(f) is None),
            "audio_metadata_type": prep["audio_metadata_type"], "audioDurationSeconds": edition.get("audioDurationSeconds"),
            "price_metadata_type": prep["price_metadata_type"], "demo_public_label_required": prep["demo_public_label_required"],
            "narrators": json.dumps(edition.get("narrators"), ensure_ascii=False), "source_url": prep["source"]["source_url"],
            "source_access": prep["source"]["source_access"], "staging": stage.relative_to(repo).as_posix(), "cover_file": prep["source"]["cover_file"],
            "ready_for_future_publication": prep["ready_for_future_publication"], "readiness_errors": ";".join(prep["readiness_errors"])}
        pending_rows.append(row)
        work_rows.append({"candidate_id": item["candidate_id"], "title": record["libro"]["titulo"], "authors": record["libro"]["autores"], **prep["work"]})
        if prep["audio_metadata_type"] == "SIMULATED/DEMO":
            audio_rows.append({k: row[k] for k in ["candidate_id", "proposed_sku", "title", "audioDurationSeconds", "narrators", "audio_metadata_type"]})
        if prep["price_metadata_type"] == "SIMULATED/DEMO":
            price_rows.append({"candidate_id": item["candidate_id"], "proposed_sku": sku, "format": edition["formato"], "title": row["title"],
                "precio": edition["precio"], "currency": "USD", "kind": "SIMULATED/DEMO", "commercial_price_claim": False})
        digest = prep["source"]["cover_sha256"]
        key = f"covers/editions/v2/{sku}-{digest[:12]}.webp"
        covers.append({"isbn13": edition.get("isbn13"), "title": record["libro"]["titulo"], "original_file": image.relative_to(repo / "covers").as_posix(),
            "old_sku": None, "permanent_sku": sku, "r2_object_key": key, "cover_url": "https://covers.pliegolibros.com/" + key})
    for stage, records in stages.items():
        write_json(stage, {"schema": "pliego-pending-digital-staging-v1", "publication_status": "PENDING", "libros": records})
    write_json(output / "sku-registry-proposed.json", registry)
    write_json(output / "manifest-cover-proposed.json", {"schema": "pliego-cover-manifest-v1", "publication_status": "PENDING_NOT_UPLOADED", "records": covers})
    read_manifest(output / "manifest-cover-proposed.json")
    write_json(output / "work-proposals.json", {"snapshot_sha256": hashlib.sha256(snapshot_path.read_bytes()).hexdigest(), "works": work_rows})
    counts = collections.Counter(row["work_action"] for row in pending_rows)
    summary = {"candidates": 259, "existing_works_reused": counts["REUSE_EXISTING_WORK"], "new_work_proposals": counts["CREATE_NEW_WORK"], "ambiguous_candidates": counts["PENDING_IDENTITY"],
        "ebook_edition_proposals": 142, "audiobook_edition_proposals": 117, "new_sku_proposals": len(proposals),
        "sku_range": min(proposals.values()) + ".." + max(proposals.values()), "active_sku_registry_modified": False,
        "missing_real_metadata": {"editorial": sum(row["editorial"] is None for row in pending_rows), "idioma": sum(row["idioma"] is None for row in pending_rows)},
        "audio_demo_candidates": len(audio_rows), "audio_real_duration_missing": sum(c["record"]["edicion"]["formato"] == "AUDIOBOOK" and c["record"]["preparacion"]["field_provenance"]["edicion.audioDurationSeconds"]["kind"] in {"MISSING", "SIMULATED/DEMO"} for c in candidates),
        "audio_real_narrators_missing": sum(c["record"]["edicion"]["formato"] == "AUDIOBOOK" and c["record"]["preparacion"]["field_provenance"]["edicion.narrators"]["kind"] in {"MISSING", "SIMULATED/DEMO"} for c in candidates),
        "candidates_without_price": sum(row["precio"] is None for row in pending_rows), "ready_for_future_publication": sum(row["ready_for_future_publication"] for row in pending_rows),
        "framing_candidates_included": 0, "stock_rows_generated": 0, "demo_explicitly_enabled": allow_demo,
        "demo_price_candidates": len(price_rows), "commercial_prices_required": not allow_demo_price,
        "missing_required_metadata": {f: sum(row[f] is None for row in pending_rows) for f in ["editorial", "idioma", "precio"]}}
    write_json(output / "manifest-pending.json", {"schema": "pliego-digital-editions-pending-v1", "publication_status": "PENDING", "records": [], "summary": summary,
        "active_registry_sha256": hashlib.sha256(baseline_path.read_bytes()).hexdigest(), "snapshot_sha256": hashlib.sha256(snapshot_path.read_bytes()).hexdigest(),
        "sku_proposals_are_unreserved": True, "pending_records": pending_rows,
        "ready_candidate_ids": [row["candidate_id"] for row in pending_rows if row["ready_for_future_publication"]]})
    csv_output(output / "audit/prepared-candidates.csv", pending_rows, list(pending_rows[0]))
    csv_output(output / "audit/price-missing.csv", [r for r in pending_rows if r["precio"] is None], list(pending_rows[0]))
    csv_output(output / "audit/audio-demo.csv", audio_rows, ["candidate_id", "proposed_sku", "title", "audioDurationSeconds", "narrators", "audio_metadata_type"])
    csv_output(output / "audit/price-demo.csv", price_rows, ["candidate_id", "proposed_sku", "format", "title", "precio", "currency", "kind", "commercial_price_claim"])
    csv_output(output / "audit/blockers.csv", [r for r in pending_rows if not r["ready_for_future_publication"]], list(pending_rows[0]))
    write_json(output / "summary.json", summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--allow-demo-audio", action="store_true", help="Solo con autorización explícita de DEMO ante fuentes inaccesibles.")
    parser.add_argument("--allow-demo-prices", action="store_true", help="Precios académicos DEMO autorizados; nunca precios comerciales.")
    parser.add_argument("--metadata-file", type=Path, help="Evidencia verificable de editorial, idioma e identidad por candidato.")
    args = parser.parse_args()
    output = args.repo / "covers/generated/digital-batch/editions"
    summary = prepare_batch(args.repo.resolve(), args.snapshot, args.sources, output.resolve(), args.allow_demo_audio, args.allow_demo_prices, args.metadata_file)
    print(json.dumps(summary, ensure_ascii=False))
    return 2 if summary["ready_for_future_publication"] != summary["candidates"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
