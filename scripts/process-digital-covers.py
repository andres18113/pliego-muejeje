#!/usr/bin/env python3
"""Local-only EBOOK/AUDIOBOOK batch preparation. No upload, API call or physical renormalization."""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
import re
import shutil
import tempfile
from pathlib import Path

import prepare_covers_loader  # shared import of the existing hyphen-named allocator
from cover_catalog import (DIGITAL_FORMATS, EXCLUDED_SKUS, category_slug, discover_staging,
                           metadata_errors, pipeline_lock, read_manifest, sync_generated_json, write_bytes, write_json)
from cover_images import CoverRejected, MAX_BYTES, QUALITIES, TARGET_H, TARGET_W, initial_report, normalize_file

prepare = prepare_covers_loader.module


def _value(row, field):
    value = row.get(field)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _integer(row, field):
    value = _value(row, field)
    return int(value) if value and re.fullmatch(r"[0-9]+", value) else value


def _array(row, field):
    value = _value(row, field)
    if value is None:
        return []
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value  # metadata preflight reports invalid data; never guesses separators.


def inventory_records(root: Path, inventory: Path):
    inventory = inventory.resolve()
    if not inventory.is_relative_to(root):
        raise ValueError("El inventario debe estar dentro de covers.")
    family = inventory.relative_to(root).parts[0]
    if family not in {"Ebook", "Audiolibros"}:
        raise ValueError("El inventario debe estar bajo Ebook/ o Audiolibros/.")
    fmt = "EBOOK" if family == "Ebook" else "AUDIOBOOK"
    with inventory.open(encoding="utf-8-sig", newline="") as incoming:
        reader = csv.DictReader(incoming)
        if not {"Categoria", "Titulo", "Autor", "Archivo", "Fuente"}.issubset(reader.fieldnames or []):
            raise ValueError("El inventario requiere Categoria, Titulo, Autor, Archivo y Fuente.")
        for index, row in enumerate(reader, start=2):
            category = _value(row, "Categoria")
            folder = category_slug(category) if category else "pendiente"
            folder = {"filosofia": "Filosofia", "matematicas": "Matematicas", "literatura": "Literatura"}.get(folder, folder)
            original = (_value(row, "Archivo") or "").replace("\\", "/")
            source = (inventory.parent / original).resolve()
            if not original or Path(original).is_absolute() or not source.is_relative_to(inventory.parent):
                source = None
            source_label = _value(row, "Fuente")
            ident = hashlib.sha256(f"{fmt}\n{source_label or ''}\n{original}".encode()).hexdigest()[:16]
            filename = f"{fmt.lower()}-{ident}.webp"
            authors = _array(row, "autores") if _value(row, "autores") else [{"nombre": _value(row,"Autor"), "orden": 1}]
            isbn = _value(row,"isbn13")
            if isbn:
                isbn = re.sub(r"[-\s]", "", isbn)
            record = {"portadaArchivo": f"portadas/{filename}",
                "libro": {"titulo": _value(row,"Titulo"), "subtitulo": _value(row,"subtitulo"),
                    "sinopsis": _value(row,"sinopsis"), "autores": authors, "categorias": [category]},
                "edicion": {"editorial": _value(row,"editorial"), "isbn13": isbn, "idioma": _value(row,"idioma"),
                    "formato": fmt, "paginas": _integer(row,"paginas"), "anioPublicacion": _integer(row,"anioPublicacion"),
                    "fechaPublicacion": _value(row,"fechaPublicacion"), "precio": None, "sku": None, "inventarioInicial": None,
                    "ebookFileFormat": _value(row,"ebookFileFormat"), "audioDurationSeconds": _integer(row,"audioDurationSeconds"),
                    "narrators": _array(row,"narrators"), "portada": {"url": None, "licencia": _value(row,"coverLicense"),
                        "fuente": _value(row,"coverSourceUrl") or source_label or "archivo_local", "atribucion": _value(row,"coverAttribution")}},
                "observacionesStaging": []}
            options = _array(row,"protectedRegions")
            borders = _array(row,"editorialBorders")
            yield root / family / folder / "staging.json", record, source, {"protectedRegions": options, "editorialBorders": borders}, {
                "inventory": inventory.relative_to(root).as_posix(), "row": index, "original_file": original, "source_label": source_label}


