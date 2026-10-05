"""Prepare an evidence-preserving physical batch for the official cover pipeline.

This offline step does not allocate SKUs, publish objects, or import catalog data.
Original cover bytes are retained; staging references lossless WebP derivatives.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import copy
import csv
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil

from PIL import Image

from cover_catalog import metadata_errors, write_json
from prepare_digital_editions import author_key, authors_from_inventory, canonical, resolve_work, validate_snapshot
import prepare_covers_loader


CATEGORIES = {"Filosofía", "Literatura", "Matemáticas", "Medicina", "Psicología", "Infantil y Juvenil"}
SCHEMA = "pliego-physical-edition-preparation-v1"


def _snapshot(snapshot):
    """Adapt complete REST snapshots to the established bibliographic resolver."""
    result = copy.deepcopy(snapshot)
    for book in result.get("books", []):
        book.setdefault("book_id", book.get("bookId"))
        book.setdefault("authors_json", book.get("authors", []))
    for author in result.get("authors", []):
        author.setdefault("author_id", author.get("authorId"))
    for collection, count in [("books", "book_count"), ("editions", "edition_count"),
                              ("authors", "authors_count"), ("publishers", "publisher_count"),
                              ("categories", "categories_count")]:
        result.setdefault(collection, [])
        result.setdefault(count, len(result[collection]))
    validate_snapshot(result)
    return result


def _demo(basis, **details):
    return {"kind": "SIMULATED/DEMO", "real_source_claim": False,
            "source": "User-authorized academic physical catalog", "basis": basis, **details}


def prepare_record(row: dict, provenance: dict, snapshot: dict) -> dict:
    snapshot = _snapshot(snapshot)
    category = row.get("categoria")
    if category not in CATEGORIES:
        raise ValueError("Categoría física no autorizada: " + str(category))
    fields = provenance.get("fields", {})
    for name in ("titulo", "autor", "isbn", "precio", "categoria", "nombre_archivo", "descripcion", "fuente_portada"):
        if fields.get(name, {}).get("value") != row.get(name):
            # Price evidence is numeric in the supplied source provenance.
            if name != "precio" or str(fields.get(name, {}).get("value")) != str(row.get(name)):
                raise ValueError("Inventario y procedencia discrepan: " + name)
    candidate_id = "physical-elibrary-" + str(provenance["book_id"])
    identifier = row["isbn"]
    isbn_proof = fields["isbn"]
    if re.fullmatch(r"DEMO-ISBN-FIS-[0-9]{4}", identifier):
        if isbn_proof.get("status") != "demo_identifier_not_isbn":
            raise ValueError("El identificador DEMO no está respaldado como tal.")
        isbn = None
    else:
        isbn = prepare_covers_loader.module._normalize_isbn13(identifier)
        if not isbn or isbn_proof.get("status") != "observed_print_isbn" or isbn_proof.get("observed_print_isbn") != isbn or isbn_proof.get("observed_print_isbn_checksum_valid") is not True:
            raise ValueError("El ISBN impreso carece de evidencia coherente.")
    try:
        price = Decimal(row["precio"])
        if not price.is_finite() or price <= 0 or price != price.quantize(Decimal("0.01")):
            raise ValueError()
    except (InvalidOperation, ValueError):
        raise ValueError("Precio DEMO inválido.") from None
    book = {"titulo": row["titulo"], "subtitulo": None, "sinopsis": row["descripcion"],
            "autores": authors_from_inventory([{"nombre": row["autor"], "orden": 1}]),
            "categorias": [category]}
    work = resolve_work(book, snapshot)
    if work["action"] == "PENDING_IDENTITY":
        same_title = [b for b in snapshot["books"] if canonical(b["title"]) == canonical(book["titulo"])]
        wanted = sorted(author_key(a["nombre"]) for a in book["autores"])
        distinct = bool(same_title) and all(sorted(author_key(a["name"]) for a in b["authors_json"]) != wanted for b in same_title)
        author_proof, title_proof = fields["autor"], fields["titulo"]
        reference = provenance.get("source_catalog_url")
        if (distinct and reference and author_proof.get("status") == "observed_contributors_with_roles"
                and title_proof.get("status") == "observed"
                and author_proof.get("source_url") == reference and title_proof.get("source_url") == reference):
            work.update(action="CREATE_NEW_WORK", status="PROPOSED_NOT_CREATED",
                        reason="Fuente bibliográfica identifica autoría distinta del homónimo existente; obra separada sin fusión.")
            work["evidence"]["primary_identity_resolution"] = {"source_url": reference,
                "observed_title": row["titulo"], "observed_authorship": row["autor"],
                "confirmed_distinct_authorship": True, "source_evidence": copy.deepcopy(author_proof)}
    if work["action"] == "REUSE_EXISTING_WORK":
        for author, name in zip(book["autores"], work["matched_author_names"]):
            author["nombre"] = name
    bindings = []
    for author in book["autores"]:
        matches = [a for a in snapshot["authors"] if author_key(a["name"]) == author_key(author["nombre"])]
        if len(matches) == 1:
            author["nombre"] = matches[0]["name"]
        bindings.append({"name": author["nombre"], "order": author["orden"],
                         "authorId": str(matches[0]["author_id"]) if len(matches) == 1 else None,
                         "action": "REUSE_EXISTING_AUTHOR" if len(matches) == 1 else "PROPOSE_AUTHOR_FROM_INVENTORY" if not matches else "PENDING_AUTHOR_IDENTITY"})
    work_key = json.dumps([canonical(book["titulo"]), "", [author_key(a["nombre"]) for a in book["autores"]]], ensure_ascii=False)
    work["proposal_key"] = "work-" + hashlib.sha256(work_key.encode()).hexdigest()[:16]
    publisher = provenance.get("observed_metadata", {}).get("publisher")
    page_seed = int(hashlib.sha256(("PLIEGO-DEMO-PHYSICAL-PAGES-v1\n" + candidate_id).encode()).hexdigest()[:8], 16)
    pages = 80 + page_seed % 521
    edition = {"editorial": publisher or "Editorial DEMO PLIEGO (sin identidad bibliográfica)",
               "idioma": "es", "formato": "PAPERBACK", "isbn13": isbn,
               "paginas": pages, "precio": format(price, ".2f"), "sku": None,
               "inventarioInicial": 10, "fechaPublicacion": None,
               "ebookFileFormat": None, "audioDurationSeconds": None, "narrators": [],
               "portada": {"url": None, "licencia": None, "fuente": row["fuente_portada"], "atribucion": None}}
    evidence = {"edicion.editorial": {"kind": "REAL_SOURCE", "source": provenance.get("source_catalog_url"),
                                     "observed_text": publisher, "real_source_claim": True} if publisher else _demo("No editorial disponible; valor etiquetado DEMO."),
                "edicion.idioma": _demo("Código académico es; idioma físico no verificado."),
                "edicion.formato": _demo("PAPERBACK académico; encuadernación física no verificada."),
                "edicion.paginas": _demo("Páginas académicas deterministas; no paginación bibliográfica.", algorithm="80 + first 8 SHA256 hex digits of UTF8(PLIEGO-DEMO-PHYSICAL-PAGES-v1,newline,candidate_id) mod 521"),
                "edicion.precio": _demo("Precio DEMO del inventario; no cotización comercial.", currency="USD", source_evidence=copy.deepcopy(fields["precio"])),
                "edicion.inventarioInicial": _demo("10 unidades académicas; existencia física no verificada.", physical_availability_verified=False),
                "edicion.isbn13": {"kind": "REAL_SOURCE" if isbn else "DEMO_IDENTIFIER_NOT_ISBN", "source_evidence": copy.deepcopy(isbn_proof), "real_source_claim": bool(isbn)}}
    book["sinopsis"] += "\n[Catálogo físico SIMULATED/DEMO: encuadernación, idioma, páginas y existencias académicas; disponibilidad física no verificada.]"
    record = {"portadaArchivo": "portadas/" + candidate_id + ".webp", "libro": book, "edicion": edition,
              "preparacion": {"schema": SCHEMA, "candidate_id": candidate_id, "publication_status": "PENDING",
                              "work": work, "author_bindings": bindings, "raw_authorship": row["autor"],
                              "field_provenance": evidence, "demo_public_label_required": True,
                              "physical_catalog_type": "SIMULATED/DEMO", "stock_action": "SIMULATED_INITIAL_STOCK_10",
                              "sku_status": "PROPOSED_NOT_RESERVED", "source": {"inventory_identifier": identifier,
                              "original_path": "originales/" + provenance["relative_path"], "provenance": copy.deepcopy(provenance)}}}
    problems = metadata_errors(record)
    if problems:
        raise ValueError("Metadatos físicos inválidos: " + "; ".join(problems))
    return record


def prepare_batch(source: Path, snapshot: dict, output: Path) -> dict:
    source, output = source.resolve(), output.resolve()
    _snapshot(snapshot)
    if output.exists():
        raise ValueError("La salida debe ser una ruta nueva para preservar preparaciones existentes.")
    document = json.loads((source / "metadata_provenance.json").read_text(encoding="utf-8-sig"))
    with (source / "inventario_fisicos.csv").open(encoding="utf-8-sig", newline="") as inventory:
        rows = list(csv.DictReader(inventory))
    proofs = document.get("records", [])
    if len(proofs) != len(rows) or len({p["relative_path"] for p in proofs}) != len(proofs):
        raise ValueError("Inventario y procedencia no tienen correspondencia única.")
    by_path = {proof["relative_path"]: proof for proof in proofs}
    records, identities = [], set()
    for row in rows:
        relative = row["categoria"] + "/" + row["nombre_archivo"]
        path = PurePosixPath(relative)
        original = (source / relative).resolve()
        if path.is_absolute() or ".." in path.parts or "\\" in relative or not original.is_relative_to(source):
            raise ValueError("Ruta de portada insegura.")
        proof = by_path.get(relative)
        if proof is None:
            raise ValueError("Portada sin procedencia: " + relative)
        digest = hashlib.sha256(original.read_bytes()).hexdigest()
        if digest != proof.get("image", {}).get("sha256"):
            raise ValueError("SHA256 original no coincide: " + relative)
        with Image.open(original) as image:
            image.load()
            if (image.width, image.height) != (proof["image"]["width"], proof["image"]["height"]):
                raise ValueError("Dimensiones originales no coinciden: " + relative)
        record = prepare_record(row, proof, snapshot)
        identity = prepare_covers_loader.module._edition_identity(record, record["edicion"]["isbn13"])
        if identity in identities:
            raise ValueError("Identidad de edición duplicada: " + identity)
        identities.add(identity)
        records.append((row["categoria"], original, record))
    groups = defaultdict(list)
    output.mkdir(parents=True)
    for category, original, record in records:
        destination = output / category / record["portadaArchivo"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(original) as image:
            image.convert("RGB").save(destination, format="WEBP", lossless=True, method=6)
        preserved = output / record["preparacion"]["source"]["original_path"]
        preserved.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, preserved)
        record["preparacion"]["source"].update(cover_sha256=hashlib.sha256(destination.read_bytes()).hexdigest(),
            original_sha256=hashlib.sha256(preserved.read_bytes()).hexdigest(),
            transformations=[{"operation": "LOSSLESS_WEBP_ENCODING", "decoded_pixels_preserved": True}])
        groups[category].append(record)
    for category, group in groups.items():
        write_json(output / category / "staging.json", {"schema": SCHEMA, "publication_status": "PENDING", "libros": group})
    for name in ("inventario_fisicos.csv", "metadata_provenance.json", "incidencias_detalle.csv", "README.txt", "resumen_por_categoria.csv"):
        if (source / name).is_file():
            (output / "provenance").mkdir(exist_ok=True)
            shutil.copyfile(source / name, output / "provenance" / name)
    report = {"schema": SCHEMA, "records": len(records), "categories": dict(Counter(c for c, _, _ in records)),
              "work_actions": dict(Counter(r["preparacion"]["work"]["action"] for _, _, r in records)),
              "print_isbns": sum(bool(r["edicion"]["isbn13"]) for _, _, r in records),
              "demo_identifiers": sum(r["edicion"]["isbn13"] is None for _, _, r in records),
              "source_originals_preserved": len(records), "lossless_webp_derivatives": len(records),
              "pending_identities": [{"candidate_id": r["preparacion"]["candidate_id"], "title": r["libro"]["titulo"], "plan": r["preparacion"]["work"]}
                                     for _, _, r in records if r["preparacion"]["work"]["action"] == "PENDING_IDENTITY"]}
    write_json(output / "preparation-report.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = prepare_batch(args.source, json.loads(args.snapshot.read_text()), args.output)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
