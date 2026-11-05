-- Run with psql -X -v ON_ERROR_STOP=1 against a Flyway V081 PostgreSQL 18 database.
BEGIN;
DO $signature$
BEGIN
 IF NOT EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='pliego' AND p.proname='sp_checkout_billed_quoted' AND p.pronargs=19) THEN
  RAISE EXCEPTION 'recipient-aware checkout Database API signature is missing';
 END IF;
END; $signature$;

DO $gate$
DECLARE
 suffix TEXT:=replace(uuidv4()::TEXT,'-',''); admin BIGINT; author BIGINT; publisher BIGINT; category BIGINT;
 book BIGINT; edition BIGINT; movement BIGINT; before_stock INTEGER; after_stock INTEGER;
 user_other BIGINT; customer_other BIGINT; state VARCHAR; address_other BIGINT;
 user_saved BIGINT; customer_saved BIGINT; address_saved BIGINT;
 user_account BIGINT; customer_account BIGINT; address_account BIGINT;
 cart BIGINT; cart_item BIGINT; quantity INTEGER; key UUID:=uuidv4(); order_id BIGINT; order_state VARCHAR;
 payment_state VARCHAR; total NUMERIC; reference VARCHAR; invoice_id BIGINT; replay_order BIGINT; replay_invoice BIGINT;
 legacy_key UUID; legacy_order BIGINT; legacy_invoice BIGINT; legacy_fingerprint VARCHAR;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('checkout-recipient-admin-'||suffix||'@pliego.local','fixture-hash','ADMIN','ACTIVE') RETURNING usuario_id INTO admin;
 CALL pliego.sp_author_create(admin,'Autor recipient '||suffix,NULL,author);
 CALL pliego.sp_publisher_create(admin,'Editorial recipient '||suffix,NULL,publisher);
 CALL pliego.sp_category_create(admin,'Categoría recipient '||suffix,'recipient-'||suffix,NULL,NULL,category);
 CALL pliego.sp_book_create(admin,'Libro recipient '||suffix,NULL,NULL,
  jsonb_build_array(jsonb_build_object('authorId',author,'order',1)),jsonb_build_array(category),book);
 CALL pliego.sp_edition_create(admin,book,publisher,'RECIPIENT-'||suffix,NULL,'es','PAPERBACK',100,NULL,9.50,
  NULL,NULL,NULL,NULL,edition);
 CALL pliego.sp_inventory_entry(admin,edition,12,'checkout recipient fixture',movement,before_stock,after_stock);
 CALL pliego.sp_customer_register('checkout-recipient-other-'||suffix||'@pliego.local','fixture-hash',
  'Otra','Persona',NULL,user_other,customer_other,state);
 CALL pliego.sp_customer_register('checkout-recipient-saved-'||suffix||'@pliego.local','fixture-hash',
  'Cuenta','Registrada',NULL,user_saved,customer_saved,state);
 CALL pliego.sp_customer_register('checkout-recipient-account-'||suffix||'@pliego.local','fixture-hash',
  'Cuenta','Nueva',NULL,user_account,customer_account,state);
 CALL pliego.sp_address_create(user_other,'Casa','Otra Persona','Calle Other',NULL,'Quito','Pichincha','EC',NULL,NULL,
  '+59325550134',TRUE,address_other);
 CALL pliego.sp_address_create(user_saved,'Casa','Cuenta Registrada','Calle Saved',NULL,'Quito','Pichincha','EC',NULL,NULL,
  '+59325550134',TRUE,address_saved);
 CALL pliego.sp_address_create(user_account,'Casa','Cuenta Nueva','Calle Account',NULL,'Quito','Pichincha','EC',NULL,NULL,
  '+59325550134',TRUE,address_account);
 CALL pliego.sp_customer_billing_identity_register(user_saved,'EC_CEDULA','0912345675');

 -- OTHER is a third-party invoice snapshot and leaves a customer with no saved identity unchanged.
 CALL pliego.sp_cart_add_item(user_other,edition,1,cart,cart_item,quantity);
 CALL pliego.sp_checkout_billed_quoted(user_other,key,address_other,'TRANSFER','PENDING',cart,'HOME_DELIVERY',NULL,NULL,
  'OTHER','EC_CEDULA','1710034065','Tercera Persona','Dirección de otra persona',NULL,'Quito','Pichincha','EC',NULL,
  order_id,order_state,payment_state,total,reference,invoice_id);
 IF EXISTS(SELECT FROM pliego.fn_customer_billing_identity(user_other))
  OR (SELECT destinatario_tipo FROM pliego.factura WHERE factura_id=invoice_id)<>'OTHER'
  OR (SELECT identidad_numero FROM pliego.factura WHERE factura_id=invoice_id)<>'1710034065' THEN
  RAISE EXCEPTION 'OTHER checkout registered an account identity or missed its invoice snapshot'; END IF;
 CALL pliego.sp_checkout_billed_quoted(user_other,key,address_other,'TRANSFER','PENDING',cart,'HOME_DELIVERY',NULL,NULL,
  'OTHER','EC_CEDULA','1710034065','Tercera Persona','Dirección de otra persona',NULL,'Quito','Pichincha','EC',NULL,
  replay_order,order_state,payment_state,total,reference,replay_invoice);
 IF replay_order<>order_id OR replay_invoice<>invoice_id OR
  (SELECT count(*) FROM pliego.factura WHERE pedido_id=order_id)<>1 THEN
  RAISE EXCEPTION 'OTHER replay created a second order or invoice'; END IF;
 BEGIN
  CALL pliego.sp_checkout_billed_quoted(user_other,key,address_other,'TRANSFER','PENDING',cart,'HOME_DELIVERY',NULL,NULL,
   'ACCOUNT','EC_CEDULA','1710034065','Tercera Persona','Dirección de otra persona',NULL,'Quito','Pichincha','EC',NULL,
   replay_order,order_state,payment_state,total,reference,replay_invoice);
  RAISE EXCEPTION 'recipient kind did not participate in checkout fingerprint';
 EXCEPTION WHEN SQLSTATE 'P1010' THEN NULL; END;
 IF EXISTS(SELECT FROM pliego.fn_customer_billing_identity(user_other)) THEN
  RAISE EXCEPTION 'changed-kind replay registered an account identity'; END IF;

 -- OTHER accepts a number different from an identity already stored on the account without P1106 or a profile write.
 CALL pliego.sp_cart_add_item(user_saved,edition,1,cart,cart_item,quantity);
 CALL pliego.sp_checkout_billed_quoted(user_saved,uuidv4(),address_saved,'TRANSFER','PENDING',cart,'HOME_DELIVERY',NULL,NULL,
  'OTHER','EC_CEDULA','0912345675','Comprador tercero','Dirección de tercero',NULL,'Quito','Pichincha','EC',NULL,
  order_id,order_state,payment_state,total,reference,invoice_id);
 IF (SELECT identity_number FROM pliego.fn_customer_billing_identity(user_saved))<>'0912345675'
  OR (SELECT destinatario_tipo FROM pliego.factura WHERE factura_id=invoice_id)<>'OTHER'
  OR (SELECT identidad_numero FROM pliego.factura WHERE factura_id=invoice_id)<>'0912345675'
  OR NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity_read_model(user_saved)
   WHERE NOT used AND correction_mode='DIRECT') THEN
  RAISE EXCEPTION 'OTHER changed or enforced the account identity'; END IF;

 -- The legacy Database API overload delegates to ACCOUNT and preserves first-checkout registration.
 CALL pliego.sp_cart_add_item(user_account,edition,1,cart,cart_item,quantity);
 CALL pliego.sp_checkout_billed_quoted(user_account,uuidv4(),address_account,'TRANSFER','PENDING',cart,'HOME_DELIVERY',NULL,NULL,
  'EC_CEDULA','0912345675','Cuenta Nueva','Dirección fiscal de cuenta',NULL,'Quito','Pichincha','EC',NULL,
  order_id,order_state,payment_state,total,reference,invoice_id);
 IF (SELECT destinatario_tipo FROM pliego.factura WHERE factura_id=invoice_id)<>'ACCOUNT'
  OR NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity(user_account) WHERE identity_number='0912345675') THEN
  RAISE EXCEPTION 'ACCOUNT compatibility did not preserve checkout identity registration'; END IF;

 -- A receipt written before V081 has the legacy fingerprint without recipient kind; same ACCOUNT retry stays valid.
 legacy_key:=uuidv4();
 CALL pliego.sp_cart_add_item(user_account,edition,1,cart,cart_item,quantity);
 CALL pliego.sp_checkout_quoted(user_account,legacy_key,address_account,'TRANSFER','APPROVED',NULL,
  'HOME_DELIVERY',NULL,NULL,legacy_order,order_state,payment_state,total,reference);
 CALL pliego.sp_invoice_issue(admin,legacy_order,'LEGACY-RECIPIENT-'||suffix,'Cuenta Nueva','NATIONAL_ID',
  '0912345675',NULL,'Dirección fiscal de cuenta',NULL,'Quito','Pichincha','EC',NULL,legacy_invoice);
 IF (SELECT destinatario_tipo FROM pliego.factura WHERE factura_id=legacy_invoice)<>'ACCOUNT' THEN
  RAISE EXCEPTION 'new legacy ACCOUNT invoice did not receive the recipient default'; END IF;
 BEGIN
  UPDATE pliego.factura SET destinatario_tipo='OTHER' WHERE factura_id=legacy_invoice;
  RAISE EXCEPTION 'issued invoice recipient snapshot was mutable';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 IF (SELECT destinatario_tipo FROM pliego.factura WHERE factura_id=legacy_invoice)<>'ACCOUNT' THEN
  RAISE EXCEPTION 'issued invoice recipient snapshot changed'; END IF;
 legacy_fingerprint:=encode(sha256(convert_to(jsonb_build_array('EC_CEDULA','0912345675','Cuenta Nueva',
  'Dirección fiscal de cuenta',NULL,'Quito','Pichincha','EC',NULL)::TEXT,'UTF8')),'hex');
 INSERT INTO pliego.checkout_billing_attempt VALUES(user_account,legacy_key,legacy_fingerprint);
 CALL pliego.sp_checkout_billed_quoted(user_account,legacy_key,address_account,'TRANSFER','APPROVED',NULL,
  'HOME_DELIVERY',NULL,NULL,'ACCOUNT','EC_CEDULA','0912345675','Cuenta Nueva','Dirección fiscal de cuenta',
  NULL,'Quito','Pichincha','EC',NULL,replay_order,order_state,payment_state,total,reference,replay_invoice);
 IF replay_order<>legacy_order OR replay_invoice<>legacy_invoice
  OR (SELECT count(*) FROM pliego.factura WHERE pedido_id=legacy_order)<>1 THEN
  RAISE EXCEPTION 'pre-V081 ACCOUNT replay changed its original receipt or invoice'; END IF;
END; $gate$;
ROLLBACK;
SELECT 'PASS: ACCOUNT compatibility, OTHER isolation, invoice recipient snapshots, and recipient-kind replay fingerprint';
