"""Read-only integrity/compatibility gate; writes audit evidence only to --output."""
import argparse
import collections
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

from PIL import Image


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def write_csv(path, items):
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(items[0]))
        writer.writeheader()
        writer.writerows(items)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-root", type=Path, required=True)
    parser.add_argument("--pipeline-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root, pipeline, output = args.batch_root.resolve(), args.pipeline_root.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(pipeline / "scripts"))
    from cover_catalog import metadata_errors, read_manifest, discover_staging
    from cover_images import normalize_file
    spec = importlib.util.spec_from_file_location("digital_processor_audit", pipeline / "scripts/process-digital-covers.py")
    processor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(processor)
    delivery = json.loads((root / "DELIVERY-MANIFEST.json").read_text())
    for entry in delivery["files"]:
        path = root / entry["path"]
        assert path.resolve().is_relative_to(root)
        assert path.stat().st_size == entry["bytes"], entry["path"]
        assert digest(path) == entry["sha256"], entry["path"]
    for entry in delivery["files"]:
        if entry["path"].startswith("covers/"):
            installed = pipeline / entry["path"]
            assert installed.stat().st_size == entry["bytes"], entry["path"]
            assert digest(installed) == entry["sha256"], entry["path"]
    covers = pipeline / "covers"
    report = json.loads((covers / "generated/digital-batch/reports/normalization-report.json").read_text())
    assert report["schema"] == "pliego-cover-normalization-v4"
    assert report["summary"] == {"input": 450, "accepted": 0, "pending": 450, "preserved": 55}
    originals = list((covers / "Ebook").rglob("*.jpg")) + list((covers / "Audiolibros").rglob("*.jpg"))
    assert len(originals) == 450
    registry = json.loads((covers / "sku-registry.json").read_text())
    assert len(registry["assignments"]) == 56 and registry["next_sequence"] == 57
    historical = read_manifest(covers / "generated/manifest-normalized.json")
    assert len(historical["records"]) == 55
    for entry in delivery["files"]:
        relative = entry["path"]
        if relative.startswith("covers/") and not relative.startswith(("covers/Ebook/", "covers/Audiolibros/", "covers/generated/digital-batch/")):
            assert digest(pipeline / relative) == entry["sha256"], relative
    jobs = {}
    inventories = {}
    for family, provenance_file in [("Ebook", "provenance/Ebook/inventario.csv"), ("Audiolibros", "provenance/Audiolibros/inventario_audiolibros.csv")]:
        inventory = covers / family / "inventario.csv"
        operational, provenance = rows(inventory), rows(root / provenance_file)
        assert len(operational) == len(provenance) == 225
        sources = {(x["Categoria"], x["Titulo"], x["Autor"], x["Archivo"]): x for x in provenance}
        ebook_sources = {(x["Categoria"], x["Titulo"], x["Autor"], x["Archivo"]): x["Ficha"] for x in rows(root / "provenance/Ebook/fuentes.csv")}
        for index, row in enumerate(operational, 2):
            parts = Path(row["Archivo"]).parts
            assert parts[-2] == "originales"
            old_path = (Path(*parts[:-2]) / parts[-1]).as_posix()
            key = (row["Categoria"], row["Titulo"], row["Autor"], old_path)
            source = sources[key]
            assert row["Fuente"] == (ebook_sources[key] if family == "Ebook" else source["Fuente"])
            inventories[(family + "/inventario.csv", index)] = row
        for _, record, source, options, context in processor.inventory_records(covers, inventory):
            key = (context["inventory"], context["row"])
            assert key not in jobs
            jobs[key] = (record, source, options, context)
    assert len(jobs) == len(report["records"]) == 450
    statuses = collections.Counter()
    for item in report["records"]:
        key = (item["inventory"], item["row"])
        record, source, options, context = jobs[key]
        assert source.is_file() and item["original_file"] == context["original_file"]
        assert item["title"] == record["libro"]["titulo"]
        assert item["format"] == record["edicion"]["formato"]
        assert item["source_label"] == context["source_label"]
        assert item["metadata_problems"] == metadata_errors(record)
        assert item["sku"] is None
        statuses[item["status"]] += 1
        if item["status"] == "REVISION_ENCUADRE":
            assert not any(k.startswith("reviewed") for k in options)
            assert not item.get("pending_image")
    assert statuses == {"REVISION_ENCUADRE": 191, "METADATOS_PENDIENTES": 259}
    pending = report["pending_records"]
    assert len(pending) == 259
    metadata_csv = {"EBOOK": [], "AUDIOBOOK": []}
    seen_images, seen_hashes = set(), set()
    records_by_key = {(x["inventory"], x["row"]): x for x in report["records"]}
    assert len(records_by_key) == 450 and records_by_key.keys() == jobs.keys()
    by_staging = {x["staging_file"]: x for x in report["records"]}
    assert len(by_staging) == 450
    for filename, count in [("normalization-report.csv", 450), ("revision-manual.csv", 450), ("archivos-irresolubles.csv", 191)]:
        csv_rows = rows(covers / "generated/digital-batch/reports" / filename)
        assert len(csv_rows) == len({x["staging_file"] for x in csv_rows}) == count
        for csv_row in csv_rows:
            item = by_staging[csv_row["staging_file"]]
            for field in ["title", "format", "original_file", "status", "reason", "sha256"]:
                assert csv_row[field] == str(item.get(field) or ""), (filename, field)
            if csv_row["reviewed_crop"]:
                assert json.loads(csv_row["reviewed_crop"]) == item["reviewed_crop"]
    for entry in pending:
        item, record = entry["context"], entry["record"]
        key = (item["inventory"], item["row"])
        assert item == records_by_key[key] and record == jobs[key][0]
        assert item["status"] == "METADATOS_PENDIENTES"
        relative = "generated/digital-batch/pending-images/" + item["staging_file"]
        assert item["pending_image"] == relative
        path = covers / relative
        assert path.resolve().is_relative_to(covers)
        assert digest(path) == item["sha256"]
        assert path.stat().st_size == item["bytes"] <= 204800
        with Image.open(path) as image:
            assert image.format == "WEBP" and image.size == (720, 1080) and image.n_frames == 1
            image.load()
            assert image.mode == "RGB" and not any(image.info.get(k) for k in ("exif", "xmp", "icc_profile"))
        assert not item["padded"]
        seen_images.add(path)
        seen_hashes.add(item["sha256"])
        fmt = record["edicion"]["formato"]
        fields = ["edicion.editorial", "edicion.idioma"]
        if fmt == "AUDIOBOOK":
            assert record["edicion"]["paginas"] is None
            fields += ["edicion.audioDurationSeconds", "edicion.narrators"]
        metadata_csv[fmt].append({"format": fmt, "inventory": item["inventory"], "row": item["row"],
            "title": record["libro"]["titulo"], "authors": json.dumps(record["libro"]["autores"], ensure_ascii=False),
            "category": record["libro"]["categorias"][0], "source_url": item["source_label"],
            "original_file": item["original_file"], "pending_image": "covers/" + relative,
            "image_sha256": item["sha256"], "missing_staging_fields": ";".join(fields),
            "metadata_errors": ";".join(metadata_errors(record)),
            "import_blockers": "Sin staging aceptado; sin asignación SKU existente; sin entrada digital en manifiesto normalizado",
            "direct_api_unresolved_fields": "bookId;publisherId;sku;price (vincular valores existentes/verificados)",
            "optional_null_fields": "isbn13;fechaPublicacion" + (";paginas;ebookFileFormat" if fmt == "EBOOK" else ""),
            "development_seed_price": "20.00: constante existente del importador de desarrollo; no es precio verificado del lote"})
    assert len(seen_images) == len(seen_hashes) == 259
    assert seen_images == set((covers / "generated/digital-batch/pending-images").rglob("*.webp"))
    assert len(metadata_csv["EBOOK"]) == 142 and len(metadata_csv["AUDIOBOOK"]) == 117
    decisions = json.loads((covers / "generated/digital-batch/reports/decisiones-visuales-210.json").read_text())["decisions"]
    by_source = {(x["inventory"], x["original_file"]): x for x in decisions}
    assert len(by_source) == len(decisions) == 210
    assert collections.Counter(x["decision"] for x in decisions) == {"impossible": 190, "hold": 1, "approved": 19}
    replacements = rows(covers / "generated/digital-batch/reports/archivos-irresolubles.csv")
    assert len(replacements) == 191
    replacement_keys = {(x["inventory"], int(x["row"])) for x in replacements}
    assert len(replacement_keys) == 191
    assert replacement_keys == {key for key, item in records_by_key.items() if item["status"] == "REVISION_ENCUADRE"}
    replacement_output = []
    for row in replacements:
        key = (row["inventory"], int(row["row"]))
        item = records_by_key[key]
        decision = by_source[(row["inventory"], row["original_file"])]
        assert item["status"] == row["status"] == "REVISION_ENCUADRE"
        assert item["reason"] == row["reason"]
        assert decision["visual_justification"] == row["visual_reason"] and row["visual_reason"].strip()
        assert decision["decision"] == row["visual_decision"]
        assert digest(jobs[key][1]) == row["source_sha256"] == decision["source_sha256"]
        assert not row["pending_image"] and not row["reviewed_crop"]
        replacement_output.append({k: row[k] for k in ["format", "inventory", "row", "title", "author", "category", "source_label", "original_file", "source_sha256", "visual_review_id", "visual_decision", "reason", "visual_reason"]} | {
            "required_action": "Obtener fuente alternativa verificable con márgenes suficientes; no forzar recorte" if row["visual_decision"] == "impossible" else "Retención conservadora: solicitar fuente con margen adicional o revisión visual explícita; no declarar imposibilidad definitiva",
            "alternative_source": ""})
    assert collections.Counter(x["visual_decision"] for x in replacements) == {"impossible": 190, "hold": 1}
    assert collections.Counter(x["format"] for x in replacements) == {"EBOOK": 83, "AUDIOBOOK": 108}
    overrides = json.loads((covers / "generated/digital-batch/reports/overrides-revisados.json").read_text())
    assert overrides["applied"] is True and overrides["count"] == len(overrides["overrides"]) == 19
    assert len({(x["inventory"], x["row"]) for x in overrides["overrides"]}) == 19
    for override in overrides["overrides"]:
        key = (override["inventory"], override["row"])
        record, source, options, _ = jobs[key]
        item = records_by_key[key]
        assert item["status"] == "METADATOS_PENDIENTES"
        decision = by_source[(override["inventory"], override["original_file"])]
        assert decision["decision"] == "approved" and decision["review_id"] == override["review_id"]
        assert digest(source) == override["reviewedSourceSha256"]
        for field in ["reviewedCropBox", "reviewedCropReason", "reviewedSourceSha256"]:
            assert options[field] == override[field]
        data, normalized = normalize_file(source, options)
        assert hashlib.sha256(data).hexdigest() == override["output_sha256"] == item["sha256"]
        assert normalized["reviewed_crop"] == item["reviewed_crop"]
    assert sum(bool(x.get("reviewed_crop")) for x in report["records"]) == 19
    assert not any(p.is_relative_to(covers / "generated/digital-batch") for p in discover_staging(covers))
    for fmt, items in metadata_csv.items():
        write_csv(output / ("metadatos-pendientes-" + fmt.lower() + ".csv"), items)
    write_csv(output / "fuentes-alternativas-191.csv", replacement_output)
    summary = {"status": "PASS_WITH_PENDING", "delivery_hashes_verified": len(delivery["files"]),
        "installed_cover_files_verified": 837,
        "report_csv_rows_verified": 1091,
        "originals_verified": 450, "provenance_rows_verified": 450, "historical_records_preserved": 55,
        "sku_assignments_preserved": 56, "new_skus": 0, "accepted_digital": 0,
        "valid_pending_webps": 259, "pending_by_format": {k: len(v) for k, v in metadata_csv.items()},
        "framing_review": 191, "framing_by_format": {"EBOOK": 83, "AUDIOBOOK": 108},
        "visual_decisions": {"impossible": 190, "hold": 1}, "overrides_reproduced_exactly": 19,
        "metadata_fields": {"EBOOK": ["edicion.editorial", "edicion.idioma"],
            "AUDIOBOOK": ["edicion.editorial", "edicion.idioma", "edicion.audioDurationSeconds", "edicion.narrators"]},
        "limitations": ["Integridad y decisiones documentadas del lote; no sustituye inspección visual humana nueva.",
            "Los hashes de los ZIP originales de origen son evidencia del lote; no se han comparado con esos ZIP no suministrados.",
            "No se consultó BD: no se afirma que existan ediciones digitales equivalentes; el registro local carece de asignaciones para este lote."]}
    (output / "integration-audit.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
