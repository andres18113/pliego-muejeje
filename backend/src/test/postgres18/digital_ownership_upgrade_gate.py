"""Fresh disposable database only: real Flyway V044→current historical ownership backfill."""
import json
import uuid
from monetary_upgrade_gate import start
from checkout_last_unit import fixture,query


def main():
    old=start(44)
    try:
        actors,physical=fixture(); actor,address=actors[0]
        admin=query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'")
        book,pub=query(f'SELECT libro_id,editorial_id FROM pliego.edicion WHERE edicion_id={physical}').split('|')
        cart_item=query(f'SELECT carrito_item_id FROM pliego.carrito_item ci JOIN pliego.carrito c USING(carrito_id) JOIN pliego.cliente cl USING(cliente_id) WHERE cl.usuario_id={actor}')
        query(f'CALL pliego.sp_cart_remove_item({actor},{cart_item})')
        sources=[]
        for case in ['paid','refunded','rejected']:
            sku='UPGRADE-OWN-'+uuid.uuid4().hex.upper()
            edition=query(f"CALL pliego.sp_edition_create({admin},{book},{pub},'{sku}',NULL,'es','EBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],NULL)")
            query(f'CALL pliego.sp_cart_add_item({actor},{edition},1,NULL,NULL,NULL)')
            outcome='REJECTED' if case=='rejected' else 'APPROVED'
            order=query(f"CALL pliego.sp_checkout({actor},{address},'TRANSFER','{outcome}',NULL,NULL,NULL,NULL,NULL)").split('|')[0]
            if case=='refunded': query(f'CALL pliego.sp_order_cancel({actor},{order},NULL,NULL,NULL,NULL,NULL)')
            snapshot=json.loads(query(f'SELECT to_jsonb(d) FROM pliego.fn_customer_order_detail({actor},{order}) d'))
            sources.append((case,edition,order,snapshot))
            if case=='rejected':
                item=query(f'SELECT carrito_item_id FROM pliego.carrito_item WHERE edicion_id={edition}')
                query(f'CALL pliego.sp_cart_remove_item({actor},{item})')
    finally:
        old.terminate();old.wait(timeout=20)
    new=start(48)
    try:
        assert query('SELECT max(version)::integer FROM public.flyway_schema_history WHERE success')=='48'
        library=json.loads(query(f'SELECT COALESCE(jsonb_agg(item),\'[]\'::JSONB) FROM pliego.fn_customer_library({actor},NULL,0,20)'))
        assert len(library)==2
        by_edition={item['editionId']:item for item in library}
        for case,edition,order,before in sources:
            current=json.loads(query(f'SELECT to_jsonb(d) FROM pliego.fn_customer_order_detail({actor},{order}) d'))
            assert current==before,(case,'immutable legacy order changed')
            if case=='rejected': assert edition not in by_edition
            else:
                item=by_edition[edition]
                assert item['ownershipState']==('OWNED' if case=='paid' else 'REVOKED')
                assert item['sourcePurchases'][0]['orderId']==order
                assert item['sourcePurchases'][0]['orderItemId']==str(before['items'][0]['orderItemId'])
        print('Digital ownership Flyway upgrade passed: paid/refunded backfill, rejected exclusion and unchanged historical order/address/logistics snapshots.')
    finally:
        new.terminate();new.wait(timeout=20)

if __name__=='__main__': main()
