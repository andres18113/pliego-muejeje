\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE province_id BIGINT; city_id BIGINT; alias_city BIGINT; rejected BOOLEAN;
BEGIN
    IF (SELECT count(*) FROM pliego.provincia)<>24
       OR (SELECT count(*) FROM pliego.ciudad)<>1171
       OR (SELECT count(*) FROM pliego.ciudad WHERE tipo='CABECERA_CANTONAL')<>223
       OR (SELECT count(*) FROM pliego.ciudad WHERE tipo='PARROQUIA_RURAL')<>948
       OR (SELECT count(*) FROM pliego.ciudad WHERE activo)<>1048 THEN
        RAISE EXCEPTION 'Geographic catalog does not match the full INEC CGE 2026 code set';
    END IF;
    IF (SELECT count(*) FROM pliego.ciudad_alias)<>278 THEN
        RAISE EXCEPTION 'Expected 278 evidence-backed INEC aliases';
    END IF;
    IF EXISTS (
        SELECT FROM pliego.ciudad_alias a
        JOIN pliego.ciudad c USING(provincia_id,ciudad_id)
        WHERE NOT c.activo OR a.search_key=c.search_key OR btrim(a.fuente_evidencia)=''
    ) THEN
        RAISE EXCEPTION 'Alias target, self-name or evidence invariant failed';
    END IF;
    IF EXISTS (
        SELECT FROM pliego.ciudad_alias a
        JOIN pliego.ciudad c ON c.provincia_id=a.provincia_id AND c.activo AND c.ciudad_id<>a.ciudad_id
        WHERE c.search_key=a.search_key
           OR (c.tipo='CABECERA_CANTONAL' AND pliego.fn_search_fold(c.canton_nombre)=a.search_key)
    ) THEN
        RAISE EXCEPTION 'An alias duplicates another active city/canton-seat label in its province';
    END IF;
    IF EXISTS (
        SELECT FROM pliego.ciudad c
        WHERE c.activo
        GROUP BY c.provincia_id,c.codigo_dpa
        HAVING count(*)>1
    ) THEN
        RAISE EXCEPTION 'Selectable city DPA codes are duplicated';
    END IF;

    SELECT p.provincia_id INTO province_id FROM pliego.provincia p WHERE p.codigo_dpa='09';
    SELECT c.ciudad_id INTO city_id FROM pliego.ciudad c WHERE c.codigo_dpa='0927' AND c.activo;
    SELECT ids.city_id INTO alias_city FROM pliego.fn_geo_ids_from_names('Bucay','Guayas') ids;
    IF alias_city IS DISTINCT FROM city_id THEN RAISE EXCEPTION 'Bucay did not resolve to General Antonio Elizalde'; END IF;
    SELECT ids.city_id INTO alias_city FROM pliego.fn_geo_ids_from_names('Chongón','Guayas') ids;
    IF alias_city IS DISTINCT FROM (SELECT ciudad_id FROM pliego.ciudad WHERE codigo_dpa='0901') THEN
        RAISE EXCEPTION 'Chongón did not resolve to Guayaquil';
    END IF;
    SELECT ids.city_id INTO alias_city FROM pliego.fn_geo_ids_from_names('General Elizalde','Guayas') ids;
    IF alias_city IS DISTINCT FROM city_id THEN RAISE EXCEPTION 'General Elizalde did not resolve to General Antonio Elizalde'; END IF;

    SELECT c.ciudad_id INTO city_id FROM pliego.ciudad c WHERE c.codigo_dpa='0921' AND c.activo;
    SELECT ids.city_id INTO alias_city FROM pliego.fn_geo_ids_from_names('Playas','Guayas') ids;
    IF alias_city IS DISTINCT FROM city_id THEN RAISE EXCEPTION 'Playas did not resolve to General Villamil'; END IF;
    SELECT ids.city_id INTO alias_city FROM pliego.fn_geo_ids_from_names('Gral. Villamil','Guayas') ids;
    IF alias_city IS DISTINCT FROM city_id THEN RAISE EXCEPTION 'Gral. Villamil did not resolve to General Villamil'; END IF;

    SELECT c.ciudad_id INTO city_id FROM pliego.ciudad c WHERE c.codigo_dpa='092251' AND c.activo;
    SELECT ids.city_id INTO alias_city FROM pliego.fn_geo_ids_from_names('Coronel Lorenzo de Garaicoa','Guayas') ids;
    IF alias_city IS DISTINCT FROM city_id THEN RAISE EXCEPTION 'Historical Garaicoa spelling did not resolve to its current city'; END IF;
    SELECT c.ciudad_id INTO city_id FROM pliego.ciudad c WHERE c.codigo_dpa='131752' AND c.activo;
    SELECT ids.city_id INTO alias_city FROM pliego.fn_geo_ids_from_names('10 de Agosto','Manabí') ids;
    IF alias_city IS DISTINCT FROM city_id THEN RAISE EXCEPTION '10 de Agosto did not resolve to Diez de Agosto'; END IF;
    SELECT c.ciudad_id INTO city_id FROM pliego.ciudad c WHERE c.codigo_dpa='140953' AND c.activo;
    SELECT ids.city_id INTO alias_city FROM pliego.fn_geo_ids_from_names('Tuutinentza','Morona Santiago') ids;
    IF alias_city IS DISTINCT FROM city_id THEN RAISE EXCEPTION 'Tuutinentza did not resolve to Tuutinentsa'; END IF;

    IF EXISTS (SELECT FROM pliego.ciudad WHERE activo AND nombre IN ('Bucay','Playas')) THEN
        RAISE EXCEPTION 'Aliases created duplicate selectable city rows';
    END IF;
    IF NOT EXISTS (SELECT FROM pliego.fn_geo_cities(province_id) c
                    WHERE c.code='0927' AND c.name='General Antonio Elizalde'
                      AND c.aliases @> ARRAY['Bucay','General Elizalde']::TEXT[])
       OR NOT EXISTS (SELECT FROM pliego.fn_geo_cities(province_id) c
                       WHERE c.code='0921' AND c.name='General Villamil'
                         AND c.aliases @> ARRAY['Playas','Gral. Villamil']::TEXT[]) THEN
        RAISE EXCEPTION 'City reads did not return the official aliases';
    END IF;

    rejected:=FALSE;
    BEGIN
        INSERT INTO pliego.ciudad_alias(provincia_id,ciudad_id,nombre_alias,fuente_evidencia)
        VALUES(province_id,(SELECT ciudad_id FROM pliego.ciudad WHERE codigo_dpa='0927'),'bUcAy','test duplicate');
    EXCEPTION WHEN unique_violation THEN rejected:=TRUE;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Alias uniqueness did not fold case and accents'; END IF;

    rejected:=FALSE;
    BEGIN
        INSERT INTO pliego.ciudad_alias(provincia_id,ciudad_id,nombre_alias,fuente_evidencia)
        VALUES(province_id,(SELECT ciudad_id FROM pliego.ciudad WHERE codigo_dpa='0927'),
               'General Antonio Elizalde','test self-name');
    EXCEPTION WHEN SQLSTATE 'P5015' THEN rejected:=TRUE;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Alias equal to its canonical city name was accepted'; END IF;

    SELECT p.provincia_id INTO province_id FROM pliego.provincia p WHERE p.codigo_dpa='08';
    rejected:=FALSE;
    BEGIN
        PERFORM * FROM pliego.fn_geo_ids_from_names('La Unión','Esmeraldas');
        RAISE EXCEPTION 'Ambiguous active locality name La Unión was accepted';
    EXCEPTION WHEN SQLSTATE 'P5015' THEN rejected:=TRUE;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Ambiguous alias/name did not return P5015'; END IF;
    IF EXISTS (SELECT FROM pliego.ciudad_alias a WHERE a.provincia_id=province_id
                AND a.search_key=pliego.fn_search_fold('La Unión')) THEN
        RAISE EXCEPTION 'Ambiguous source candidate La Unión was seeded as a single alias';
    END IF;

    SELECT p.provincia_id INTO province_id FROM pliego.provincia p WHERE p.codigo_dpa='10';
    IF EXISTS (SELECT FROM pliego.ciudad_alias a WHERE a.provincia_id=province_id
                AND a.search_key=pliego.fn_search_fold('Sagrario')) THEN
        RAISE EXCEPTION 'Source alias with two urban-parish seat targets was seeded';
    END IF;

    rejected:=FALSE;
    BEGIN
        PERFORM * FROM pliego.fn_geo_ids_from_names('Bucay','Pichincha');
        RAISE EXCEPTION 'Guayas alias Bucay resolved under Pichincha';
    EXCEPTION WHEN SQLSTATE 'P5014' THEN rejected:=TRUE;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Alias outside the selected province did not return P5014'; END IF;

    IF EXISTS (
        SELECT FROM pg_class c
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        WHERE c.oid='pliego.ciudad_alias'::regclass AND a.grantee NOT IN (0,c.relowner)
          AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
    ) OR NOT EXISTS (
        SELECT FROM pg_class c
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        WHERE c.oid='pliego.ciudad_alias'::regclass AND a.grantee=0 AND a.privilege_type='SELECT'
    ) THEN
        RAISE EXCEPTION 'Alias reference table is not read-only to runtime roles';
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname='pliego_app') AND (
        NOT has_table_privilege('pliego_app','pliego.ciudad_alias','SELECT')
        OR has_table_privilege('pliego_app','pliego.ciudad_alias','INSERT')
        OR has_table_privilege('pliego_app','pliego.ciudad_alias','UPDATE')
        OR has_table_privilege('pliego_app','pliego.ciudad_alias','DELETE')
        OR has_table_privilege('pliego_app','pliego.ciudad_alias','TRUNCATE')
    ) THEN
        RAISE EXCEPTION 'pliego_app must have SELECT only on the geographic alias table';
    END IF;
