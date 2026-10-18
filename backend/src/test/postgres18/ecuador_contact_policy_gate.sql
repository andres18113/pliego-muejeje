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
ROLLBACK;
