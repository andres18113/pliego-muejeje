-- Synthetic local performance fixture only. Never run against shared/production data.
-- Guarded by fk_index_audit.py: disposable opt-in, loopback, database marker.
-- Bulk import suppresses business side effects/FK triggers, keeps CHECK/UNIQUE,
-- then the harness checks every FK for orphans before measuring anything.
BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO pliego.usuario(usuario_id,email_normalizado,password_hash,rol,email_verificado_en)
OVERRIDING SYSTEM VALUE
SELECT 1000000+n,'fk-index-'||n||'@example.invalid','fixture-unusable','CUSTOMER',now()
FROM generate_series(1,2000) n;
INSERT INTO pliego.usuario(usuario_id,email_normalizado,password_hash,rol,email_verificado_en)
OVERRIDING SYSTEM VALUE
SELECT 900000+n,'fk-index-staff-'||n||'@example.invalid','fixture-unusable','ADMIN',now()
FROM generate_series(1,4) n;
INSERT INTO pliego.usuario(usuario_id,email_normalizado,password_hash,rol)
OVERRIDING SYSTEM VALUE VALUES(9999999,'fk-index-unused@example.invalid','fixture-unusable','ADMIN');
INSERT INTO pliego.cliente(cliente_id,usuario_id,nombres,apellidos) OVERRIDING SYSTEM VALUE
SELECT 1000000+n,1000000+n,'Cliente','Prueba' FROM generate_series(1,2000) n;
INSERT INTO pliego.direccion(direccion_id,cliente_id,alias,destinatario,direccion_linea1,
 ciudad,provincia,pais_codigo,telefono) OVERRIDING SYSTEM VALUE
SELECT 1000000+n,1000000+n,'Casa','Cliente Prueba','Calle de prueba','Quito','Pichincha','EC','0991234567'
FROM generate_series(1,2000) n;
INSERT INTO pliego.libro(libro_id,titulo) OVERRIDING SYSTEM VALUE
SELECT 1000000+n,'Libro de prueba '||n FROM generate_series(1,2001) n;
INSERT INTO pliego.editorial(editorial_id,nombre) OVERRIDING SYSTEM VALUE VALUES(1000001,'Editorial de prueba');
INSERT INTO pliego.edicion(edicion_id,libro_id,editorial_id,sku,idioma,formato,numero_paginas,precio)
OVERRIDING SYSTEM VALUE SELECT 1000000+n,1000000+n,1000001,'FK-IDX-'||n,'es',
 CASE WHEN n<=1000 THEN 'PAPERBACK' ELSE 'EBOOK' END,100,10
FROM generate_series(1,2001) n;
INSERT INTO pliego.inventario(edicion_id,stock_actual)
SELECT 1000000+n,100 FROM generate_series(1,1000) n;
INSERT INTO pliego.pedido(pedido_id,cliente_id,estado,subtotal,total,referencia_publica)
OVERRIDING SYSTEM VALUE
SELECT 1000000+n,1000001+(n-1)%2000,'CONFIRMED',10,10,
 'PL-'||lpad((n/10000)::text,4,'0')||'-'||lpad((n%10000)::text,4,'0') FROM generate_series(1,20000) n;
INSERT INTO pliego.pedido_item(pedido_item_id,pedido_id,edicion_id,sku_snapshot,titulo_snapshot,
 autores_snapshot,editorial_snapshot,formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal,
 precio_original_snapshot,ahorro_unitario_snapshot,subtotal_original_snapshot,ahorro_linea_snapshot)
OVERRIDING SYSTEM VALUE SELECT 1000000+n,1000000+n,1000001+(n-1)%1000,'FK-IDX-'||(1+(n-1)%1000),
 'Libro de prueba','Autor','Editorial de prueba','PAPERBACK','es',10,1,10,10,0,10,0
FROM generate_series(1,20000) n;
INSERT INTO pliego.checkout_attempt(actor_user_id,attempt_key,state,order_id,total,fulfillment_method,address_id,pickup_location_id)
SELECT 1000001+(n-1)%2000,md5('attempt-'||n)::uuid,'CREATED',1000000+n,10,
 CASE WHEN n%2=0 THEN 'STORE_PICKUP' ELSE 'HOME_DELIVERY' END,
 CASE WHEN n%2=0 THEN NULL ELSE 1000001+(n-1)%2000 END,
 CASE WHEN n%2=0 THEN (SELECT min(ubicacion_retiro_id) FROM pliego.ubicacion_retiro) ELSE NULL END
FROM generate_series(1,20000) n;
INSERT INTO pliego.cliente_favorito(cliente_id,edicion_id)
SELECT 1000001+(n-1)%2000,1000001+((n-1)/2000+(n-1)%2000)%1000 FROM generate_series(1,20000) n;
INSERT INTO pliego.digital_ownership(owned_item_id,cliente_id,edicion_id) OVERRIDING SYSTEM VALUE
SELECT 1000000+n,1000001+(n-1)%2000,1001001+((n-1)/2000+(n-1)%2000)%1000
FROM generate_series(1,20000) n;
INSERT INTO pliego.cliente_identificacion_solicitud_correccion(cliente_id,tipo_actual,numero_actual,
 tipo_propuesto,numero_propuesto,codigo_motivo,estado,vence_en,decidido_en,decidido_por,
 clave_idempotencia,huella_payload)
