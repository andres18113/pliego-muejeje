"""Same name vectors as frontend/Java, plus direct Database API validation."""
import json
from pathlib import Path
import subprocess
from checkout_last_unit import query, fixture, PSQL

quote=lambda text:"'"+text.replace("'","''")+"'"
def rejects(sql,state="P1001"):
    result=subprocess.run(PSQL+["-At","-c",sql],text=True,capture_output=True,timeout=20)
    assert result.returncode!=0 and state in result.stderr,(result.stdout,result.stderr)

def main():
    cases=json.loads((Path(__file__).resolve().parents[4]/"shared/validation/person-cases.json").read_text())
    for case in cases["names"]:
        value=quote(case["input"])
        assert query(f"SELECT pliego.fn_is_person_name({value})")==('t' if case["valid"] else 'f'),case
        if case["valid"]: assert query(f"SELECT pliego.fn_normalize_person_name({value})")==case["normalized"],case
    assert query("SELECT pliego.fn_is_person_name(repeat('𐐀',120)),pliego.fn_is_person_name(repeat('𐐀',121))")=="t|f"
    actors,_=fixture();actor,_=actors[0]
    rejects(f"CALL pliego.sp_customer_update({actor},'Gat1n','Conc',NULL)")
    rejects(f"CALL pliego.sp_customer_update({actor},'Cliente','Conc','0991234567')")
    version=query(f"SELECT version FROM pliego.fn_customer_profile_versioned({actor})")
    rejects(f"CALL pliego.sp_customer_patch({actor},{version},'firstNames','Ana7')")
    assert query(f"SELECT version FROM pliego.fn_customer_profile_versioned({actor})")==version
    # Old stored data remains untouched; only the selected field is validated on PATCH.
    query(f"UPDATE pliego.cliente SET telefono='0991234567' WHERE usuario_id={actor}")
    version=query(f"SELECT version FROM pliego.fn_customer_profile_versioned({actor})")
    query(f"CALL pliego.sp_customer_patch({actor},{version},'firstNames','Ana')")
    assert query(f"SELECT phone FROM pliego.fn_customer_profile_versioned({actor})")=="0991234567"
    print("Shared Unicode Database API vectors, direct rejection, profile version and legacy-data isolation passed")

if __name__=="__main__":main()
