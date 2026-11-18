"""Registration/profile/address validation and historical recipient limits over real HTTP."""
import json
import os
import urllib.error
import urllib.request
import uuid

from checkout_http_gate import token
from checkout_last_unit import fixture, query
from checkout_billing import billed

def request(path, method="GET", body=None, actor=None, key=None):
    if path == "/api/v1/checkout" and method == "POST" and body is not None:
        body = billed(body)
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

def register(first="Ana",last="Pérez",phone=None,*,email=None):
    if email is None:
        email=uuid.uuid4().hex+"@validation.example.invalid"
    status,result=request("/api/v1/auth/register","POST",{"email":email,
        "password":"Lectura-segura-2026","firstNames":first,"lastNames":last,"phone":phone})
    if status==201:
        assert result=={"state":"PENDING_VERIFICATION"},result
        # Fixture lookup is independent of the public, existence-neutral response.
        result={**result,"fixtureActor":int(query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='{email}'"))}
    return status,result

def recipient_limits():
    full="A"*120+" "+"B"*120
    status,registered=register("A"*120,"B"*120)
    assert status==201,(status,registered)
    actor=int(registered["fixtureActor"])
    body={"alias":"Casa","recipient":full,"line1":"Calle 1","provinceId":"17","cityId":"893",
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
    actor=int(registered["fixtureActor"])
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
    whitespace = " \t\n"
    expected_violations = [{"field": "phone", "message": "Escribe solo dígitos en el número de teléfono."}]
    invalid_email = uuid.uuid4().hex + "@validation.example.invalid"
    status, problem = register(phone=whitespace, email=invalid_email)
    assert status == 400 and problem["code"] == "VALIDATION_ERROR", (status, problem)
    assert problem["violations"] == expected_violations, problem
    assert query(f"SELECT count(*) FROM pliego.usuario WHERE email_normalizado='{invalid_email}'") == "0"
    status,registered=register(phone="+593 (99) 123-4567")
    assert status==201,(status,registered)
    actor=int(registered["fixtureActor"])
    _,profile=request("/api/v1/me",actor=actor)
    assert profile["phone"]=="+593991234567",profile
    status, problem = request("/api/v1/me", "PUT", {"firstNames": "María", "lastNames": "López",
                              "phone": whitespace, "expectedVersion": profile["version"]}, actor)
    assert status == 400 and problem["code"] == "VALIDATION_ERROR", (status, problem)
    assert problem["violations"] == expected_violations, problem
    assert request("/api/v1/me", actor=actor) == (200, profile)
    foreign_phone_message = "Solo se aceptan teléfonos de Ecuador (+593)."
    for value, message in (("+44 020 7946 0018", foreign_phone_message),
                           ("+44 20 7946 0018", foreign_phone_message),
                           (whitespace, expected_violations[0]["message"])):
        status, problem = request("/api/v1/me", "PATCH", {"field": "phone", "value": value,
                                  "expectedVersion": profile["version"]}, actor)
        assert status == 400 and problem["code"] == "VALIDATION_ERROR", (status, problem)
        # A PATCH names the failed request property, "value", as it does for names.
        assert problem["violations"] == [{"field": "value", "message": message}], problem
        assert request("/api/v1/me", actor=actor) == (200, profile)
    assert request("/api/v1/me","PATCH",{"field":"phone","value":"+59325550134","expectedVersion":profile["version"]},actor)[0]==204
    _,after=request("/api/v1/me",actor=actor)
    assert after["phone"]=="+59325550134",after

def delivery_scope():
    assert request('/api/v1/reference/countries')==(200,[{'code':'EC','name':'Ecuador'}])
    actors,_=fixture();actor,_=actors[0]
    body={'alias':'Casa','recipient':'Ana Pérez','line1':'Calle 1','provinceId':'17','cityId':'893',
          'countryCode':'EC','phone':'+593991234567','makePrimary':False}
    for field,value in [('countryCode','GB'),('phone','+442079460018'),('recipient','Ana7 Pérez')]:
        status,problem=request('/api/v1/me/addresses','POST',{**body,field:value},actor,str(uuid.uuid4()))
        assert status==400 and any(v['field']==field for v in problem['violations']),(status,problem)
    status,address=request('/api/v1/me/addresses','POST',{**body,'countryCode':' ec '},actor,str(uuid.uuid4()))
    assert status==201,(status,address)
    update={k:v for k,v in body.items() if k!='makePrimary'}
    assert request('/api/v1/me/addresses/'+address['addressId'],'PUT',{**update,'countryCode':'US'},actor)[0]==400

def address_phone_rule():
    actors, _ = fixture()
    actor, _ = actors[0]
    addresses = "/api/v1/me/addresses"
    body = {"alias": "Casa", "recipient": "Ana Pérez", "line1": "Calle 1", "provinceId": "17", "cityId": "893",
            "countryCode": "EC", "phone": "+593991234567"}
    status, created = request(addresses, "POST", {**body, "makePrimary": True}, actor, str(uuid.uuid4()))
    assert status == 201, (status, created)
    address_id = int(created["addressId"])
    address_path = f"{addresses}/{address_id}"
    snapshot_sql = f"SELECT to_jsonb(d) FROM pliego.direccion d WHERE direccion_id={address_id}"
    original = json.loads(query(snapshot_sql))
    before = request(addresses, actor=actor)
    assert before[0] == 200, before

    for phone, message in (("+593９９１２３４５６７", "Escribe solo dígitos en el número de teléfono."),
                           (" \t\n", "Escribe un teléfono de contacto.")):
        status, problem = request(address_path, "PUT", {**body, "alias": "Trabajo", "line1": "Calle 2", "phone": phone}, actor)
        assert status == 400 and problem["code"] == "VALIDATION_ERROR", (status, problem)
        assert problem["violations"] == [{"field": "phone", "message": message}], problem
        assert json.loads(query(snapshot_sql)) == original

    assert request(address_path, "PUT", body, actor) == (204, None)
    assert request(addresses, actor=actor) == before
    # The identical replacement still takes the database UPDATE path and refreshes the internal timestamp.
    repeated = json.loads(query(snapshot_sql))
    assert repeated.pop("fecha_actualizacion") != original.pop("fecha_actualizacion")
    assert repeated == original
    assert request(address_path, "PUT", {**body, "alias": "Trabajo", "phone": "+593 (2) 555-0134"}, actor) == (204, None)
    changed = json.loads(query(snapshot_sql))
    assert (changed["alias"], changed["telefono"]) == ("Trabajo", "+59325550134"), changed

if __name__=="__main__":
    import sys
    for check in (recipient_limits,personal_names,phone_rule,delivery_scope,address_phone_rule):
        if not sys.argv[1:] or check.__name__ in sys.argv[1:]:
            check(); print(check.__name__+" passed")
