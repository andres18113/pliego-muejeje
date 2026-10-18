"""Reuse transactional core fixtures, then verify fenced publication and private artifacts."""
from pathlib import Path
import subprocess

root = Path(__file__).parent
core = (root / "automatic_billing_gate.sql").read_text()
assert core.rstrip().endswith("ROLLBACK;")
sql = core.rstrip()[:-len("ROLLBACK;")] + "\n" + (root / "invoice_artifacts_gate.sql").read_text()
subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1"], input=sql, text=True, check=True)
print("Invoice artifact lease, publication, checksum and immutability gates passed.")
