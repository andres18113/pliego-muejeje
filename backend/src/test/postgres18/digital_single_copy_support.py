"""Public routine fixtures for disposable PostgreSQL single-copy gates."""
import uuid
from checkout_last_unit import fixture, query


def digital_fixture():
    actors, physical = fixture()
    actor = actors[0][0]
    admin = query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'")
    book, publisher = query(f'SELECT libro_id,editorial_id FROM pliego.edicion WHERE edicion_id={physical}').split('|')
    edition = query(f"CALL pliego.sp_edition_create({admin},{book},{publisher},'SINGLE-{uuid.uuid4().hex.upper()}',NULL,'es','EBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],NULL)")
    item = query(f'SELECT ci.carrito_item_id FROM pliego.carrito c JOIN pliego.carrito_item ci USING(carrito_id) JOIN pliego.cliente cl USING(cliente_id) WHERE cl.usuario_id={actor} AND c.estado=\'ACTIVE\'')
    query(f'CALL pliego.sp_cart_remove_item({actor},{item})')
    cart = query(f'CALL pliego.sp_cart_add_item({actor},{edition},1,NULL,NULL,NULL)').split('|')[0]
    return actor, actors[1][0], edition, cart, admin


def digital_checkout(actor, cart, key=None, outcome='APPROVED'):
    return f"""CALL pliego.sp_checkout_billed_quoted({actor},'{key or uuid.uuid4()}',NULL,'TRANSFER','{outcome}',{cart},
      'DIGITAL_ONLY',NULL,NULL,'EC_CEDULA','0912345675','Comprador Fiscal','Calle Fiscal',NULL,
      'Quito','Pichincha','EC',NULL,NULL,NULL,NULL,NULL,NULL,NULL)"""
