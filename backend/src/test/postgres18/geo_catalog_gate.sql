\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
    province_id BIGINT;
    city_id BIGINT;
    guayas_id BIGINT;
    inactive_city_id BIGINT;
    fk_rejected BOOLEAN := FALSE;
    mismatch_rejected BOOLEAN := FALSE;
    unavailable_rejected BOOLEAN := FALSE;
    inactive_rejected BOOLEAN := FALSE;
BEGIN
    IF (SELECT count(*) FROM pliego.provincia) <> 24 THEN
        RAISE EXCEPTION 'Expected 24 INEC provinces';
    END IF;
    IF (SELECT count(*) FROM pliego.ciudad WHERE tipo='CABECERA_CANTONAL') <> 223
       OR (SELECT count(*) FROM pliego.ciudad WHERE tipo='CABECERA_CANTONAL' AND activo) <> 222
       OR (SELECT count(*) FROM pliego.ciudad WHERE tipo='CABECERA_CANTONAL' AND NOT activo) <> 1 THEN
        RAISE EXCEPTION 'INEC canton-seat rows and the starred historical seat must match the 2026 source';
    END IF;
    IF (SELECT count(*) FROM pliego.ciudad WHERE tipo='PARROQUIA_RURAL') <> 948 THEN
        RAISE EXCEPTION 'Expected 948 distinct INEC rural-parish entries';
    END IF;
    IF (SELECT count(*) FROM pliego.ciudad WHERE tipo='PARROQUIA_RURAL' AND activo) <> 826
       OR (SELECT count(*) FROM pliego.ciudad WHERE tipo='PARROQUIA_RURAL' AND NOT activo) <> 122 THEN
        RAISE EXCEPTION 'INEC starred rural-parish activity flags do not match the 2026 source';
    END IF;
    IF (SELECT count(*) FROM pliego.ciudad) <> 1171
       OR (SELECT count(*) FROM pliego.ciudad WHERE activo) <> 1048 THEN
        RAISE EXCEPTION 'Expected 1,171 INEC DPA rows and 1,048 active selectable localities';
    END IF;
    IF EXISTS (SELECT FROM pliego.provincia WHERE codigo_dpa='90')
       OR EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa LIKE '90%') THEN
        RAISE EXCEPTION 'DPA code 90 must remain excluded';
    END IF;
    IF NOT EXISTS (SELECT FROM pliego.provincia WHERE codigo_dpa='17' AND nombre='Pichincha')
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='1701' AND nombre='Quito' AND tipo='CABECERA_CANTONAL' AND activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='1705' AND nombre='Sangolquí' AND tipo='CABECERA_CANTONAL' AND activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='170160' AND nombre='El Quinche' AND tipo='PARROQUIA_RURAL' AND activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='170156' AND nombre='Conocoto' AND tipo='PARROQUIA_RURAL' AND activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='0901' AND nombre='Guayaquil' AND tipo='CABECERA_CANTONAL' AND activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='0808' AND nombre='La Concordia' AND tipo='CABECERA_CANTONAL' AND NOT activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='2302' AND nombre='La Concordia' AND canton_nombre='La Concordia' AND tipo='CABECERA_CANTONAL' AND activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='080851' AND nombre='Monterrey' AND canton_nombre='La Concordia' AND tipo='PARROQUIA_RURAL' AND NOT activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='080852' AND nombre='La Villegas' AND canton_nombre='La Concordia' AND tipo='PARROQUIA_RURAL' AND NOT activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='080853' AND nombre='Plan Piloto' AND canton_nombre='La Concordia' AND tipo='PARROQUIA_RURAL' AND NOT activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='230251' AND nombre='Monterrey' AND canton_nombre='La Concordia' AND tipo='PARROQUIA_RURAL' AND activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='230252' AND nombre='La Villegas' AND canton_nombre='La Concordia' AND tipo='PARROQUIA_RURAL' AND activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='230253' AND nombre='Plan Piloto' AND canton_nombre='La Concordia' AND tipo='PARROQUIA_RURAL' AND activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='140190' AND nombre='Sinaí-Cuchaentza' AND canton_nombre='Morona' AND tipo='PARROQUIA_RURAL' AND activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='1413' AND nombre='Sevilla Don Bosco' AND canton_nombre='Sevilla Don Bosco' AND tipo='CABECERA_CANTONAL' AND activo)
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='140157' AND nombre='Sevilla Don Bosco' AND tipo='PARROQUIA_RURAL' AND NOT activo) THEN
        RAISE EXCEPTION 'INEC geographic spot checks failed';
    END IF;
    IF NOT EXISTS (SELECT FROM pliego.ciudad WHERE nombre='Quito' AND search_key='quito')
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE nombre='Guayaquil' AND search_key='guayaquil')
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='140190' AND search_key='sinai-cuchaentza')
       OR NOT EXISTS (SELECT FROM pliego.ciudad WHERE codigo_dpa='1413' AND search_key='sevilla don bosco') THEN
        RAISE EXCEPTION 'City search keys must use pliego.fn_search_fold';
    END IF;
    IF EXISTS (
        SELECT FROM pliego.ciudad c
        JOIN pliego.ciudad_alias a ON a.provincia_id=c.provincia_id AND a.search_key=c.search_key
        WHERE c.codigo_dpa IN ('2302','230251','230252','230253','140190','1413') AND c.activo
    ) THEN
        RAISE EXCEPTION 'A source alias collides with a newly active canonical city name';
    END IF;

    SELECT p.provincia_id INTO province_id FROM pliego.provincia p WHERE p.codigo_dpa='17';
    SELECT p.provincia_id INTO guayas_id FROM pliego.provincia p WHERE p.codigo_dpa='09';
    SELECT c.ciudad_id INTO city_id FROM pliego.ciudad c WHERE c.codigo_dpa='1701' AND c.activo;
    BEGIN
        PERFORM * FROM pliego.fn_assert_geo_city(province_id,
            (SELECT c.ciudad_id FROM pliego.ciudad c WHERE c.codigo_dpa='0901'));
        RAISE EXCEPTION 'Expected P5014 for a city from another province';
    EXCEPTION WHEN SQLSTATE 'P5014' THEN mismatch_rejected := TRUE;
    END;
    BEGIN
        PERFORM * FROM pliego.fn_assert_geo_city(province_id,9223372036854770000);
        RAISE EXCEPTION 'Expected P5015 for an unknown city';
    EXCEPTION WHEN SQLSTATE 'P5015' THEN unavailable_rejected := TRUE;
    END;
    SELECT c.ciudad_id INTO inactive_city_id FROM pliego.ciudad c WHERE c.provincia_id=province_id AND NOT c.activo LIMIT 1;
    BEGIN
        PERFORM * FROM pliego.fn_assert_geo_city(province_id,inactive_city_id);
        RAISE EXCEPTION 'Expected P5015 for an inactive city';
    EXCEPTION WHEN SQLSTATE 'P5015' THEN inactive_rejected := TRUE;
    END;
    IF NOT mismatch_rejected OR NOT unavailable_rejected OR NOT inactive_rejected THEN
        RAISE EXCEPTION 'Geo pair validation returned an unexpected SQLSTATE';
    END IF;
    IF NOT EXISTS (SELECT FROM pliego.fn_geo_ids_from_names('Quito','Pichincha'))
       OR NOT EXISTS (SELECT FROM pliego.fn_geo_ids_from_names('Distrito Metropolitano de Quito','Pichincha')) THEN
        RAISE EXCEPTION 'Legacy name resolver must map both a seat and its canton name';
    END IF;
    IF NOT EXISTS (
        SELECT FROM pliego.fn_geo_ids_from_names('La Concordia','Santo Domingo de los Tsáchilas') ids
        JOIN pliego.ciudad c ON c.provincia_id=ids.province_id AND c.ciudad_id=ids.city_id
        WHERE c.codigo_dpa='2302' AND c.activo
    ) OR NOT EXISTS (
        SELECT FROM pliego.fn_geo_ids_from_names('Monterrey','Santo Domingo de los Tsáchilas') ids
        JOIN pliego.ciudad c ON c.provincia_id=ids.province_id AND c.ciudad_id=ids.city_id
        WHERE c.codigo_dpa='230251' AND c.activo
    ) OR NOT EXISTS (
        SELECT FROM pliego.fn_geo_ids_from_names('Sinaí-Cuchaentza','Morona Santiago') ids
        JOIN pliego.ciudad c ON c.provincia_id=ids.province_id AND c.ciudad_id=ids.city_id
        WHERE c.codigo_dpa='140190' AND c.activo
    ) OR NOT EXISTS (
        SELECT FROM pliego.fn_geo_ids_from_names('Sevilla Don Bosco','Morona Santiago') ids
        JOIN pliego.ciudad c ON c.provincia_id=ids.province_id AND c.ciudad_id=ids.city_id
        WHERE c.codigo_dpa='1413' AND c.activo
    ) THEN
        RAISE EXCEPTION 'INEC 2026 current locality name resolution failed';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='pliego.direccion'::regclass
            AND conname='fk_direccion_provincia_ciudad' AND contype='f')
       OR NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='pliego.ubicacion_retiro'::regclass
            AND conname='fk_ubicacion_retiro_provincia_ciudad' AND contype='f') THEN
        RAISE EXCEPTION 'Editable address inputs require composite province/city foreign keys';
    END IF;

    SELECT p.provincia_id, other.ciudad_id INTO province_id, city_id
    FROM pliego.provincia p
    JOIN pliego.ciudad same ON same.provincia_id=p.provincia_id
    JOIN pliego.ciudad other ON other.provincia_id<>p.provincia_id
    LIMIT 1;
    CREATE TABLE pliego.geo_pair_fk_check (
        provincia_id BIGINT NOT NULL,
        ciudad_id BIGINT NOT NULL,
        FOREIGN KEY (provincia_id,ciudad_id)
            REFERENCES pliego.ciudad(provincia_id,ciudad_id)
    );
    BEGIN
        INSERT INTO pliego.geo_pair_fk_check VALUES (province_id,city_id);
    EXCEPTION WHEN foreign_key_violation THEN
        fk_rejected := TRUE;
    END;
    IF NOT fk_rejected THEN
        RAISE EXCEPTION 'Composite FK accepted a city from another province';
    END IF;

    IF EXISTS (
        SELECT FROM pg_class c
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r',c.relowner))) a
        WHERE c.oid IN ('pliego.provincia'::regclass,'pliego.ciudad'::regclass)
          AND a.grantee NOT IN (0,c.relowner)
          AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
    ) THEN
        RAISE EXCEPTION 'Application roles have write privileges on INEC reference tables';
    END IF;
    IF NOT EXISTS (
        SELECT FROM pg_class c
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r',c.relowner))) a
        WHERE c.oid='pliego.ciudad'::regclass AND a.grantee=0 AND a.privilege_type='SELECT'
    ) THEN
        RAISE EXCEPTION 'Public catalog reads require SELECT on the reference tables';
    END IF;

    IF EXISTS (
        SELECT FROM information_schema.columns
        WHERE (table_schema,table_name) IN (('pliego','pedido_direccion'),('pliego','factura_direccion'),('pliego','pedido_retiro'))
          AND column_name IN ('provincia_id','ciudad_id')
    ) THEN
        RAISE EXCEPTION 'Immutable address snapshots must remain text-only';
    END IF;
