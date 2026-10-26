"""Budget the actual customer JDBC SELECTs on fixtures left by the HTTP gates.

No third-party Python dependencies. EXPLAIN ANALYZE runs in rollback transactions
because authorized order readers reconcile state and quote readers acquire locks.
Authentication/email commands are planned only: executing them would require
consuming live tokens and is covered by the HTTP authentication gates instead.
"""

import argparse
import json
from pathlib import Path
import re
import subprocess


MODULES = Path(__file__).resolve().parents[2] / "main/java/com/pliego/modules"


def psql(sql):
    result = subprocess.run(
        ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
        text=True, capture_output=True, timeout=30, check=True,
    )
    return result.stdout.strip()


def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def gateway_queries():
    """Read Java strings so changing a gateway cannot leave an old copy green."""
    excluded = {"JdbcAdminCatalogGateway", "JdbcAdminCustomerGateway",
                "JdbcAdminOrderGateway", "JdbcInventoryGateway",
                "JdbcMailOutboxGateway", "JdbcHomeDeliveryGateway",
                "JdbcEditionOfferGateway"}
    queries = {}
    for path in sorted(MODULES.glob("*/gateway/Jdbc*Gateway.java")):
        if path.stem in excluded:
            continue
        source = path.read_text()
        constant = r'private static final String (\w+)\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+);'
        for match in re.finditer(constant, source):
            sql = "".join(json.loads('"' + part + '"') for part in
                          re.findall(r'"((?:[^"\\]|\\.)*)"', match[2]))
            if sql.startswith("SELECT "):
                queries[f"{path.stem}.{match[1]}"] = sql
        # Remove constant declarations to avoid counting their first fragment twice.
        source = re.sub(constant, "", source)
        for match in re.finditer(r'"(SELECT [^"\n]+)"', source):
            sql = match[1]
            function = re.search(r"pliego\.(fn_\w+)", sql)[1]
            # Scheduled billing workers do not serve customer requests.
            if function in {"fn_invoice_artifact_claim", "fn_invoice_artifact_complete",
                            "fn_invoice_artifact_fail"}:
                continue
            queries[f"{path.stem}.{function}"] = sql
    return queries