SELECT 1000001+(n-1)%2000,'EC_CEDULA','1710034065','EC_RUC','1710034065001','DOCUMENT_CHANGED',
 'APPROVED',now()+interval '15 days',now(),900001+(n-1)%4,md5('correction-'||n)::uuid,
 repeat('a',64) FROM generate_series(1,20000) n;
INSERT INTO pliego.factura(factura_id,pedido_id,numero_documento,estado,comprador_nombre,
 identidad_tipo,identidad_numero,subtotal,impuesto_total,total,usuario_emisor_id,fecha_emision)
OVERRIDING SYSTEM VALUE SELECT 1000000+n,1000000+n,'FK-INDEX-F-'||n,'ISSUED','Cliente Prueba',
 'NATIONAL_ID','1710034065',10,0,10,900001+(n-1)%4,now() FROM generate_series(1,20000) n;
INSERT INTO pliego.factura_item(factura_id,pedido_item_id,descripcion,cantidad,precio_unitario,
 subtotal,tratamiento_impuesto,impuesto_monto,total)
SELECT 1000000+n,1000000+n,'Libro de prueba',1,10,10,'NOT_ASSESSED',0,10
FROM generate_series(1,20000) n;
INSERT INTO pliego.nota_credito(factura_id,numero_documento,motivo,subtotal,impuesto_total,total,usuario_emisor_id)
SELECT 1000000+n,'FK-INDEX-NC-'||n,'Devolución sintética histórica',10,0,10,900001+(n-1)%4
FROM generate_series(1,2000) n;
INSERT INTO pliego.movimiento_inventario(edicion_id,usuario_actor_id,tipo,cantidad,stock_anterior,stock_posterior,motivo)
SELECT 1000001+(n-1)%1000,900001+(n-1)%4,'ENTRY',1,99,100,'Ingreso sintético'
FROM generate_series(1,20000) n;
INSERT INTO pliego.pedido_estado_historial(pedido_id,usuario_actor_id,origen,estado_anterior,estado_nuevo)
SELECT 1000000+n,900001+(n-1)%4,'USER','PENDING_PAYMENT','CONFIRMED'
FROM generate_series(1,20000) n;
INSERT INTO pliego.pedido_entrega(pedido_id,metodo)
SELECT 1000000+n,CASE WHEN n%2=0 THEN 'STORE_PICKUP' ELSE 'HOME_DELIVERY' END
FROM generate_series(1,20000) n;
INSERT INTO pliego.envio(envio_id,pedido_id,estado) OVERRIDING SYSTEM VALUE
SELECT 1000000+n,1000000+n,'PREPARING' FROM generate_series(1,20000,2) n;
INSERT INTO pliego.envio_historial(envio_id,tipo,origen,usuario_actor_id,estado_anterior,estado_nuevo)
SELECT 1000000+n,'STATUS','USER',900001+(n-1)%4,'PENDING','PREPARING'
FROM generate_series(1,20000,2) n;
INSERT INTO pliego.pedido_retiro(pedido_id,ubicacion_retiro_id,nombre,direccion,ciudad,provincia,
 pais_codigo,latitud,longitud,zona_horaria,apertura,cierre,preparacion_minutos,estimado_desde,listo_desde,codigo)
SELECT 1000000+n,(SELECT min(ubicacion_retiro_id) FROM pliego.ubicacion_retiro),
 'Retiro de prueba','Calle de prueba','Quito','Pichincha','EC',-0.2,-78.5,'America/Guayaquil',
 '09:00'::time,'17:00'::time,25,now(),now()+interval '25 minutes',
 'P-'||translate(lpad(to_hex(n),6,'0'),'0123456789abcdef','23456789ABCDEFGH')
FROM generate_series(2,20000,2) n;
INSERT INTO pliego.ayuda_articulo(categoria_id,slug,titulo,resumen,cuerpo,posicion,estado)
SELECT (SELECT min(categoria_id) FROM pliego.ayuda_categoria),'fk-index-help-'||n,
 'Ayuda de prueba '||n,'Resumen sintético','Contenido de ayuda sintético',n,
 CASE WHEN n%5=0 THEN 'DRAFT' ELSE 'PUBLISHED' END FROM generate_series(1,240) n;
INSERT INTO pliego.sesion_autenticacion(usuario_id,token_refresco_hash,fecha_expiracion,fecha_revocacion)
SELECT 1000001+(n-1)%2000,md5('session-'||n)||md5('session-tail-'||n),now()+interval '10 days',
 CASE WHEN ((n-1)/2000)%10=0 THEN NULL ELSE now()-interval '1 day' END FROM generate_series(1,40000) n;
COMMIT;
ANALYZE;
