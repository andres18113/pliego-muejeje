"""Disposable PG18: concurrent lifecycle sweeps observe one durable transition.

Interactive transactions expose real pg_stat_activity barriers. Locks stay held
until the assertion releases them; correctness never depends on a fixed sleep.
"""
import json
import os
import uuid

from checkout_last_unit import fixture, query
from offer_expiry_checkout_gate import finish_holder, start, stop, wait_for


def due_offer():
    _, edition = fixture()
    admin = query(f"""SELECT u.usuario_id FROM pliego.edicion e JOIN pliego.usuario u
      ON u.email_normalizado='i8-conc-admin-'||lower(substring(e.sku FROM 9))||'@pliego.local'
      WHERE e.edicion_id={edition}""")
    query(f"CALL pliego.sp_edition_offer_set({admin},{edition},3,clock_timestamp()-INTERVAL '1 day',clock_timestamp()+INTERVAL '1 day',NULL)")
    offer = int(query(f'SELECT oferta_id FROM pliego.edicion_oferta WHERE edicion_id={edition}'))
    query(f"UPDATE pliego.offer_transition SET next_transition_at=clock_timestamp()-INTERVAL '1 minute' WHERE offer_id={offer}")
    return edition, offer


def snapshot(edition, offer):
    return json.loads(query(f"""SELECT jsonb_build_object(
      'eventCount',(SELECT count(*) FROM pliego.realtime_event WHERE event_name='catalog.offers.changed'
          AND resource_type='edition' AND resource_id='{edition}'),
      'due',(SELECT next_transition_at FROM pliego.offer_transition WHERE offer_id={offer}),
      'offer',(SELECT to_jsonb(o) FROM pliego.edicion_oferta o WHERE oferta_id={offer}))"""))


def assert_advanced_once(edition, offer, before):
    after = snapshot(edition, offer)
    assert after['eventCount'] == before['eventCount'] + 1, ('Duplicate or lost lifecycle hint', before, after)
    assert after['offer'] == before['offer'], 'Time observation rewrote offer history'
    assert query(f'SELECT q.next_transition_at=o.fin FROM pliego.offer_transition q JOIN pliego.edicion_oferta o ON o.oferta_id=q.offer_id WHERE offer_id={offer}') == 't', after
    query('SELECT pliego.fn_offer_lifecycle_advance(1000)')
    assert snapshot(edition, offer) == after, 'A rerun observed the same transition twice'


def two_runners():
    edition, offer = due_offer()
    before = snapshot(edition, offer)
    name = 'offer-two-runners-' + uuid.uuid4().hex
    first = start('BEGIN; SELECT pliego.fn_offer_lifecycle_advance(1000);', name, True)
    try:
        wait_for(name, "state='idle in transaction'", first)
        assert snapshot(edition, offer) == before, 'Uncommitted sweep exposed queue/event changes'
        second = json.loads(query('SELECT pliego.fn_offer_lifecycle_advance(1000)'))
        assert second['state'] == 'SKIPPED' and second['transitionCount'] == 0, second
        first_output = finish_holder(first)
        result = json.loads(first_output)
        assert result['state'] == 'OK' and result['transitionCount'] >= 1, result
        assert result['maxLagSeconds'] >= 59, result
        assert_advanced_once(edition, offer, before)
    finally:
        stop(first)
    print('PASS: two lifecycle runners, one effective transition and one SKIPPED result; no uncommitted hint; no duplicate rerun')


def skip_locked_then_recover():
    edition, offer = due_offer()
    before = snapshot(edition, offer)
    name = 'offer-locked-row-' + uuid.uuid4().hex
    holder = start(f'BEGIN; SELECT offer_id FROM pliego.offer_transition WHERE offer_id={offer} FOR UPDATE;', name, True)
    try:
        wait_for(name, "state='idle in transaction'", holder)
        # The runner returns while the row remains locked. A missing SKIP LOCKED
        # fails via statement_timeout, rather than waiting for a timer to unlock.
        output = query("SET statement_timeout='2s'; SELECT pliego.fn_offer_lifecycle_advance(1000)")
        result = json.loads(output.splitlines()[-1])
        assert result['state'] == 'OK', result
        assert snapshot(edition, offer) == before, 'Sweep observed a locked transition'
        finish_holder(holder)
        result = json.loads(query('SELECT pliego.fn_offer_lifecycle_advance(1000)'))
        assert result['state'] == 'OK' and result['transitionCount'] >= 1, result
        assert_advanced_once(edition, offer, before)
    finally:
        stop(holder)
    print('PASS: locked transition is skipped promptly and recovered once after the row lock releases')


def rollback_then_retry():
    edition, offer = due_offer()
    before = snapshot(edition, offer)
    name = 'offer-rollback-' + uuid.uuid4().hex
    failed = start('BEGIN; SELECT pliego.fn_offer_lifecycle_advance(1000);', name, True)
    try:
        wait_for(name, "state='idle in transaction'", failed)
        finish_holder(failed, commit=False)
        assert snapshot(edition, offer) == before, 'Rolled-back sweep consumed queue or emitted a durable hint'
        result = json.loads(query('SELECT pliego.fn_offer_lifecycle_advance(1000)'))
        assert result['state'] == 'OK' and result['transitionCount'] >= 1, result
        assert_advanced_once(edition, offer, before)
    finally:
        stop(failed)
    print('PASS: rolled-back worker advances neither queue nor events; retry recovers exactly one durable hint')


def main():
    if not all(os.environ.get(key) for key in ('PGHOST', 'PGPORT', 'PGDATABASE')):
        raise SystemExit('Set PGHOST, PGPORT and PGDATABASE for a disposable PostgreSQL 18 database')
    two_runners()
    skip_locked_then_recover()
    rollback_then_retry()
    print('PASS: 3 lifecycle concurrency/rollback scenarios with deterministic PostgreSQL lock barriers')


if __name__ == '__main__':
    main()
