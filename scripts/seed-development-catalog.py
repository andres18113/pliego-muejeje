#!/usr/bin/env python3
"""Idempotently populate a local PLIEGO catalog through its ADMIN REST API."""

from __future__ import annotations

import json
import getpass
import os
import sys
import argparse
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


API_BASE = os.environ.get("PLIEGO_API_BASE_URL", "http://127.0.0.1:8080").rstrip("/")
ADMIN_EMAIL = os.environ.get("PLIEGO_ADMIN_EMAIL", "admin@pliego.local")
ADMIN_PASSWORD = os.environ.get("PLIEGO_ADMIN_PASSWORD")
PAGE_SIZE = 50
DEFAULT_COVER_MANIFEST = Path(__file__).resolve().parent.parent / "covers/generated/manifest-normalized.json"
DEFAULT_SKU_REGISTRY = Path(__file__).resolve().parent.parent / "covers/sku-registry.json"
DEFAULT_STAGING_FILES = (
    Path(__file__).resolve().parent.parent / "covers/Literatura/pliego_literatura_limpio.json",
    Path(__file__).resolve().parent.parent / "covers/Matemáticas/pliego_matematicas_limpio.json",
    Path(__file__).resolve().parent.parent / "covers/Filosofia/pliego_filosofia_limpio.json",
)
PERMANENT_SKU_PATTERN = re.compile(r"PLG-BK-[0-9]{6,}\Z")
NORMALIZED_COVER_KEY_PATTERN = re.compile(r"covers/editions/v2/(PLG-BK-[0-9]{6,})-[0-9a-f]{12}\.webp\Z")
EXCLUDED_CATALOG_SKUS = frozenset({"PLG-BK-000042"})
LOCAL_DEVELOPMENT_PRICE = "20.00"
LOCAL_DEVELOPMENT_MINIMUM_STOCK = 5
TEST_FIXTURE_SKU_PREFIXES = ("I8-CONC-", "I9-CONC-", "I10-CONC-", "I12-JOURNEY-")


@dataclass(frozen=True)
class CategorySeed:
    slug: str
    name: str
    parent_slug: str | None = None


@dataclass(frozen=True)
class EditionSeed:
    sku: str
    title: str
    subtitle: str | None
    authors: tuple[str, ...]
    category: str
    publisher: str
    language: str
    format: str
    page_count: int
    publication_date: str | None
    price: str
    stock: int
    synopsis: str
    isbn13: str | None = None


CATEGORIES = (
    CategorySeed("literatura", "Literatura"),
    CategorySeed("matematicas", "Matemáticas"),
    CategorySeed("filosofia", "Filosofía"),
)


class ApiError(RuntimeError):
    pass


def load_cover_manifest(path: Path) -> dict[str, dict[str, str | None]]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ApiError(f"No se pudo leer el manifiesto de portadas ({type(error).__name__}).") from None
    if not isinstance(manifest, dict) or not isinstance(manifest.get("records"), list):
        raise ApiError("El manifiesto de portadas debe contener una lista records.")

    covers: dict[str, dict[str, str | None]] = {}
    seen_skus: set[str] = set()
    for index, record in enumerate(manifest["records"]):
        if not isinstance(record, dict):
            raise ApiError(f"El registro {index} del manifiesto de portadas no es válido.")
        sku = record.get("permanent_sku")
        object_key = record.get("r2_object_key")
        cover_url = record.get("cover_url")
        if not isinstance(sku, str) or not PERMANENT_SKU_PATTERN.fullmatch(sku):
            raise ApiError(f"El registro {index} tiene un SKU permanente no válido.")
        if sku in seen_skus:
            raise ApiError(f"El manifiesto contiene el SKU duplicado {sku}.")
        seen_skus.add(sku)
        if sku in EXCLUDED_CATALOG_SKUS:
            continue
        key_match = NORMALIZED_COVER_KEY_PATTERN.fullmatch(object_key) if isinstance(object_key, str) else None
        if key_match is None or key_match.group(1) != sku:
            raise ApiError(f"El registro {sku} no usa una clave normalizada v2 por SKU.")
        parsed_url = urllib.parse.urlsplit(cover_url) if isinstance(cover_url, str) else None
        if (parsed_url is None or parsed_url.scheme != "https"
                or parsed_url.hostname != "covers.pliegolibros.com"
                or parsed_url.path != f"/{object_key}" or parsed_url.username or parsed_url.password
                or parsed_url.query or parsed_url.fragment):
            raise ApiError(f"El registro {sku} no contiene una URL CDN canónica.")
        isbn13 = record.get("isbn13")
        covers[sku] = {
            "coverUrl": cover_url,
            "isbn13": isbn13 if isinstance(isbn13, str) else None,
            "title": record.get("title") if isinstance(record.get("title"), str) else None,
        }
    return covers


