-- Mejora la lectura de etiquetas y enlaces del Centro de ayuda.
-- Las frases editadas por el personal se conservan si ya no contienen el texto original.

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'El eBook sale de Mi biblioteca.',
      'El eBook sale de [Mi biblioteca](/biblioteca).')
WHERE slug = 'ebooks'
  AND strpos(cuerpo, 'El eBook sale de Mi biblioteca.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'En la página del audiolibro, Formato muestra su duración y Narración dice quién lo narra.',
      'En la página del audiolibro, «Formato» muestra su duración y «Narración» dice quién lo narra.')
WHERE slug = 'audiolibros'
  AND strpos(cuerpo, 'En la página del audiolibro, Formato muestra su duración y Narración dice quién lo narra.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'El audiolibro sale de Mi biblioteca.',
      'El audiolibro sale de [Mi biblioteca](/biblioteca).')
WHERE slug = 'audiolibros'
  AND strpos(cuerpo, 'El audiolibro sale de Mi biblioteca.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'selecciona Continuar con la compra.',
      'selecciona «Continuar con la compra».')
WHERE slug = 'compras'
  AND strpos(cuerpo, 'selecciona Continuar con la compra.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '2. Para libros impresos, elige Entrega a domicilio o Retiro en tienda.',
      '2. Para libros impresos, elige «Entrega a domicilio» o «Retiro en tienda».')
WHERE slug = 'compras'
  AND strpos(cuerpo, '2. Para libros impresos, elige Entrega a domicilio o Retiro en tienda.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '5. Selecciona Hacer pedido.',
      '5. Selecciona «Hacer pedido».')
WHERE slug = 'compras'
  AND strpos(cuerpo, '5. Selecciona Hacer pedido.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'Para hacerla a nombre de otra persona o empresa, elige Otra persona o empresa al finalizar la compra; tu perfil no cambia.',
      'Para hacerla a nombre de otra persona o empresa, al finalizar la compra selecciona «Cambiar datos de factura» y elige «Otra persona o empresa»; tu perfil no cambia.')
WHERE slug = 'compras'
  AND strpos(cuerpo, 'Para hacerla a nombre de otra persona o empresa, elige Otra persona o empresa al finalizar la compra; tu perfil no cambia.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'en el detalle del pedido aparece Ver factura.',
      'en el detalle del pedido aparece «Ver factura».')
WHERE slug = 'compras'
  AND strpos(cuerpo, 'en el detalle del pedido aparece Ver factura.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '1. Al finalizar la compra, elige Entrega a domicilio.',
      '1. Al finalizar la compra, elige «Entrega a domicilio».')
WHERE slug = 'entrega-a-domicilio'
  AND strpos(cuerpo, '1. Al finalizar la compra, elige Entrega a domicilio.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '3. Revisa la dirección y selecciona Hacer pedido.',
      '3. Revisa la dirección y selecciona «Hacer pedido».')
WHERE slug = 'entrega-a-domicilio'
  AND strpos(cuerpo, '3. Revisa la dirección y selecciona Hacer pedido.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'ves en qué etapa está: Pedido confirmado, En preparación, En camino, En reparto y Entregado.',
      'ves en qué etapa está: «Pedido confirmado», «En preparación», «En camino», «En reparto» y «Entregado».')
WHERE slug = 'entrega-a-domicilio'
  AND strpos(cuerpo, 'ves en qué etapa está: Pedido confirmado, En preparación, En camino, En reparto y Entregado.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'Puedes cancelarlo mientras está En preparación, desde el detalle del pedido. Después ya está en camino y no se puede cancelar.',
      'Puedes cancelarlo mientras está «En preparación», desde el detalle del pedido. Cuando pasa a «En camino», ya no se puede cancelar.')
WHERE slug = 'entrega-a-domicilio'
  AND strpos(cuerpo, 'Puedes cancelarlo mientras está En preparación, desde el detalle del pedido. Después ya está en camino y no se puede cancelar.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '1. Al finalizar la compra, elige Retiro en tienda.',
      '1. Al finalizar la compra, elige «Retiro en tienda».')
WHERE slug = 'retiro'
  AND strpos(cuerpo, '1. Al finalizar la compra, elige Retiro en tienda.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '3. Selecciona Hacer pedido.',
      '3. Selecciona «Hacer pedido».')
WHERE slug = 'retiro'
  AND strpos(cuerpo, '3. Selecciona Hacer pedido.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'tu código, que empieza con P-.',
      'tu código, que empieza con «P-».')
WHERE slug = 'retiro'
  AND strpos(cuerpo, 'tu código, que empieza con P-.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'el pedido pasa a Retirado y',
      'el pedido pasa a «Retirado» y')
WHERE slug = 'retiro'
  AND strpos(cuerpo, 'el pedido pasa a Retirado y') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'desde su detalle en Mis pedidos.',
      'desde su detalle en [Mis pedidos](/orders).')
WHERE slug = 'retiro'
  AND strpos(cuerpo, 'desde su detalle en Mis pedidos.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '1. En Finalizar compra, elige Tarjeta de crédito o débito.',
      '1. En «Finalizar compra», elige «Tarjeta de crédito o débito».')