def fixtures():
    # Offer HTTP gates can exhaust stock or expire their offers. Keep one public
    # offer on an existing digital fixture so search exercises a nonempty page.
    psql("""DO $fixture$ DECLARE admin bigint; edition bigint; price numeric; offer bigint;
        BEGIN
          SELECT min(usuario_id) INTO admin FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE';
          SELECT e.edicion_id,round(e.precio*0.9,2) INTO STRICT edition,price
            FROM pliego.edicion e JOIN pliego.libro l USING(libro_id)
            WHERE e.formato='EBOOK' AND e.estado='ACTIVE' AND l.estado='ACTIVE' AND e.precio>=1
            ORDER BY e.edicion_id LIMIT 1;
          IF NOT EXISTS(SELECT FROM pliego.fn_edition_offer(edition) WHERE offer_id IS NOT NULL) THEN
            CALL pliego.sp_edition_offer_set(admin,edition,price,
              CURRENT_TIMESTAMP-INTERVAL '1 minute',CURRENT_TIMESTAMP+INTERVAL '1 day',
              'Plan gate',NULL,offer);
          END IF;
        END $fixture$;""")
    data = json.loads(psql("""
        SELECT json_build_object(
          'cart_actor', (SELECT cl.usuario_id FROM pliego.carrito c
            JOIN pliego.cliente cl USING(cliente_id)
            JOIN pliego.usuario u USING(usuario_id)
            WHERE c.estado='ACTIVE' AND u.estado='ACTIVE'
              AND EXISTS(SELECT FROM pliego.carrito_item ci WHERE ci.carrito_id=c.carrito_id)
            ORDER BY (SELECT count(*) FROM pliego.carrito_item ci WHERE ci.carrito_id=c.carrito_id) DESC,
              c.carrito_id LIMIT 1),
          'owned', (SELECT json_build_object('actor',cl.usuario_id,'order',pi.pedido_id,
              'edition',o.edicion_id,'owned',o.owned_item_id,'email',u.email_normalizado)
            FROM pliego.digital_ownership o JOIN pliego.digital_grant g USING(owned_item_id)
            JOIN pliego.pedido_item pi USING(pedido_item_id)
            JOIN pliego.cliente cl ON cl.cliente_id=o.cliente_id
            JOIN pliego.usuario u USING(usuario_id)
            WHERE g.state='ACTIVE' AND u.estado='ACTIVE'
            ORDER BY o.owned_item_id LIMIT 1),
          'offer', (SELECT json_build_object('edition',e.edicion_id,'title',l.titulo)
            FROM pliego.edicion e JOIN pliego.libro l USING(libro_id)
            CROSS JOIN LATERAL pliego.fn_edition_offer(e.edicion_id) o
            WHERE e.estado='ACTIVE' AND l.estado='ACTIVE' AND o.offer_id IS NOT NULL
              AND pliego.fn_edition_listable(e.formato,
                (SELECT i.stock_actual FROM pliego.inventario i WHERE i.edicion_id=e.edicion_id))
            ORDER BY e.edicion_id LIMIT 1),
          'invoice', (SELECT json_build_object('actor',cl.usuario_id,'order',p.pedido_id)
            FROM pliego.factura f JOIN pliego.factura_archivo_contenido content USING(factura_id)
            JOIN pliego.pedido p USING(pedido_id) JOIN pliego.cliente cl USING(cliente_id)
            JOIN pliego.usuario u USING(usuario_id)
            WHERE content.tipo='PDF' AND f.estado='ISSUED' AND u.estado='ACTIVE'
            ORDER BY f.factura_id LIMIT 1),
          'admin_actor', (SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE'),
          'identity_actor', (SELECT min(u.usuario_id) FROM pliego.cliente_identificacion i
            JOIN pliego.cliente c USING(cliente_id) JOIN pliego.usuario u USING(usuario_id) WHERE u.estado='ACTIVE'),
          'help_slug', NULL)
    """))
    assert data["cart_actor"] and data["owned"] and data["offer"] and data["invoice"] and data["admin_actor"] and data["identity_actor"], (
        "Run after HTTP gates: need a populated cart, active ownership, live offer, PDF, ADMIN, and billing identity")
    # A published article, independent of the seeded slug naming convention.
    data["help_slug"] = psql("SELECT slug FROM pliego.fn_help_search(NULL,NULL,NULL,0,1) LIMIT 1")
    assert data["help_slug"], "Expected published help fixture"
    return data