def staged_records(root: Path, staging: Path):
    staging = staging.resolve()
    if not staging.is_relative_to(root) or staging.relative_to(root).parts[0] not in {"Ebook","Audiolibros"}:
        raise ValueError("Solo se normaliza staging digital bajo Ebook/ o Audiolibros/.")
    doc = json.loads(staging.read_text(encoding="utf-8"))
    if not isinstance(doc,dict) or not isinstance(doc.get("libros"),list):
        raise ValueError("El staging digital requiere libros.")
    for index, record in enumerate(doc["libros"]):
        if not isinstance(record,dict) or not isinstance(record.get("libro"),dict) or not isinstance(record.get("edicion"),dict) or record["edicion"].get("formato") not in DIGITAL_FORMATS:
            raise ValueError("El staging digital contiene registros de otro formato.")
        original = record.get("Archivo",record.get("portadaArchivo",""))
        source = (staging.parent / original).resolve()
        if not source.is_relative_to(root) or Path(original).is_absolute():
            source = None
        result = copy.deepcopy(record)
        staged_name = record.get("portadaArchivo", "")
        canonical_webp = (isinstance(staged_name, str) and re.fullmatch(r"portadas/[^/\\]+\.webp", staged_name) is not None)
        if source is not None and (source.suffix.lower() != ".webp" or not canonical_webp):
            ident = hashlib.sha256(f"{record['edicion']['formato']}\n{record['edicion'].get('portada',{}).get('fuente','')}\n{original}".encode()).hexdigest()[:16]
            result["portadaArchivo"] = f"portadas/{record['edicion']['formato'].lower()}-{ident}.webp"
        yield staging, result, source, record.get("normalizacion") or {}, {"staging": staging.relative_to(root).as_posix(), "row": index,
            "original_file": original, "source_label": record.get("edicion",{}).get("portada",{}).get("fuente")}


def _copy_staging(root: Path, work: Path, replaced: set[Path], published: dict):
    for path in discover_staging(root):
        document = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(document,dict) or not isinstance(document.get("libros"),list):
            raise ValueError(f"Staging inválido: {path}")
        if path.resolve() in replaced:
            # Use the last informative copy for published records until their replacement passes.
            generated = root / "generated/json" / path.relative_to(root)
            previous_doc = json.loads(generated.read_text()) if generated.exists() else document
            document["libros"] = [r for r in previous_doc["libros"]
                if (path.parent / r["portadaArchivo"]).resolve().is_relative_to(root)
                and (path.parent / r["portadaArchivo"]).resolve().relative_to(root).as_posix() in published]
        destination = work / path.relative_to(root)
        write_json(destination, document)
        for record in document["libros"]:
            source = (path.parent / record["portadaArchivo"]).resolve()
            if not source.is_relative_to(root) or not source.is_file():
                raise ValueError(f"Portada existente ausente o fuera de covers: {source}")
            target = work / source.relative_to(root)
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(source,target)