WHERE slug = 'pagos'
  AND strpos(cuerpo, '1. En Finalizar compra, elige Tarjeta de crédito o débito.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'y selecciona Usar esta tarjeta.',
      'y selecciona «Usar esta tarjeta».')
WHERE slug = 'pagos'
  AND strpos(cuerpo, 'y selecciona Usar esta tarjeta.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '3. Selecciona Hacer pedido.',
      '3. Selecciona «Hacer pedido».')
WHERE slug = 'pagos'
  AND strpos(cuerpo, '3. Selecciona Hacer pedido.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '1. En Finalizar compra, elige Transferencia bancaria.',
      '1. En «Finalizar compra», elige «Transferencia bancaria».')
WHERE slug = 'pagos'
  AND strpos(cuerpo, '1. En Finalizar compra, elige Transferencia bancaria.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '4. Selecciona Hacer pedido.',
      '4. Selecciona «Hacer pedido».')
WHERE slug = 'pagos'
  AND strpos(cuerpo, '4. Selecciona Hacer pedido.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '- Pedidos con entrega a domicilio: mientras están En preparación.',
      '- Pedidos con entrega a domicilio: mientras están «En preparación».')
WHERE slug = 'cancelaciones-y-reembolsos'
  AND strpos(cuerpo, '- Pedidos con entrega a domicilio: mientras están En preparación.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'el detalle del pedido muestra Cancelar pedido.',
      'el detalle del pedido muestra «Cancelar pedido».')
WHERE slug = 'cancelaciones-y-reembolsos'
  AND strpos(cuerpo, 'el detalle del pedido muestra Cancelar pedido.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '2. Selecciona Cancelar pedido.',
      '2. Selecciona «Cancelar pedido».')
WHERE slug = 'cancelaciones-y-reembolsos'
  AND strpos(cuerpo, '2. Selecciona Cancelar pedido.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '3. Selecciona Confirmar cancelación.',
      '3. Selecciona «Confirmar cancelación».')
WHERE slug = 'cancelaciones-y-reembolsos'
  AND strpos(cuerpo, '3. Selecciona Confirmar cancelación.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'el pago aparece como Reembolsado.',
      'el pago aparece como «Reembolsado».')
WHERE slug = 'cancelaciones-y-reembolsos'
  AND strpos(cuerpo, 'el pago aparece como Reembolsado.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'con Cambiar en Contraseña.',
      'con «Cambiar» en «Contraseña».')
WHERE slug = 'cuenta-y-correo'
  AND strpos(cuerpo, 'con Cambiar en Contraseña.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'Tus pedidos, facturas y Mi biblioteca están',
      'Tus pedidos, facturas y [Mi biblioteca](/biblioteca) están')
WHERE slug = 'cuenta-y-correo'
  AND strpos(cuerpo, 'Tus pedidos, facturas y Mi biblioteca están') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'selecciona Agregar en Cédula o RUC.',
      'selecciona «Agregar» en «Cédula o RUC».')
WHERE slug = 'cedula-o-ruc'
  AND strpos(cuerpo, 'selecciona Agregar en Cédula o RUC.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '2. Escribe el número y selecciona Guardar.',
      '2. Escribe el número y selecciona «Guardar».')
WHERE slug = 'cedula-o-ruc'
  AND strpos(cuerpo, '2. Escribe el número y selecciona Guardar.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'selecciona Confirmar cédula o Confirmar RUC.',
      'selecciona «Confirmar cédula» o «Confirmar RUC».')
WHERE slug = 'cedula-o-ruc'
  AND strpos(cuerpo, 'selecciona Confirmar cédula o Confirmar RUC.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      '1. En Mi perfil, selecciona Corregir en Cédula o RUC.',
      '1. En [Mi perfil](/account), selecciona «Corregir» en «Cédula o RUC».')
WHERE slug = 'cedula-o-ruc'
  AND strpos(cuerpo, '1. En Mi perfil, selecciona Corregir en Cédula o RUC.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'Confirma con Sí, corregir o con Enviar solicitud.',
      'Confirma con «Sí, corregir» o con «Enviar solicitud».')
WHERE slug = 'cedula-o-ruc'
  AND strpos(cuerpo, 'Confirma con Sí, corregir o con Enviar solicitud.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'tu solicitud aparece como En revisión.',
      'tu solicitud aparece como «En revisión».')
WHERE slug = 'cedula-o-ruc'
  AND strpos(cuerpo, 'tu solicitud aparece como En revisión.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'te avisamos por correo y en Mi perfil.',
      'te avisamos por correo y en [Mi perfil](/account).')
WHERE slug = 'cedula-o-ruc'
  AND strpos(cuerpo, 'te avisamos por correo y en Mi perfil.') > 0;

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'Selecciona Retirar solicitud en',
      'Selecciona «Retirar solicitud» en')
WHERE slug = 'cedula-o-ruc'
  AND strpos(cuerpo, 'Selecciona Retirar solicitud en') > 0;
