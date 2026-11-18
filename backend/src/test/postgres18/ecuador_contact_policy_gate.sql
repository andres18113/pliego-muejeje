BEGIN;
DO $gate$
DECLARE u BIGINT; c BIGINT; state VARCHAR; address BIGINT; version BIGINT; value TEXT;
BEGIN
 CALL pliego.sp_customer_register('ecuador-contact-gate@example.invalid','fixture','Ana','Pérez',
  '+593 (99) 123-4567',u,c,state);
 IF (SELECT phone FROM pliego.fn_customer_profile_versioned(u))<>'+593991234567'
 THEN RAISE EXCEPTION 'Ecuador contact normalization lost national digits'; END IF;
 FOREACH value IN ARRAY ARRAY['+442079460018','+5930991234567','+59399123456789','+5932555','+59399123','+593991234567 ext 1','0991234567','+59318001234'] LOOP
  BEGIN
   CALL pliego.sp_customer_update(u,'Ana','Pérez',value::VARCHAR);
   RAISE EXCEPTION 'RED: Ecuador-only phone policy accepted %',value;
  EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 END LOOP;
 SELECT p.version INTO version FROM pliego.fn_customer_profile_versioned(u) p;
 BEGIN
  CALL pliego.sp_customer_patch(u,version,'phone','+442079460018');
  RAISE EXCEPTION 'foreign phone accepted on profile PATCH';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 IF (SELECT p.version FROM pliego.fn_customer_profile_versioned(u) p)<>version
 THEN RAISE EXCEPTION 'invalid phone changed profile version'; END IF;
 BEGIN
  CALL pliego.sp_address_create(u,'Casa','Ana Pérez','Calle',NULL,'Quito','Pichincha','GB',NULL,NULL,'+593991234567',TRUE,address);
  RAISE EXCEPTION 'foreign delivery country accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  CALL pliego.sp_address_create(u,'Casa','Ana7 Pérez','Calle',NULL,'Quito','Pichincha','EC',NULL,NULL,'+593991234567',TRUE,address);
  RAISE EXCEPTION 'recipient accepted a digit';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 CALL pliego.sp_address_create(u,'Casa','Ana Pérez','Calle',NULL,'Quito','Pichincha',' ec ',NULL,NULL,'+59325550134',TRUE,address);
 BEGIN
  CALL pliego.sp_address_update(u,address,'Casa','Ana Pérez','Calle',NULL,'Quito','Pichincha','US',NULL,NULL,'+59325550134');
  RAISE EXCEPTION 'foreign delivery country accepted on update';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  UPDATE pliego.cliente SET telefono='+442079460018' WHERE cliente_id=c;
  RAISE EXCEPTION 'direct customer phone write bypassed policy';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  UPDATE pliego.direccion SET destinatario='Ana8' WHERE direccion_id=address;
  RAISE EXCEPTION 'direct address recipient write bypassed policy';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  UPDATE pliego.direccion SET pais_codigo='US' WHERE direccion_id=address;
  RAISE EXCEPTION 'direct delivery-country write bypassed policy';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  UPDATE pliego.direccion SET telefono='+59399123456789' WHERE direccion_id=address;
  RAISE EXCEPTION 'direct address phone write bypassed policy';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 CALL pliego.sp_address_update(u,address,'Casa','Ana O’Connor-Pérez','Calle',NULL,'Quito','Pichincha','EC',NULL,NULL,'+593991234567');
 CALL pliego.sp_customer_patch(u,version,'phone','');
 IF (SELECT phone FROM pliego.fn_customer_profile_versioned(u)) IS NOT NULL
 THEN RAISE EXCEPTION 'optional contact phone could not be cleared'; END IF;
 IF NOT pliego.fn_is_address_recipient(repeat('𐐀',120)||' '||repeat('李',120))
 OR pliego.fn_is_address_recipient(repeat('A',242)) OR pliego.fn_is_address_recipient('Ana7')
 THEN RAISE EXCEPTION 'recipient Unicode repertoire/241-code-point limit changed'; END IF;
 IF NOT pliego.fn_is_valid_country_code('GB') THEN RAISE EXCEPTION 'historical ISO helper was narrowed'; END IF;
END $gate$;

