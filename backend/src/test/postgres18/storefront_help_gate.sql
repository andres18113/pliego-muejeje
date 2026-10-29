-- PostgreSQL 18, Flyway through V046. All fixtures roll back.
BEGIN;
CREATE FUNCTION pg_temp.purchase(p_customer BIGINT,p_edition BIGINT,p_at TIMESTAMPTZ,p_quantity INTEGER DEFAULT 1,
 p_payment VARCHAR DEFAULT 'APPROVED',p_order_state VARCHAR DEFAULT 'CONFIRMED') RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE o BIGINT; e RECORD;
BEGIN
 SELECT * INTO e FROM pliego.edicion WHERE edicion_id=p_edition;
 INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total,fecha_creacion)
 VALUES(p_customer,p_order_state,10*p_quantity,10*p_quantity,p_at) RETURNING pedido_id INTO o;
 INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,isbn_snapshot,titulo_snapshot,autores_snapshot,
 editorial_snapshot,formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal)
 VALUES(o,e.edicion_id,e.sku,e.isbn13,'Compra de prueba','Autora de prueba','Editorial de prueba',e.formato,e.idioma,10,p_quantity,10*p_quantity);
 INSERT INTO pliego.pedido_estado_historial(pedido_id,origen,estado_anterior,estado_nuevo,fecha)
 VALUES(o,'SYSTEM','PENDING_PAYMENT','CONFIRMED',p_at);
 INSERT INTO pliego.pago(pedido_id,metodo,estado,monto,referencia)
 VALUES(o,'TRANSFER',p_payment,10*p_quantity,CASE WHEN p_payment IN('APPROVED','REFUNDED') THEN 'NAV-'||o END);
 RETURN o;
