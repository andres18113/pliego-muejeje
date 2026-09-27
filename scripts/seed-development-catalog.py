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
from decimal import Decimal
from typing import Any


API_BASE = os.environ.get("PLIEGO_API_BASE_URL", "http://127.0.0.1:8080").rstrip("/")
ADMIN_EMAIL = os.environ.get("PLIEGO_ADMIN_EMAIL", "admin@pliego.local")
ADMIN_PASSWORD = os.environ.get("PLIEGO_ADMIN_PASSWORD")
PAGE_SIZE = 50
DEFAULT_COVER_MANIFEST = Path(__file__).resolve().parent.parent / "covers/generated/manifest.json"
PERMANENT_SKU_PATTERN = re.compile(r"PLG-BK-[0-9]{6,}\Z")


@dataclass(frozen=True)
class CategorySeed:
    slug: str
    name: str
    parent_slug: str | None = None


@dataclass(frozen=True)
class EditionSeed:
    sku: str
    title: str
    authors: tuple[str, ...]
    category: str
    publisher: str
    language: str
    format: str
    page_count: int
    publication_date: str
    price: str
    stock: int
    synopsis: str
    isbn13: str | None = None


# These exact labels and slugs are already used by the project's public catalog
# category examples and frontend catalog fixtures.
CATEGORIES = (
    CategorySeed("narrativa", "Narrativa"),
    CategorySeed("novela", "Novela histórica", "narrativa"),
    CategorySeed("poesia", "Poesía"),
    CategorySeed("verso", "Verso libre", "poesia"),
    CategorySeed("ciencia", "Ciencia"),
    CategorySeed("astronomia", "Astronomía", "ciencia"),
    CategorySeed("ensayo", "Ensayo"),
)