DO $gate$
DECLARE
 actor BIGINT;
 customer BIGINT;
 new_actor BIGINT;
 new_customer BIGINT;
 account_state VARCHAR;
 address BIGINT;
 new_address BIGINT;
 previous_addresses JSONB;
 previous_profile JSONB;
 phone VARCHAR;
 malformed_phones CONSTANT VARCHAR[] := ARRAY[
  'abc','+593abc','+5930991234567','+442079460018','+59399123456789','+59399',
  E' \t\n','+593９９１２３４５６７','+593991234567 ext 2'
 ];
BEGIN
 CALL pliego.sp_customer_register('contact-phone-gate@example.invalid','fixture','Ana','Pérez',
  '+593991234567',actor,customer,account_state);
 SELECT to_jsonb(p) INTO previous_profile FROM pliego.fn_customer_profile_versioned(actor) p;

 CALL pliego.sp_address_create(actor,'Casa','Ana Pérez','Calle 1',NULL,17::BIGINT,893::BIGINT,'EC',
  NULL,NULL,'+593991234567',TRUE,address);
 SELECT jsonb_agg(to_jsonb(d) ORDER BY d.direccion_id) INTO previous_addresses
  FROM pliego.direccion d WHERE d.cliente_id=customer;

 FOREACH phone IN ARRAY malformed_phones || ARRAY['',NULL]::VARCHAR[] LOOP
  BEGIN
   CALL pliego.sp_address_update(actor,address,'Trabajo','María Pérez','Calle 2','Suite 4',
    17::BIGINT,893::BIGINT,'EC','170101','Otra referencia',phone);
   RAISE EXCEPTION 'Invalid phone accepted by address update: %',phone;
  EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
  BEGIN
   CALL pliego.sp_address_create(actor,'Trabajo','María Pérez','Calle 2','Suite 4',
    17::BIGINT,893::BIGINT,'EC','170101','Otra referencia',phone,TRUE,new_address);
   RAISE EXCEPTION 'Invalid phone accepted by address creation: %',phone;
  EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
  IF (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.direccion_id) FROM pliego.direccion d WHERE d.cliente_id=customer)
   IS DISTINCT FROM previous_addresses THEN RAISE EXCEPTION 'Invalid phone changed a stored address: %',phone; END IF;
 END LOOP;

 FOREACH phone IN ARRAY malformed_phones LOOP
  BEGIN
   CALL pliego.sp_customer_update_versioned(actor,(previous_profile->>'version')::BIGINT,'María','Pérez',phone);
   RAISE EXCEPTION 'Invalid phone accepted by profile replacement: %',phone;
  EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
  BEGIN
   CALL pliego.sp_customer_patch(actor,(previous_profile->>'version')::BIGINT,'phone',phone);
   RAISE EXCEPTION 'Invalid phone accepted by profile PATCH: %',phone;
  EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
  BEGIN
   CALL pliego.sp_customer_register('invalid-contact-phone@example.invalid','fixture','Ana','Pérez',
    phone,new_actor,new_customer,account_state);
   RAISE EXCEPTION 'Invalid phone accepted by registration: %',phone;
  EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
  IF (SELECT to_jsonb(p) FROM pliego.fn_customer_profile_versioned(actor) p) IS DISTINCT FROM previous_profile
   THEN RAISE EXCEPTION 'Invalid phone changed the profile: %',phone; END IF;
  IF EXISTS (SELECT FROM pliego.usuario WHERE email_normalizado='invalid-contact-phone@example.invalid')
   THEN RAISE EXCEPTION 'Invalid phone created an account: %',phone; END IF;
 END LOOP;

 CALL pliego.sp_customer_update_versioned(actor,(previous_profile->>'version')::BIGINT,'Ana','Pérez','');
 IF (SELECT p.phone FROM pliego.fn_customer_profile_versioned(actor) p) IS NOT NULL
  THEN RAISE EXCEPTION 'Empty optional profile phone did not clear the saved phone'; END IF;
 CALL pliego.sp_customer_register('empty-contact-phone@example.invalid','fixture','Ana','Pérez',
  '',new_actor,new_customer,account_state);
 IF (SELECT p.phone FROM pliego.fn_customer_profile_versioned(new_actor) p) IS NOT NULL
  THEN RAISE EXCEPTION 'Empty optional registration phone was stored'; END IF;
END $gate$;
ROLLBACK;
