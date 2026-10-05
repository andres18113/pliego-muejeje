"""Shared staging discovery and typed metadata checks; no image or network I/O."""
from __future__ import annotations

import re
import unicodedata
from datetime import date
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

FORMATS = {"RUSTICA": "PAPERBACK", "TAPA_DURA": "HARDCOVER", "PAPERBACK": "PAPERBACK",
           "HARDCOVER": "HARDCOVER", "EBOOK": "EBOOK", "AUDIOBOOK": "AUDIOBOOK"}
DIGITAL_FORMATS = {"EBOOK", "AUDIOBOOK"}
EXCLUDED_SKUS = {"PLG-BK-000042"}
LICENSES = {"PUBLIC_DOMAIN", "CC0", "CC_BY", "CC_BY_SA", "OWNED"}
STAGING_NAME = re.compile(r"(?:staging|pliego_[^/]+_limpio)\.json\Z")


def discover_staging(root: Path) -> list[Path]:
    """Only catalog entry points, never arbitrary JSON/configuration or generated output."""
    root = root.resolve()
    return sorted(p for p in root.rglob("*.json") if p.is_file()
                  and p.relative_to(root).parts[0] != "generated" and STAGING_NAME.fullmatch(p.name))


def category_slug(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    if not slug or len(slug) > 140:
        raise ValueError("La categoría no tiene un nombre válido.")
    return slug


def cover_evidence(edition: dict) -> dict[str, str | None]:
    cover = edition.get("portada") or {}
    if not isinstance(cover, dict):
        raise ValueError("Los metadatos de portada deben ser un objeto.")
    license = cover.get("licencia")
    source = cover.get("fuente")
    credit = cover.get("atribucion")
    # A platform label or source URL alone is not license evidence (V024).
    if license is None and credit is None:
        return {"coverLicense": None, "coverSourceUrl": None, "coverAttribution": None}
    parsed = urlsplit(source) if isinstance(source, str) else None
    if (license not in LICENSES or parsed is None or parsed.scheme not in {"http", "https"}
            or not parsed.hostname or parsed.username or parsed.password or len(source) > 2048
            or (credit is not None and (not isinstance(credit, str) or not credit.strip() or len(credit) > 500))
            or (license in {"CC_BY", "CC_BY_SA"} and credit is None)):
        raise ValueError("La evidencia de portada requiere licencia, URL de procedencia y atribución coherentes.")
    return {"coverLicense": license, "coverSourceUrl": source,
            "coverAttribution": credit.strip() if credit else None}


def metadata_errors(record: dict) -> list[str]:
    """Mirror the public input contract for offline preflight; PostgreSQL stays authoritative."""
    problems = []
    book, edition = record.get("libro"), record.get("edicion")
    if not isinstance(book, dict) or not isinstance(edition, dict):
        return ["Faltan los objetos libro y edicion."]
    if not isinstance(book.get("titulo"), str) or not 1 <= len(book["titulo"].strip()) <= 300:
        problems.append("Falta un título válido.")
    for field, maximum in [("subtitulo", 300), ("sinopsis", 10000)]:
        value = book.get(field)
        if value is not None and (not isinstance(value, str) or len(value) > maximum):
            problems.append(f"{field} debe ser texto o null.")
    authors = book.get("autores")
    if (not isinstance(authors, list) or not authors
            or any(not isinstance(a, dict) or not isinstance(a.get("nombre"), str)
                   or not 1 <= len(a["nombre"].strip()) <= 200
                   or type(a.get("orden")) is not int or a["orden"] < 1 for a in authors)):
        problems.append("Faltan autores y orden de autoría válidos.")
    elif len({a["orden"] for a in authors}) != len(authors):
        problems.append("El orden de autoría está duplicado.")
    categories = book.get("categorias")
    if not isinstance(categories, list) or len(categories) != 1 or not isinstance(categories[0], str) or not categories[0].strip():
        problems.append("Se requiere una categoría temática por registro de staging.")
    elif len(categories[0]) > 120:
        problems.append("La categoría excede 120 caracteres.")
    if not isinstance(edition.get("editorial"), str) or not 1 <= len(edition["editorial"].strip()) <= 200:
        problems.append("Falta la editorial.")
    if not isinstance(edition.get("idioma"), str) or not re.fullmatch(r"[a-z]{2,3}", edition["idioma"]):
        problems.append("Falta un idioma válido.")
    publication = edition.get("fechaPublicacion")
    if publication is not None:
        try:
            if not isinstance(publication, str):
                raise ValueError()
            if date.fromisoformat(publication).isoformat() != publication:
                raise ValueError()
        except ValueError:
            problems.append("La fecha de publicación debe ser ISO o null.")
    fmt = FORMATS.get(edition.get("formato"))
    pages = edition.get("paginas")
    ebook = edition.get("ebookFileFormat")
    seconds = edition.get("audioDurationSeconds")
    voices = edition.get("narrators")
    if voices is None:
        voices = []
    if fmt is None:
        problems.append("El formato de edición no es válido.")
    if pages is not None and (type(pages) is not int or not 1 <= pages <= 100000):
        problems.append("Las páginas deben ser un entero 1–100000 o null.")
    if fmt in {"PAPERBACK", "HARDCOVER"} and pages is None:
        problems.append("Las ediciones físicas requieren páginas.")
    if ebook is not None and (not isinstance(ebook, str) or ebook not in {"EPUB", "PDF"} or fmt != "EBOOK"):
        problems.append("ebookFileFormat solo admite EPUB/PDF en EBOOK.")
    if (not isinstance(voices, list) or len(voices) > 32
            or any(not isinstance(n, str) or not 1 <= len(n.strip()) <= 200 for n in voices)):
        problems.append("Los narradores deben ser hasta 32 nombres no vacíos.")
    if fmt == "AUDIOBOOK":
        if pages is not None or type(seconds) is not int or not 1 <= seconds <= 2147483647 or not voices:
            problems.append("AUDIOBOOK requiere duración positiva, narradores y páginas null.")
    elif seconds is not None or voices:
        problems.append("Duración y narradores solo corresponden a AUDIOBOOK.")
    try:
        cover_evidence(edition)
    except (ValueError, TypeError) as error:
        problems.append(str(error))
    return problems


def read_manifest(path: Path) -> dict:
    import json
    if not path.exists():
        return {"schema": "pliego-cover-manifest-v1", "records": []}
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or document.get("schema") != "pliego-cover-manifest-v1" or not isinstance(document.get("records"), list):
        raise ValueError("El manifiesto de portadas no tiene el esquema esperado.")
    skus, keys = set(), set()
    for row in document["records"]:
        if not isinstance(row, dict):
            raise ValueError("El manifiesto contiene un registro inválido.")
        sku, key = row.get("permanent_sku"), row.get("r2_object_key")
        source = row.get("original_file")
        if (not isinstance(source, str) or PurePosixPath(source).is_absolute() or ".." in PurePosixPath(source).parts
                or "\\" in source or PurePosixPath(source).suffix.lower() != ".webp"
                or not isinstance(row.get("title"), str) or not row["title"].strip()):
            raise ValueError("El manifiesto contiene una fuente o título inválidos.")
        if (not isinstance(sku, str) or not re.fullmatch(r"PLG-BK-\d{6,}", sku)
                or not isinstance(key, str) or not re.fullmatch(r"covers/editions/v2/" + re.escape(sku) + r"-[0-9a-f]{12}\.webp", key)
                or row.get("cover_url") != "https://covers.pliegolibros.com/" + key or sku in skus or key in keys):
            raise ValueError("El manifiesto contiene claves, URLs o identidades incoherentes.")
        skus.add(sku); keys.add(key)
    return document


def retired_records(root: Path) -> list[dict]:
    """The optional retirement ledger is separate from the publishable manifest."""
    return read_manifest(root / "retired-manifest.json")["records"]


def reject_retired_records(records: list[dict], retired: list[dict]) -> None:
    skus = {row["permanent_sku"] for row in retired}
    isbns = {row["isbn13"] for row in retired if row.get("isbn13")}
    for row in records:
        if not isinstance(row, dict):
            raise ValueError("El manifiesto contiene un registro inválido.")
        if row.get("permanent_sku") in skus or row.get("isbn13") in isbns:
            raise ValueError("El catálogo activo intenta reintroducir una edición retirada.")


def publication_existing_keys(root: Path, active: list[dict], own_skus: set[str]) -> set[str]:
    retired = retired_records(root)
    reject_retired_records(active, retired)
    return ({row["r2_object_key"] for row in active if row["permanent_sku"] not in own_skus}
            | {row["r2_object_key"] for row in retired})


def write_json(path: Path, document: dict) -> None:
    import json
    write_bytes(path, (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def write_bytes(path: Path, data: bytes) -> None:
    import os
    import tempfile
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == data:
        return
    fd, name = tempfile.mkstemp(prefix=".cover-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def sync_generated_json(root: Path, records: list[dict]) -> None:
    import json
    urls = {r["permanent_sku"]: r["cover_url"] for r in records}
    for path in (root / "generated/json").rglob("*.json"):
        doc = json.loads(path.read_text(encoding="utf-8"))
        for record in doc.get("libros", []):
            edition = record["edicion"]
            if edition.get("sku") in urls:
                edition.setdefault("portada", {})["url"] = urls[edition["sku"]]
        write_json(path, doc)


def pipeline_lock(root: Path):
    from contextlib import contextmanager
    import fcntl
    @contextmanager
    def locked():
        path = root / "generated/.cover-pipeline.lock"
        if not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("generated/ sale del directorio covers.")
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError("Otro proceso está actualizando el catálogo de portadas.") from None
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)
    return locked()
