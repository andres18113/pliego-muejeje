"""Live public Storefront/Help/catalog contract; ownership ends at owned-item detail."""
import uuid
from urllib.parse import urlencode
from digital_editions_http_gate import ok, problem as assert_problem
from checkout_last_unit import query


def problem(path, status, code):
    assert_problem(path, None, "GET", None, code, expected=status)


def main():
    nav = ok('/api/v1/storefront/navigation')
    assert [s['key'] for s in nav['sections']] == ['PHYSICAL', 'EBOOK', 'AUDIOBOOK', 'OFFERS', 'HELP']
    assert [s['label'] for s in nav['sections']] == ['Libros', 'eBooks', 'Audiolibros', 'Ofertas', 'Ayuda']
    for section in nav['sections'][:3]:
        kind = section['key']
        assert len(section['featured']) <= 3
        assert section['bestSellingHref'] == f'/catalog?productType={kind}&sort=BEST_SELLING'
        assert section['activeOfferCount'].isdigit()
        for item in section['featured']:
            assert item['productType'] == kind and isinstance(item['price'], str)
            expected = ('PAPERBACK', 'HARDCOVER') if kind == 'PHYSICAL' else (kind,)
            assert item['format'] in expected
            assert item['href'] == '/catalog/editions/' + item['editionId']
    assert nav['sections'][3]['href'] == '/ofertas' and nav['sections'][4]['href'] == '/ayuda'
    for kind in ('PHYSICAL', 'EBOOK', 'AUDIOBOOK'):
        for q in ('', 'libro'):
            page = ok('/api/v1/catalog/editions?' + urlencode({'productType': kind, 'sort': 'BEST_SELLING', 'que': q}))
            for edition in page['items']:
                assert edition['format'] in (('PAPERBACK', 'HARDCOVER') if kind == 'PHYSICAL' else (kind,))
    problem('/api/v1/catalog/editions?productType=VIDEO', 400, 'VALIDATION_ERROR')
    categories = ok('/api/v1/help/categories')['items']
    assert {'ebooks', 'audiolibros', 'pagos', 'compras'} <= {c['slug'] for c in categories}
    for slug in ('ebooks', 'audiolibros'):
        article = ok('/api/v1/help/articles/' + slug)
        assert article['slug'] == slug and article['body'] and 'simulación académica' in article['body']
    suffix = uuid.uuid4().hex[:12]
    slug = 'http-help-' + suffix
    query(f"INSERT INTO pliego.ayuda_categoria(slug,titulo,estado) VALUES('{slug}','Ayuda {suffix}','PUBLISHED')")
    category = query(f"SELECT categoria_id FROM pliego.ayuda_categoria WHERE slug='{slug}'")
    try:
        query(f"INSERT INTO pliego.ayuda_articulo(categoria_id,slug,titulo,resumen,cuerpo,estado,aplicabilidad) VALUES"
              f"({category},'{slug}-public','Título {suffix}','Resumen {suffix}','Cuerpo {suffix}','PUBLISHED','EBOOK'),"
              f"({category},'{slug}-draft','Título {suffix}','Resumen {suffix}','Cuerpo {suffix}','DRAFT','EBOOK')")
        page = ok('/api/v1/help/articles?' + urlencode({'que': suffix, 'category': slug, 'applicability': 'EBOOK'}))
        assert page['totalCount'] == '1' and [a['slug'] for a in page['items']] == [slug + '-public']
        page = ok('/api/v1/help/articles?' + urlencode({'que': suffix, 'category': slug, 'page': 100, 'pageSize': 1}))
        assert page['items'] == [] and page['totalCount'] == '1'
        problem('/api/v1/help/articles/' + slug + '-draft', 404, 'HELP_ARTICLE_NOT_FOUND')
        ok('/api/v1/help/articles/' + slug + '-public')
        query(f"UPDATE pliego.ayuda_categoria SET estado='DRAFT' WHERE categoria_id={category}")
        problem('/api/v1/help/articles/' + slug + '-public', 404, 'HELP_ARTICLE_NOT_FOUND')
    finally:
        query(f"DELETE FROM pliego.ayuda_articulo WHERE categoria_id={category}")
        query(f"DELETE FROM pliego.ayuda_categoria WHERE categoria_id={category}")
    problem('/api/v1/help/articles?applicability=VIDEO', 400, 'VALIDATION_ERROR')
    problem('/api/v1/help/articles?que=' + 'x' * 141, 400, 'VALIDATION_ERROR')
    print('Storefront navigation, scoped BEST_SELLING and published Help HTTP contracts passed')


if __name__ == '__main__':
    main()