EDITIONS = (
    EditionSeed("PLG-DEV-NAR-001", "Cien años de soledad", ("Gabriel García Márquez",), "narrativa",
        "Vintage Español", "es", "PAPERBACK", 494, "2009-01-01", "17.50", 8,
        "La saga de la familia Buendía y la historia de Macondo.", "9780307474728"),
    EditionSeed("PLG-DEV-NAR-002", "One Hundred Years of Solitude", ("Gabriel García Márquez",), "narrativa",
        "Penguin Books, Limited", "en", "PAPERBACK", 417, "2007-01-01", "16.99", 4,
        "The Buendía family saga unfolds across generations in Macondo.", "9780141032436"),
    EditionSeed("PLG-DEV-NOV-003", "Don Quijote de la Mancha", ("Miguel de Cervantes",), "novela",
        "Susaeta", "es", "HARDCOVER", 152, "2016-04-06", "24.95", 0,
        "Las aventuras del caballero manchego y su escudero Sancho Panza.", "9788467750911"),
    EditionSeed("PLG-DEV-NAR-004", "1984", ("George Orwell",), "narrativa", "Signet Classics",
        "en", "PAPERBACK", 328, "1949-06-08", "9.99", 7,
        "A dystopian novel about surveillance, language, and political power.", "9780451524935"),
    EditionSeed("PLG-DEV-NAR-005", "The Hobbit", ("J. R. R. Tolkien",), "narrativa",
        "Houghton Mifflin Harcourt", "en", "HARDCOVER", 310, "1937-09-21", "24.95", 3,
        "Bilbo Baggins joins a company of dwarves on a journey to the Lonely Mountain.", "9780547928227"),
    EditionSeed("PLG-DEV-NAR-006", "El principito", ("Antoine de Saint-Exupéry",), "narrativa",
        "Salamandra", "es", "PAPERBACK", 93, "2010-01-01", "12.95", 0,
        "Un aviador conoce a un pequeño viajero que comparte preguntas sobre la vida.", "9788498381498"),
    EditionSeed("PLG-DEV-NOV-007", "Pride and Prejudice", ("Jane Austen",), "novela",
        "Penguin Classics", "en", "PAPERBACK", 480, "1813-01-28", "10.50", 5,
        "Elizabeth Bennet navigates family expectations, first impressions, and affection.", "9780141439518"),
    EditionSeed("PLG-DEV-NOV-008", "La sombra del viento", ("Carlos Ruiz Zafón",), "novela",
        "Editorial Planeta", "es", "PAPERBACK", 576, "2001-04-01", "18.75", 2,
        "Daniel Sempere busca la historia de un autor olvidado en la Barcelona de posguerra.", "9788408043645"),
    EditionSeed("PLG-DEV-NAR-009", "Dune", ("Frank Herbert",), "narrativa", "Ace Books",
        "en", "PAPERBACK", 688, "1965-08-01", "16.95", 1,
        "Paul Atreides enters a struggle over the desert planet Arrakis and its spice.", "9780441172719"),
    EditionSeed("PLG-DEV-NOV-010", "El nombre de la rosa", ("Umberto Eco",), "novela",
        "Debolsillo", "es", "PAPERBACK", 607, "2011-05-24", "18.50", 4,
        "Un fraile franciscano investiga una serie de muertes en una abadía medieval.", "9780307882776"),
    EditionSeed("PLG-DEV-NAR-011", "Fahrenheit 451", ("Ray Bradbury",), "narrativa",
        "Simon & Schuster", "en", "HARDCOVER", 249, "1953-10-19", "19.50", 0,
        "A fireman begins to question a society that burns books.", "9781451673319"),
    EditionSeed("PLG-DEV-NAR-012", "El coronel no tiene quien le escriba", ("Gabriel García Márquez",),
        "narrativa", "Plaza & Janés", "es", "PAPERBACK", 98, "2003-05-01", "11.95", 6,
        "Un coronel retirado espera una carta y una pensión que no llegan.", "9788497592352"),

    EditionSeed("PLG-DEV-POE-013", "Veinte poemas de amor y una canción desesperada", ("Pablo Neruda",),
        "poesia", "Navona", "es", "PAPERBACK", 96, "2014-03-17", "9.95", 4,
        "Un poemario temprano de Pablo Neruda sobre el amor, la ausencia y el paisaje.", "9788416259595"),
    EditionSeed("PLG-DEV-VER-014", "Poeta en Nueva York", ("Federico García Lorca",), "verso",
        "Lumen España", "es", "PAPERBACK", 128, "1998-04-01", "14.95", 2,
        "Poemas escritos durante la estancia de Lorca en Nueva York.", "9788426423122"),
    EditionSeed("PLG-DEV-POE-015", "Leaves of Grass", ("Walt Whitman",), "poesia", "Penguin Classics",
        "en", "PAPERBACK", 736, "1855-07-04", "17.95", 1,
        "Whitman's evolving collection of poems about people, place, and the self.", "9780140421996"),
    EditionSeed("PLG-DEV-VER-016", "El libro de las preguntas", ("Pablo Neruda",), "verso",
        "Martínez Roca", "es", "HARDCOVER", 192, "2000-03-01", "13.50", 5,
        "Preguntas breves y poéticas de la colección póstuma de Neruda.", "9788427025219"),
    EditionSeed("PLG-DEV-POE-017", "Versos sencillos", ("José Martí",), "poesia",
        "Betania", "es", "PAPERBACK", 112, "2003-04-02", "10.25", 0,
        "Poemas de José Martí reunidos en una colección publicada en Nueva York.", "9788480171823"),
    EditionSeed("PLG-DEV-VER-018", "Twenty Love Poems and a Song of Despair", ("Pablo Neruda",),
        "verso", "Penguin Books", "en", "PAPERBACK", 96, "1924-01-01", "12.99", 3,
        "An English-language edition of Neruda's early love poems.", "9780143039969"),

    EditionSeed("PLG-DEV-SCI-019", "Cosmos", ("Carl Sagan",), "ciencia", "Ballantine Books",
        "en", "PAPERBACK", 432, "1980-01-01", "21.50", 4,
        "Sagan explores astronomy, life, and humanity's place in the universe.", "9780345539434"),
    EditionSeed("PLG-DEV-AST-020", "A Brief History of Time", ("Stephen Hawking",), "astronomia",
        "Bantam Books", "en", "PAPERBACK", 212, "1988-04-01", "14.50", 0,
        "An introduction to cosmology, black holes, and the nature of time.", "9780553380163"),
    EditionSeed("PLG-DEV-SCI-021", "Astrophysics for People in a Hurry", ("Neil deGrasse Tyson",),
        "ciencia", "W. W. Norton", "en", "HARDCOVER", 224, "2017-05-02", "18.95", 3,
        "A concise tour of the ideas and discoveries that shape modern astrophysics.", "9780393609394"),
    EditionSeed("PLG-DEV-AST-022", "El universo en tu mano", ("Christophe Galfard",), "astronomia",
        "Blackie Books", "es", "PAPERBACK", 464, "2016-01-01", "22.00", 1,
        "Un recorrido divulgativo por el espacio, el tiempo y la física moderna.", "9788416290628"),

    EditionSeed("PLG-DEV-ENS-023", "Sapiens: De animales a dioses", ("Yuval Noah Harari",), "ensayo",
        "Debolsillo", "es", "PAPERBACK", 496, "2023-02-23", "20.00", 2,
        "Una historia de la humanidad desde las primeras sociedades hasta el presente.", "9788466347518"),
    EditionSeed("PLG-DEV-ENS-024", "A Room of One's Own", ("Virginia Woolf",), "ensayo",
        "Harcourt", "en", "PAPERBACK", 112, "1929-10-24", "11.50", 6,
        "Woolf's essay examines women's writing, education, and material independence.", "9780156787338"),
    EditionSeed("PLG-DEV-ENS-025", "Educated", ("Tara Westover",), "ensayo", "Random House",
        "en", "HARDCOVER", 352, "2018-02-20", "23.00", 0,
        "Westover recounts her education and departure from an isolated childhood.", "9780399590504"),
    EditionSeed("PLG-DEV-ENS-026", "El laberinto de la soledad", ("Octavio Paz",), "ensayo",
        "Fondo de Cultura Económica", "es", "PAPERBACK", 352, "1990-11-02", "16.00", 1,
        "Paz reflexiona sobre la identidad mexicana, su historia y su vida cultural.", "9789681616434"),
    EditionSeed("PLG-DEV-ENS-027", "Meditations", ("Marcus Aurelius",), "ensayo", "Modern Library",
        "en", "PAPERBACK", 304, "2006-01-01", "12.95", 4,
        "A collection of Stoic reflections by the Roman emperor.", "9780812968255"),
    EditionSeed("PLG-DEV-ENS-028", "Una habitación propia", ("Virginia Woolf",), "ensayo",
        "Alianza Editorial", "es", "PAPERBACK", 160, "2023-02-02", "12.75", 0,
        "La reflexión de Woolf sobre las condiciones materiales para escribir.", "9788411481892"),
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
    for index, record in enumerate(manifest["records"]):
        if not isinstance(record, dict):
            raise ApiError(f"El registro {index} del manifiesto de portadas no es válido.")
        sku = record.get("permanent_sku")
        object_key = record.get("r2_object_key")
        cover_url = record.get("cover_url")
        if not isinstance(sku, str) or not PERMANENT_SKU_PATTERN.fullmatch(sku):
            raise ApiError(f"El registro {index} tiene un SKU permanente no válido.")
        if object_key != f"covers/editions/{sku}.webp":
            raise ApiError(f"El registro {sku} no usa su clave canónica de R2.")
        parsed_url = urllib.parse.urlsplit(cover_url) if isinstance(cover_url, str) else None
        if (parsed_url is None or parsed_url.scheme != "https"
                or parsed_url.hostname != "covers.pliegolibros.com"
                or parsed_url.path != f"/{object_key}" or parsed_url.username or parsed_url.password
                or parsed_url.query or parsed_url.fragment):
            raise ApiError(f"El registro {sku} no contiene una URL CDN canónica.")
        if sku in covers:
            raise ApiError(f"El manifiesto contiene el SKU duplicado {sku}.")
        isbn13 = record.get("isbn13")
        covers[sku] = {"coverUrl": cover_url, "isbn13": isbn13 if isinstance(isbn13, str) else None}
    return covers


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


def sync_cover_manifest(api: PliegoApi, covers: dict[str, dict[str, str | None]]) -> dict[str, int]:
    editions_by_sku: dict[str, dict[str, Any]] = {}
    page = 0
    while True:
        query = urllib.parse.urlencode({"query": "PLG-BK-", "page": str(page), "pageSize": str(PAGE_SIZE)})
        response = api.request("GET", "/api/v1/admin/editions?" + query)
        rows = response.get("items") if isinstance(response, dict) else None
        if not isinstance(rows, list):
            raise ApiError("La búsqueda ADMIN de ediciones devolvió una respuesta inválida.")
        for row in rows:
            sku = row.get("sku") if isinstance(row, dict) else None
            if isinstance(sku, str) and sku in covers:
                editions_by_sku[sku] = row
        if len(rows) < PAGE_SIZE:
            break
        page += 1

    updated = 0
    skipped = 0
    for sku, cover in covers.items():
        edition = editions_by_sku.get(sku)
        if edition is None:
            continue
        manifest_isbn = cover["isbn13"]
        if manifest_isbn and edition.get("isbn13") and edition["isbn13"] != manifest_isbn:
            raise ApiError(f"El ISBN de {sku} no coincide con el manifiesto de portadas.")
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
        "unmatched": len(covers) - len(editions_by_sku),
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
        and author_names == list(seed.authors)
        and category_ids == [category_id]
        and book.get("state") == "ACTIVE"
    )