def cases(data):
    actor = f"{data['owned']['actor']}::bigint"
    cart_actor = f"{data['cart_actor']}::bigint"
    order = f"{data['owned']['order']}::bigint"
    edition = f"{data['offer']['edition']}::bigint"
    owned = f"{data['owned']['owned']}::bigint"
    invoice_actor = f"{data['invoice']['actor']}::bigint"
    invoice_order = f"{data['invoice']['order']}::bigint"
    admin_actor = f"{data['admin_actor']}::bigint"
    batch = literal(str(data["owned"]["edition"]))
    key = "'00000000-0000-4000-8000-000000000079'::uuid"
    null = "NULL::varchar"
    search = [null] * 4 + ["NULL::numeric"] * 2 + [null] * 2 + ["'TITLE_ASC'", "0", "20"]
    global_search = [literal(data['offer']['title']), null, "NULL::numeric", "NULL::numeric",
                     null, null, "'TITLE_ASC'", "0", "20"]
    bindings = {
        "fn_purchase_item_capabilities": [cart_actor] * 3,
        "fn_catalog_search": search,
        "fn_catalog_search_global": global_search,
        "fn_edition_detail": [edition],
        "fn_public_category_list": ["'GLOBAL'"],
        "fn_public_catalog_filter_facets": ["'GLOBAL'"],
        "fn_offers_filter_options": [],
        "fn_customer_profile_verified": [actor],
        "fn_customer_password_hash": [actor],
        "fn_geo_provinces": [],
        "fn_geo_cities": ["17"],
        "fn_address_list": [actor],
        "fn_customer_favorites": [actor, "0", "20"],
        "fn_customer_favorite_status": [actor, batch],
        "fn_address_create_resolve": [actor, key],
        "fn_customer_billing_identity": [actor],
        "fn_customer_billing_identity_read_model": [f"{data['identity_actor']}::bigint"],
        "fn_admin_billing_identity_correction_requests": [admin_actor, "'PENDING'", "0", "20"],
        "fn_customer_digital_eligibility": [actor, batch],
        "fn_customer_library": [actor, null, "0", "20"],
        "fn_customer_library_detail": [actor, owned],
        "fn_checkout_resolve": [actor, key],
        "fn_order_fulfillment": [order],
        "fn_order_pricing": [order],
        "fn_order_offer_pricing": [order],
        "fn_customer_orders": [actor, "0", "20"],
        "fn_order_item_offer_snapshots": [actor, order],
        "fn_pickup_locations": [],
        "fn_storefront_navigation": [],
        "fn_help_categories": [],
        "fn_help_search": [null, null, null, "0", "20"],
        "fn_help_article": [literal(data['help_slug'])],
        "fn_invoice_artifact_metadata": [invoice_actor, invoice_order],
        "fn_invoice_artifact_download": [invoice_actor, invoice_order, "'PDF'"],
        "fn_user_auth_data": [literal(data['owned']['email'])],
        "fn_auth_session_create_checked": [actor, "'plan-gate-unused'", "CURRENT_TIMESTAMP + INTERVAL '1 day'", "'unused'"],
        "fn_auth_session_refresh": ["'plan-gate-unused'", "'plan-gate-replacement'"],
        "fn_auth_session_revoke": ["'plan-gate-unused'"],
        "fn_email_action_request": [literal(data['owned']['email']), "'VERIFY_EMAIL'", "'unused'", "'unused'", "'unused'"],
        "fn_email_action_set_return_path": ["'unused'", "'/catalogo'"],
        "fn_email_action_consume": ["'VERIFY_EMAIL'", "'unused'", "NULL::varchar"],
        "fn_email_verification_for_user": [actor, "'unused'", "'unused'"],
    }
    queries = gateway_queries()
    # Mirror the runtime replacements in JdbcCatalogGateway.runCatalogSearch.
    catalog = "JdbcCatalogGateway.CATALOG_SEARCH_QUERY"
    global_catalog = "JdbcCatalogGateway.CATALOG_GLOBAL_SEARCH_QUERY"
    queries[catalog + ".product_type"] = queries[catalog].replace(
        "fn_catalog_search(?,?,?,?,?,?,?,?,?,?,?)", "fn_catalog_search(?,?,?,?,?,?,?,?,?,?,?,?)")
    queries[global_catalog + ".product_type"] = queries[global_catalog].replace(
        "fn_catalog_search_global(?,?,?,?,?,?,?,?,?)", "fn_catalog_search_global(?,?,?,?,?,?,?,?,?,?)")
    queries[catalog + ".offers"] = queries[catalog].replace(
        "fn_catalog_search(?,?,?,?,?,?,?,?,?,?,?)", "fn_catalog_search_offers(?,?,?,?,?,?,?,?,?,?,?,?)")
    required = {"JdbcCartGateway.CART_GET", "JdbcCustomerOrderGateway.DETAIL",
                "JdbcDigitalEligibilityGateway.fn_customer_digital_eligibility",
                global_catalog + ".product_type"}
    assert required <= queries.keys(), f"Missing required gateway queries: {required - queries.keys()}"
    for name, sql in queries.items():
        function = re.search(r"pliego\.(fn_\w+)", sql)[1]
        if name.endswith(".offers"):
            params = search[:8] + [null, "'RELEVANCE'", "0", "20"]
        else:
            params = bindings[function].copy()  # Fail closed on an unreviewed new SELECT.
            if name.endswith(".product_type"):
                params.append(null)
        assert sql.count("?") == len(params), name
        parts = sql.split("?")
        bound = parts[0] + "".join(value + part for value, part in zip(params, parts[1:]))
        analyze = not name.startswith("JdbcIdentityGateway.") or name.endswith(".AUTH_QUERY")
        yield name, bound, analyze, ""
        if name in {"JdbcCartGateway.CART_GET", "JdbcCustomerOrderGateway.DETAIL",
                    "JdbcDigitalEligibilityGateway.fn_customer_digital_eligibility",
                    "JdbcCatalogGateway.CATALOG_GLOBAL_SEARCH_QUERY.product_type"}:
            numbered = iter(range(1, len(params) + 1))
            prepared = re.sub(r"\?", lambda _: f"${next(numbered)}", sql)
            setup = "SET LOCAL plan_cache_mode=force_generic_plan; PREPARE customer_plan_gate AS " + prepared + "; "
            yield name + ".generic", "EXECUTE customer_plan_gate(" + ",".join(params) + ")", analyze, setup