def _process_batch(root: Path, inventories: list[Path], staging_files: list[Path] | None = None) -> dict:
    root = root.resolve()
    staging_files = [p.resolve() for p in (staging_files or [])]
    prior = read_manifest(root / "generated/manifest-normalized.json")
    published = {r["original_file"]:r for r in prior["records"] if r["permanent_sku"] not in EXCLUDED_SKUS}
    reports, accepted, changed_docs, pending = [], [], {}, []
    jobs = []
    for inventory in inventories:
        jobs.extend(inventory_records(root, inventory))
    for staging in staging_files:
        jobs.extend(staged_records(root, staging))
    if not jobs:
        raise ValueError("No hay registros digitales de entrada.")
    seen_sources = set()
    for staging, record, source, options, context in jobs:
        staged_file = (staging.parent / record["portadaArchivo"]).resolve()
        family = staging.relative_to(root).parts[0]
        if (family not in {"Ebook", "Audiolibros"} or not staged_file.is_relative_to(root / family)
                or not staging.resolve().is_relative_to(root / family)
                or not staged_file.is_relative_to((staging.parent / "portadas").resolve())):
            raise ValueError("La salida digital debe permanecer en portadas/ de su propio staging.")
        if staged_file in seen_sources:
            raise ValueError(f"Entrada de staging duplicada: {staged_file}")
        seen_sources.add(staged_file)
        previous_row = published.get(staged_file.relative_to(root).as_posix())
        item = {**initial_report(), **context, "sku": previous_row["permanent_sku"] if previous_row else None, "title": record["libro"].get("titulo"),
                "format": record["edicion"].get("formato"), "staging_file": staged_file.relative_to(root).as_posix()}
        for field in ("titulo", "subtitulo"):
            if isinstance(record["libro"].get(field), str):
                record["libro"][field] = record["libro"][field].strip()
        for author in record["libro"].get("autores", []) or []:
            if isinstance(author, dict) and isinstance(author.get("nombre"), str):
                author["nombre"] = author["nombre"].strip()
        problems = metadata_errors(record)
        try:
            record["edicion"]["isbn13"] = prepare._normalize_isbn13(record["edicion"].get("isbn13"))
        except ValueError as error:
            problems.append(str(error))
        if not problems:
            record["libro"]["autores"].sort(key=lambda a:a["orden"])
        item["metadata_problems"] = problems
        try:
            if source is None:
                raise CoverRejected("ARCHIVO_INVALIDO", "Archivo relativo ausente o inseguro.", item)
            data, details = normalize_file(source, options)
            item.update(details)
            if problems:
                item.update(status="METADATOS_PENDIENTES", reason="; ".join(problems))
                pending.append((record,data,item))
            else:
                accepted.append((staging,record,staged_file,data,item))
        except CoverRejected as error:
            item.update(error.details)
        reports.append(item)
    # A scratch catalog validates identities and registry matches before touching accepted state.
    with tempfile.TemporaryDirectory(prefix="pliego-covers-") as directory:
        work = Path(directory)
        _copy_staging(root,work,set(staging_files),published)
        if (root / "sku-registry.json").exists():
            shutil.copyfile(root / "sku-registry.json",work / "sku-registry.json")
        write_json(work / "generated/manifest-normalized.json",prior)
        for staging,record,path,data,item in accepted:
            staged_json = work / staging.relative_to(root)
            doc = json.loads(staged_json.read_text()) if staged_json.exists() else {"schema":"PLIEGO digital staging v1","notas":[],"libros":[]}
            rows = [r for r in doc["libros"] if r["portadaArchivo"] != record["portadaArchivo"]]
            doc["libros"] = [*rows,record]
            write_json(staged_json,doc)
            write_bytes(work / path.relative_to(root),data)
            changed_docs[staging] = staged_json
        # Explicit raw staging also gets a clean accepted catalog (possibly empty).
        for staging in staging_files:
            changed_docs.setdefault(staging,work / staging.relative_to(root))
        prepare.prepare_covers(work)
        provisional = json.loads((work / "generated/manifest.json").read_text())
        manifest_rows = {r["permanent_sku"]:r for r in prior["records"] if r["permanent_sku"] not in EXCLUDED_SKUS}
        by_source = {r["original_file"]:r for r in provisional["records"]}
        objects = []
        for staging,record,path,data,item in accepted:
            row = by_source[path.relative_to(root).as_posix()]
            sku = row["permanent_sku"]
            existing = manifest_rows.get(sku)
            if existing and existing["original_file"] != row["original_file"]:
                raise ValueError(f"El SKU {sku} ya pertenece a otra entrada de staging; no se reemplazará su portada.")
            if sku in EXCLUDED_SKUS:
                raise ValueError("Una entrada digital coincide con un SKU históricamente excluido.")
            key = f"covers/editions/v2/{sku}-{item['sha256'][:12]}.webp"
            output = root / "generated/r2-normalized" / key
            if output.exists() and output.read_bytes() != data:
                raise ValueError(f"Colisión de objeto inmutable: {key}")
            manifest_rows[sku] = {**row,"r2_object_key":key,"cover_url":f"https://covers.pliegolibros.com/{key}"}
            item.update(sku=sku,output=key)
            objects.append((output,data))
        result = {"schema":"pliego-cover-manifest-v1","records":sorted(manifest_rows.values(),key=lambda r:r["permanent_sku"])}
        write_json(work / "generated/manifest-normalized.json",result)
        read_manifest(work / "generated/manifest-normalized.json")
        sync_generated_json(work,result["records"])
        # Commit with rollback for write failures; immutable unreferenced new objects can be retried.
        plan = {path:stage.read_bytes() for path,stage in changed_docs.items()}
        plan.update({path:data for _,_,path,data,_ in accepted})
        plan[root / "sku-registry.json"] = (work / "sku-registry.json").read_bytes()
        plan[root / "generated/manifest.json"] = (work / "generated/manifest.json").read_bytes()
        for path in (work / "generated/r2").rglob("*.webp"):
            plan[root / path.relative_to(work)] = path.read_bytes()
        for path in (work / "generated/json").rglob("*.json"):
            plan[root / path.relative_to(work)] = path.read_bytes()
        plan[root / "generated/manifest-normalized.json"] = (work / "generated/manifest-normalized.json").read_bytes()
        pending_root = root / "generated/digital-batch/pending-images"
        for record,data,item in pending:
            path = pending_root / item["staging_file"]
            plan[path] = data
            item["pending_image"] = path.relative_to(root).as_posix()
        report = {"schema":"pliego-cover-normalization-v4","target":{"width":TARGET_W,"height":TARGET_H,"aspect_ratio":"2:3",
                  "qualities":list(QUALITIES),"maximum_bytes":MAX_BYTES}, "records":reports,
                  "excluded":[{"sku":s,"reason":"Exclusión histórica"} for s in sorted(EXCLUDED_SKUS)],
                  "pending_records":[{"context":item,"record":record} for record,_,item in pending],
                  "summary":{"input":len(reports),"accepted":len(accepted),"pending":len(reports)-len(accepted),
                             "preserved":sum(manifest_rows.get(r["permanent_sku"]) == r for r in prior["records"]
                                 if r["permanent_sku"] not in EXCLUDED_SKUS)}}
        report_path = root / "generated/digital-batch/reports/normalization-report.json"
        plan[report_path] = (json.dumps(report,ensure_ascii=False,indent=2) + "\n").encode("utf-8")
        stream = io.StringIO(newline="")
        columns = ["staging_file","sku","format","title","original_file","original_size","oriented_size",
                   "clean_size","trim","crop","upscale_factor","normalized_size","quality","bytes","sha256","status","reason"]
        writer = csv.DictWriter(stream,fieldnames=columns)
        writer.writeheader()
        for item in reports:
            writer.writerow({key:json.dumps(item[key],ensure_ascii=False) if isinstance(item.get(key),(dict,list))
                             else item.get(key) for key in columns})
        plan[report_path.with_suffix(".csv")] = stream.getvalue().encode("utf-8")

        for staging in staging_files:
            if staging.exists() and plan.get(staging) != staging.read_bytes():
                original_bytes = staging.read_bytes()
                archive = root / "generated/digital-batch/inputs" / staging.relative_to(root)
                archive = archive.with_name(archive.name + "." + hashlib.sha256(original_bytes).hexdigest()[:12] + ".json")
                plan[archive] = original_bytes
        if any(not path.resolve().is_relative_to(root) for path in plan) or any(not path.resolve().is_relative_to(root) for path,_ in objects):
            raise ValueError("Una ruta de salida sale de covers.")
        before = {path:path.read_bytes() if path.exists() else None for path in plan}
        written = []
        try:
            for path,data in objects:
                write_bytes(path,data)
            for path,data in plan.items():
                written.append(path)
                write_bytes(path,data)
        except Exception:
            for path in reversed(written):
                if before[path] is None:
                    path.unlink(missing_ok=True)
                else:
                    write_bytes(path,before[path])
            raise
    return report


def process_batch(root: Path, inventories: list[Path], staging_files: list[Path] | None = None) -> dict:
    with pipeline_lock(root.resolve()):
        return _process_batch(root, inventories, staging_files)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--covers-dir",type=Path,default=Path(__file__).resolve().parent.parent / "covers")
    parser.add_argument("--inventory",type=Path,action="append",default=[])
    parser.add_argument("--staging-file",type=Path,action="append",default=[])
    args = parser.parse_args()
    report = process_batch(args.covers_dir,args.inventory,args.staging_file)
    print(json.dumps(report["summary"],ensure_ascii=False))
    return 2 if report["summary"]["pending"] else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError,ValueError,prepare.PreparationError) as error:
        message = prepare._format_report(error.report) if isinstance(error,prepare.PreparationError) else str(error)
        raise SystemExit(message)