END;
$$;

DO $$
DECLARE alias_case RECORD; actual_code VARCHAR; unresolved_codes TEXT[];
        expected_unresolved TEXT[]:=ARRAY['010455','0808','080851','080852','080853',
                                           '150351','150353','150355','150755'];
BEGIN
    FOR alias_case IN
        SELECT * FROM (VALUES
            ('Chucchilán (Chugchilán)','Cotopaxi','050751'),
            ('Isinlibí (Isinliví)','Cotopaxi','050752'),
            ('Las Lajas','El Oro','0714'),
            ('Coronel Lorenzo de Garaicoa (Pedregal)','Guayas','092251'),
            ('Coronel Marcelino Maridueña (San Carlos)','Guayas','0923'),
            ('General Elizalde (Bucay)','Guayas','0927'),
            ('Isidro Ayora (Soledad)','Guayas','0928'),
            ('Piedrahita (Nobol)','Guayas','0925'),
            ('Playas (Gral. Villamil)','Guayas','0921'),
            ('Olmedo (Santa Bárbara)','Loja','1116'),
            ('Pindal (Federico Páez)','Loja','1114'),
            ('Quilanga (La Paz)','Loja','1115'),
            ('Barreiro (Santa Rita)','Los Ríos','1201'),
            ('San Carlos de Limón (San Carlos del Zamora)','Morona Santiago','140852'),
            ('Carlos Julio Arosemena Tola (Zatza-Yacu)','Napo','1509'),
            ('Chongón','Guayas','0901')
        ) AS expected(alias_text,province_name,city_code)
    LOOP
        SELECT c.codigo_dpa INTO actual_code
          FROM pliego.fn_geo_ids_from_names(alias_case.alias_text,alias_case.province_name) ids
          JOIN pliego.ciudad c ON c.provincia_id=ids.province_id AND c.ciudad_id=ids.city_id;
        IF actual_code IS DISTINCT FROM alias_case.city_code THEN
            RAISE EXCEPTION 'Starred INEC alias % resolved to %, expected %',
                alias_case.alias_text,actual_code,alias_case.city_code;
        END IF;
        IF NOT EXISTS (
            SELECT FROM pliego.ciudad_alias a
            JOIN pliego.ciudad c USING(provincia_id,ciudad_id)
            WHERE c.codigo_dpa=alias_case.city_code
              AND a.search_key=pliego.fn_search_fold(alias_case.alias_text)
        ) THEN
            RAISE EXCEPTION 'Expected source-backed alias row for %',alias_case.alias_text;
        END IF;
    END LOOP;

    SELECT COALESCE(array_agg(c.codigo_dpa::TEXT ORDER BY c.codigo_dpa),ARRAY[]::TEXT[])
      INTO unresolved_codes
      FROM pliego.ciudad c
     WHERE NOT c.activo
       AND NOT EXISTS (SELECT FROM pliego.ciudad active_city
                        WHERE active_city.activo AND active_city.provincia_id=c.provincia_id
                          AND active_city.search_key=c.search_key)
       AND NOT EXISTS (SELECT FROM pliego.ciudad_alias a
                        WHERE a.provincia_id=c.provincia_id AND a.search_key=c.search_key);
    IF unresolved_codes IS DISTINCT FROM expected_unresolved THEN
        RAISE EXCEPTION 'Inactive DPA names requiring review changed: expected %, found %',
            expected_unresolved,unresolved_codes;
    END IF;
END;
$$;
ROLLBACK;
