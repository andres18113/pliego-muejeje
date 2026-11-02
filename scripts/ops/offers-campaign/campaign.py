#!/usr/bin/env python3
"""Prepare and apply a finite campaign through existing PLIEGO HTTP routes only."""
import argparse
from collections import Counter, defaultdict
from contextlib import contextmanager
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[3]
PRIOR = ROOT / "docs/audit/demonstration-offers-2026-10-06/plan.json"
ZONE = ZoneInfo("America/Guayaquil")
KINDS = ("PHYSICAL", "EBOOK", "AUDIOBOOK")
DURATIONS = (3, 7, 5, 7, 3, 7, 5, 7)


class CampaignError(Exception):
    pass


def money(value):
    try:
        price = Decimal(str(value))
        if not price.is_finite() or price <= 0 or price != price.quantize(Decimal("0.01")):
            raise CampaignError("Precio base inválido.")
        return price
    except (InvalidOperation, ValueError):
        raise CampaignError("Precio base inválido.") from None


def discount(fmt, base):
    base = money(base)
    if fmt == "EBOOK":
        percent = 15 if base < 10 else 20 if base < 18 else 25
    elif fmt in {"PAPERBACK", "HARDCOVER", "AUDIOBOOK"}:
        percent = 10 if base < 15 else 15 if base < 25 else 20
    else:
        raise CampaignError("Formato no autorizado.")
    price = (base * (100 - percent) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if not 0 < price < base:
        raise CampaignError("El precio no permite un descuento válido.")
    return percent, price


def product_type(fmt):
    return "PHYSICAL" if fmt in {"PAPERBACK", "HARDCOVER"} else fmt


def exclusions():
    raw = PRIOR.read_bytes()
    rows = json.loads(raw)
    return ({str(r["editionId"]) for r in rows}, {r["sku"] for r in rows}, hashlib.sha256(raw).hexdigest())


def eligible(row, excluded_ids, excluded_skus):
    try:
        fmt = row["format"]
        discount(fmt, row["price"])
        cover = urlsplit(row.get("coverUrl") or "")
        return (str(row["editionId"]).isdigit() and str(row["editionId"]) not in excluded_ids
                and row["sku"] not in excluded_skus and row["sku"] != "PLG-BK-000042"
                and re.fullmatch(r"PLG-BK-[0-9]{6}", row["sku"]) is not None
                and row["state"] == "ACTIVE" and row.get("offerRowExists") is False
                and cover.scheme == "https" and cover.netloc == "covers.pliegolibros.com"
                and cover.path.startswith("/covers/")
                and (fmt in {"EBOOK", "AUDIOBOOK"} or
                     isinstance(row.get("stockActual"), int) and row["stockActual"] > 0))
    except (KeyError, TypeError, CampaignError):
        return False


def public_matches(row, detail):
    return (detail.get("available") is True and detail.get("offer") is None
            and all(str(detail.get(k)) == str(row.get(k))
                    for k in ("editionId", "sku", "format", "coverUrl", "price")))


def generate_plan(api, excluded_ids, excluded_skus, per_type, base_url):
    if per_type not in {6, 7, 8}:
        raise CampaignError("Seleccione entre 6 y 8 ediciones por tipo (18–24 total).")
    buckets = defaultdict(lambda: defaultdict(list))
    for row in sorted(api.editions(), key=lambda r: (r["sku"], int(r["editionId"]))):
        if eligible(row, excluded_ids, excluded_skus):
            percent, _ = discount(row["format"], row["price"])
            buckets[product_type(row["format"])][percent].append(row)
    chosen = []
    for kind in KINDS:
        selected = []
        # Round robin through available authorized tiers; selection is deterministic.
        tiers = buckets[kind]
        while len(selected) < per_type and any(tiers.values()):
            for percent in sorted(tiers):
                if not tiers[percent] or len(selected) == per_type:
                    continue
                row = tiers[percent].pop(0)
                try:
                    detail = api.detail(row["editionId"])
                except CampaignError:
                    continue
                if public_matches(row, detail):
                    selected.append(row)
        if len(selected) != per_type:
            raise CampaignError(f"Candidatos públicos elegibles insuficientes para {kind}.")
        for index, row in enumerate(selected):
            percent, price = discount(row["format"], row["price"])
            chosen.append(dict(editionId=row["editionId"], sku=row["sku"], title=row["bookTitle"],
                format=row["format"], productType=kind, basePrice=f'{money(row["price"]):.2f}',
                stockActual=row["stockActual"], coverUrl=row["coverUrl"], offerPrice=f"{price:.2f}",
                discountPercentRequested=percent, durationDays=DURATIONS[index]))
    return dict(version=1, baseUrl=base_url.rstrip("/"), timezone="America/Guayaquil",
                excludedPlanSha256=exclusions()[2], counts=dict(Counter(r["productType"] for r in chosen)),
                editions=chosen)


def validate_plan(plan):
    ids, skus, digest = exclusions()
    if plan.get("version") != 1 or plan.get("timezone") != "America/Guayaquil" or plan.get("excludedPlanSha256") != digest:
        raise CampaignError("Plan incompatible o exclusiones alteradas.")
    rows = plan.get("editions", [])
    counts = Counter(r.get("productType") for r in rows)
    if set(counts) != set(KINDS) or len(set(counts.values())) != 1 or next(iter(counts.values())) not in {6, 7, 8} or dict(counts) != plan.get("counts"):
        raise CampaignError("La campaña debe contener 18–24 ediciones equilibradas.")
    if len({r["editionId"] for r in rows}) != len(rows) or len({r["sku"] for r in rows}) != len(rows):
        raise CampaignError("El plan repite ediciones o SKU.")
    if any(not {3, 7} <= {r["durationDays"] for r in rows if r["productType"] == kind} for kind in KINDS):
        raise CampaignError("Cada tipo requiere ofertas de 3 y 7 días.")
    for row in rows:
        current = dict(row, price=row["basePrice"], state="ACTIVE", offerRowExists=False)
        percent, price = discount(row["format"], row["basePrice"])
        if (not eligible(current, ids, skus) or product_type(row["format"]) != row["productType"]
                or row.get("discountPercentRequested") != percent or row.get("offerPrice") != f"{price:.2f}"
                or type(row.get("durationDays")) is not int or row["durationDays"] not in {3, 5, 7}
                or "startsAt" in row or "endsAt" in row):
            raise CampaignError(f'Plan no autorizado para {row.get("sku", "?")}.')


def requests_for(plan, now):
    if now.tzinfo is None:
        raise CampaignError("La fecha debe tener zona horaria.")
    start = now.astimezone(ZONE).replace(microsecond=0)
    return [dict(row, request=dict(offerPrice=row["offerPrice"], startsAt=start.isoformat(),
                 endsAt=(start + timedelta(days=row["durationDays"])).isoformat(), offerCopy=None, terms=None))
            for row in plan["editions"]]


def preflight(api, row):
    candidates = [r for r in api.editions(row["sku"]) if r["editionId"] == row["editionId"]]
    if len(candidates) != 1:
        raise CampaignError(f'La edición {row["sku"]} cambió o desapareció.')
    current = candidates[0]
    ids, skus, _ = exclusions()
    if not eligible(current, ids, skus) or any(current.get(k) != row.get(k)
            for k in ("sku", "format", "stockActual", "coverUrl")) or current["price"] != row["basePrice"]:
        raise CampaignError(f'Preflight rechazado para {row["sku"]}: oferta existente o catálogo modificado.')
    if not public_matches(current, api.detail(row["editionId"])):
        raise CampaignError(f'La edición {row["sku"]} no está disponible públicamente sin oferta.')


def append_journal(path, event):
    if path is None:
        return
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "a") as output:
        output.write(json.dumps(event, ensure_ascii=False) + "\n")
        output.flush()
        os.fsync(output.fileno())


