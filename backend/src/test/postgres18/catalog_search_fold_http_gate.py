"""Catalog and header suggestions share the real global-search HTTP endpoint."""
import uuid
from urllib.parse import urlencode
from checkout_last_unit import fixture, query
from digital_editions_http_gate import ok
from full_journey_http_gate import admin_token


def main():
    actors, physical = fixture()
    book, publisher = query(f'SELECT libro_id,editorial_id FROM pliego.edicion WHERE edicion_id={physical}').split('|')
    admin_id = query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'")
    auth = admin_token(int(admin_id))
    suffix = uuid.uuid4().hex[:10]
    author = query(f'SELECT autor_id FROM pliego.libro_autor WHERE libro_id={book}')
    category = query(f'SELECT c.slug FROM pliego.categoria c JOIN pliego.libro_categoria lc USING(categoria_id) WHERE libro_id={book}')
    query(f"UPDATE pliego.libro SET titulo='Cómo comportarse en la multitud' WHERE libro_id={book}")
    query(f"UPDATE pliego.autor SET nombre='Ángela Muñoz Peña {suffix}' WHERE autor_id={author}")
    editions = {'PAPERBACK': str(physical)}
    for media in ('HARDCOVER', 'EBOOK', 'AUDIOBOOK'):
        payload = dict(bookId=book, publisherId=publisher, sku=f'FOLD-{media}-{suffix}', isbn13=None,
            language='es', format=media, pageCount=100 if media == 'HARDCOVER' else None, price='10.00')
        if media == 'EBOOK':
            payload['ebookFileFormat'] = 'EPUB'
        if media == 'AUDIOBOOK':
            payload.update(audioDurationSeconds=3600, narrators=['Voz'])
        editions[media] = ok('/api/v1/admin/editions', auth, 'POST', payload, 201)['editionId']
        if media == 'HARDCOVER':
            query(f"CALL pliego.sp_inventory_entry({admin_id},{editions[media]},5,'fold fixture',NULL,NULL,NULL)")

    def search(**criteria):
        return ok('/api/v1/catalog/editions?' + urlencode(criteria))

    expected = set(editions.values())
    for text in ('como', 'COMO', 'CÓMO', 'Cómo', 'Co\u0301mo', 'comportarse en la multitud',
                 'ANGELA MUNOZ PENA ' + suffix, 'ÁNGELA MUÑOZ PEÑA ' + suffix):
        result = search(que=text, category=category, pageSize=50)
        assert {x['editionId'] for x in result['items']} == expected and result['totalCount'] == '4', (text, result)
        # HeaderSearch.tsx sends que, TITLE_ASC, page=0,pageSize=6, no scope.
        header = search(que=text, sort='TITLE_ASC', page=0, pageSize=6)
        assert expected <= {x['editionId'] for x in header['items']}, (text, header)
    for media, product_type in [('PAPERBACK', 'PHYSICAL'), ('HARDCOVER', 'PHYSICAL'), ('EBOOK', 'EBOOK'), ('AUDIOBOOK', 'AUDIOBOOK')]:
        result = search(que='como', category=category, format=media, productType=product_type, language='ES')
        assert [x['editionId'] for x in result['items']] == [editions[media]], result
    assert search(que='como', category=category, language='en')['items'] == []
    assert search(que='como', category=category, minPrice='11')['items'] == []
    for sort in ('TITLE_ASC', 'TITLE_DESC', 'PRICE_ASC', 'PRICE_DESC', 'BEST_SELLING'):
        accented = search(que='Cómo', category=category, sort=sort)
        plain = search(que='como', category=category, sort=sort)
        assert accented == plain
        pages = [search(que='como', category=category, sort=sort, page=i, pageSize=1) for i in range(4)]
        assert all(x['totalCount'] == '4' for x in pages)
        assert [x['items'][0]['editionId'] for x in pages] == [x['editionId'] for x in plain['items']]
    beyond = search(que='como', category=category, page=100)
    assert beyond['items'] == [] and beyond['totalCount'] == '4'
    independent = search(title='como', author='angela munoz pena ' + suffix, category=category)
    assert {x['editionId'] for x in independent['items']} == expected
    # Admin JDBC gateways are also backed by the folded Database API.
    for path, text, field, value in [('authors', 'angela munoz pena ' + suffix, 'authorId', author),
                                     ('books', 'como', 'bookId', book),
                                     ('editions', 'como', 'editionId', editions['AUDIOBOOK'])]:
        result = ok('/api/v1/admin/' + path + '?' + urlencode(dict(query=text, pageSize=50)), auth)
        assert value in {x[field] for x in result['items']}, (path, result)
    # Reverse folding: accented query over an unaccented stored title, including ñ.
    query(f"UPDATE pliego.libro SET titulo='Como nino {suffix}' WHERE libro_id={book}")
    result = search(que='CÓMO NIÑO ' + suffix)
    assert {x['editionId'] for x in result['items']} == expected
    print('Catalog fold HTTP: 4 formats, 8 query variants + header suggestions, independent filters, 5 sorts/pagination/counts, admin gateways and reverse accents/ñ passed.')


if __name__ == '__main__':
    main()
