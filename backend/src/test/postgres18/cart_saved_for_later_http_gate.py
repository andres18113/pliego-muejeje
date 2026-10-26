"""Live CUSTOMER REST/JDBC/PostgreSQL coverage for Saved for Later."""
import uuid
from decimal import Decimal

from checkout_http_gate import token
from checkout_last_unit import fixture, query
from digital_editions_http_gate import ok, problem
from full_journey_http_gate import admin_token
from library_checkout_http_gate import checkout


def cart_snapshot(auth):
    cart = ok('/api/v1/cart', auth)
    return (cart['cartId'], [(line['editionId'], line['quantity']) for line in cart['items']],
            cart['currentSubtotal'], cart['total'])


def favorite_ids(auth):
    return {item['editionId'] for item in ok('/api/v1/me/favorites?page=0&pageSize=50', auth)['items']}


def create_edition(admin, physical, media, price='10.00'):
    suffix = uuid.uuid4().hex.upper()
    book, publisher = query(f'SELECT libro_id,editorial_id FROM pliego.edicion WHERE edicion_id={physical}').split('|')
    sku = f'SFL-{media}-{suffix}'
    if media == 'PAPERBACK':
        edition = query(f"CALL pliego.sp_edition_create({admin},{book},{publisher},'{sku}',NULL,'es','PAPERBACK',100,NULL,{price},NULL,NULL,NULL,NULL,NULL,NULL,ARRAY[]::TEXT[],NULL)")
        query(f"CALL pliego.sp_inventory_entry({admin},{edition},3,'Saved for Later test inventory',NULL,NULL,NULL)")
        return edition
    if media == 'EBOOK':
        return query(f"CALL pliego.sp_edition_create({admin},{book},{publisher},'{sku}',NULL,'es','EBOOK',NULL,NULL,{price},NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],NULL)")
    return query(f"CALL pliego.sp_edition_create({admin},{book},{publisher},'{sku}',NULL,'es','AUDIOBOOK',NULL,NULL,{price},NULL,NULL,NULL,NULL,NULL,3600,ARRAY['Voz SFL'],NULL)")


