-- Refresh existing published Help copy and add the billing-identity topic.
-- Existing articles retain their titles, categories, slugs, positions, applicability and publication state.
UPDATE pliego.ayuda_articulo
SET resumen = 'Dónde encuentras los eBooks que compras y qué incluye tu compra.',
    cuerpo = $body$## ¿Dónde está mi eBook?

Aparece en [Mi biblioteca](/biblioteca) en cuanto haces el pedido. Entra con la misma cuenta con la que compraste.

## ¿Puedo leerlo en PLIEGO?

No. PLIEGO registra el eBook en tu cuenta, pero no incluye un lector ni permite descargarlo.

## ¿Puedo comprarlo dos veces?

No. Cada cuenta tiene una sola copia de cada eBook. Si ya lo tienes, la página del libro dice «Ya está en tu biblioteca».

## ¿Y si cancelo el pedido?

El eBook sale de Mi biblioteca. Mira cuándo puedes cancelar en [Cancelaciones y reembolsos](/ayuda/cancelaciones-y-reembolsos).$body$
WHERE slug = 'ebooks'
  AND estado = 'PUBLISHED'
  AND categoria_id = (SELECT categoria_id FROM pliego.ayuda_categoria WHERE slug = 'ebooks');

UPDATE pliego.ayuda_articulo
SET resumen = 'Dónde encuentras los audiolibros que compras y qué incluye tu compra.',
    cuerpo = $body$## ¿Dónde está mi audiolibro?

Aparece en [Mi biblioteca](/biblioteca) en cuanto haces el pedido. Entra con la misma cuenta con la que compraste.

## ¿Puedo escucharlo en PLIEGO?

No. PLIEGO registra el audiolibro en tu cuenta, pero no incluye un reproductor ni permite descargarlo.

## ¿Cuánto dura y quién lo narra?

En la página del audiolibro, Formato muestra su duración y Narración dice quién lo narra.

## ¿Puedo comprarlo dos veces?

No. Cada cuenta tiene una sola copia de cada audiolibro. Si ya lo tienes, la página dice «Ya está en tu biblioteca».

## ¿Y si cancelo el pedido?

El audiolibro sale de Mi biblioteca. Mira cuándo puedes cancelar en [Cancelaciones y reembolsos](/ayuda/cancelaciones-y-reembolsos).$body$
WHERE slug = 'audiolibros'
  AND estado = 'PUBLISHED'
  AND categoria_id = (SELECT categoria_id FROM pliego.ayuda_categoria WHERE slug = 'audiolibros');

UPDATE pliego.ayuda_articulo
SET resumen = 'Cómo hacer un pedido, qué necesitas y dónde ves tu factura.',
    cuerpo = $body$## Cómo hacer un pedido

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

Cuando está lista, te avisamos por correo y en el detalle del pedido aparece Ver factura. Es un comprobante de compra en PDF, sin validez tributaria.$body$
WHERE slug = 'compras'
  AND estado = 'PUBLISHED'
  AND categoria_id = (SELECT categoria_id FROM pliego.ayuda_categoria WHERE slug = 'compras');

UPDATE pliego.ayuda_articulo
SET resumen = 'Cómo recibir tus libros impresos en casa y seguir tu envío.',
    cuerpo = $body$## Dónde y cuánto cuesta

Entregamos libros impresos en Ecuador, en las ciudades que puedes elegir al guardar tu dirección. El envío es gratis.

## Cómo pedirlo

1. Al finalizar la compra, elige Entrega a domicilio.
2. Elige una de tus direcciones o agrega una nueva: provincia, ciudad, dirección, quién recibe y un teléfono.
3. Revisa la dirección y selecciona Hacer pedido.

Después de hacer el pedido, su dirección ya no se puede cambiar. Tus direcciones guardadas se editan en [Direcciones](/account/addresses).

## Sigue tu envío

En [Mis pedidos](/orders) ves en qué etapa está: Pedido confirmado, En preparación, En camino, En reparto y Entregado. Te avisamos por correo cuando cambia de etapa, y el detalle del pedido guarda el historial del envío.

## Cancelar

