"""Small real-HTTP invalid-input matrix; rejected inputs must not create accounts."""
import os
import uuid
from transactional_email_http_gate import request
from checkout_last_unit import query


def main():
    base=os.environ["CHECKOUT_BASE_URL"]
    marker="audit-invalid-"+uuid.uuid4().hex
    valid={"email":marker+"@example.invalid","password":"Fixture-safe-2026","firstNames":"Ana","lastNames":"Prueba"}
    cases=[
        {**valid,"email":marker+"@@example.invalid"},
        {**valid,"email":"   "},
        {**valid,"email":marker+"example.invalid"},
        {**valid,"email":"a"*260+"@example.invalid"},
        {**valid,"firstNames":"   "},
        {**valid,"firstNames":"A"*121},
        {**valid,"password":"   "},
        {**valid,"password":"short"},
        {},
    ]
    for body in cases:
        status,_,problem=request(base,"/api/v1/auth/register",body)
        assert status==400,(status,problem)
        assert problem.get("violations"),problem
        assert "SQL" not in problem["detail"] and "Exception" not in problem["detail"],problem
    for action in ("login","forgot-password","resend-verification"):
        for email in (marker+"@@example.invalid","   ",marker+"example.invalid"):
            body={"email":email,**({"password":"Fixture-safe-2026"} if action=="login" else {})}
            status,_,problem=request(base,"/api/v1/auth/"+action,body)
            assert status==400 and problem.get("violations"),(action,status,problem)
    assert query(f"SELECT count(*) FROM pliego.usuario WHERE email_normalizado LIKE '%{marker}%' ")=="0"
    for path in ("/api/v1/cart","/api/v1/me","/api/v1/me/library"):
        status,_,problem=request(base,path,headers={"Authorization":"Bearer invalid-session-token"})
        assert status==401 and problem["code"]=="AUTH_INVALID_TOKEN",(status,problem)
    print("PASS auth adversarial: 18 invalid-input requests (double @, missing/blank/long/format boundaries), zero accounts, 3 invalid private sessions")


if __name__=="__main__":main()