def main():
    actors, physical = fixture()
    actor, address = actors[0]
    other_actor = actors[1][0]
    auth = 'Bearer ' + token(actor)
    other_auth = 'Bearer ' + token(other_actor)
    admin = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'"))
    admin_auth = admin_token(admin)

    # Authentication and OpenAPI advertise all four new customer operations.
    ok('/api/v1/cart/saved', None, expected=401)
    ok('/api/v1/cart/saved', admin_auth, expected=403)
    contract = ok('/v3/api-docs', None)
    assert contract['paths']['/api/v1/cart/saved']['get']['responses']['200']
    assert contract['paths']['/api/v1/cart/items/{cartItemId}/save-for-later']['post']['responses']['200']
    assert contract['paths']['/api/v1/cart/saved/{savedItemId}/move-to-cart']['post']['responses']['200']
    assert contract['paths']['/api/v1/cart/saved/{savedItemId}']['delete']['responses']['204']

    # Both lists are separate; save removes the cart line and keeps favorites.
    query(f"CALL pliego.sp_inventory_entry({admin},{physical},8,'Saved for Later stock',NULL,NULL,NULL)")
    ok(f'/api/v1/me/favorites/{physical}', auth, 'PUT', expected=204)
    before_favorites = favorite_ids(auth)
    empty = ok('/api/v1/cart/saved', auth)
    assert empty == {'items': [], 'totalCount': 0}, empty
    cart = ok('/api/v1/cart', auth)
    line = next(row for row in cart['items'] if row['editionId'] == str(physical))
    moved = ok(f"/api/v1/cart/items/{line['cartItemId']}/save-for-later", auth, 'POST')
    saved = moved['saved']['items'][0]
    assert saved['editionId'] == str(physical) and saved['quantity'] == 1
    assert saved['format'] == 'PAPERBACK' and saved['requiresPhysicalFulfillment'] is True
    assert saved['available'] is True and saved['currentPrice'] and saved['currentSubtotal'] == saved['currentPrice']
    assert moved['cart']['items'] == [] and moved['cart']['currentSubtotal'] == '0.00'
    saved_id = saved['savedItemId']
    assert ok('/api/v1/cart/saved', other_auth)['items'] == []
    problem(f'/api/v1/cart/saved/{saved_id}/move-to-cart', other_auth, 'POST', None, 'P4006', 404)
    assert len(ok('/api/v1/cart/saved', auth)['items']) == 1

    # Re-saving the same edition keeps one row and the latest cart quantity wins.
    ok('/api/v1/cart/items', auth, 'POST', {'editionId': str(physical), 'quantity': 2})
    cart = ok('/api/v1/cart', auth)
    line = next(row for row in cart['items'] if row['editionId'] == str(physical))
    moved = ok(f"/api/v1/cart/items/{line['cartItemId']}/save-for-later", auth, 'POST')
    assert len(moved['saved']['items']) == 1 and moved['saved']['items'][0]['savedItemId'] == saved_id
    assert moved['saved']['items'][0]['quantity'] == 2

    restored = ok(f'/api/v1/cart/saved/{saved_id}/move-to-cart', auth, 'POST')
    assert restored['saved']['items'] == []
    assert len(restored['cart']['items']) == 1 and restored['cart']['items'][0]['quantity'] == 2
    assert Decimal(restored['cart']['currentSubtotal']) == Decimal(restored['cart']['items'][0]['currentPrice']) * 2
    problem(f'/api/v1/cart/saved/{saved_id}/move-to-cart', auth, 'POST', None, 'P4006', 404)
    problem('/api/v1/cart/items/9223372036854775807/save-for-later', auth, 'POST', None, 'P4003', 404)
    assert favorite_ids(auth) == before_favorites

    # Insufficient stock leaves the saved item and the pre-existing cart unchanged.
    stock_edition = create_edition(admin, physical, 'PAPERBACK', '4.00')
    ok(f'/api/v1/me/favorites/{stock_edition}', auth, 'PUT', expected=204)
    ok('/api/v1/cart/items', auth, 'POST', {'editionId': stock_edition, 'quantity': 2})
    cart = ok('/api/v1/cart', auth)
    stock_line = next(row for row in cart['items'] if row['editionId'] == stock_edition)
    saved_state = ok(f"/api/v1/cart/items/{stock_line['cartItemId']}/save-for-later", auth, 'POST')
    stock_saved = next(row for row in saved_state['saved']['items'] if row['editionId'] == stock_edition)
    query(f"CALL pliego.sp_inventory_adjust({admin},{stock_edition},'ADJUSTMENT_OUT',2,'Saved for Later stock decrease',NULL,NULL,NULL)")
    before_cart = cart_snapshot(auth)
    problem(f"/api/v1/cart/saved/{stock_saved['savedItemId']}/move-to-cart", auth, 'POST', None, 'P3002', 409)
    after_cart = cart_snapshot(auth)
    assert after_cart == before_cart, (before_cart, after_cart)
    still_saved = ok('/api/v1/cart/saved', auth)
    retained = next(row for row in still_saved['items'] if row['savedItemId'] == stock_saved['savedItemId'])
    assert retained['quantity'] == 2 and not retained['available'] and retained['unavailabilityReason'] == 'P3002'

    # Existing digital item remains one unit when its saved copy is moved back.
    ebook_duplicate = create_edition(admin, physical, 'EBOOK', '8.00')
    ok(f'/api/v1/me/favorites/{ebook_duplicate}', auth, 'PUT', expected=204)
    ok('/api/v1/cart/items', auth, 'POST', {'editionId': ebook_duplicate, 'quantity': 1})
    cart = ok('/api/v1/cart', auth)
    digital_line = next(row for row in cart['items'] if row['editionId'] == ebook_duplicate)
    state = ok(f"/api/v1/cart/items/{digital_line['cartItemId']}/save-for-later", auth, 'POST')
    digital_saved = next(row for row in state['saved']['items'] if row['editionId'] == ebook_duplicate)
    ok('/api/v1/cart/items', auth, 'POST', {'editionId': ebook_duplicate, 'quantity': 1})
    state = ok(f"/api/v1/cart/saved/{digital_saved['savedItemId']}/move-to-cart", auth, 'POST')
    matching = [row for row in state['cart']['items'] if row['editionId'] == ebook_duplicate]
    assert len(matching) == 1 and matching[0]['quantity'] == 1
    assert all(row['savedItemId'] != digital_saved['savedItemId'] for row in state['saved']['items'])

    # Already-owned digital copies fail without changing either list/cart.
    for row in ok('/api/v1/cart', auth)['items']:
        ok(f"/api/v1/cart/items/{row['cartItemId']}", auth, 'DELETE', expected=204)
    ebook_owned = create_edition(admin, physical, 'EBOOK', '9.00')
    ok(f'/api/v1/me/favorites/{ebook_owned}', auth, 'PUT', expected=204)
    ok('/api/v1/cart/items', auth, 'POST', {'editionId': ebook_owned, 'quantity': 1})
    cart = ok('/api/v1/cart', auth)
    line = next(row for row in cart['items'] if row['editionId'] == ebook_owned)
    state = ok(f"/api/v1/cart/items/{line['cartItemId']}/save-for-later", auth, 'POST')
    owned_saved = next(row for row in state['saved']['items'] if row['editionId'] == ebook_owned)
    cart = ok('/api/v1/cart', auth)
    ok('/api/v1/cart/items', auth, 'POST', {'editionId': ebook_owned, 'quantity': 1})
    cart = ok('/api/v1/cart', auth)
    status, order = checkout(auth, {'fulfillmentMethod': 'DIGITAL_ONLY', 'paymentMethod': 'TRANSFER',
                                    'simulationOutcome': 'APPROVED', 'expectedCartId': cart['cartId'],
                                    'expectedQuoteFingerprint': cart['quoteFingerprint']}, str(uuid.uuid4()))
    assert status == 201, (status, order)
    before_cart = cart_snapshot(auth)
    problem(f"/api/v1/cart/saved/{owned_saved['savedItemId']}/move-to-cart", auth, 'POST', None, 'P6002', 409)
    assert cart_snapshot(auth) == before_cart
    assert any(row['savedItemId'] == owned_saved['savedItemId'] for row in ok('/api/v1/cart/saved', auth)['items'])

    # Pending digital orders also retain the saved item and leave cart unchanged.
    audio_pending = create_edition(admin, physical, 'AUDIOBOOK', '11.00')
    ok(f'/api/v1/me/favorites/{audio_pending}', auth, 'PUT', expected=204)
    ok('/api/v1/cart/items', auth, 'POST', {'editionId': audio_pending, 'quantity': 1})
    cart = ok('/api/v1/cart', auth)
    line = next(row for row in cart['items'] if row['editionId'] == audio_pending)
    state = ok(f"/api/v1/cart/items/{line['cartItemId']}/save-for-later", auth, 'POST')
    pending_saved = next(row for row in state['saved']['items'] if row['editionId'] == audio_pending)
    ok('/api/v1/cart/items', auth, 'POST', {'editionId': audio_pending, 'quantity': 1})
    cart = ok('/api/v1/cart', auth)
    status, pending_order = checkout(auth, {'fulfillmentMethod': 'DIGITAL_ONLY', 'paymentMethod': 'TRANSFER',
                                            'simulationOutcome': 'PENDING', 'expectedCartId': cart['cartId'],
                                            'expectedQuoteFingerprint': cart['quoteFingerprint']}, str(uuid.uuid4()))
    assert status == 201 and pending_order['paymentState'] == 'PENDING', (status, pending_order)
    before_cart = cart_snapshot(auth)
    problem(f"/api/v1/cart/saved/{pending_saved['savedItemId']}/move-to-cart", auth, 'POST', None, 'P6003', 409)
    assert cart_snapshot(auth) == before_cart
    assert any(row['savedItemId'] == pending_saved['savedItemId'] for row in ok('/api/v1/cart/saved', auth)['items'])

    # Checkout only captures active-cart lines; a separately saved edition is untouched.
    ebook_saved = create_edition(admin, physical, 'EBOOK', '13.00')
    audio_checkout = create_edition(admin, physical, 'AUDIOBOOK', '14.00')
    ok(f'/api/v1/me/favorites/{ebook_saved}', auth, 'PUT', expected=204)
    ok('/api/v1/cart/items', auth, 'POST', {'editionId': ebook_saved, 'quantity': 1})
    cart = ok('/api/v1/cart', auth)
    saved_line = next(row for row in cart['items'] if row['editionId'] == ebook_saved)
    state = ok(f"/api/v1/cart/items/{saved_line['cartItemId']}/save-for-later", auth, 'POST')
    checkout_saved = next(row for row in state['saved']['items'] if row['editionId'] == ebook_saved)
    ok('/api/v1/cart/items', auth, 'POST', {'editionId': audio_checkout, 'quantity': 1})
    cart = ok('/api/v1/cart', auth)
    status, purchased = checkout(auth, {'fulfillmentMethod': 'DIGITAL_ONLY', 'paymentMethod': 'TRANSFER',
                                        'simulationOutcome': 'APPROVED', 'expectedCartId': cart['cartId'],
                                        'expectedQuoteFingerprint': cart['quoteFingerprint']}, str(uuid.uuid4()))
    assert status == 201, (status, purchased)
    order_items = query(f'SELECT string_agg(edicion_id::TEXT,\',\' ORDER BY edicion_id) FROM pliego.pedido_item WHERE pedido_id={purchased["orderId"]}')
    assert order_items == audio_checkout and ebook_saved not in order_items, order_items
    assert any(row['savedItemId'] == checkout_saved['savedItemId'] for row in ok('/api/v1/cart/saved', auth)['items'])
    ok(f"/api/v1/cart/saved/{checkout_saved['savedItemId']}", auth, 'DELETE', expected=204)
    assert all(row['savedItemId'] != checkout_saved['savedItemId'] for row in ok('/api/v1/cart/saved', auth)['items'])
    problem(f"/api/v1/cart/saved/{checkout_saved['savedItemId']}", auth, 'DELETE', None, 'P4006', 404)

    # Every saved movement/removal leaves the existing Favorites records alone.
    expected = before_favorites | {stock_edition, ebook_duplicate, ebook_owned, audio_pending, ebook_saved}
    assert favorite_ids(auth) == expected
    print('Saved for Later HTTP: CUSTOMER isolation, both directions, latest-wins uniqueness, stock/owned/pending rollback, digital one-copy, favorites, totals, checkout exclusion, delete and Spanish errors passed.')


if __name__ == '__main__':
    main()