def load_catalog_seeds(covers: dict[str, dict[str, str | None]], registry_path: Path,
                       staging_files: tuple[Path, ...]) -> tuple[EditionSeed, ...]:
    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ApiError(f"No se pudo leer el registro permanente de SKU ({type(error).__name__}).") from None
    assignments = registry.get("assignments") if isinstance(registry, dict) else None
    if not isinstance(assignments, list):
        raise ApiError("El registro permanente de SKU debe contener assignments.")

    sku_by_isbn: dict[str, str] = {}
    for assignment in assignments:
        if not isinstance(assignment, dict):
            raise ApiError("El registro permanente de SKU contiene una asignación inválida.")
        sku = assignment.get("sku")
        identity_keys = assignment.get("identity_keys")
        if not isinstance(sku, str) or not PERMANENT_SKU_PATTERN.fullmatch(sku):
            raise ApiError("El registro permanente contiene un SKU no válido.")
        if not isinstance(identity_keys, list):
            raise ApiError(f"La asignación de {sku} no contiene identity_keys.")
        for key in identity_keys:
            if not isinstance(key, str) or not key.startswith("isbn13:"):
                continue
            isbn13 = key.removeprefix("isbn13:")
            if isbn13 in sku_by_isbn and sku_by_isbn[isbn13] != sku:
                raise ApiError(f"El ISBN {isbn13} está asignado a más de un SKU permanente.")
            sku_by_isbn[isbn13] = sku

    covers_by_isbn: dict[str, tuple[str, dict[str, str | None]]] = {}
    for sku, cover in covers.items():
        isbn13 = cover.get("isbn13")
        if not isinstance(isbn13, str) or not isbn13:
            raise ApiError(f"El manifiesto normalizado no incluye ISBN-13 para {sku}.")
        if isbn13 in covers_by_isbn:
            raise ApiError(f"El ISBN {isbn13} aparece más de una vez en el manifiesto normalizado.")
        covers_by_isbn[isbn13] = (sku, cover)

    seeds: list[EditionSeed] = []
    matched_skus: set[str] = set()
    excluded_skus: set[str] = set()
    seen_isbns: set[str] = set()
    category_slugs = {category.name: category.slug for category in CATEGORIES}
    staging_count = 0
    for staging_path in staging_files:
        try:
            document = json.loads(staging_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ApiError(f"No se pudo leer el catálogo de {staging_path.name} ({type(error).__name__}).") from None
        records = document.get("libros") if isinstance(document, dict) else None
        if not isinstance(records, list):
            raise ApiError(f"El catálogo de {staging_path.name} debe contener libros.")
        for record in records:
            staging_count += 1
            if not isinstance(record, dict):
                raise ApiError(f"El catálogo de {staging_path.name} contiene un registro inválido.")
            book = record.get("libro")
            edition = record.get("edicion")
            if not isinstance(book, dict) or not isinstance(edition, dict):
                raise ApiError(f"Un registro de {staging_path.name} no separa libro y edición.")
            isbn13 = edition.get("isbn13")
            title = book.get("titulo")
            if not isinstance(isbn13, str) or not isbn13 or isbn13 in seen_isbns:
                raise ApiError(f"El catálogo de {staging_path.name} contiene ISBN ausente o duplicado.")
            seen_isbns.add(isbn13)
            permanent_sku = sku_by_isbn.get(isbn13)
            if permanent_sku is None:
                raise ApiError(f"El ISBN {isbn13} no tiene asignación permanente en el registro SKU.")
            if permanent_sku in EXCLUDED_CATALOG_SKUS:
                if isbn13 in covers_by_isbn:
                    raise ApiError(f"El SKU excluido {permanent_sku} también aparece en el manifiesto CDN.")
                excluded_skus.add(permanent_sku)
                continue

            manifest_entry = covers_by_isbn.get(isbn13)
            if manifest_entry is None:
                raise ApiError(f"El ISBN {isbn13} ({title}) no tiene una portada en el manifiesto normalizado.")
            manifest_sku, cover = manifest_entry
            if manifest_sku != permanent_sku or cover.get("isbn13") != isbn13:
                raise ApiError(f"La asignación SKU/ISBN de {isbn13} no coincide entre registro y manifiesto.")
            if not isinstance(title, str) or cover.get("title") != title:
                raise ApiError(f"El título para {permanent_sku} no coincide con el manifiesto normalizado.")

            authors = book.get("autores")
            categories = book.get("categorias")
            if not isinstance(authors, list) or not authors or not isinstance(categories, list) or len(categories) != 1:
                raise ApiError(f"El registro bibliográfico para {permanent_sku} no tiene autor/categoría únicos válidos.")
            author_names = tuple(author.get("nombre") for author in authors if isinstance(author, dict))
            if len(author_names) != len(authors) or any(not isinstance(name, str) or not name for name in author_names):
                raise ApiError(f"El registro bibliográfico para {permanent_sku} contiene un autor inválido.")
            category_name = categories[0]
            if not isinstance(category_name, str) or category_name not in category_slugs:
                raise ApiError(f"La categoría de {permanent_sku} no pertenece al catálogo normalizado.")
            formats = {"RUSTICA": "PAPERBACK", "TAPA_DURA": "HARDCOVER"}
            source_format = edition.get("formato")
            format_name = formats.get(source_format)
            page_count = edition.get("paginas")
            language = edition.get("idioma")
            publisher = edition.get("editorial")
            synopsis = book.get("sinopsis")
            publication_date = edition.get("fechaPublicacion")
            subtitle = book.get("subtitulo")
            if (format_name is None or not isinstance(page_count, int) or page_count <= 0
                    or not isinstance(language, str) or not isinstance(publisher, str) or not publisher
                    or not isinstance(synopsis, str) or not synopsis.strip()
                    or (subtitle is not None and not isinstance(subtitle, str))):
                raise ApiError(f"Los metadatos bibliográficos de {permanent_sku} están incompletos.")
            if publication_date is not None:
                try:
                    from datetime import date
                    date.fromisoformat(publication_date)
                except (TypeError, ValueError):
                    raise ApiError(f"La fecha de publicación de {permanent_sku} no es ISO válida.") from None

            seeds.append(EditionSeed(
                permanent_sku, title, subtitle, author_names, category_slugs[category_name], publisher, language,
                format_name, page_count, publication_date, LOCAL_DEVELOPMENT_PRICE,
                LOCAL_DEVELOPMENT_MINIMUM_STOCK, synopsis, isbn13,
            ))
            matched_skus.add(permanent_sku)

    if excluded_skus != EXCLUDED_CATALOG_SKUS:
        raise ApiError("El registro bibliográfico no confirma el SKU 000042 excluido.")
    if matched_skus != set(covers):
        missing = sorted(set(covers) - matched_skus)
        raise ApiError("El catálogo fuente no cubre todos los SKU del manifiesto: " + ", ".join(missing))
    if staging_count != len(seeds) + len(EXCLUDED_CATALOG_SKUS):
        raise ApiError("El número de registros bibliográficos no coincide con los 55 elegibles y el excluido.")
    return tuple(seeds)


class PliegoApi:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token: str | None = None

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        url = self.base_url + path
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                payload = response.read()
                return json.loads(payload) if payload else None
        except urllib.error.HTTPError as error:
            payload = error.read()
            try:
                problem = json.loads(payload)
            except (json.JSONDecodeError, UnicodeDecodeError):
                problem = {}
            code = problem.get("code", "HTTP_ERROR")
            detail = problem.get("detail", "La solicitud REST no se completó.")
            raise ApiError(f"{method} {path}: HTTP {error.code} {code}: {detail}") from None
        except urllib.error.URLError as error:
            raise ApiError(f"{method} {path}: no se pudo conectar con PLIEGO ({error.reason}).") from None

    def login(self, email: str, password: str) -> None:
        response = self.request("POST", "/api/v1/auth/login", {"email": email, "password": password})
        if response.get("user", {}).get("role") != "ADMIN":
            raise ApiError("La cuenta configurada no tiene el rol ADMIN requerido para este seed.")
        self.token = response["accessToken"]

    def page(self, path: str, **params: str) -> list[dict[str, Any]]:
        query = {"page": "0", "pageSize": str(PAGE_SIZE), **params}
        return self.request("GET", path + "?" + urllib.parse.urlencode(query))["items"]

    def all_pages(self, path: str, **params: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        page = 0
        while True:
            current = self.page(path, page=str(page), **params)
            rows.extend(current)
            if len(current) < PAGE_SIZE:
                return rows
            page += 1


def sync_cover_manifest(api: PliegoApi, covers: dict[str, dict[str, str | None]]) -> dict[str, int]:
    eligible_covers = {
        sku: cover for sku, cover in covers.items()
        if sku not in EXCLUDED_CATALOG_SKUS
    }
    wanted_skus = set(eligible_covers) | EXCLUDED_CATALOG_SKUS
    editions_by_sku: dict[str, dict[str, Any]] = {}
    for row in api.all_pages("/api/v1/admin/editions", query="PLG-BK-"):
        sku = row.get("sku") if isinstance(row, dict) else None
        if isinstance(sku, str) and sku in wanted_skus:
            if sku in editions_by_sku:
                raise ApiError(f"La búsqueda ADMIN devolvió más de una edición con SKU {sku}.")
            editions_by_sku[sku] = row

    for sku, cover in eligible_covers.items():
        edition = editions_by_sku.get(sku)
        if edition is None:
            continue
        if cover.get("isbn13") and edition.get("isbn13") != cover["isbn13"]:
            raise ApiError(f"El ISBN de {sku} no coincide con el manifiesto de portadas.")
        if cover.get("title") and edition.get("bookTitle") != cover["title"]:
            raise ApiError(f"El título de {sku} no coincide con el manifiesto de portadas.")

    updated = 0
    skipped = 0
    excluded = 0
    for sku in EXCLUDED_CATALOG_SKUS:
        edition = editions_by_sku.get(sku)
        if edition is None:
            continue
        state = edition.get("state")
        if state not in {"ACTIVE", "INACTIVE"}:
            raise ApiError(f"El estado de {sku} no está disponible para excluirla del catálogo.")
        if state == "ACTIVE":
            api.request("PUT", f"/api/v1/admin/editions/{edition['editionId']}/status", {"state": "INACTIVE"})
        excluded += 1

    for sku, cover in eligible_covers.items():
        edition = editions_by_sku.get(sku)
        if edition is None:
            continue
        cover_url = cover["coverUrl"]
        if edition.get("coverUrl") == cover_url:
            skipped += 1
            continue
        api.request("PUT", f"/api/v1/admin/editions/{edition['editionId']}", {
            "publisherId": edition["publisherId"],
            "isbn13": edition.get("isbn13"),
            "language": edition["language"],
            "format": edition["format"],
            "pageCount": edition["pageCount"],
            "publicationDate": edition.get("publicationDate"),
            "price": edition["price"],
            "coverUrl": cover_url,
            "coverLicense": edition.get("coverLicense"),
            "coverSourceUrl": edition.get("coverSourceUrl"),
            "coverAttribution": edition.get("coverAttribution"),
        })
        updated += 1

    return {
        "updated": updated,
        "skipped": skipped,
        "unmatched": len(eligible_covers) - sum(sku in editions_by_sku for sku in eligible_covers),
        "excluded": excluded,
    }


def isbn_is_valid(value: str) -> bool:
    return len(value) == 13 and value.isdigit() and sum(
        int(digit) * (1 if index % 2 == 0 else 3) for index, digit in enumerate(value)
    ) % 10 == 0


def exact_name(items: list[dict[str, Any]], field: str, value: str) -> dict[str, Any] | None:
    return next((item for item in items if item.get(field) == value), None)


def ensure_author(api: PliegoApi, name: str) -> str:
    found = exact_name(api.page("/api/v1/admin/authors", query=name), "name", name)
    if found:
        return found["authorId"]
    created = api.request("POST", "/api/v1/admin/authors", {"name": name, "biography": None})
    return created["authorId"]


def ensure_publisher(api: PliegoApi, name: str) -> str:
    found = exact_name(api.page("/api/v1/admin/publishers", query=name), "name", name)
    if found:
        if found.get("state") != "ACTIVE":
            raise ApiError(f"La editorial de seed '{name}' existe pero está inactiva.")
        return found["publisherId"]
    created = api.request("POST", "/api/v1/admin/publishers", {"name": name, "description": None})
    return created["publisherId"]


def ensure_categories(api: PliegoApi) -> dict[str, str]:
    category_ids: dict[str, str] = {}
    for category in CATEGORIES:
        matches = api.page("/api/v1/admin/categories", query=category.slug)
        found = exact_name(matches, "slug", category.slug)
        expected_parent = category_ids.get(category.parent_slug) if category.parent_slug else None
        if found:
            if found.get("state") != "ACTIVE" or found.get("parentCategoryId") != expected_parent:
                raise ApiError(f"La categoría existente '{category.slug}' no coincide con el seed esperado.")
            category_ids[category.slug] = found["categoryId"]
            continue
        created = api.request("POST", "/api/v1/admin/categories", {
            "name": category.name,
            "slug": category.slug,
            "description": "Categoría de catálogo para datos locales de desarrollo.",
            "parentCategoryId": expected_parent,
        })
        category_ids[category.slug] = created["categoryId"]
    return category_ids


def book_matches(book: dict[str, Any], seed: EditionSeed, category_id: str) -> bool:
    author_names = [author.get("name") for author in book.get("authors", [])]
    category_ids = [category.get("categoryId") for category in book.get("categories", [])]
    return (
        book.get("title") == seed.title
        and book.get("subtitle") == seed.subtitle
        and author_names == list(seed.authors)
        and category_ids == [category_id]
        and book.get("state") == "ACTIVE"
    )


def ensure_book(api: PliegoApi, seed: EditionSeed, category_id: str) -> str:
    candidates = api.page("/api/v1/admin/books", query=seed.title)
    for candidate in candidates:
        if candidate.get("title") == seed.title and book_matches(candidate, seed, category_id):
            if candidate.get("state") == "INACTIVE":
                api.request("PUT", f"/api/v1/admin/books/{candidate['bookId']}/status", {"state": "ACTIVE"})
            elif candidate.get("state") != "ACTIVE":
                raise ApiError(f"El estado del libro '{seed.title}' no está disponible para el seed.")
            return candidate["bookId"]
    authors = [
        {"authorId": ensure_author(api, author), "order": index}
        for index, author in enumerate(seed.authors, start=1)
    ]
    created = api.request("POST", "/api/v1/admin/books", {
        "title": seed.title,
        "subtitle": seed.subtitle,
        "synopsis": seed.synopsis,
        "authors": authors,
        "categoryIds": [category_id],
    })
    return created["bookId"]


def find_existing_edition(api: PliegoApi, seed: EditionSeed) -> dict[str, Any] | None:
    by_sku = api.page("/api/v1/admin/editions", query=seed.sku)
    found = exact_name(by_sku, "sku", seed.sku)
    if found:
        return found
    if not seed.isbn13:
        return None
    by_isbn = api.page("/api/v1/admin/editions", query=seed.isbn13)
    found = exact_name(by_isbn, "isbn13", seed.isbn13)
    if found:
        if found.get("bookTitle") != seed.title:
            raise ApiError(f"El ISBN de '{seed.title}' ya pertenece a otra edición.")
        return found
    return None


def ensure_edition(api: PliegoApi, seed: EditionSeed, book_id: str, publisher_id: str) -> dict[str, Any]:
    existing = find_existing_edition(api, seed)
    if existing:
        if existing.get("bookId") != book_id or existing.get("sku") != seed.sku:
            raise ApiError(f"El SKU determinista {seed.sku} ya existe asociado a otro libro.")
        edition_id = existing["editionId"]
        api.request("PUT", f"/api/v1/admin/editions/{edition_id}", {
            "publisherId": publisher_id,
            "isbn13": seed.isbn13,
            "language": seed.language,
            "format": seed.format,
            "pageCount": seed.page_count,
            "publicationDate": seed.publication_date,
            "price": seed.price,
            "coverUrl": existing.get("coverUrl"),
            "coverLicense": existing.get("coverLicense"),
            "coverSourceUrl": existing.get("coverSourceUrl"),
            "coverAttribution": existing.get("coverAttribution"),
        })
        if existing.get("state") == "INACTIVE":
            api.request("PUT", f"/api/v1/admin/editions/{edition_id}/status", {"state": "ACTIVE"})
        elif existing.get("state") != "ACTIVE":
            raise ApiError(f"El estado de {seed.sku} no está disponible para el seed.")
        return existing
    created = api.request("POST", "/api/v1/admin/editions", {
        "bookId": book_id,
        "publisherId": publisher_id,
        "sku": seed.sku,
        "isbn13": seed.isbn13,
        "language": seed.language,
        "format": seed.format,
        "pageCount": seed.page_count,
        "publicationDate": seed.publication_date,
        "price": seed.price,
        "coverUrl": None,
        "coverLicense": None,
        "coverSourceUrl": None,
        "coverAttribution": None,
    })
    return {"editionId": created["editionId"], "bookId": book_id, "sku": seed.sku}


def ensure_minimum_stock(api: PliegoApi, edition_id: str, minimum: int) -> None:
    current_rows = api.page("/api/v1/admin/inventory", editionId=edition_id)
    if len(current_rows) != 1:
        raise ApiError(f"No se encontró inventario único para la edición {edition_id}.")
    current = int(current_rows[0]["stockActual"])
    difference = minimum - current
    if difference > 0:
        api.request("POST", f"/api/v1/admin/inventory/{edition_id}/entries", {
            "quantity": difference,
            "reason": "Stock mínimo idempotente para pruebas locales de desarrollo.",
        })


def retire_test_fixtures(api: PliegoApi) -> int:
    retired = 0
    for edition in api.all_pages("/api/v1/admin/editions"):
        sku = edition.get("sku")
        if not isinstance(sku, str) or not sku.startswith(TEST_FIXTURE_SKU_PREFIXES):
            continue
        if edition.get("state") not in {"ACTIVE", "INACTIVE"}:
            raise ApiError(f"El estado de la edición fixture {sku} no está disponible.")
        if edition["state"] == "ACTIVE":
            api.request("PUT", f"/api/v1/admin/editions/{edition['editionId']}/status", {"state": "INACTIVE"})
            retired += 1
    return retired


def verify_seeded_catalog(api: PliegoApi, seeds: tuple[EditionSeed, ...],
                          covers: dict[str, dict[str, str | None]]) -> tuple[int, int]:
    admin_rows = api.all_pages("/api/v1/admin/editions")
    admin_by_sku: dict[str, dict[str, Any]] = {}
    for row in admin_rows:
        sku = row.get("sku")
        if isinstance(sku, str) and sku.startswith("PLG-BK-"):
            if sku in admin_by_sku:
                raise ApiError(f"La búsqueda ADMIN devolvió más de una edición con SKU {sku}.")
            admin_by_sku[sku] = row

    for seed in seeds:
        edition = admin_by_sku.get(seed.sku)
        if edition is None:
            raise ApiError(f"La edición {seed.sku} no aparece en ADMIN después del seed.")
        cover = covers[seed.sku]
        if (edition.get("state") != "ACTIVE" or edition.get("isbn13") != seed.isbn13
                or edition.get("bookTitle") != seed.title or edition.get("coverUrl") != cover["coverUrl"]):
            raise ApiError(f"La edición ADMIN {seed.sku} no coincide exactamente con el seed y el manifiesto.")

    public_rows = api.all_pages("/api/v1/catalog/editions", sort="TITLE_ASC")
    expected_ids = {admin_by_sku[seed.sku]["editionId"] for seed in seeds}
    public_by_id = {row["editionId"]: row for row in public_rows}
    if len(public_rows) != len(seeds) or set(public_by_id) != expected_ids:
        raise ApiError(f"El catálogo público muestra {len(public_rows)} ediciones; se esperaban {len(seeds)}.")

    for seed in seeds:
        admin = admin_by_sku[seed.sku]
        public = public_by_id[admin["editionId"]]
        expected_url = covers[seed.sku]["coverUrl"]
        if public.get("coverUrl") != expected_url or public.get("isbn13") != seed.isbn13:
            raise ApiError(f"La búsqueda pública no devuelve el CDN esperado para {seed.sku}.")
        detail = api.request("GET", f"/api/v1/catalog/editions/{admin['editionId']}")
        if (detail.get("sku") != seed.sku or detail.get("isbn13") != seed.isbn13
                or detail.get("coverUrl") != expected_url):
            raise ApiError(f"El detalle público no devuelve el CDN esperado para {seed.sku}.")

    excluded_rows = [row for row in admin_rows if row.get("sku") in EXCLUDED_CATALOG_SKUS]
    if any(row.get("state") != "INACTIVE" for row in excluded_rows):
        raise ApiError("PLG-BK-000042 debe permanecer INACTIVE.")
    if any(row.get("editionId") in public_by_id for row in excluded_rows):
        raise ApiError("PLG-BK-000042 no debe aparecer en el catálogo público.")
    matched = sum(1 for seed in seeds if admin_by_sku[seed.sku].get("coverUrl") == covers[seed.sku]["coverUrl"])
    return len(public_rows), matched


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sku", action="append", help="Seed only this manifest SKU; may be repeated.")
    parser.add_argument("--cover-manifest", type=Path, default=DEFAULT_COVER_MANIFEST,
                        help="Normalized v2 manifest containing permanent SKU and CDN URL mappings.")
    parser.add_argument("--sku-registry", type=Path, default=DEFAULT_SKU_REGISTRY,
                        help="Permanent ISBN-to-SKU registry for the bibliographic staging records.")
    parser.add_argument("--staging-file", action="append", type=Path,
                        help="Bibliographic staging JSON; may be repeated (defaults to the three local catalogs).")
    args = parser.parse_args()
    covers = load_cover_manifest(args.cover_manifest)
    seeds = load_catalog_seeds(covers, args.sku_registry, tuple(args.staging_file or DEFAULT_STAGING_FILES))
    selected = seeds
    if args.sku:
        wanted = set(args.sku)
        known = {seed.sku for seed in seeds}
        unknown = wanted - known
        if unknown:
            raise ApiError("SKU no incluidos en el manifiesto: " + ", ".join(sorted(unknown)))
        selected = tuple(seed for seed in seeds if seed.sku in wanted)
    invalid = [seed.sku for seed in seeds if seed.isbn13 and not isbn_is_valid(seed.isbn13)]
    if invalid:
        print("ISBN-13 inválido en el manifiesto: " + ", ".join(invalid), file=sys.stderr)
        return 2

    api = PliegoApi(API_BASE)
    password = ADMIN_PASSWORD or getpass.getpass(f"Contraseña ADMIN para {ADMIN_EMAIL}: ")
    api.login(ADMIN_EMAIL, password)
    category_ids = ensure_categories(api)
    publisher_ids: dict[str, str] = {}

    for seed in selected:
        book_id = ensure_book(api, seed, category_ids[seed.category])
        publisher_id = publisher_ids.setdefault(seed.publisher, "")
        if not publisher_id:
            publisher_id = ensure_publisher(api, seed.publisher)
            publisher_ids[seed.publisher] = publisher_id
        edition = ensure_edition(api, seed, book_id, publisher_id)
        edition_id = edition["editionId"]
        ensure_minimum_stock(api, edition_id, seed.stock)
        print(f"{seed.sku}: {edition_id} listo")

    retired_fixtures = retire_test_fixtures(api)
    cover_result = sync_cover_manifest(api, covers)
    print("Portadas CDN: "
          f"{cover_result['updated']} actualizadas; {cover_result['skipped']} vigentes; "
          f"{cover_result['unmatched']} SKU sin edición importada; "
          f"{cover_result['excluded']} SKU excluidos del catálogo.")

    if not args.sku:
        total_public, matched = verify_seeded_catalog(api, seeds, covers)
        print(f"Verificación API: {total_public} ediciones públicas; {matched}/{len(covers)} portadas concordantes.")
        print(f"Fixtures sintéticos retirados: {retired_fixtures}.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ApiError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