Puedes cancelarlo mientras está En preparación, desde el detalle del pedido. Después ya está en camino y no se puede cancelar.$body$
WHERE slug = 'entrega-a-domicilio'
  AND estado = 'PUBLISHED'
  AND categoria_id = (SELECT categoria_id FROM pliego.ayuda_categoria WHERE slug = 'entrega-a-domicilio');

UPDATE pliego.ayuda_articulo
SET resumen = 'Cómo elegir un punto de retiro y recoger tu pedido.',
    cuerpo = $body$## Cómo pedirlo

1. Al finalizar la compra, elige Retiro en tienda.
2. Elige un punto de la lista: verás su dirección y su horario de atención.
3. Selecciona Hacer pedido.

El retiro es para libros impresos. Si el pedido también tiene eBooks o audiolibros, esos aparecen en [Mi biblioteca](/biblioteca).

## Cuándo y cómo recogerlo

En el detalle del pedido, en [Mis pedidos](/orders), ves la hora estimada de retiro y tu código de retiro, que empieza con P-. El código también llega en el correo de confirmación.

Ve al punto dentro de su horario de atención y presenta el código. Cuando lo recoges, el pedido pasa a Retirado.

## Cancelar

Tienes 6 minutos desde que haces el pedido para cancelarlo, desde su detalle en Mis pedidos.$body$
WHERE slug = 'retiro'
  AND estado = 'PUBLISHED'
  AND categoria_id = (SELECT categoria_id FROM pliego.ayuda_categoria WHERE slug = 'retiro');

UPDATE pliego.ayuda_articulo
SET resumen = 'Con qué puedes pagar y cómo hacerlo con tarjeta o transferencia.',
    cuerpo = $body$## Formas de pago

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

En el detalle de cada pedido, en [Mis pedidos](/orders): el método de pago, el subtotal, el IVA, el envío y el total.$body$
WHERE slug = 'pagos'
  AND estado = 'PUBLISHED'
  AND categoria_id = (SELECT categoria_id FROM pliego.ayuda_categoria WHERE slug = 'pagos');

UPDATE pliego.ayuda_articulo
SET resumen = 'Cuándo puedes cancelar un pedido y qué pasa con tu pago.',
    cuerpo = $body$## Cuándo puedes cancelar

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
- Te avisamos por correo de la cancelación.$body$
WHERE slug = 'cancelaciones-y-reembolsos'
  AND estado = 'PUBLISHED'
  AND categoria_id = (SELECT categoria_id FROM pliego.ayuda_categoria WHERE slug = 'cancelaciones-y-reembolsos');

UPDATE pliego.ayuda_articulo
SET resumen = 'Verifica tu correo, recupera tu contraseña y cambia tus datos.',
    cuerpo = $body$## Verificar tu correo

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

Tus pedidos, facturas y Mi biblioteca están en la cuenta con la que compraste. Entra siempre con ese correo.$body$
WHERE slug = 'cuenta-y-correo'
  AND estado = 'PUBLISHED'
  AND categoria_id = (SELECT categoria_id FROM pliego.ayuda_categoria WHERE slug = 'cuenta-y-correo');

-- Add the billing-identity topic after the existing published Help categories.
INSERT INTO pliego.ayuda_categoria(slug,titulo,posicion,aplicabilidad,estado)
SELECT 'cedula-o-ruc','Cédula o RUC',90,'GENERAL','PUBLISHED'
WHERE NOT EXISTS (SELECT 1 FROM pliego.ayuda_categoria WHERE slug='cedula-o-ruc');

INSERT INTO pliego.ayuda_articulo(categoria_id,slug,titulo,resumen,cuerpo,posicion,aplicabilidad,estado)
SELECT c.categoria_id,'cedula-o-ruc','Cédula o RUC','Por qué lo solicitamos y cómo corregirlo.',$body$## Por qué te la pedimos

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

Selecciona Retirar solicitud en [Cédula o RUC](/account/identity). Tu número actual no cambia. Si más adelante quieres corregirlo, envía una solicitud nueva.$body$,10,c.aplicabilidad,'PUBLISHED'
FROM pliego.ayuda_categoria c
WHERE c.slug='cedula-o-ruc' AND c.estado='PUBLISHED'
  AND NOT EXISTS (SELECT 1 FROM pliego.ayuda_articulo WHERE slug='cedula-o-ruc');
