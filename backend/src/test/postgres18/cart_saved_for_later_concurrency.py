"""Two HTTP moves on the same cart/saved item cannot duplicate or lose state."""
from concurrent.futures import ThreadPoolExecutor

from checkout_http_gate import token
from checkout_last_unit import fixture, query
from digital_editions_http_gate import ok
from full_journey_http_gate import request


def main():
    actors, edition = fixture()
    actor = actors[0][0]
    auth = 'Bearer ' + token(actor)
    ok(f'/api/v1/me/favorites/{edition}', auth, 'PUT', expected=204)
    before_favorites = {item['editionId'] for item in ok('/api/v1/me/favorites?page=0&pageSize=50', auth)['items']}
    cart = ok('/api/v1/cart', auth)
    line = next(row for row in cart['items'] if row['editionId'] == str(edition))

    save_path = f"/api/v1/cart/items/{line['cartItemId']}/save-for-later"
    with ThreadPoolExecutor(max_workers=2) as pool:
        saved_moves = list(pool.map(lambda _: request(save_path, auth, 'POST'), range(2)))
    assert sorted(status for status, _, _ in saved_moves) == [200, 404], saved_moves
    absent_line = next(problem for status, _, problem in saved_moves if status == 404)
    assert absent_line['code'] == 'P4003', absent_line
    saved = ok('/api/v1/cart/saved', auth)
    assert saved['totalCount'] == 1 and len(saved['items']) == 1, saved
    saved_id = saved['items'][0]['savedItemId']
    assert saved['items'][0]['editionId'] == str(edition) and saved['items'][0]['quantity'] == 1
    assert ok('/api/v1/cart', auth)['items'] == []

    restore_path = f'/api/v1/cart/saved/{saved_id}/move-to-cart'
    with ThreadPoolExecutor(max_workers=2) as pool:
        restore_moves = list(pool.map(lambda _: request(restore_path, auth, 'POST'), range(2)))
    assert sorted(status for status, _, _ in restore_moves) == [200, 404], restore_moves
    absent_saved = next(problem for status, _, problem in restore_moves if status == 404)
    assert absent_saved['code'] == 'P4006', absent_saved
    cart = ok('/api/v1/cart', auth)
    assert len(cart['items']) == 1 and cart['items'][0]['editionId'] == str(edition)
    assert cart['items'][0]['quantity'] == 1
    assert ok('/api/v1/cart/saved', auth) == {'items': [], 'totalCount': 0}
    assert {item['editionId'] for item in ok('/api/v1/me/favorites?page=0&pageSize=50', auth)['items']} == before_favorites
    assert query(f"SELECT count(*) FROM pliego.carrito_item ci JOIN pliego.carrito c USING(carrito_id) JOIN pliego.cliente cl USING(cliente_id) WHERE cl.usuario_id={actor} AND c.estado='ACTIVE' AND ci.edicion_id={edition}") == '1'
    print('Saved for Later concurrency: simultaneous save and restore races each yielded one effect, one safe 404, one final item and no favorite changes.')


if __name__ == '__main__':
    main()