def verify_detail(api, row):
    detail = api.detail(row["editionId"])
    offer = detail.get("offer") or {}
    base, price = money(row["basePrice"]), money(row["offerPrice"])
    percent = ((base - price) * 100 / base).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    expected_days = (datetime.fromisoformat(row["request"]["endsAt"]).astimezone(ZONE).date()
                     - datetime.now(ZONE).date()).days
    if (detail.get("price") != row["offerPrice"] or offer.get("originalPrice") != row["basePrice"]
            or offer.get("discountAmount") != f"{base-price:.2f}" or offer.get("savingsPercent") != f"{percent:.2f}"
            or any(offer.get(k) != row["request"][k] for k in ("startsAt", "endsAt"))
            or offer.get("daysRemaining") != expected_days or offer.get("endingSoon") != (expected_days <= 3)):
        raise CampaignError(f'La verificación pública falló para {row["sku"]}.')
    return detail


def run(api, plan, apply=False, journal=None, now=None, on_preflight=None):
    validate_plan(plan)
    # All rows must pass before the first write. Recheck immediately before each PUT.
    for row in plan["editions"]:
        preflight(api, row)
    rows = requests_for(plan, now or datetime.now(ZONE))
    if on_preflight:
        on_preflight(rows)
    if not apply:
        return dict(mode="dry-run", counts=plan["counts"], preflight=rows)
    if journal is None:
        raise CampaignError("La aplicación requiere un diario de escrituras.")
    baseline_rows = api.offers()
    baseline = {r["editionId"] for r in baseline_rows}
    verified = []
    for row in rows:
        preflight(api, row)
        append_journal(journal, dict(stage="attempt", editionId=row["editionId"], sku=row["sku"], request=row["request"]))
        # Server enforces create-only/base/stock atomically; never retry an uncertain response.
        api.put_offer(row["editionId"], row["request"], row["basePrice"], row["stockActual"])
        append_journal(journal, dict(stage="http-204", editionId=row["editionId"]))
        verified.append(verify_detail(api, row))
        append_journal(journal, dict(stage="public-verified", editionId=row["editionId"]))
    expected = baseline | {r["editionId"] for r in rows}
    if {r["editionId"] for r in api.offers()} != expected:
        raise CampaignError("La lista pública no coincide con las ofertas previas más la campaña.")
    expected_counts = {}
    for kind in KINDS:
        campaign_ids = {r["editionId"] for r in rows if r["productType"] == kind}
        expected_kind = campaign_ids | {r["editionId"] for r in baseline_rows if product_type(r["format"]) == kind}
        expected_counts[kind] = len(expected_kind)
        for sort in ("RELEVANCE", "ENDING_SOON", "PRICE_ASC", "PRICE_DESC"):
            filtered = api.offers(kind, sort)
            if expected_kind != {r["editionId"] for r in filtered}:
                raise CampaignError(f"El filtro {kind}/{sort} no coincide con las ediciones esperadas.")
            verify_order(filtered, sort)
    facets = api.get("/api/v1/catalog/offers/filter-options", authenticated=False)
    if facets.get("timezone") != "America/Guayaquil" or facets.get("endingSoonDays") != 3 or int(facets["totalCount"]) != len(expected):
        raise CampaignError("Las facetas no coinciden con el catálogo público.")
    if {r['code']: int(r['count']) for r in facets['productTypes']} != expected_counts:
        raise CampaignError("Los conteos por formato no coinciden con las listas públicas.")
    return dict(mode="applied", counts=plan["counts"], preflight=rows, verifiedDetails=verified,
                facets=facets, endingSoonCount=sum(r["offer"]["endingSoon"] for r in verified))