def has_jit(value):
    if isinstance(value, dict):
        return "JIT" in value or any(has_jit(item) for item in value.values())
    if isinstance(value, list):
        return any(has_jit(item) for item in value)
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Save plans and timings as JSON")
    args = parser.parse_args()
    settings = json.loads(psql("SELECT json_build_object('threshold',current_setting('jit_above_cost')::numeric,"
                               "'jit',current_setting('jit'),'database',current_database())"))
    data = fixtures()
    results = []
    failures = []
    for name, sql, analyze, setup in cases(data):
        try:
            options = "ANALYZE, BUFFERS, " if analyze else ""
            plan = json.loads(psql("BEGIN; SET LOCAL statement_timeout='10s'; " + setup +
                                   f"EXPLAIN ({options}FORMAT JSON) {sql}; ROLLBACK;"))[0]
            cost = plan["Plan"]["Total Cost"]
            jit = has_jit(plan)
            elapsed = plan.get("Execution Time")
            problems = []
            if cost >= settings["threshold"]:
                problems.append(f"cost {cost} >= jit_above_cost {settings['threshold']}")
            if jit:
                problems.append("EXPLAIN contains JIT")
            base_name = name.removesuffix(".generic")
            if base_name == "JdbcCartGateway.CART_GET":
                if elapsed >= 200:
                    problems.append(f"CART_GET {elapsed} ms >= 200 ms")
                if plan["Plan"]["Actual Rows"] != 1:
                    problems.append("CART_GET must return exactly one row")
            if base_name in {"JdbcCustomerOrderGateway.DETAIL", "JdbcDigitalEligibilityGateway.fn_customer_digital_eligibility",
                             "JdbcCatalogGateway.CATALOG_GLOBAL_SEARCH_QUERY.product_type", "JdbcLibraryGateway.fn_customer_library",
                             "JdbcCatalogGateway.CATALOG_SEARCH_QUERY.offers", "JdbcBillingGateway.fn_invoice_artifact_download"}:
                if not plan["Plan"]["Actual Rows"]:
                    problems.append("Expected nonempty representative fixture result")
            results.append(dict(name=name, sql=sql, setup=setup, analyzed=analyze, cost=cost,
                                execution_ms=elapsed, jit=jit, plan=plan, failures=problems))
            failures.extend(f"{name}: {problem}" for problem in problems)
            print(f"{'FAIL' if problems else 'PASS'} {name}: cost={cost:.2f} execution_ms={elapsed} JIT={jit}", flush=True)
        except (subprocess.SubprocessError, ValueError, AssertionError) as error:
            detail = getattr(error, "stderr", None) or str(error)
            failures.append(f"{name}: {detail}")
            results.append(dict(name=name, failures=[detail]))
            print(f"FAIL {name}: {detail}", flush=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(dict(settings=settings, fixtures=data, results=results), indent=2) + "\n")
    failed = sum(bool(result["failures"]) for result in results)
    print(f"Customer query plan gate: {len(results) - failed}/{len(results)} queries passed; {failed} failed", flush=True)
    if failures:
        raise SystemExit("\n".join(failures))


if __name__ == "__main__":
    main()