END;
$$;

DO $$
DECLARE
    actor_id BIGINT;
    customer_id BIGINT;
    address_id BIGINT;
    province_id BIGINT;
    quito_id BIGINT;
    conocoto_id BIGINT;
    guayaquil_id BIGINT;
    inactive_city_id BIGINT;
    user_state VARCHAR;
    rejected BOOLEAN;
BEGIN
    SELECT p.provincia_id INTO province_id FROM pliego.provincia p WHERE p.codigo_dpa='17';
    SELECT c.ciudad_id INTO quito_id FROM pliego.ciudad c WHERE c.codigo_dpa='1701';
    SELECT c.ciudad_id INTO conocoto_id FROM pliego.ciudad c WHERE c.codigo_dpa='170156';
    SELECT c.ciudad_id INTO guayaquil_id FROM pliego.ciudad c WHERE c.codigo_dpa='0901';
    SELECT c.ciudad_id INTO inactive_city_id FROM pliego.ciudad c WHERE c.provincia_id=province_id AND NOT c.activo LIMIT 1;
    CALL pliego.sp_customer_register('geo-catalog-'||replace(uuidv4()::TEXT,'-','')||'@pliego.local',
        'fixture-hash','Geo','Gate',NULL,actor_id,customer_id,user_state);

    CALL pliego.sp_address_create(actor_id,'ID pair','Geo Gate','Calle catálogo',NULL,
        province_id,quito_id,'EC',NULL,NULL,'+59325550134',FALSE,address_id);
    IF NOT EXISTS (SELECT FROM pliego.direccion d JOIN pliego.ciudad c USING(provincia_id,ciudad_id)
        WHERE d.direccion_id=address_id AND d.ciudad='Quito' AND d.provincia='Pichincha' AND c.codigo_dpa='1701') THEN
        RAISE EXCEPTION 'ID-based address create did not obtain canonical names from the catalog';
    END IF;
    CALL pliego.sp_address_update(actor_id,address_id,'ID pair','Geo Gate','Calle catálogo',NULL,
        province_id,conocoto_id,'EC',NULL,NULL,'+59325550134');
    IF NOT EXISTS (SELECT FROM pliego.direccion d JOIN pliego.ciudad c USING(provincia_id,ciudad_id)
        WHERE d.direccion_id=address_id AND d.ciudad='Conocoto' AND d.provincia='Pichincha' AND c.codigo_dpa='170156') THEN
        RAISE EXCEPTION 'ID-based address update did not refresh the catalog names';
    END IF;

    rejected:=FALSE;
    BEGIN
        CALL pliego.sp_address_update(actor_id,address_id,'ID pair','Geo Gate','Calle catálogo',NULL,
            province_id,guayaquil_id,'EC',NULL,NULL,'+59325550134');
        RAISE EXCEPTION 'Address update accepted a city outside the selected province';
    EXCEPTION WHEN SQLSTATE 'P5014' THEN rejected:=TRUE;
    END;
    IF NOT rejected OR NOT EXISTS (SELECT FROM pliego.direccion WHERE direccion_id=address_id AND ciudad='Conocoto') THEN
        RAISE EXCEPTION 'Invalid city/province update was not rejected atomically';
    END IF;

    rejected:=FALSE;
    BEGIN
        CALL pliego.sp_address_update(actor_id,address_id,'ID pair','Geo Gate','Calle catálogo',NULL,
            province_id,9223372036854770000,'EC',NULL,NULL,'+59325550134');
        RAISE EXCEPTION 'Address update accepted an unknown city ID';
    EXCEPTION WHEN SQLSTATE 'P5015' THEN rejected:=TRUE;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Unknown city ID did not return P5015'; END IF;

    rejected:=FALSE;
    BEGIN
        CALL pliego.sp_address_update(actor_id,address_id,'ID pair','Geo Gate','Calle catálogo',NULL,
            province_id,inactive_city_id,'EC',NULL,NULL,'+59325550134');
        RAISE EXCEPTION 'Address update accepted an inactive city ID';
    EXCEPTION WHEN SQLSTATE 'P5015' THEN rejected:=TRUE;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Inactive city ID did not return P5015'; END IF;

    -- Legacy Database API names can still be resolved only through one active catalog pair.
    CALL pliego.sp_address_create(actor_id,'Legacy adapter','Geo Gate','Calle catálogo',NULL,
        'Rumiñahui','Pichincha','EC',NULL,NULL,'+59325550134',FALSE,address_id);
    IF NOT EXISTS (SELECT FROM pliego.direccion d JOIN pliego.ciudad c USING(provincia_id,ciudad_id)
        WHERE d.direccion_id=address_id AND c.codigo_dpa='1705' AND d.ciudad='Sangolquí') THEN
        RAISE EXCEPTION 'Legacy database adapter bypassed catalog seat resolution';
    END IF;
END;
$$;
ROLLBACK;