def verify_order(rows, sort):
    if sort in {'PRICE_ASC', 'PRICE_DESC'}:
        keys = [money(r['price']) for r in rows]
    elif sort == 'ENDING_SOON':
        keys = [datetime.fromisoformat(r['offer']['endsAt']) for r in rows]
    else:
        keys = [(-money(r['offer']['discountAmount']), datetime.fromisoformat(r['offer']['endsAt'])) for r in rows]
    if keys != sorted(keys, reverse=sort == 'PRICE_DESC'):
        raise CampaignError(f"El orden público {sort} es incorrecto.")


def validate_target(base_url, target, authorization):
    parsed = urlsplit(base_url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise CampaignError("La URL debe contener solo esquema, host y puerto.")
    try:
        local = parsed.hostname == "localhost" or ipaddress.ip_address(parsed.hostname).is_loopback
    except (ValueError, TypeError):
        local = False
    if target == "local" and local and parsed.scheme in {"http", "https"}:
        return
    if target == "production" and authorization and base_url.rstrip("/") == "https://api.pliegolibros.com":
        return
    raise CampaignError("Destino rechazado. Producción requiere autorización explícita y su URL canónica.")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CampaignError("La API devolvió una redirección; operación detenida.")


class Api:
    def __init__(self, base_url, token):
        self.base = base_url.rstrip("/")
        self.token = token.removeprefix("Bearer ").strip()
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(self, path, method="GET", body=None, authenticated=True, extra_headers=None):
        headers = {"Accept": "application/json"}
        if authenticated:
            headers["Authorization"] = "Bearer " + self.token
        if body is not None:
            headers["Content-Type"] = "application/json"
        if extra_headers:
            headers.update(extra_headers)
        request = Request(self.base + path, headers=headers, method=method,
                          data=None if body is None else json.dumps(body).encode())
        try:
            with self.opener.open(request, timeout=30) as response:
                expected = 204 if method == "PUT" else 200
                if response.status != expected:
                    raise CampaignError(f"Estado HTTP inesperado: {response.status}.")
                raw = response.read()
                return json.loads(raw) if raw else None
        except HTTPError as error:
            raise CampaignError(f"La API rechazó {method} {path}: HTTP {error.code}.") from None
        except (URLError, TimeoutError):
            raise CampaignError(f"Sin respuesta confirmada para {method} {path}; revise el diario antes de continuar.") from None

    def get(self, path, authenticated=True):
        return self.request(path, authenticated=authenticated)

    def pages(self, path, params, authenticated):
        rows, page = [], 0
        while True:
            result = self.get(path + "?" + urlencode(dict(params, page=page, pageSize=50)), authenticated)
            batch = result["items"]
            rows.extend(batch)
            if len(rows) >= int(result["totalCount"]):
                if len({r["editionId"] for r in rows}) != len(rows):
                    raise CampaignError("El catálogo cambió durante la paginación; repita el preflight.")
                return rows
            if not batch:
                raise CampaignError("Paginación incompleta.")
            page += 1

    def editions(self, sku=None):
        return self.pages("/api/v1/admin/editions", {} if sku is None else {"query": sku}, True)

    def detail(self, edition_id):
        return self.get("/api/v1/catalog/editions/" + edition_id, authenticated=False)

    def offers(self, kind=None, sort="RELEVANCE"):
        params = {"sort": sort}
        if kind:
            params["productType"] = kind
        return self.pages("/api/v1/catalog/offers", params, False)

    def put_offer(self, edition_id, payload, expected_base, expected_stock):
        self.request("/api/v1/admin/editions/" + edition_id + "/offer", "PUT", payload,
            extra_headers={"If-None-Match": "*", "X-Expected-Base-Price": expected_base,
                           "X-Expected-Stock": "NONE" if expected_stock is None else str(expected_stock)})


def write_json(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(data, output, indent=2, ensure_ascii=False)
        output.write("\n")


def archive_plan(base_url, per_type):
    """Historical candidates only; every candidate still requires live API preflight."""
    sources = [
        ROOT / "docs/audit/physical-catalog-cleanup-2026-10-05/editions-final.json",
        ROOT / "docs/audit/physical-catalog-180-2026-10-05/detail-verification.json",
        ROOT / "docs/audit/digital-publication-2026-10-04/api-verification.json",
    ]
    catalog, physical, digital = [json.loads(path.read_text())["records"] for path in sources]
    public = {r["editionId"]: r for r in physical + digital if r.get("available") is True}
    ids, skus, _ = exclusions()

    class Archive:
        def editions(self):
            # This false is a candidate assumption, never proof of current absence.
            return [dict(r, offerRowExists=False) for r in catalog if r["editionId"] in public]

        def detail(self, edition_id):
            row = next(r for r in catalog if r["editionId"] == edition_id)
            return dict(row, available=True, offer=None)

    plan = generate_plan(Archive(), ids, skus, per_type, base_url)
    plan["evidence"] = dict(status="HISTORICAL_CANDIDATES_REQUIRING_LIVE_PREFLIGHT",
        currentOfferRowPresence="UNKNOWN", currentStockAndAvailability="UNKNOWN",
        warning="Datos archivados del 4–5 de octubre; no se consultó producción. El preflight actual debe aprobar cada candidato.",
        sources=[dict(path=str(path.relative_to(ROOT)), sha256=hashlib.sha256(path.read_bytes()).hexdigest()) for path in sources])
    return plan


def print_preflight(rows):
    print("editionId\tSKU\tformato\tstock\tbase\toferta\t% solicitado\tinicio\tfin", flush=True)
    for row in rows:
        print("\t".join(str(row[key]) for key in ("editionId", "sku", "format", "stockActual", "basePrice", "offerPrice", "discountPercentRequested"))
              + "\t" + row["request"]["startsAt"] + "\t" + row["request"]["endsAt"], flush=True)


@contextmanager
def operator_lock(base_url):
    digest = hashlib.sha256(base_url.encode()).hexdigest()[:20]
    path = Path("/tmp") / f"pliego-offers-{digest}.lock"
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise CampaignError("Otra campaña usa este destino desde este equipo.") from None
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["draft", "plan", "run"])
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--target", choices=["local", "production"], default="local")
    parser.add_argument("--authorization-reference")
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--per-type", type=int, default=7)
    parser.add_argument("--apply", action="store_true", help="Sin esta opción solo se verifica el preflight.")
    parser.add_argument("--exclusive-writer-window", action="store_true")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--journal", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "draft":
            if args.apply:
                raise CampaignError("Un borrador histórico no puede escribir ofertas.")
            if args.base_url.rstrip("/") != "https://api.pliegolibros.com":
                validate_target(args.base_url, "local", None)
            plan = archive_plan(args.base_url, args.per_type)
            write_json(args.plan, plan)
            print(json.dumps(dict(mode="historical-draft", counts=plan["counts"], warning=plan["evidence"]["warning"]), ensure_ascii=False))
            return 0
        validate_target(args.base_url, args.target, args.authorization_reference)
        token = os.environ.get("OFFER_ADMIN_TOKEN", "")
        if not token.strip():
            raise CampaignError("Defina OFFER_ADMIN_TOKEN sin incluirlo en argumentos ni artefactos.")
        if args.apply and (args.command != "run" or not args.exclusive_writer_window or args.journal is None or args.report is None):
            raise CampaignError("Aplicar requiere run, --exclusive-writer-window, --journal y --report.")
        if args.report and args.report.exists() or args.apply and args.journal.exists():
            raise CampaignError("El informe o diario ya existe; revise la ejecución previa.")
        api = Api(args.base_url, token)
        with operator_lock(args.base_url.rstrip("/")):
            if args.command == "plan":
                ids, skus, _ = exclusions()
                plan = generate_plan(api, ids, skus, args.per_type, args.base_url)
                write_json(args.plan, plan)
                result = dict(mode="planned", counts=plan["counts"], plan=str(args.plan))
            else:
                plan = json.loads(args.plan.read_text())
                if plan.get("baseUrl") != args.base_url.rstrip("/"):
                    raise CampaignError("El destino no coincide con el plan aprobado.")
                result = run(api, plan, args.apply, args.journal, on_preflight=print_preflight)
                if args.report:
                    write_json(args.report, result)
        print(json.dumps({k: result[k] for k in ("mode", "counts")}, ensure_ascii=False))
        return 0
    except (CampaignError, KeyError, ValueError, OSError) as error:
        print(f"Campaña detenida: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
