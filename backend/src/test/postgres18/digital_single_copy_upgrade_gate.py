"""Fresh disposable database only: V075 duplicates must upgrade without erasing history."""
import json
import subprocess
from pathlib import Path
from checkout_last_unit import PSQL, query
from digital_single_copy_support import digital_fixture, digital_checkout
from monetary_upgrade_gate import start


def fails(sql, code):
    result = subprocess.run(PSQL + ['-c', sql], text=True, capture_output=True)
    assert result.returncode != 0 and code in result.stderr, result.stderr


def buy(actor, edition, outcome='APPROVED'):
    cart = query(f'CALL pliego.sp_cart_add_item({actor},{edition},1,NULL,NULL,NULL)').split('|')[0]
    return query(digital_checkout(actor, cart, outcome=outcome)).split('|')[0]


def main():
    old = start(75)
    try:
        actor, _, edition, cart, admin = digital_fixture()
        first = query(digital_checkout(actor, cart)).split('|')[0]
        second = buy(actor, edition)
        # A further paid source whose grant was revoked needs reconciliation.
        owned_pending = buy(actor, edition, 'PENDING')
        third = buy(actor, edition)
        query(f"UPDATE pliego.digital_grant SET state='REVOKED' WHERE pedido_item_id IN(SELECT pedido_item_id FROM pliego.pedido_item WHERE pedido_id={third})")
        # Legacy duplicate pending orders have no grants, but must not both capture.
        pending_actor, _, pending_edition, pending_cart, _ = digital_fixture()
        pending_first = query(digital_checkout(pending_actor, pending_cart, outcome='PENDING')).split('|')[0]
        pending_second = buy(pending_actor, pending_edition, 'PENDING')
        before = query(f"SELECT jsonb_agg(to_jsonb(g) ORDER BY pedido_item_id) FROM pliego.digital_grant g WHERE owned_item_id IN(SELECT owned_item_id FROM pliego.digital_ownership WHERE edicion_id={edition})")
        assert query(f"SELECT count(*) FROM pliego.digital_grant g JOIN pliego.digital_ownership o USING(owned_item_id) WHERE o.edicion_id={edition} AND g.state='ACTIVE'") == '2'
    finally:
        old.terminate(); old.wait(timeout=20)
    current = start(76)
    try:
        assert query('SELECT max(version)::integer FROM public.flyway_schema_history WHERE success') == '76'
        audit = Path(__file__).resolve().parents[4] / 'docs/audit/digital-duplicates/find-duplicate-active-digital-purchases.sql'
        result = subprocess.run(PSQL + ['-At', '-f', str(audit)], text=True, capture_output=True, check=True)
        rows = [line.split('|') for line in result.stdout.splitlines() if '|' in line]
        assert len(rows) == 2 and {r[9] for r in rows} == {first, second}, result.stdout
        assert all(r[0] == query(f'SELECT cliente_id FROM pliego.cliente WHERE usuario_id={actor}')
                   and r[2] == edition and r[5] == '2' and r[-1] == 'ACTIVE' for r in rows)

        assert query(f"SELECT jsonb_agg(to_jsonb(g) ORDER BY pedido_item_id) FROM pliego.digital_grant g WHERE owned_item_id IN(SELECT owned_item_id FROM pliego.digital_ownership WHERE edicion_id={edition})") == before
        for order in (first, second):
            query(f'CALL pliego.sp_digital_ownership_reconcile({order})')
        fails(f'CALL pliego.sp_cart_add_item({actor},{edition},1,NULL,NULL,NULL)', 'P6002')
        # Reconcile and trigger boundaries cannot re-activate a different source.
        fails(f'CALL pliego.sp_digital_ownership_reconcile({third})', 'P6002')
        fails(f"UPDATE pliego.digital_grant SET state='ACTIVE' WHERE pedido_item_id IN(SELECT pedido_item_id FROM pliego.pedido_item WHERE pedido_id={third})", 'P6002')
        # An already paid active source also blocks capture, with owned error precedence.
        fails(f'CALL pliego.sp_billed_order_approve({admin},{owned_pending})', 'P6002')
        fails(f"UPDATE pliego.pago SET estado='APPROVED',referencia=pliego.fn_generate_payment_reference() WHERE pedido_id={owned_pending}", 'P6002')
        assert query(f"SELECT estado FROM pliego.pago WHERE pedido_id={owned_pending}") == 'PENDING'
        query(f'CALL pliego.sp_order_cancel({actor},{owned_pending},NULL,NULL,NULL,NULL,NULL)')
        # Neither legacy pending order can leapfrog the other, including admin capture.
        fails(f'CALL pliego.sp_billed_order_approve({admin},{pending_first})', 'P6003')
        fails(f"UPDATE pliego.pago SET estado='APPROVED',referencia=pliego.fn_generate_payment_reference() WHERE pedido_id={pending_first}", 'P6003')
        assert query(f"SELECT count(*) FROM pliego.pago WHERE pedido_id IN({pending_first},{pending_second}) AND estado='PENDING'") == '2'
        query(f'CALL pliego.sp_order_cancel({pending_actor},{pending_second},NULL,NULL,NULL,NULL,NULL)')
        query(f'CALL pliego.sp_billed_order_approve({admin},{pending_first})')
        # Approved grant blocks capture of another legacy source even without a pending blocker.
        # Refund each old source independently; only the last active revocation releases ownership.
        query(f'CALL pliego.sp_order_cancel({actor},{first},NULL,NULL,NULL,NULL,NULL)')
        eligible = json.loads(query(f'SELECT to_jsonb(e) FROM pliego.fn_customer_digital_eligibility({actor},ARRAY[{edition}]) e'))
        assert eligible['owned'] and not eligible['purchasable']
        query(f'CALL pliego.sp_order_cancel({actor},{second},NULL,NULL,NULL,NULL,NULL)')
        # Third paid source is still open (although revoked); cancel it to remove pending status.
        query(f'CALL pliego.sp_order_cancel({actor},{third},NULL,NULL,NULL,NULL,NULL)')
        assert query(f'SELECT purchasable FROM pliego.fn_customer_digital_eligibility({actor},ARRAY[{edition}])') == 't'
        buy(actor, edition)
        print('Digital single-copy upgrade: 2 legacy ACTIVE grants retained and read-only audit reports both; same-item replay, new-source denial, legacy pending capture rollback, refunds and repurchase passed.')
    finally:
        current.terminate(); current.wait(timeout=20)


if __name__ == '__main__':
    main()
