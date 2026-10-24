"""Independent worker connections cannot claim/publish the same invoice artifact."""
from pathlib import Path
import subprocess
import uuid

root = Path(__file__).parent
psql = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]

def query(sql):
    return subprocess.run(psql, input=sql, text=True, capture_output=True, check=True).stdout.strip()

suffix = uuid.uuid4().hex[:10]
fixture = (root / "automatic_billing_gate.sql").read_text()
fixture = fixture.replace("billing-core-gate", "artifact-race-" + suffix).replace("BILLING-CORE-", "ART-" + suffix + "-")
# Avoid a globally unique ISBN collision with another independent committed fixture.
fixture = fixture.replace("'9780306406157'", "NULL")
assert fixture.rstrip().endswith("ROLLBACK;")
query(fixture.rstrip()[:-len("ROLLBACK;")] + "COMMIT;")

command = "BEGIN; SELECT invoice_id||'|'||file_type||'|'||lease_owner FROM pliego.fn_invoice_artifact_claim(); SELECT pg_sleep(0.4); COMMIT;"
workers = [subprocess.Popen(psql + ["-c", command], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(2)]
claims = []
for worker in workers:
    stdout, stderr = worker.communicate(timeout=20)
    assert worker.returncode == 0, stderr
    rows = [line for line in stdout.splitlines() if "|" in line]
    assert len(rows) == 1, stdout
    claims.append(rows[0].split("|"))
assert tuple(claims[0][:2]) != tuple(claims[1][:2]), "concurrent workers claimed same file"
for invoice, file_type, owner in claims:
    assert query(f"SELECT pliego.fn_invoice_artifact_complete({invoice},'{file_type}',uuidv4(),decode('25504446','hex')); ") == "f"
    assert query(f"SELECT pliego.fn_invoice_artifact_complete({invoice},'{file_type}','{owner}',decode('25504446','hex')); ") == "t"
    assert query(f"SELECT pliego.fn_invoice_artifact_complete({invoice},'{file_type}','{owner}',decode('25504446','hex')); ") == "f"
    assert query(f"SELECT checksum=encode(sha256(contenido),'hex') FROM pliego.factura_archivo_contenido WHERE factura_id={invoice} AND tipo='{file_type}';") == "t"
print("Two independent workers: distinct claims, owner fencing, exactly one publication and correct checksum.")
