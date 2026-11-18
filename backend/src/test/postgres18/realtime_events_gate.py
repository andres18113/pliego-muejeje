"""RQ-RT: scoped durable replay, commit ordering, rollback, leases and retention."""
import concurrent.futures
import hashlib
import json
import os
import subprocess
import uuid
from checkout_last_unit import query, fixture, PSQL, wait_for_activity


def main():
    assert os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1'
    actors, _ = fixture()
    a, b = [x[0] for x in actors]
    admin = int(query(f"""INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
        VALUES('realtime-admin-{uuid.uuid4().hex}@example.invalid','fixture-hash','ADMIN','ACTIVE')
        RETURNING usuario_id""").splitlines()[0])
    connections = []
    for actor in (a, b, admin):
        secret = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
        query(f"UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id={actor}")
        assert query(f"SELECT pliego.fn_auth_session_create_checked({actor},'{secret}',clock_timestamp()+interval '1 day','fixture-hash')") == 't', \
            'The gate must create its authenticated fixture session before opening SSE'
        conn = str(uuid.uuid4())
        result = json.loads(query(f"SELECT pliego.fn_realtime_connect('{secret}','{conn}')"))
        assert result['state'] == 'CONNECTED'
        connections.append((conn, secret))
    ca, cb, cad = [x[0] for x in connections]
    base = json.loads(query(f"SELECT pliego.fn_realtime_read('{ca}',NULL)"))
    assert base['resync'] is True
    cursor = base['cursor']
    query(f"BEGIN; SELECT pliego.fn_realtime_enqueue({a},false,'order.changed','order','100'); ROLLBACK")
    query('SELECT pliego.fn_realtime_publish(1000)')
    assert json.loads(query(f"SELECT pliego.fn_realtime_read('{ca}',{cursor})"))['events'] == []
    query(f"SELECT pliego.fn_realtime_enqueue({a},false,'order.changed','order','101'); SELECT pliego.fn_realtime_enqueue({b},false,'order.changed','order','102'); SELECT pliego.fn_realtime_enqueue(NULL,true,'order.changed','order','103')")
    query('SELECT pliego.fn_realtime_publish(1000)')
    def read(c, at=cursor):
        return json.loads(query(f"SELECT pliego.fn_realtime_read('{c}',{at})"))
    assert [e['resourceId'] for e in read(ca)['events']] == ['101']
    assert [e['resourceId'] for e in read(cb)['events']] == ['102']
    assert [e['resourceId'] for e in read(cad)['events']] == ['103']
    resumed = read(ca, read(ca)['cursor'])
    assert resumed['events'] == [] and resumed['resync'] is False
    # Commit order must not lose a transaction that allocated an internal ID earlier.
    first = subprocess.Popen(PSQL + ['-c', f"BEGIN; SELECT pliego.fn_realtime_enqueue({a},false,'order.changed','order','104'); SELECT pg_sleep(2); COMMIT"], env={**os.environ,'PGAPPNAME':'realtime-commit-order'}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    wait_for_activity('realtime-commit-order', "wait_event='PgSleep'")
    query(f"SELECT pliego.fn_realtime_enqueue({a},false,'order.changed','order','105'); SELECT pliego.fn_realtime_publish(1000)")
    middle = read(ca, resumed['cursor'])
    assert [e['resourceId'] for e in middle['events']] == ['105']
    out, err = first.communicate(timeout=8)
    assert first.returncode == 0, err
    query('SELECT pliego.fn_realtime_publish(1000)')
    assert [e['resourceId'] for e in read(ca, middle['cursor'])['events']] == ['104']
    # Clone the actual routine in this connection's temporary schema, adding only
    # a barrier after its cursor read. Retention may commit while this read waits.
    at=read(ca)['cursor']
    query(f"SELECT pliego.fn_realtime_enqueue({a},false,'order.changed','order','106'); SELECT pliego.fn_realtime_publish(1000)")
    probe_sql=f"""DO $probe$ DECLARE definition TEXT; BEGIN
      SELECT pg_get_functiondef('pliego.fn_realtime_read(uuid,bigint)'::regprocedure) INTO definition;
      definition:=replace(definition,'pliego.fn_realtime_read(', 'pg_temp.realtime_snapshot_probe(');
      definition:=replace(definition,'SELECT head,retained_after INTO h FROM pliego.realtime_cursor WHERE singleton;',
        'SELECT head,retained_after INTO h FROM pliego.realtime_cursor WHERE singleton; PERFORM pg_sleep(2);');
      EXECUTE definition;
    END $probe$; SELECT pg_temp.realtime_snapshot_probe('{ca}',{at});"""
    probe=subprocess.Popen(PSQL+['-At','-c',probe_sql],env={**os.environ,'PGAPPNAME':'realtime-retention-snapshot'},text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    wait_for_activity('realtime-retention-snapshot',"wait_event='PgSleep'")
    query("UPDATE pliego.realtime_event SET published_at=clock_timestamp()-interval '2 hours' WHERE resource_id='106'; SELECT pliego.fn_realtime_publish(1000)")
    out,err=probe.communicate(timeout=8)
    assert probe.returncode==0,err
    snapshot=json.loads(out.strip().splitlines()[-1])
    assert [e['resourceId'] for e in snapshot['events']]==['106'], 'retention raced read and silently lost a hint'
    # Resume pages must not skip own events when foreign IDs interleave.
    page_cursor=read(ca)['cursor']
    query(f"SELECT pliego.fn_realtime_enqueue({a},false,'order.changed','order',(40000+i)::TEXT), pliego.fn_realtime_enqueue({b},false,'order.changed','order',(50000+i)::TEXT) FROM generate_series(1,250) i; SELECT pliego.fn_realtime_publish(1000)")
    recovered=[]
    sizes=[]
    for _ in range(4):
        page=read(ca,page_cursor)
        assert page['resync'] is False
        recovered.extend(e['resourceId'] for e in page['events'])
        sizes.append(len(page['events']))
        page_cursor=page['cursor']
    assert sizes==[100,100,50,0] and len(set(recovered))==250
    assert set(recovered)=={str(40000+i) for i in range(1,251)}
    # Global per-user cap remains atomic across connections/instances.
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        states = list(pool.map(lambda _: json.loads(query(f"SELECT pliego.fn_realtime_connect('{connections[0][1]}','{uuid.uuid4()}')"))['state'], range(12)))
    assert states.count('CONNECTED') == 3 and states.count('LIMITED') == 9
    query(f"SELECT pliego.fn_auth_session_revoke('{connections[0][1]}')")
    assert read(ca)['state'] == 'CLOSED'
    assert json.loads(query(f"SELECT pliego.fn_realtime_connect('{connections[0][1]}','{uuid.uuid4()}')"))['state'] == 'UNAUTHORIZED'
    assert json.loads(query(f"SELECT pliego.fn_realtime_connect('{'0'*64}','{uuid.uuid4()}')"))['state'] == 'UNAUTHORIZED'
    # Retention creates an explicit gap; future cursors also require a resync.
    query("UPDATE pliego.realtime_event SET published_at=clock_timestamp()-interval '2 hours' WHERE event_id IS NOT NULL; SELECT pliego.fn_realtime_publish(1000)")
    assert read(cb, 0)['resync'] is True
    assert read(cb, 9223372036854775807)['resync'] is True
    query(f"UPDATE pliego.realtime_connection SET expires_at=clock_timestamp()-interval '1 second' WHERE connection_id='{cb}'")
    assert read(cb)['state'] == 'CLOSED'
    query('SELECT pliego.fn_realtime_publish(1000)')
    assert query(f"SELECT count(*) FROM pliego.realtime_connection WHERE connection_id='{cb}'") == '0'
    print(json.dumps({'cases_passed': 18, 'cases_total': 18, 'scope':'customer/admin', 'concurrent_admissions':12, 'commit_order':True, 'retention_snapshot':True, 'replayed_own_events':250}))


if __name__ == '__main__':
    main()