END $$;
DO $gate$
DECLARE a BIGINT; author_id BIGINT; publisher BIGINT; category BIGINT; hidden BIGINT; hidden_child BIGINT;
 book BIGINT; other_book BIGINT; paperback BIGINT; hardcover BIGINT; ebook BIGINT; recent1 BIGINT; recent2 BIGINT;
 recent3 BIGINT; audio BIGINT; hidden_edition BIGINT; user_id BIGINT; customer BIGINT; state VARCHAR; movement BIGINT;
 before_stock INTEGER; after_stock INTEGER; o BIGINT; offer BIGINT; nav JSONB; section JSONB; first_id BIGINT;
 c BIGINT; ids BIGINT[]; draft_category BIGINT;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('nav-help-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
 CALL pliego.sp_author_create(a,'Autora navegación',NULL,author_id);
 CALL pliego.sp_publisher_create(a,'Editorial navegación',NULL,publisher);
 CALL pliego.sp_category_create(a,'Navegación','nav-help',NULL,NULL,category);
 CALL pliego.sp_category_create(a,'Oculta','nav-hidden',NULL,NULL,hidden);
 CALL pliego.sp_category_create(a,'Hija oculta','nav-hidden-child',NULL,hidden,hidden_child);
 CALL pliego.sp_book_create(a,'Obra navegación',NULL,NULL,jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(category),book);
 CALL pliego.sp_book_create(a,'Obra oculta navegación',NULL,NULL,jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(hidden_child),other_book);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-PAPER',NULL,'es','PAPERBACK',100,NULL,10,NULL,NULL,NULL,NULL,paperback);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-HARD',NULL,'es','HARDCOVER',100,NULL,10,NULL,NULL,NULL,NULL,hardcover);
 CALL pliego.sp_inventory_entry(a,paperback,10,'fixture',movement,before_stock,after_stock);
 CALL pliego.sp_inventory_entry(a,hardcover,10,'fixture',movement,before_stock,after_stock);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-EBOOK',NULL,'es','EBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],ebook);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-RECENT1',NULL,'es','EBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,'PDF',NULL,ARRAY[]::TEXT[],recent1);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-RECENT2',NULL,'es','EBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,NULL,NULL,NULL,recent2);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-RECENT3',NULL,'es','EBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,NULL,NULL,NULL,recent3);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-AUDIO',NULL,'es','AUDIOBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,NULL,3600,ARRAY['Una voz'],audio);
 CALL pliego.sp_edition_create(a,other_book,publisher,'NAV-HIDDEN',NULL,'es','EBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,NULL,NULL,NULL,hidden_edition);
 CALL pliego.sp_category_set_status(a,hidden,'INACTIVE');
 UPDATE pliego.edicion SET fecha_creacion=statement_timestamp()-INTERVAL '4 days' WHERE edicion_id=ebook;
 UPDATE pliego.edicion SET fecha_creacion=statement_timestamp()-INTERVAL '3 days' WHERE edicion_id=recent1;
 UPDATE pliego.edicion SET fecha_creacion=statement_timestamp()-INTERVAL '2 days' WHERE edicion_id=recent2;
 UPDATE pliego.edicion SET fecha_creacion=statement_timestamp()-INTERVAL '1 day' WHERE edicion_id=recent3;
 CALL pliego.sp_customer_register('nav-help-customer@example.invalid','fixture','Ana','Pérez',NULL,user_id,customer,state);
 PERFORM pg_temp.purchase(customer,paperback,statement_timestamp()-INTERVAL '2 days',3);
 PERFORM pg_temp.purchase(customer,hardcover,statement_timestamp()-INTERVAL '1 day',1);
 o:=pg_temp.purchase(customer,ebook,statement_timestamp()-INTERVAL '30 days');
 -- Later physical lifecycle/payment timestamp changes do not move the sale timestamp.
 UPDATE pliego.pago SET fecha_actualizacion=statement_timestamp()+INTERVAL '100 days' WHERE pedido_id=o;
 PERFORM pg_temp.purchase(customer,recent1,statement_timestamp()-INTERVAL '31 days');
 PERFORM pg_temp.purchase(customer,recent2,statement_timestamp()+INTERVAL '1 day');
 PERFORM pg_temp.purchase(customer,recent3,statement_timestamp()-INTERVAL '1 day',1,'REJECTED','CANCELLED');
 PERFORM pg_temp.purchase(customer,recent3,statement_timestamp()-INTERVAL '1 day',1,'REFUNDED','CANCELLED');
 PERFORM pg_temp.purchase(customer,audio,statement_timestamp()-INTERVAL '1 day');
 IF (SELECT units FROM pliego.fn_catalog_sales_30d() WHERE edition_id=ebook)<>1
  OR EXISTS(SELECT 1 FROM pliego.fn_catalog_sales_30d() WHERE edition_id IN(recent1,recent2,recent3)) THEN
  RAISE EXCEPTION '30-day ranking included stale/future/rejected/refunded or omitted boundary sale'; END IF;
 SELECT edition_id INTO first_id FROM pliego.fn_catalog_search(NULL,NULL,NULL,'nav-help',NULL,NULL,NULL,NULL,'BEST_SELLING',0,20,'PHYSICAL') LIMIT 1;
 IF first_id<>paperback OR (SELECT count(*) FROM pliego.fn_catalog_search(NULL,NULL,NULL,'nav-help',NULL,NULL,NULL,NULL,'BEST_SELLING',0,20,'PHYSICAL'))<>2 THEN
  RAISE EXCEPTION 'Physical bestseller ranking/filter incorrect'; END IF;
 SELECT array_agg(edition_id) INTO ids FROM pliego.fn_catalog_search_global('Obra navegación','nav-help',NULL,NULL,NULL,NULL,'BEST_SELLING',0,20,'EBOOK');
 IF ids<>ARRAY[ebook,recent3,recent2,recent1] THEN RAISE EXCEPTION 'eBook ranking/fallback incorrect: %',ids; END IF;
 IF (SELECT count(*) FROM pliego.fn_catalog_search(NULL,NULL,NULL,'nav-help',NULL,NULL,NULL,NULL,'BEST_SELLING',0,20,'AUDIOBOOK'))<>1 THEN
  RAISE EXCEPTION 'Audiobook scope incorrect'; END IF;
 CALL pliego.sp_edition_offer_set(a,ebook,8,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '1 day',offer);
 nav:=pliego.fn_storefront_navigation();
 IF jsonb_array_length(nav->'sections')<>5 OR nav->'sections'->0->>'label'<>'Libros'
  OR nav->'sections'->2->>'label'<>'Audiolibros' OR nav->'sections'->4->>'href'<>'/ayuda' THEN
  RAISE EXCEPTION 'Storefront section contract incorrect'; END IF;
 SELECT value INTO section FROM jsonb_array_elements(nav->'sections') WHERE value->>'key'='EBOOK';
 SELECT array_agg((value->>'editionId')::BIGINT) INTO ids FROM jsonb_array_elements(section->'featured');
 IF ids<>ARRAY[ebook,recent3,recent2] OR section->>'bestSellingHref'<>'/catalog?productType=EBOOK&sort=BEST_SELLING'
  OR (section->>'activeOfferCount')::BIGINT<1 OR section->'featured'->0->>'price'<>'8.00'
  OR section->'featured'->0->'offer'->>'offerId'<>offer::TEXT THEN RAISE EXCEPTION 'Featured fallback/offer contract incorrect: %',section; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(section->'categories') value WHERE value->>'slug' IN('nav-hidden','nav-hidden-child'))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(section->'featured') value WHERE value->>'editionId'=hidden_edition::TEXT) THEN
  RAISE EXCEPTION 'Inactive category ancestor leaked'; END IF;
 UPDATE pliego.edicion SET estado='INACTIVE' WHERE edicion_id=recent3;
 nav:=pliego.fn_storefront_navigation();
 SELECT value INTO section FROM jsonb_array_elements(nav->'sections') WHERE value->>'key'='EBOOK';
 SELECT array_agg((value->>'editionId')::BIGINT) INTO ids FROM jsonb_array_elements(section->'featured');
 IF ids<>ARRAY[ebook,recent2,recent1] THEN RAISE EXCEPTION 'Inactive edition leaked into featured'; END IF;
 -- Published Help filters on both category and article, with literal substring search and applicability.
 INSERT INTO pliego.ayuda_categoria(slug,titulo,estado) VALUES('draft-help','Oculto','DRAFT') RETURNING categoria_id INTO draft_category;
 INSERT INTO pliego.ayuda_articulo(categoria_id,slug,titulo,resumen,cuerpo,estado)
 VALUES(draft_category,'hidden-published','Hidden','Hidden','Hidden','PUBLISHED');
 SELECT categoria_id INTO c FROM pliego.ayuda_categoria WHERE slug='ebooks';
 INSERT INTO pliego.ayuda_articulo(categoria_id,slug,titulo,resumen,cuerpo,estado)
 VALUES(c,'draft-ebook','Hidden','Hidden','Hidden','DRAFT');
 IF EXISTS(SELECT 1 FROM pliego.fn_help_categories() WHERE slug='draft-help')
  OR EXISTS(SELECT 1 FROM pliego.fn_help_search('Hidden',NULL,NULL,0,20))
  OR EXISTS(SELECT 1 FROM pliego.fn_help_article('draft-ebook'))
  OR EXISTS(SELECT 1 FROM pliego.fn_help_article('hidden-published')) THEN RAISE EXCEPTION 'Unpublished Help leaked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pliego.fn_help_search('biblioteca','ebooks','EBOOK',0,20) WHERE slug='ebooks')
  OR NOT EXISTS(SELECT 1 FROM pliego.fn_help_search(NULL,NULL,'EBOOK',0,20) WHERE slug='pagos')
  OR EXISTS(SELECT 1 FROM pliego.fn_help_search(NULL,NULL,'EBOOK',0,20) WHERE applicability IN('PHYSICAL','AUDIOBOOK')) THEN
  RAISE EXCEPTION 'Help search/applicability incorrect'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pliego.fn_help_categories()
  WHERE slug='cedula-o-ruc' AND title='Cédula o RUC' AND "position"=90 AND applicability='GENERAL') THEN
  RAISE EXCEPTION 'Cédula o RUC Help category is missing or misordered'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pliego.fn_help_article('cedula-o-ruc') a
  WHERE a.slug='cedula-o-ruc' AND a.category_slug='cedula-o-ruc' AND a.title='Cédula o RUC'
   AND a."position"=10 AND a.applicability='GENERAL') THEN RAISE EXCEPTION 'Cédula o RUC Help article metadata is incorrect'; END IF;
 -- Exact summaries and bodies persisted by V086.
 IF EXISTS (
  SELECT 1
  FROM (VALUES
  ('ebooks','Dónde encuentras los eBooks que compras y qué incluye tu compra.',$expected_ebooks$## ¿Dónde está mi eBook?

Aparece en [Mi biblioteca](/biblioteca) en cuanto haces el pedido. Entra con la misma cuenta con la que compraste.

## ¿Puedo leerlo en PLIEGO?

No. PLIEGO registra el eBook en tu cuenta, pero no incluye un lector ni permite descargarlo.

## ¿Puedo comprarlo dos veces?

No. Cada cuenta tiene una sola copia de cada eBook. Si ya lo tienes, la página del libro dice «Ya está en tu biblioteca».

## ¿Y si cancelo el pedido?

El eBook sale de Mi biblioteca. Mira cuándo puedes cancelar en [Cancelaciones y reembolsos](/ayuda/cancelaciones-y-reembolsos).$expected_ebooks$),
  ('audiolibros','Dónde encuentras los audiolibros que compras y qué incluye tu compra.',$expected_audiolibros$## ¿Dónde está mi audiolibro?

Aparece en [Mi biblioteca](/biblioteca) en cuanto haces el pedido. Entra con la misma cuenta con la que compraste.

## ¿Puedo escucharlo en PLIEGO?

No. PLIEGO registra el audiolibro en tu cuenta, pero no incluye un reproductor ni permite descargarlo.

## ¿Cuánto dura y quién lo narra?

En la página del audiolibro, Formato muestra su duración y Narración dice quién lo narra.

## ¿Puedo comprarlo dos veces?

No. Cada cuenta tiene una sola copia de cada audiolibro. Si ya lo tienes, la página dice «Ya está en tu biblioteca».

## ¿Y si cancelo el pedido?

El audiolibro sale de Mi biblioteca. Mira cuándo puedes cancelar en [Cancelaciones y reembolsos](/ayuda/cancelaciones-y-reembolsos).$expected_audiolibros$),
  ('compras','Cómo hacer un pedido, qué necesitas y dónde ves tu factura.',$expected_compras$## Cómo hacer un pedido

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

Cuando está lista, te avisamos por correo y en el detalle del pedido aparece Ver factura. Es un comprobante de compra en PDF, sin validez tributaria.$expected_compras$),
  ('entrega-a-domicilio','Cómo recibir tus libros impresos en casa y seguir tu envío.',$expected_entrega_a_domicilio$## Dónde y cuánto cuesta

Entregamos libros impresos en Ecuador, en las ciudades que puedes elegir al guardar tu dirección. El envío es gratis.

## Cómo pedirlo

1. Al finalizar la compra, elige Entrega a domicilio.
2. Elige una de tus direcciones o agrega una nueva: provincia, ciudad, dirección, quién recibe y un teléfono.
3. Revisa la dirección y selecciona Hacer pedido.

Después de hacer el pedido, su dirección ya no se puede cambiar. Tus direcciones guardadas se editan en [Direcciones](/account/addresses).

## Sigue tu envío

En [Mis pedidos](/orders) ves en qué etapa está: Pedido confirmado, En preparación, En camino, En reparto y Entregado. Te avisamos por correo cuando cambia de etapa, y el detalle del pedido guarda el historial del envío.

## Cancelar

Puedes cancelarlo mientras está En preparación, desde el detalle del pedido. Después ya está en camino y no se puede cancelar.$expected_entrega_a_domicilio$),
  ('retiro','Cómo elegir un punto de retiro y recoger tu pedido.',$expected_retiro$## Cómo pedirlo

1. Al finalizar la compra, elige Retiro en tienda.
2. Elige un punto de la lista: verás su dirección y su horario de atención.
3. Selecciona Hacer pedido.

El retiro es para libros impresos. Si el pedido también tiene eBooks o audiolibros, esos aparecen en [Mi biblioteca](/biblioteca).

## Cuándo y cómo recogerlo

En el detalle del pedido, en [Mis pedidos](/orders), ves la hora estimada de retiro y tu código de retiro, que empieza con P-. El código también llega en el correo de confirmación.

Ve al punto dentro de su horario de atención y presenta el código. Cuando lo recoges, el pedido pasa a Retirado.

## Cancelar

Tienes 6 minutos desde que haces el pedido para cancelarlo, desde su detalle en Mis pedidos.$expected_retiro$),
  ('pagos','Con qué puedes pagar y cómo hacerlo con tarjeta o transferencia.',$expected_pagos$## Formas de pago

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

En el detalle de cada pedido, en [Mis pedidos](/orders): el método de pago, el subtotal, el IVA, el envío y el total.$expected_pagos$),
  ('cancelaciones-y-reembolsos','Cuándo puedes cancelar un pedido y qué pasa con tu pago.',$expected_cancelaciones_y_reembolsos$## Cuándo puedes cancelar

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
- Te avisamos por correo de la cancelación.$expected_cancelaciones_y_reembolsos$),
  ('cuenta-y-correo','Verifica tu correo, recupera tu contraseña y cambia tus datos.',$expected_cuenta_y_correo$## Verificar tu correo

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

Tus pedidos, facturas y Mi biblioteca están en la cuenta con la que compraste. Entra siempre con ese correo.$expected_cuenta_y_correo$),
  ('cedula-o-ruc','Por qué lo solicitamos y cómo corregirlo.',$expected_cedula_o_ruc$## Por qué te la pedimos

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

Selecciona Retirar solicitud en [Cédula o RUC](/account/identity). Tu número actual no cambia. Si más adelante quieres corregirlo, envía una solicitud nueva.$expected_cedula_o_ruc$)
  ) AS expected(slug, summary, body)
  LEFT JOIN LATERAL pliego.fn_help_article(expected.slug) a ON TRUE
  WHERE a.slug IS NULL OR a.summary IS DISTINCT FROM expected.summary OR a.body IS DISTINCT FROM expected.body
 ) THEN RAISE EXCEPTION 'Published Help content is not the persisted V086 copy'; END IF;
 UPDATE pliego.ayuda_categoria SET estado='DRAFT' WHERE slug='ebooks';
 IF EXISTS(SELECT 1 FROM pliego.fn_help_article('ebooks')) THEN RAISE EXCEPTION 'Unpublished parent category leaked article'; END IF;
END $gate$;
ROLLBACK;
