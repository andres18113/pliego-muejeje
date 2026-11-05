-- CI/isolated-restore-only rollback-safe post-migration runtime ACL and address-write proof.
-- On production-style runs this must connect as pliego_app after cleanup.
-- CI's existing empty-database job uses its database owner directly; that path
-- remains for its normal gate database. This gate performs rolled-back writes;
-- never run it against production.
\set ON_ERROR_STOP on
BEGIN;
SELECT count(*)=2 AS strict_runtime_roles_present
  FROM pg_roles WHERE rolname IN ('pliego_app','pliego_owner') \gset
\if :{?require_strict_mode}
  \if :require_strict_mode
    \if :strict_runtime_roles_present
      \echo 'Runtime privilege gate: strict mode required and roles are present'
    \else
      \echo 'ERROR: strict runtime privilege mode required; refusing owner-mode fallback'
      DO $$ BEGIN RAISE EXCEPTION 'strict runtime privilege mode required; refusing owner-mode fallback'; END $$;
    \endif
  \endif
\endif
\if :strict_runtime_roles_present
SET LOCAL ROLE pliego_app;
\echo 'Runtime privilege gate: strict pliego_app/pliego_owner mode'
\else
\echo 'Runtime privilege gate: CI owner-mode compatibility branch'
\endif
DO $gate$
DECLARE
    strict_mode BOOLEAN;
    table_oid REGCLASS;
    privilege_name TEXT;
    write_statement TEXT;
    denied BOOLEAN;
    foreign_keys TEXT[];
    actor_id BIGINT;
    customer_id BIGINT;
    actor_state VARCHAR;
    address_id BIGINT;
    province_id BIGINT;
    quito_id BIGINT;
    conocoto_id BIGINT;
    guayaquil_id BIGINT;
    mismatch_rejected BOOLEAN := FALSE;