def ensure_book(api: PliegoApi, seed: EditionSeed, category_id: str) -> str:
    candidates = api.page("/api/v1/admin/books", query=seed.title, state="ACTIVE")
    for candidate in candidates:
        if candidate.get("title") == seed.title and book_matches(candidate, seed, category_id):
            return candidate["bookId"]
    authors = [
        {"authorId": ensure_author(api, author), "order": index}
        for index, author in enumerate(seed.authors, start=1)
    ]
    created = api.request("POST", "/api/v1/admin/books", {
        "title": seed.title,
        "subtitle": None,
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


def sync_stock(api: PliegoApi, edition_id: str, desired: int) -> None:
    current_rows = api.page("/api/v1/admin/inventory", editionId=edition_id)
    if len(current_rows) != 1:
        raise ApiError(f"No se encontró inventario único para la edición {edition_id}.")
    current = int(current_rows[0]["stockActual"])
    difference = desired - current
    if difference > 0:
        api.request("POST", f"/api/v1/admin/inventory/{edition_id}/entries", {
            "quantity": difference,
            "reason": "Carga idempotente del catálogo de desarrollo.",
        })
    elif difference < 0:
        api.request("POST", f"/api/v1/admin/inventory/{edition_id}/adjustments", {
            "type": "ADJUSTMENT_OUT",
            "quantity": -difference,
            "reason": "Ajuste idempotente del catálogo de desarrollo.",
        })


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sku", action="append", help="Seed only this deterministic edition SKU; may be repeated.")
    parser.add_argument("--cover-manifest", type=Path, default=DEFAULT_COVER_MANIFEST,
                        help="Prepared manifest containing permanent SKU and CDN URL mappings.")
    args = parser.parse_args()
    covers = load_cover_manifest(args.cover_manifest)
    selected = EDITIONS
    if args.sku:
        wanted = set(args.sku)
        known = {seed.sku for seed in EDITIONS}
        unknown = wanted - known
        if unknown:
            raise ApiError("SKU no incluidos en el manifiesto: " + ", ".join(sorted(unknown)))
        selected = tuple(seed for seed in EDITIONS if seed.sku in wanted)
    invalid = [seed.sku for seed in EDITIONS if seed.isbn13 and not isbn_is_valid(seed.isbn13)]
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
        sync_stock(api, edition_id, seed.stock)
        print(f"{seed.sku}: {edition_id} listo")

    cover_result = sync_cover_manifest(api, covers)
    print("Portadas CDN: "
          f"{cover_result['updated']} actualizadas; {cover_result['skipped']} vigentes; "
          f"{cover_result['unmatched']} SKU sin edición importada.")

    admin_editions = api.page("/api/v1/admin/editions", query="PLG-DEV-")
    seed_rows = [row for row in admin_editions if row.get("sku", "").startswith("PLG-DEV-")]
    if len(seed_rows) < len(EDITIONS):
        raise ApiError(f"La búsqueda ADMIN devolvió {len(seed_rows)} ediciones seed; se esperaban {len(EDITIONS)}.")
    public_rows = api.page("/api/v1/catalog/editions", sort="TITLE_ASC")
    public_by_id = {row["editionId"]: row for row in public_rows}
    public_ids = {row["editionId"] for row in seed_rows}
    visible = [public_by_id[edition_id] for edition_id in public_ids if edition_id in public_by_id]
    categories = api.request("GET", "/api/v1/catalog/categories")["items"]
    options = api.request("GET", "/api/v1/catalog/filter-options")
    if len(visible) != len(EDITIONS):
        raise ApiError(f"El catálogo público muestra {len(visible)} de {len(EDITIONS)} ediciones seed.")
    languages = {row["language"] for row in visible}
    formats = {row["format"] for row in visible}
    if not {"en", "es"}.issubset(languages) or not {"PAPERBACK", "HARDCOVER"}.issubset(formats):
        raise ApiError("La búsqueda pública no expone los idiomas o formatos definidos por el seed.")
    available = sum(1 for row in visible if row["available"])
    unavailable = len(visible) - available
    prices = [Decimal(row["price"]) for row in visible]
    by_language = {code: sum(1 for row in visible if row["language"] == code) for code in sorted(languages)}
    by_format = {kind: sum(1 for row in visible if row["format"] == kind) for kind in sorted(formats)}
    by_category = {}
    for category in categories:
        query = urllib.parse.urlencode({"category": category["slug"], "page": 0, "pageSize": PAGE_SIZE})
        by_category[category["slug"]] = len(api.request("GET", "/api/v1/catalog/editions?" + query)["items"])
    print(f"Resumen: {len(categories)} categorías públicas; {len(seed_rows)} ediciones ADMIN; "
          f"{len(visible)} visibles; {available} disponibles; {unavailable} sin stock.")
    print("Filtros públicos:", json.dumps({
        "languages": by_language,
        "formats": by_format,
        "minimumPrice": str(min(prices)),
        "maximumPrice": str(max(prices)),
        "categoryCounts": by_category,
    }, ensure_ascii=False, sort_keys=True))
    print("Idiomas/filtros:", json.dumps(options, ensure_ascii=False, sort_keys=True))
    print("Categorías:", json.dumps(categories, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ApiError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
