"""Accepted quantity/price snapshot must survive GET -> POST races; isolated PG18 only."""
import os
import uuid
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from checkout_last_unit import fixture, query, PSQL, wait_for_activity
from p1_integrity_http_gate import request


def quantity_changed():
    actors, edition = fixture()
    actor, address = actors[0]
    query(f"UPDATE pliego.inventario SET stock_actual=4 WHERE edicion_id={edition}")
    status, accepted = request(actor, "/api/v1/cart")
    assert status == 200, (status, accepted)
    line = accepted["items"][0]
    status, _ = request(actor, f'/api/v1/cart/items/{line["cartItemId"]}', "PUT", {"quantity": 2})
    assert status == 200
    body = {"addressId": str(address), "paymentMethod": "TRANSFER", "simulationOutcome": "APPROVED",
            "expectedCartId": accepted["cartId"]}
    if accepted.get("quoteFingerprint"):
        body["expectedQuoteFingerprint"] = accepted["quoteFingerprint"]
    status, result = request(actor, "/api/v1/checkout", "POST", body, str(uuid.uuid4()))
    assert status == 409 and result["code"] == "P4005", (status, result)
    assert query(f"SELECT count(*) FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}") == "0"
    assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}") == "4"
    print("PASS accepted quote: stale quantities rejected before order/inventory effects")


def price_changed_and_replay():
    actors, edition = fixture()
    actor, address = actors[0]
    query(f"UPDATE pliego.inventario SET stock_actual=4 WHERE edicion_id={edition}")
    _, accepted = request(actor,"/api/v1/cart")
    assert len(accepted["quoteFingerprint"]) == 64
    body = {"addressId":str(address),"paymentMethod":"TRANSFER","simulationOutcome":"APPROVED",
            "expectedCartId":accepted["cartId"],"expectedQuoteFingerprint":accepted["quoteFingerprint"]}
    query(f"UPDATE pliego.edicion SET precio=9.25 WHERE edicion_id={edition}")
    key = str(uuid.uuid4())
    status, result = request(actor,"/api/v1/checkout","POST",body,key)
    assert status == 409 and result["code"] == "P4005", (status,result)
    assert query(f"SELECT count(*) FROM pliego.checkout_attempt WHERE actor_user_id={actor} AND attempt_key='{key}'") == "0"
    _, accepted = request(actor,"/api/v1/cart")
    body["expectedQuoteFingerprint"] = accepted["quoteFingerprint"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: request(actor,"/api/v1/checkout","POST",body,key),range(2)))
    assert all(status == 201 for status,_ in results), results
    assert results[0][1] == results[1][1], results
    order = results[0][1]
    assert order["subtotal"] == "9.25" and order["total"] == "10.64", order
    assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}") == "3"
    assert query(f"SELECT count(*) FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}") == "1"
    # A lost-response replay returns the accepted receipt despite new catalog/cart state.
    query(f"UPDATE pliego.edicion SET precio=12.25 WHERE edicion_id={edition}")
    status, replay = request(actor,"/api/v1/checkout","POST",body,key)
    assert status == 201 and replay == order, (status,replay)
    status, conflict = request(actor,"/api/v1/checkout","POST",{**body,"expectedQuoteFingerprint":"0"*64},key)
    assert status == 409 and conflict["code"] == "P1010", (status,conflict)
    status, foreign = request(actors[1][0],"/api/v1/checkout","POST",body,key)
    assert status == 409 and foreign["code"] in ("P4001","P4005"), (status,foreign)
    print("PASS accepted quote: price changes, concurrent duplicate, lost response replay, payload conflict and actor isolation")


def equal_total_substitution():
    actors, edition = fixture()
    _, other_edition = fixture()
    actor, address = actors[0]
    _, accepted = request(actor,"/api/v1/cart")
    status,_ = request(actor,f'/api/v1/cart/items/{accepted["items"][0]["cartItemId"]}',"DELETE")
    assert status == 204
    status,_ = request(actor,"/api/v1/cart/items","POST",{"editionId":str(other_edition),"quantity":1})
    assert status == 200
    _, current = request(actor,"/api/v1/cart")
    assert current["total"] == accepted["total"] and current["cartId"] == accepted["cartId"]
    body = {"addressId":str(address),"paymentMethod":"TRANSFER","simulationOutcome":"APPROVED","expectedCartId":accepted["cartId"],"expectedQuoteFingerprint":accepted["quoteFingerprint"]}
    status,result = request(actor,"/api/v1/checkout","POST",body,str(uuid.uuid4()))
    assert status == 409 and result["code"] == "P4005", (status,result)
    print("PASS accepted quote: equal-total edition substitution requires fresh acceptance")


def quote_after_master_lock_wait():
    actors,edition=fixture(); actor,address=actors[0]
    _,accepted=request(actor,"/api/v1/cart")
    body={"addressId":str(address),"paymentMethod":"TRANSFER","simulationOutcome":"APPROVED",
          "expectedCartId":accepted["cartId"],"expectedQuoteFingerprint":accepted["quoteFingerprint"]}
    name="quote-master-"+uuid.uuid4().hex
    holder=subprocess.Popen(PSQL+["-c","BEGIN","-c",f"UPDATE pliego.edicion SET precio=9.25 WHERE edicion_id={edition}","-c","SELECT pg_sleep(2)","-c","COMMIT"],
                            env={**os.environ,"PGAPPNAME":name},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        wait_for_activity(name,"query='SELECT pg_sleep(2)' AND state='active'")
        started=time.monotonic()
        status,result=request(actor,"/api/v1/checkout","POST",body,str(uuid.uuid4()))
        assert time.monotonic()-started>1,"checkout did not wait for the held master lock"
        assert status==409 and result["code"]=="P4005",(status,result)
        _,error=holder.communicate(timeout=5); assert holder.returncode==0,error
        assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}")=="1"
        assert query(f"SELECT count(*) FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}")=="0"
    finally:
        if holder.poll() is None: holder.terminate(); holder.communicate(timeout=5)
    print("PASS accepted quote: comparison reads committed prices after a contested master lock")


def offer_expires_before_confirmation():
    actors,edition=fixture();actor,address=actors[0]
    admin=query("SELECT usuario_id FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE' ORDER BY usuario_id LIMIT 1")
    query(f"CALL pliego.sp_edition_offer_set({admin},{edition},6.25,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '2 seconds',NULL)")
    _,accepted=request(actor,"/api/v1/cart")
    assert accepted["items"][0]["currentPrice"]=="6.25",accepted
    deadline=time.monotonic()+5
    while query(f"SELECT price FROM pliego.fn_edition_offer({edition})")=="6.25":
        assert time.monotonic()<deadline,"test offer failed to expire"
        time.sleep(.1)
    body={"addressId":str(address),"paymentMethod":"TRANSFER","simulationOutcome":"APPROVED",
          "expectedCartId":accepted["cartId"],"expectedQuoteFingerprint":accepted["quoteFingerprint"]}
    status,result=request(actor,"/api/v1/checkout","POST",body,str(uuid.uuid4()))
    assert status==409 and result["code"]=="P4005",(status,result)
    assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}")=="1"
    print("PASS accepted quote: real offer expiry requires fresh acceptance before inventory effects")


if __name__ == "__main__":
    quantity_changed()
    price_changed_and_replay()
    equal_total_substitution()
    quote_after_master_lock_wait()
    offer_expires_before_confirmation()