BEGIN
    strict_mode := (SELECT count(*)=2 FROM pg_roles
                    WHERE rolname IN ('pliego_app','pliego_owner'));
    IF strict_mode THEN
        IF current_user IS DISTINCT FROM 'pliego_app' THEN
            RAISE EXCEPTION 'Strict runtime privilege gate must execute as pliego_app';
        END IF;
        IF pg_has_role('pliego_app','pliego_owner','MEMBER') THEN
            RAISE EXCEPTION 'pliego_app retains pliego_owner membership after cleanup';
        END IF;
        IF has_schema_privilege('pliego_app','pliego','CREATE')
           OR has_schema_privilege('pliego_app','public','CREATE')
           OR has_database_privilege('pliego_app',current_database(),'CREATE') THEN
            RAISE EXCEPTION 'pliego_app retains database or schema CREATE';
        END IF;

        FOREACH table_oid IN ARRAY ARRAY[
            'pliego.provincia'::REGCLASS,'pliego.ciudad'::REGCLASS,'pliego.ciudad_alias'::REGCLASS
        ] LOOP
            IF NOT has_table_privilege('pliego_app',table_oid,'SELECT') THEN
                RAISE EXCEPTION 'pliego_app lacks SELECT on %',table_oid;
            END IF;
            FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
                IF has_table_privilege('pliego_app',table_oid,privilege_name) THEN
                    RAISE EXCEPTION 'pliego_app retains % on %',privilege_name,table_oid;
                END IF;
            END LOOP;
        END LOOP;

        IF EXISTS (
            SELECT FROM pg_attribute a
             WHERE a.attrelid IN ('pliego.provincia'::REGCLASS,'pliego.ciudad'::REGCLASS,
                                  'pliego.ciudad_alias'::REGCLASS)
               AND a.attnum>0 AND NOT a.attisdropped
               AND (has_column_privilege('pliego_app',a.attrelid,a.attnum,'INSERT')
                    OR has_column_privilege('pliego_app',a.attrelid,a.attnum,'UPDATE')
                    OR has_column_privilege('pliego_app',a.attrelid,a.attnum,'REFERENCES'))
        ) THEN
            RAISE EXCEPTION 'pliego_app retains column-level DML or REFERENCES on a geo table';
        END IF;

        FOREACH table_oid IN ARRAY ARRAY['pliego.direccion'::REGCLASS,'pliego.libro'::REGCLASS] LOOP
            FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
                IF NOT has_table_privilege('pliego_app',table_oid,privilege_name) THEN
                    RAISE EXCEPTION 'pliego_app lacks normal % on %',privilege_name,table_oid;
                END IF;
            END LOOP;
        END LOOP;

        IF EXISTS (
            SELECT FROM pg_class c
             WHERE c.oid IN ('pliego.provincia'::REGCLASS,'pliego.ciudad'::REGCLASS,
                             'pliego.ciudad_alias'::REGCLASS)
               AND pg_get_userbyid(c.relowner) IS DISTINCT FROM 'pliego_owner'
        ) THEN
            RAISE EXCEPTION 'Geo table ownership was not reassigned to pliego_owner';
        END IF;
        IF NOT has_table_privilege('pliego_owner','pliego.ciudad','SELECT')
           OR has_table_privilege('pliego_owner','pliego.ciudad','UPDATE')
           OR has_column_privilege('pliego_owner','pliego.ciudad','provincia_id','UPDATE')
           OR NOT has_column_privilege('pliego_owner','pliego.ciudad','ciudad_id','UPDATE')
           OR NOT EXISTS (
                SELECT FROM pg_attribute a
                CROSS JOIN LATERAL aclexplode(COALESCE(a.attacl,'{}'::aclitem[])) acl
                 WHERE a.attrelid='pliego.ciudad'::REGCLASS
                   AND a.attname='ciudad_id'
                   AND acl.grantee=(SELECT oid FROM pg_roles WHERE rolname='pliego_owner')
                   AND acl.privilege_type='UPDATE'
           )
           OR has_table_privilege('pliego_owner','pliego.ciudad','INSERT')
           OR has_table_privilege('pliego_owner','pliego.ciudad','DELETE')
           OR has_table_privilege('pliego_owner','pliego.ciudad','TRUNCATE') THEN
            RAISE EXCEPTION 'pliego_owner must have only the city key-column UPDATE needed for FK key-share checks';
        END IF;
        IF has_table_privilege('pliego_owner','pliego.provincia','INSERT')
           OR has_table_privilege('pliego_owner','pliego.provincia','UPDATE')
           OR has_table_privilege('pliego_owner','pliego.provincia','DELETE')
           OR has_table_privilege('pliego_owner','pliego.ciudad_alias','INSERT')
           OR has_table_privilege('pliego_owner','pliego.ciudad_alias','UPDATE')
           OR has_table_privilege('pliego_owner','pliego.ciudad_alias','DELETE') THEN
            RAISE EXCEPTION 'pliego_owner has unnecessary DML on province or alias references';
        END IF;
        IF EXISTS (
            SELECT FROM pg_attribute a
             WHERE a.attrelid='pliego.ciudad'::REGCLASS AND a.attnum>0 AND NOT a.attisdropped
               AND a.attname NOT IN ('provincia_id','ciudad_id')
               AND (has_column_privilege('pliego_owner',a.attrelid,a.attnum,'INSERT')
                    OR has_column_privilege('pliego_owner',a.attrelid,a.attnum,'UPDATE')
                    OR has_column_privilege('pliego_owner',a.attrelid,a.attnum,'REFERENCES'))
        ) OR EXISTS (
            SELECT FROM pg_attribute a
             WHERE a.attrelid IN ('pliego.provincia'::REGCLASS,'pliego.ciudad_alias'::REGCLASS)
               AND a.attnum>0 AND NOT a.attisdropped
               AND (has_column_privilege('pliego_owner',a.attrelid,a.attnum,'INSERT')
                    OR has_column_privilege('pliego_owner',a.attrelid,a.attnum,'UPDATE')
                    OR has_column_privilege('pliego_owner',a.attrelid,a.attnum,'REFERENCES'))
        ) THEN
            RAISE EXCEPTION 'pliego_owner retains unnecessary column-level privileges on geo references';
        END IF;

        FOREACH write_statement IN ARRAY ARRAY[
            'INSERT INTO pliego.provincia DEFAULT VALUES',
            'UPDATE pliego.provincia SET codigo_dpa=codigo_dpa WHERE FALSE',
            'DELETE FROM pliego.provincia WHERE FALSE',
            'INSERT INTO pliego.ciudad DEFAULT VALUES',
            'UPDATE pliego.ciudad SET nombre=nombre WHERE FALSE',
            'DELETE FROM pliego.ciudad WHERE FALSE',
            'INSERT INTO pliego.ciudad_alias DEFAULT VALUES',
            'UPDATE pliego.ciudad_alias SET nombre_alias=nombre_alias WHERE FALSE',
            'DELETE FROM pliego.ciudad_alias WHERE FALSE'
        ] LOOP
            denied := FALSE;
            BEGIN
                EXECUTE write_statement;
            EXCEPTION WHEN insufficient_privilege THEN
                denied := TRUE;
            END;
            IF NOT denied THEN
                RAISE EXCEPTION 'Direct geo write was allowed: %',write_statement;
            END IF;
        END LOOP;
    ELSE
        IF current_user IS DISTINCT FROM 'pliego' THEN
            RAISE EXCEPTION 'Owner-mode CI fallback requires the existing CI database role pliego';
        END IF;
    END IF;

    SELECT array_agg(
        format('%I.%I.%I',rel_ns.nspname,rel.relname,c.conname)||'->'||
        format('%I.%I',ref_ns.nspname,ref.relname)||'['||
        (SELECT string_agg(a.attname,',' ORDER BY k.ord)
           FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
           JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)||':'||
        (SELECT string_agg(a.attname,',' ORDER BY k.ord)
           FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
           JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum)||']'
        ORDER BY format('%I.%I.%I',rel_ns.nspname,rel.relname,c.conname))
      INTO foreign_keys
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid=c.conrelid
      JOIN pg_namespace rel_ns ON rel_ns.oid=rel.relnamespace
      JOIN pg_class ref ON ref.oid=c.confrelid
      JOIN pg_namespace ref_ns ON ref_ns.oid=ref.relnamespace
     WHERE c.contype='f'
       AND c.confrelid IN ('pliego.provincia'::REGCLASS,'pliego.ciudad'::REGCLASS,
                           'pliego.ciudad_alias'::REGCLASS);
    IF foreign_keys IS DISTINCT FROM ARRAY[
        'pliego.ciudad.ciudad_provincia_id_fkey->pliego.provincia[provincia_id:provincia_id]',
        'pliego.ciudad_alias.fk_ciudad_alias_target->pliego.ciudad[provincia_id,ciudad_id:provincia_id,ciudad_id]',
        'pliego.direccion.fk_direccion_provincia_ciudad->pliego.ciudad[provincia_id,ciudad_id:provincia_id,ciudad_id]',
        'pliego.ubicacion_retiro.fk_ubicacion_retiro_provincia_ciudad->pliego.ciudad[provincia_id,ciudad_id:provincia_id,ciudad_id]'
    ]::TEXT[] THEN
        RAISE EXCEPTION 'Foreign keys into the geographic reference tables changed: %',foreign_keys;
    END IF;

    CALL pliego.sp_customer_register('runtime-privilege-'||uuidv4()||'@pliego.invalid','fixture-hash',
        'Cliente','Prueba',NULL,actor_id,customer_id,actor_state);
    SELECT provincia_id INTO province_id FROM pliego.provincia WHERE codigo_dpa='17';
    SELECT ciudad_id INTO quito_id FROM pliego.ciudad WHERE codigo_dpa='1701';
    SELECT ciudad_id INTO conocoto_id FROM pliego.ciudad WHERE codigo_dpa='170156';
    SELECT ciudad_id INTO guayaquil_id FROM pliego.ciudad WHERE codigo_dpa='0901';
    CALL pliego.sp_address_create(actor_id,'Permiso','Cliente Prueba','Calle de prueba',NULL,
        province_id,quito_id,'EC',NULL,NULL,'+59325550134',FALSE,address_id);
    CALL pliego.sp_address_update(actor_id,address_id,'Permiso editado','Cliente Prueba','Calle editada',NULL,
        province_id,conocoto_id,'EC',NULL,NULL,'+59325550134');
    IF NOT EXISTS (SELECT FROM pliego.direccion
                    WHERE direccion_id=address_id AND provincia_id=province_id AND ciudad_id=conocoto_id) THEN
        RAISE EXCEPTION 'Address create/update did not persist the selected catalog pair';
    END IF;
    BEGIN
        CALL pliego.sp_address_update(actor_id,address_id,'Permiso editado','Cliente Prueba','Calle editada',NULL,
            province_id,guayaquil_id,'EC',NULL,NULL,'+59325550134');
        RAISE EXCEPTION 'Address update accepted a city from another province';
    EXCEPTION WHEN SQLSTATE 'P5014' THEN
        mismatch_rejected := TRUE;
    END;
    IF NOT mismatch_rejected THEN
        RAISE EXCEPTION 'Invalid province/city pair did not return SQLSTATE P5014';
    END IF;
END;
$gate$;
ROLLBACK;
\echo 'PostgreSQL 18 runtime privilege/address gate passed.'
