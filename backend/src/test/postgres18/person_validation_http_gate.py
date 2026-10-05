"""Registration/profile/address validation and historical recipient limits over real HTTP."""
import json
import os
import urllib.error
import urllib.request
import uuid

from checkout_http_gate import token
from checkout_last_unit import fixture, query

def request(path, method="GET", body=None, actor=None, key=None):
    headers = {}
    if actor is not None: headers["Authorization"] = "Bearer " + token(actor)
    if key is not None: headers["Idempotency-Key"] = key
    if body is not None: headers["Content-Type"] = "application/json"
    incoming=urllib.request.Request(os.environ["CHECKOUT_BASE_URL"]+path, method=method,
        data=None if body is None else json.dumps(body).encode(), headers=headers)
    try: response=urllib.request.urlopen(incoming,timeout=20)
    except urllib.error.HTTPError as failure: response=failure
    with response:
        content=response.read()
        return response.status,json.loads(content) if content else None

def register(first="Ana",last="Pérez",phone=None):
    return request("/api/v1/auth/register","POST",{"email":uuid.uuid4().hex+"@validation.example.invalid",
        "password":"Lectura-segura-2026","firstNames":first,"lastNames":last,"phone":phone})

def recipient_limits():
    full="A"*120+" "+"B"*120
    status,registered=register("A"*120,"B"*120)
    assert status==201,(status,registered)
    actor=int(registered["userId"])
    body={"alias":"Casa","recipient":full,"line1":"Calle 1","city":"Quito","province":"Pichincha",
          "countryCode":"EC","phone":"+593991234567","makePrimary":True}
    key=str(uuid.uuid4())
    status,address=request("/api/v1/me/addresses","POST",body,actor,key)
    assert status==201,(status,address)
    assert request("/api/v1/me/addresses","POST",body,actor,key)==(201,address)
    assert request("/api/v1/me/addresses","POST",{**body,"recipient":full+"C"},actor,str(uuid.uuid4()))[0]==400
    _,edition=fixture()
    query(f"CALL pliego.sp_cart_add_item({actor},{edition},1,NULL,NULL,NULL)")
    cart=query(f"SELECT carrito_id FROM pliego.carrito c JOIN pliego.cliente p USING(cliente_id) WHERE p.usuario_id={actor} AND c.estado='ACTIVE'")
    status,order=request("/api/v1/checkout","POST",{"addressId":address["addressId"],"expectedCartId":cart,
        "paymentMethod":"TRANSFER","simulationOutcome":"APPROVED"},actor,str(uuid.uuid4()))
    assert status==201,(status,order)
    status,detail=request('/api/v1/orders/'+order["orderId"],actor=actor)
    assert status==200 and detail["address"]["recipient"]==full,(status,detail)

def personal_names():
    status,problem=register("Gat1n")
    assert status==400 and any(v["field"]=="firstNames" for v in problem["violations"]),(status,problem)
    status,registered=register("A\u0301na","O’Connor-Pérez")
    assert status==201,(status,registered)
    actor=int(registered["userId"])
    _,profile=request("/api/v1/me",actor=actor)
    assert profile["firstNames"]=="Ána",profile
    status,problem=request("/api/v1/me","PATCH",{"field":"lastNames","value":"Pérez7","expectedVersion":profile["version"]},actor)
    assert status==400 and problem["violations"][0]["field"]=="value",(status,problem)
    _,after=request("/api/v1/me",actor=actor)
    assert after==profile,after

def phone_rule():
    status,problem=register(phone="0991234567")
    assert status==400 and problem["violations"][0]["field"]=="phone",(status,problem)
    for phone in ("+5930991234567","+593991234567 ext 5","+999991234567"):
        status,problem=register(phone=phone)
        assert status==400,(phone,status,problem)
    status,registered=register(phone="+593 (99) 123-4567")
    assert status==201,(status,registered)
    actor=int(registered["userId"])
    _,profile=request("/api/v1/me",actor=actor)
    assert profile["phone"]=="+593991234567",profile
    status,problem=request("/api/v1/me","PATCH",{"field":"phone","value":"+44 020 7946 0018","expectedVersion":profile["version"]},actor)
    assert status==400 and problem["violations"][0]["field"]=="value",(status,problem)
    assert request("/api/v1/me","PATCH",{"field":"phone","value":"+44 20 7946 0018","expectedVersion":profile["version"]},actor)[0]==204
    _,after=request("/api/v1/me",actor=actor)
    assert after["phone"]=="+442079460018",after

if __name__=="__main__":
    import sys
    for check in (recipient_limits,personal_names,phone_rule):
        if not sys.argv[1:] or check.__name__ in sys.argv[1:]:
            check(); print(check.__name__+" passed")
