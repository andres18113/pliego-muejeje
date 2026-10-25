"""Independent PostgreSQL sessions: same customer, distinct checkout keys."""
import uuid
from automatic_billing_concurrency import compete
from checkout_last_unit import query
from digital_single_copy_support import digital_fixture, digital_checkout
from digital_mixed_single_copy_http_gate import effects
from checkout_last_unit import fixture


def main():
    for outcome, code in [('APPROVED', 'P6002'), ('PENDING', 'P6003')]:
        actor, _, edition, cart, _ = digital_fixture()
        compete(digital_checkout(actor, cart, outcome=outcome), digital_checkout(actor, cart, outcome=outcome), code)
        assert query(f'SELECT count(*) FROM pliego.pedido_item WHERE edicion_id={edition}') == '1'
        assert query(f'SELECT count(*) FROM pliego.pago pa JOIN pliego.pedido_item i USING(pedido_id) WHERE i.edicion_id={edition}') == '1'
        assert query(f"SELECT count(*) FROM pliego.digital_grant g JOIN pliego.pedido_item i USING(pedido_item_id) WHERE i.edicion_id={edition} AND g.state='ACTIVE'") == ('1' if outcome == 'APPROVED' else '0')
        assert query(f'SELECT count(*) FROM pliego.checkout_attempt WHERE actor_user_id={actor}') == '1'
    # Deterministic compete barrier, mixed audiobook/physical CARD acceptance.
    actors, physical = fixture()
    actor, address = actors[0]
    admin = query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'")
    book, publisher = query(f'SELECT libro_id,editorial_id FROM pliego.edicion WHERE edicion_id={physical}').split('|')
    edition = query(f"CALL pliego.sp_edition_create({admin},{book},{publisher},'RACE-{uuid.uuid4().hex}',NULL,'es','AUDIOBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,NULL,3600,ARRAY['Voz'],NULL)")
    cart = query(f'CALL pliego.sp_cart_add_item({actor},{edition},1,NULL,NULL,NULL)').split('|')[0]
    from automatic_billing_concurrency import checkout
    command = lambda: checkout(actor, address, uuid.uuid4()).replace("'TRANSFER'", "'CARD'").replace("'APPROVED',NULL,", f"'APPROVED',{cart},")
    compete(command(), command(), 'P6002')
    assert effects(actor, physical) == '1|1|2|0|1'
    print('Digital single-copy concurrency: 3 races passed (approved, pending and mixed CARD); exactly one order/payment/receipt each.')


if __name__ == '__main__':
    main()
