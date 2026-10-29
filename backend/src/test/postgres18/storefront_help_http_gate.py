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
    assert {'ebooks', 'audiolibros', 'pagos', 'compras', 'cedula-o-ruc'} <= {c['slug'] for c in categories}
    identity_category = next(c for c in categories if c['slug'] == 'cedula-o-ruc')
    assert identity_category['title'] == 'Cédula o RUC'
    assert identity_category['position'] == 90 and identity_category['applicability'] == 'GENERAL'
    expected_help = {
        'ebooks': {
            'summary': 'Dónde encuentras los eBooks que compras y qué incluye tu compra.',
            'body': '''## ¿Dónde está mi eBook?

Aparece en [Mi biblioteca](/biblioteca) en cuanto haces el pedido. Entra con la misma cuenta con la que compraste.

## ¿Puedo leerlo en PLIEGO?

No. PLIEGO registra el eBook en tu cuenta, pero no incluye un lector ni permite descargarlo.

## ¿Puedo comprarlo dos veces?

No. Cada cuenta tiene una sola copia de cada eBook. Si ya lo tienes, la página del libro dice «Ya está en tu biblioteca».

## ¿Y si cancelo el pedido?

El eBook sale de Mi biblioteca. Mira cuándo puedes cancelar en [Cancelaciones y reembolsos](/ayuda/cancelaciones-y-reembolsos).''',
        },
        'audiolibros': {
            'summary': 'Dónde encuentras los audiolibros que compras y qué incluye tu compra.',
            'body': '''## ¿Dónde está mi audiolibro?

Aparece en [Mi biblioteca](/biblioteca) en cuanto haces el pedido. Entra con la misma cuenta con la que compraste.

## ¿Puedo escucharlo en PLIEGO?

No. PLIEGO registra el audiolibro en tu cuenta, pero no incluye un reproductor ni permite descargarlo.

## ¿Cuánto dura y quién lo narra?

En la página del audiolibro, Formato muestra su duración y Narración dice quién lo narra.

## ¿Puedo comprarlo dos veces?

No. Cada cuenta tiene una sola copia de cada audiolibro. Si ya lo tienes, la página dice «Ya está en tu biblioteca».

## ¿Y si cancelo el pedido?

El audiolibro sale de Mi biblioteca. Mira cuándo puedes cancelar en [Cancelaciones y reembolsos](/ayuda/cancelaciones-y-reembolsos).''',
        },
        'compras': {
            'summary': 'Cómo hacer un pedido, qué necesitas y dónde ves tu factura.',
            'body': '''## Cómo hacer un pedido

Necesitas iniciar sesión y tener tu cédula o RUC en [Mi perfil](/account).

1. Agrega libros a tu [carrito](/cart) y selecciona Continuar con la compra.
2. Para libros impresos, elige Entrega a domicilio o Retiro en tienda.
3. Revisa a nombre de quién sale la factura.
4. Elige cómo pagar: tarjeta o transferencia bancaria.
5. Selecciona Hacer pedido.

Te enviamos un correo de confirmación y el pedido aparece en [Mis pedidos](/orders).

## Libros impresos y digitales en un mismo pedido

Puedes combinarlos. Los eBooks y audiolibros aparecen en [Mi biblioteca](/biblioteca); los libros impresos llegan a tu dirección o te esperan en el punto de retiro.

## Tu factura

Sale a tu nombre con tu cédula o RUC. Para hacerla a nombre de otra persona o empresa, elige Otra persona o empresa al finalizar la compra; tu perfil no cambia.

Cuando está lista, te avisamos por correo y en el detalle del pedido aparece Ver factura. Es un comprobante de compra en PDF, sin validez tributaria.''',
        },
        'entrega-a-domicilio': {
            'summary': 'Cómo recibir tus libros impresos en casa y seguir tu envío.',
            'body': '''## Dónde y cuánto cuesta

Entregamos libros impresos en Ecuador, en las ciudades que puedes elegir al guardar tu dirección. El envío es gratis.

## Cómo pedirlo

1. Al finalizar la compra, elige Entrega a domicilio.
2. Elige una de tus direcciones o agrega una nueva: provincia, ciudad, dirección, quién recibe y un teléfono.
3. Revisa la dirección y selecciona Hacer pedido.

Después de hacer el pedido, su dirección ya no se puede cambiar. Tus direcciones guardadas se editan en [Direcciones](/account/addresses).

## Sigue tu envío

En [Mis pedidos](/orders) ves en qué etapa está: Pedido confirmado, En preparación, En camino, En reparto y Entregado. Te avisamos por correo cuando cambia de etapa, y el detalle del pedido guarda el historial del envío.

## Cancelar

Puedes cancelarlo mientras está En preparación, desde el detalle del pedido. Después ya está en camino y no se puede cancelar.''',
        },
        'retiro': {
            'summary': 'Cómo elegir un punto de retiro y recoger tu pedido.',
            'body': '''## Cómo pedirlo

1. Al finalizar la compra, elige Retiro en tienda.
2. Elige un punto de la lista: verás su dirección y su horario de atención.
3. Selecciona Hacer pedido.

El retiro es para libros impresos. Si el pedido también tiene eBooks o audiolibros, esos aparecen en [Mi biblioteca](/biblioteca).

## Cuándo y cómo recogerlo

En el detalle del pedido, en [Mis pedidos](/orders), ves la hora estimada de retiro y tu código de retiro, que empieza con P-. El código también llega en el correo de confirmación.

Ve al punto dentro de su horario de atención y presenta el código. Cuando lo recoges, el pedido pasa a Retirado.

## Cancelar

Tienes 6 minutos desde que haces el pedido para cancelarlo, desde su detalle en Mis pedidos.''',
        },
        'pagos': {
            'summary': 'Con qué puedes pagar y cómo hacerlo con tarjeta o transferencia.',
            'body': '''## Formas de pago

- Tarjeta de crédito o débito: Visa, Mastercard, American Express o Diners Club.
- Transferencia bancaria.

Los precios están en dólares estadounidenses. Los libros tienen IVA 0 %.

## Pagar con tarjeta

1. En Finalizar compra, elige Tarjeta de crédito o débito.
2. Escribe el número, la caducidad (MM/AA) y el código de seguridad, y selecciona Usar esta tarjeta.
3. Selecciona Hacer pedido.

## Pagar por transferencia

1. En Finalizar compra, elige Transferencia bancaria.
2. Copia los datos que aparecen: banco, número de cuenta, beneficiario, identificación, monto exacto y referencia.
3. Transfiere el monto exacto e incluye la referencia.
4. Selecciona Hacer pedido.

## ¿Dónde veo lo que pagué?

En el detalle de cada pedido, en [Mis pedidos](/orders): el método de pago, el subtotal, el IVA, el envío y el total.''',
        },
        'cancelaciones-y-reembolsos': {
            'summary': 'Cuándo puedes cancelar un pedido y qué pasa con tu pago.',
            'body': '''## Cuándo puedes cancelar

- Pedidos de eBooks, audiolibros o retiro en tienda: durante los primeros 6 minutos después de hacer el pedido.
- Pedidos con entrega a domicilio: mientras están En preparación.

Mientras puedes cancelar, el detalle del pedido muestra Cancelar pedido.

## Cómo cancelar

1. Abre el pedido en [Mis pedidos](/orders).
2. Selecciona Cancelar pedido.
3. Selecciona Confirmar cancelación.

Se cancela el pedido completo; no puedes cancelar solo algunos libros.

## Qué pasa después

- Reembolsamos el total del pedido y el pago aparece como Reembolsado.
- Los eBooks y audiolibros del pedido salen de [Mi biblioteca](/biblioteca).
- Si el pedido ya tenía factura, verás en su detalle la nota de crédito que la anula.
- Te avisamos por correo de la cancelación.''',
        },
        'cuenta-y-correo': {
            'summary': 'Verifica tu correo, recupera tu contraseña y cambia tus datos.',
            'body': '''## Verificar tu correo

Al [crear tu cuenta](/register) te enviamos un enlace de verificación; ábrelo para poder iniciar sesión. Vale 24 horas. Si venció o no llegó, pide otro en [Reenviar verificación](/reenviar-verificacion).

## Olvidé mi contraseña

1. En [Recuperar contraseña](/recuperar-contrasena), escribe tu correo.
2. Abre el enlace que te enviamos. Vale 15 minutos.
3. Crea una contraseña nueva.

Con la sesión iniciada, también puedes pedir ese enlace desde [Mi perfil](/account), con Cambiar en Contraseña.

## Cambiar tus datos

En [Mi perfil](/account) cambias tus nombres, apellidos, teléfono y correo. Para cambiar el correo te pedimos tu contraseña actual; después verificas el correo nuevo.

Para tu cédula o RUC, lee [Cédula o RUC](/ayuda/cedula-o-ruc).

## Tus compras son de tu cuenta

Tus pedidos, facturas y Mi biblioteca están en la cuenta con la que compraste. Entra siempre con ese correo.''',
        },
        'cedula-o-ruc': {
            'summary': 'Por qué lo solicitamos y cómo corregirlo.',
            'body': '''## Por qué te la pedimos

La necesitas para comprar: identifica al comprador en el comprobante de compra. Si tu número está incompleto o es incorrecto, puedes pedir que lo corrijamos.

## Cómo agregarla

1. En [Mi perfil](/account), selecciona Agregar en Cédula o RUC.
2. Escribe el número y selecciona Guardar.
3. Revisa el número y selecciona Confirmar cédula o Confirmar RUC.

## Cómo corregirla

1. En Mi perfil, selecciona Corregir en Cédula o RUC.
2. En [Cédula o RUC](/account/identity), escribe el número correcto.
3. La página te dice si el cambio se aplica al momento o si lo revisamos. Confirma con Sí, corregir o con Enviar solicitud.

Se aplica al momento si tu número todavía no aparece en ninguna factura, o si cambias entre tu cédula y tu RUC (tu cédula seguida de 001). Los demás cambios los revisamos.

## Mientras la revisamos

Te respondemos en un plazo de 15 días. Mientras tanto, tu solicitud aparece como En revisión.

Tus compras siguen usando tu número actual. Las facturas ya emitidas no cambian.

## Si ya no quieres el cambio

Selecciona Retirar solicitud en [Cédula o RUC](/account/identity). Tu número actual no cambia. Si más adelante quieres corregirlo, envía una solicitud nueva.''',
        },
    }
    for slug, expected in expected_help.items():
        article = ok('/api/v1/help/articles/' + slug)
        assert article['slug'] == slug and article['summary'] == expected['summary']
        assert article['body'] == expected['body']
        assert 'simulación académica' not in article['body']
        if slug == 'cedula-o-ruc':
            assert article['categorySlug'] == slug
            assert article['title'] == 'Cédula o RUC'
            assert article['position'] == 10 and article['applicability'] == 'GENERAL'
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
