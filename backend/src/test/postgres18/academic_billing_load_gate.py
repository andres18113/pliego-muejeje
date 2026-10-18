"""Compare legacy and billed checkout latency with 20 independent PostgreSQL commands.

Disposable DB only. Measures process + connection + command latency on the same host;
this is a repeatable regression probe, not a production capacity claim.
"""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import statistics
import time
import uuid
from checkout_last_unit import fixture, query
from automatic_billing_concurrency import checkout

def sample(billed):
    actors = [fixture()[0][0] for _ in range(20)]
    def run(actor):
        user, address = actor
        key = uuid.uuid4()
        sql = checkout(user, address, key) if billed else (
            f"CALL pliego.sp_checkout_quoted({user},'{key}',{address},'TRANSFER','APPROVED',NULL,"
            "'HOME_DELIVERY',NULL,NULL,NULL,NULL,NULL,NULL,NULL)")
        start = time.perf_counter()
        query(sql)
        return (time.perf_counter() - start) * 1000
    with ThreadPoolExecutor(max_workers=20) as pool:
        elapsed = sorted(pool.map(run, actors))
    users = ",".join(str(user) for user, _ in actors)
    counts = query(f"SELECT count(*),count(f.factura_id) FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) LEFT JOIN pliego.factura f USING(pedido_id) WHERE c.usuario_id IN({users})").split("|")
    assert counts == ["20", "20" if billed else "0"], counts
    return {"commands": 20, "medianMs": round(statistics.median(elapsed), 2), "p95Ms": round(elapsed[18], 2)}

baseline = sample(False)
billed = sample(True)
ratio = billed["p95Ms"] / baseline["p95Ms"]
report = {"legacy": baseline, "billed": billed, "p95Ratio": round(ratio, 3), "investigateAboveRatio": 1.2}
Path("/tmp/pliego-implementation-logs/billing-load-result.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
if ratio > 1.2:
    print("Investigate p95 increase >20%; connection/process scheduling is included in this local probe.")
