-- ADR0021: extend existing fulfillment; no shipment/contact row is invented for pickup.
CREATE FUNCTION pliego.fn_pickup_timezone_valid(p_timezone TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE STRICT SECURITY INVOKER AS $$
 SELECT EXISTS(SELECT FROM pg_timezone_names WHERE name=p_timezone);
$$;
CREATE TABLE pliego.ubicacion_retiro (
 ubicacion_retiro_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 nombre VARCHAR(200) NOT NULL CHECK(char_length(btrim(nombre)) BETWEEN 1 AND 200),
 direccion VARCHAR(200) NOT NULL CHECK(char_length(btrim(direccion)) BETWEEN 1 AND 200),
 ciudad VARCHAR(100) NOT NULL CHECK(char_length(btrim(ciudad)) BETWEEN 1 AND 100),
 provincia VARCHAR(100) NOT NULL CHECK(char_length(btrim(provincia)) BETWEEN 1 AND 100),
 pais_codigo CHAR(2) NOT NULL CHECK(pliego.fn_is_valid_country_code(pais_codigo)),
 codigo_postal VARCHAR(20),
 latitud NUMERIC(9,6) NOT NULL CHECK(latitud BETWEEN -90 AND 90),
 longitud NUMERIC(10,6) NOT NULL CHECK(longitud BETWEEN -180 AND 180),
 zona_horaria VARCHAR(80) NOT NULL CHECK(pliego.fn_pickup_timezone_valid(zona_horaria)),
 apertura TIME NOT NULL,
 cierre TIME NOT NULL CHECK(cierre<>apertura),
 activo BOOLEAN NOT NULL DEFAULT TRUE,
 preparacion_minutos INTEGER NOT NULL DEFAULT 25 CHECK(preparacion_minutos BETWEEN 1 AND 1440),
 fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_ubicacion_retiro_updated BEFORE UPDATE ON pliego.ubicacion_retiro
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();
INSERT INTO pliego.ubicacion_retiro(nombre,direccion,ciudad,provincia,pais_codigo,codigo_postal,latitud,longitud,zona_horaria,apertura,cierre)
VALUES('PUCE · Sede matriz','Av. 12 de Octubre y Vicente Ramón Roca 1076','Quito','Pichincha','EC','170525',
 -0.210000,-78.491400,'America/Guayaquil','09:00','17:00');

CREATE TABLE pliego.pedido_retiro (
 pedido_id BIGINT PRIMARY KEY REFERENCES pliego.pedido_entrega(pedido_id),
 ubicacion_retiro_id BIGINT NOT NULL REFERENCES pliego.ubicacion_retiro(ubicacion_retiro_id),
 nombre VARCHAR(200) NOT NULL,
 direccion VARCHAR(200) NOT NULL,
 ciudad VARCHAR(100) NOT NULL,
 provincia VARCHAR(100) NOT NULL,
 pais_codigo CHAR(2) NOT NULL,
 codigo_postal VARCHAR(20),
 latitud NUMERIC(9,6) NOT NULL,
 longitud NUMERIC(10,6) NOT NULL,
 zona_horaria VARCHAR(80) NOT NULL,
 apertura TIME NOT NULL,
 cierre TIME NOT NULL,
 preparacion_minutos INTEGER NOT NULL CHECK(preparacion_minutos BETWEEN 1 AND 1440),
 estimado_desde TIMESTAMPTZ NOT NULL,
 listo_desde TIMESTAMPTZ NOT NULL,
 codigo VARCHAR(10) NOT NULL UNIQUE CHECK(codigo ~ '^P-[2-9A-HJ-NP-Z]{6,8}$'),
 fecha_retiro TIMESTAMPTZ,
 CHECK(listo_desde=estimado_desde+make_interval(mins=>preparacion_minutos))
);
CREATE SEQUENCE pliego.retiro_codigo_seq MINVALUE 1 MAXVALUE 1099511627775;
CREATE FUNCTION pliego.fn_generate_pickup_code() RETURNS VARCHAR
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE n BIGINT:=nextval('pliego.retiro_codigo_seq'); result TEXT:=''; alphabet TEXT:='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
BEGIN
 LOOP
  result:=substr(alphabet,(n%32)::INTEGER+1,1)||result; n:=n/32;
  EXIT WHEN n=0;
 END LOOP;
 RETURN ('P-'||lpad(result,GREATEST(6,char_length(result)),'2'))::VARCHAR;
END; $$;
CREATE FUNCTION pliego.fn_guard_pickup_snapshot() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END IF;
 IF (to_jsonb(NEW)-'fecha_retiro') IS DISTINCT FROM (to_jsonb(OLD)-'fecha_retiro')
 OR (OLD.fecha_retiro IS NOT NULL AND NEW.fecha_retiro IS DISTINCT FROM OLD.fecha_retiro) THEN
  PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_pedido_retiro_snapshot BEFORE UPDATE OR DELETE ON pliego.pedido_retiro
FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_pickup_snapshot();

CREATE FUNCTION pliego.fn_pickup_locations()
RETURNS TABLE(pickup_location_id BIGINT,name VARCHAR,address VARCHAR,city VARCHAR,province VARCHAR,country_code CHAR(2),
 postal_code VARCHAR,latitude NUMERIC,longitude NUMERIC,timezone VARCHAR,opens_at TIME,closes_at TIME,active BOOLEAN,preparation_minutes INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT ubicacion_retiro_id,nombre,direccion,ciudad,provincia,pais_codigo,codigo_postal,latitud,longitud,zona_horaria,apertura,cierre,activo,preparacion_minutos
 FROM pliego.ubicacion_retiro WHERE activo ORDER BY nombre,ubicacion_retiro_id;
$$;
CREATE PROCEDURE pliego.sp_pickup_location_update(IN p_actor BIGINT,IN p_location BIGINT,IN p_name VARCHAR,IN p_address VARCHAR,
 IN p_city VARCHAR,IN p_province VARCHAR,IN p_country VARCHAR,IN p_postal VARCHAR,IN p_latitude NUMERIC,IN p_longitude NUMERIC,
 IN p_timezone VARCHAR,IN p_opens TIME,IN p_closes TIME,IN p_active BOOLEAN,IN p_preparation INTEGER)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'ADMIN');
 IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR p_address IS NULL OR char_length(btrim(p_address)) NOT BETWEEN 1 AND 200
 OR p_city IS NULL OR char_length(btrim(p_city)) NOT BETWEEN 1 AND 100 OR p_province IS NULL OR char_length(btrim(p_province)) NOT BETWEEN 1 AND 100
 OR p_country IS NULL OR NOT pliego.fn_is_valid_country_code(pliego.fn_normalize_country_code(p_country))
 OR p_latitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude IS NULL OR p_longitude NOT BETWEEN -180 AND 180
 OR p_timezone IS NULL OR NOT pliego.fn_pickup_timezone_valid(p_timezone) OR char_length(p_timezone)>80
 OR p_opens IS NULL OR p_closes IS NULL OR p_opens=p_closes OR p_active IS NULL OR p_preparation IS NULL OR p_preparation NOT BETWEEN 1 AND 1440
 OR char_length(p_postal)>20 THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 UPDATE pliego.ubicacion_retiro SET nombre=btrim(p_name),direccion=btrim(p_address),ciudad=btrim(p_city),provincia=btrim(p_province),
 pais_codigo=pliego.fn_normalize_country_code(p_country),codigo_postal=p_postal,latitud=p_latitude,longitud=p_longitude,zona_horaria=p_timezone,
 apertura=p_opens,cierre=p_closes,activo=p_active,preparacion_minutos=p_preparation WHERE ubicacion_retiro_id=p_location;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5010','PICKUP_LOCATION_NOT_FOUND'); END IF;
END; $$;

CREATE FUNCTION pliego.fn_order_fulfillment(p_order BIGINT,p_confirmation BOOLEAN DEFAULT FALSE) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT jsonb_build_object('method',f.metodo)||CASE WHEN r.pedido_id IS NULL THEN '{}'::JSONB ELSE
 jsonb_build_object('pickup',jsonb_build_object(
  'location',jsonb_build_object('id',r.ubicacion_retiro_id::TEXT,'name',r.nombre,'address',r.direccion,'city',r.ciudad,'province',r.provincia,
   'countryCode',r.pais_codigo,'postalCode',r.codigo_postal,'latitude',r.latitud,'longitude',r.longitud,'timezone',r.zona_horaria,
   'openingHours',jsonb_build_object('opensAt',r.apertura,'closesAt',r.cierre),'active',TRUE,'preparationMinutes',r.preparacion_minutos),
  'estimatedAt',to_char(r.estimado_desde AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'readyAt',to_char(r.listo_desde AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'preparationMinutes',r.preparacion_minutos,'pickupCode',r.codigo))||CASE WHEN p_confirmation THEN '{}'::JSONB ELSE
 jsonb_build_object('state',CASE WHEN p.estado='CANCELLED' THEN 'CANCELLED' WHEN r.fecha_retiro IS NOT NULL THEN 'COLLECTED' ELSE 'PENDING' END,
  'collectedAt',r.fecha_retiro) END END
 FROM pliego.pedido_entrega f JOIN pliego.pedido p USING(pedido_id) LEFT JOIN pliego.pedido_retiro r USING(pedido_id) WHERE f.pedido_id=p_order;
$$;

CREATE FUNCTION pliego.fn_order_confirmation_enqueue(p_order BIGINT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
 SELECT 'ORDER_CONFIRMED:'||p.pedido_id,'ORDER_CONFIRMED',u.usuario_id,u.email_normalizado,
 jsonb_build_object('orderId',p.pedido_id::TEXT,'date',p.fecha_creacion,'subtotal',p.subtotal::TEXT,'total',p.total::TEXT,
 'items',(SELECT jsonb_agg(jsonb_build_object('title',i.titulo_snapshot,'quantity',i.cantidad,'unitPrice',i.precio_unitario::TEXT,'subtotal',i.subtotal::TEXT) ORDER BY i.pedido_item_id)
  FROM pliego.pedido_item i WHERE i.pedido_id=p.pedido_id),
 'delivery',(SELECT jsonb_build_object('recipient',d.destinatario,'line1',d.direccion_linea1,'line2',d.direccion_linea2,'city',d.ciudad,'province',d.provincia,'country',d.pais_codigo,'postalCode',d.codigo_postal)
  FROM pliego.pedido_direccion d JOIN pliego.pedido_entrega f USING(pedido_id) WHERE d.pedido_id=p.pedido_id AND f.metodo='HOME_DELIVERY'),
 'pickup',pliego.fn_order_fulfillment(p.pedido_id,TRUE)->'pickup')
 FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) JOIN pliego.usuario u USING(usuario_id)
 WHERE p.pedido_id=p_order AND p.estado='CONFIRMED' ON CONFLICT(evento_clave) DO NOTHING;
$$;

CREATE PROCEDURE pliego.sp_checkout_execute(
    IN p_actor_user_id BIGINT,
    IN p_address_id BIGINT,
    IN p_payment_method VARCHAR,
    IN p_payment_outcome VARCHAR,
    IN p_fulfillment_method VARCHAR,
    IN p_pickup_location_id BIGINT,
    OUT o_order_id BIGINT,
    OUT o_order_state VARCHAR,
    OUT o_payment_state VARCHAR,
    OUT o_total NUMERIC,
    OUT o_payment_reference VARCHAR
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_customer_id BIGINT;
    v_cart_id BIGINT;
    v_address pliego.direccion%ROWTYPE;
    v_item RECORD;
    v_before INTEGER;
    v_after INTEGER;
    v_payment_id BIGINT;
    v_reference VARCHAR;
    v_constraint TEXT;
    v_has_physical BOOLEAN:=FALSE;
BEGIN
    SELECT a.cliente_id
      INTO v_customer_id
      FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;

    IF p_payment_method NOT IN ('CARD', 'TRANSFER') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid payment method');
    END IF;

    IF p_payment_outcome NOT IN ('APPROVED', 'REJECTED') THEN
        PERFORM pliego.fn_raise_domain_error('P5005', 'PAYMENT_OUTCOME_INVALID');
    END IF;

    SELECT c.carrito_id
      INTO v_cart_id
      FROM pliego.carrito c
     WHERE c.cliente_id = v_customer_id
       AND c.estado = 'ACTIVE'
     FOR UPDATE;

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P4001', 'CART_NOT_ACTIVE');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pliego.carrito_item ci WHERE ci.carrito_id = v_cart_id
    ) THEN
        PERFORM pliego.fn_raise_domain_error('P4002', 'CART_EMPTY');
    END IF;

    IF p_fulfillment_method='HOME_DELIVERY' THEN
    SELECT d.*
      INTO v_address
      FROM pliego.direccion d
     WHERE d.direccion_id = p_address_id
       AND d.cliente_id = v_customer_id
     FOR SHARE;

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P5004', 'CHECKOUT_ADDRESS_INVALID');
    END IF;

    END IF;

    -- RC-01: lock masters whose state/price become order snapshots.
    -- Deterministic order reduces deadlock risk with administrative writers.
    FOR v_item IN
        SELECT e.edicion_id
          FROM pliego.carrito_item ci
          JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
          JOIN pliego.libro l ON l.libro_id = e.libro_id
         WHERE ci.carrito_id = v_cart_id
         ORDER BY e.edicion_id
         FOR SHARE OF e, l
    LOOP
        NULL;
    END LOOP;

    -- Post-lock freshness check: state and price cannot change until this transaction ends.
    FOR v_item IN
        SELECT ci.edicion_id,
               ci.cantidad,
               e.estado AS edition_state,
               l.estado AS book_state,
               e.precio, e.formato
          FROM pliego.carrito_item ci
          JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
          JOIN pliego.libro l ON l.libro_id = e.libro_id
         WHERE ci.carrito_id = v_cart_id
         ORDER BY ci.edicion_id
    LOOP
        IF pliego.fn_is_physical_format(v_item.formato) THEN v_has_physical:=TRUE; END IF;
        IF v_item.edition_state <> 'ACTIVE' THEN
            PERFORM pliego.fn_raise_domain_error('P2042', 'EDITION_INACTIVE');
        END IF;
        IF v_item.book_state <> 'ACTIVE' THEN
            PERFORM pliego.fn_raise_domain_error('P2043', 'BOOK_INACTIVE');
        END IF;
        IF NOT pliego.fn_is_physical_format(v_item.formato) AND v_item.cantidad <> 1 THEN
            PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID');
        END IF;
        IF pliego.fn_is_physical_format(v_item.formato) AND NOT EXISTS (SELECT 1 FROM pliego.inventario i WHERE i.edicion_id=v_item.edicion_id) THEN
            PERFORM pliego.fn_raise_domain_error('P3001','INVENTORY_NOT_FOUND');
        END IF;
        IF v_item.precio <= 0 THEN
            PERFORM pliego.fn_raise_domain_error('P2048', 'EDITION_DATA_INVALID');
        END IF;
    END LOOP;

    IF p_fulfillment_method='STORE_PICKUP' AND NOT v_has_physical THEN
        PERFORM pliego.fn_raise_domain_error('P5012','PICKUP_NOT_APPLICABLE');
    END IF;

    -- Lock inventories in deterministic EdicionId order and revalidate stock.
    FOR v_item IN
        SELECT i.edicion_id, i.stock_actual, ci.cantidad
          FROM pliego.carrito_item ci
          JOIN pliego.inventario i ON i.edicion_id = ci.edicion_id
         WHERE ci.carrito_id = v_cart_id
         ORDER BY i.edicion_id
         FOR UPDATE OF i
    LOOP
        IF v_item.stock_actual < v_item.cantidad THEN
            PERFORM pliego.fn_raise_domain_error('P3002', 'INSUFFICIENT_STOCK');
        END IF;
    END LOOP;

    SELECT sum(ci.cantidad * e.precio)::NUMERIC(30,2)
      INTO o_total
      FROM pliego.carrito_item ci
      JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
     WHERE ci.carrito_id = v_cart_id;

    IF o_total IS NULL OR o_total <= 0 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid order total');
    END IF;

    INSERT INTO pliego.pedido(cliente_id, estado, subtotal, total)
    VALUES (v_customer_id, 'PENDING_PAYMENT', o_total, o_total)
    RETURNING pedido_id INTO o_order_id;

    INSERT INTO pliego.pedido_estado_historial(
        pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
    ) VALUES (
        o_order_id, NULL, 'SYSTEM', NULL, 'PENDING_PAYMENT'
    );

    INSERT INTO pliego.pedido_item(
        pedido_id, edicion_id, sku_snapshot, isbn_snapshot, titulo_snapshot,
        autores_snapshot, editorial_snapshot, formato_snapshot, idioma_snapshot,
        precio_unitario, cantidad, subtotal
    )
    SELECT o_order_id,
           e.edicion_id,
           e.sku,
           e.isbn13,
           l.titulo,
           pliego.fn_build_authors_snapshot(l.libro_id),
           pub.nombre,
           e.formato,
           e.idioma,
           e.precio,
           ci.cantidad,
           (e.precio * ci.cantidad)::NUMERIC(30,2)
      FROM pliego.carrito_item ci
      JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
      JOIN pliego.libro l ON l.libro_id = e.libro_id
      JOIN pliego.editorial pub ON pub.editorial_id = e.editorial_id
     WHERE ci.carrito_id = v_cart_id
     ORDER BY e.edicion_id;

    IF p_fulfillment_method='HOME_DELIVERY' THEN
    INSERT INTO pliego.pedido_direccion(
        pedido_id, destinatario, direccion_linea1, direccion_linea2,
        ciudad, provincia, pais_codigo, codigo_postal, referencia, telefono
    ) VALUES (
        o_order_id,
        v_address.destinatario,
        v_address.direccion_linea1,
        v_address.direccion_linea2,
        v_address.ciudad,
        v_address.provincia,
        v_address.pais_codigo,
        v_address.codigo_postal,
        v_address.referencia,
        v_address.telefono
    );

    END IF;

    INSERT INTO pliego.pago(
        pedido_id, metodo, estado, monto, referencia, detalle_resultado
    ) VALUES (
        o_order_id, p_payment_method, 'PENDING', o_total, NULL, NULL
    )
    RETURNING pago_id INTO v_payment_id;

    IF p_payment_outcome = 'APPROVED' THEN
        v_reference := pliego.fn_generate_payment_reference();

        BEGIN
            UPDATE pliego.pago
               SET estado = 'APPROVED',
                   referencia = v_reference,
                   detalle_resultado = NULL
             WHERE pago_id = v_payment_id;
        EXCEPTION WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
            IF v_constraint = 'uq_pago_referencia' THEN
                PERFORM pliego.fn_raise_domain_error('P5007', 'PAYMENT_REFERENCE_CONFLICT');
            END IF;
            RAISE;
        END;

        FOR v_item IN
            SELECT ci.edicion_id, ci.cantidad
              FROM pliego.carrito_item ci
              JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id
             WHERE ci.carrito_id = v_cart_id AND pliego.fn_is_physical_format(e.formato)
             ORDER BY ci.edicion_id
        LOOP
            SELECT i.stock_actual
              INTO v_before
              FROM pliego.inventario i
             WHERE i.edicion_id = v_item.edicion_id;

            v_after := v_before - v_item.cantidad;
            IF v_after < 0 THEN
                PERFORM pliego.fn_raise_domain_error('P3002', 'INSUFFICIENT_STOCK');
            END IF;

            UPDATE pliego.inventario
               SET stock_actual = v_after
             WHERE edicion_id = v_item.edicion_id;

            BEGIN
                INSERT INTO pliego.movimiento_inventario(
                    edicion_id, pedido_id, usuario_actor_id, tipo, cantidad,
                    stock_anterior, stock_posterior, motivo
                ) VALUES (
                    v_item.edicion_id, o_order_id, NULL, 'SALE', v_item.cantidad,
                    v_before, v_after, NULL
                );
            EXCEPTION WHEN unique_violation THEN
                GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
                IF v_constraint = 'uqx_movimiento_pedido_edicion_tipo' THEN
                    PERFORM pliego.fn_raise_domain_error('P3005', 'STOCK_MOVEMENT_DUPLICATE');
                END IF;
                RAISE;
            END;
        END LOOP;

        UPDATE pliego.pedido
           SET estado = 'CONFIRMED'
         WHERE pedido_id = o_order_id;

        INSERT INTO pliego.pedido_estado_historial(
            pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
        ) VALUES (
            o_order_id, NULL, 'SYSTEM', 'PENDING_PAYMENT', 'CONFIRMED'
        );

        UPDATE pliego.carrito
           SET estado = 'CHECKED_OUT'
         WHERE carrito_id = v_cart_id;

        o_order_state := 'CONFIRMED';
        o_payment_state := 'APPROVED';
        o_payment_reference := v_reference;
    ELSE
        UPDATE pliego.pago
           SET estado = 'REJECTED',
               referencia = NULL,
               detalle_resultado = 'SIMULATED_REJECTION'
         WHERE pago_id = v_payment_id;

        UPDATE pliego.pedido
           SET estado = 'CANCELLED'
         WHERE pedido_id = o_order_id;

        INSERT INTO pliego.pedido_estado_historial(
            pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
        ) VALUES (
            o_order_id, NULL, 'SYSTEM', 'PENDING_PAYMENT', 'CANCELLED'
        );

        o_order_state := 'CANCELLED';
        o_payment_state := 'REJECTED';
        o_payment_reference := NULL;
    END IF;
END;
$$;

-- Keep the historical executor name callable, delegating to the single current implementation.
CREATE OR REPLACE PROCEDURE pliego.sp_checkout_internal_v032(IN p_actor_user_id BIGINT,IN p_address_id BIGINT,IN p_payment_method VARCHAR,IN p_payment_outcome VARCHAR,
 OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 CALL pliego.sp_checkout_execute(p_actor_user_id,p_address_id,p_payment_method,p_payment_outcome,'HOME_DELIVERY',NULL,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
END; $$;


CREATE PROCEDURE pliego.sp_checkout(IN p_actor BIGINT,IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,
 IN p_fulfillment VARCHAR,IN p_pickup BIGINT,OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE location pliego.ubicacion_retiro%ROWTYPE; mode VARCHAR:=COALESCE(p_fulfillment,'HOME_DELIVERY'); now_at TIMESTAMPTZ;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 IF mode NOT IN ('HOME_DELIVERY','STORE_PICKUP') OR
 (mode='HOME_DELIVERY' AND (p_address IS NULL OR p_pickup IS NOT NULL)) OR
 (mode='STORE_PICKUP' AND (p_address IS NOT NULL OR p_pickup IS NULL)) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF mode='STORE_PICKUP' THEN
  SELECT * INTO location FROM pliego.ubicacion_retiro WHERE ubicacion_retiro_id=p_pickup FOR SHARE;
  IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5010','PICKUP_LOCATION_NOT_FOUND'); END IF;
  IF NOT location.activo THEN PERFORM pliego.fn_raise_domain_error('P5011','PICKUP_LOCATION_INACTIVE'); END IF;
 END IF;
 CALL pliego.sp_checkout_execute(p_actor,p_address,p_method,p_outcome,mode,p_pickup,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
 IF EXISTS(SELECT FROM pliego.pedido_item i WHERE i.pedido_id=o_order_id AND pliego.fn_is_physical_format(i.formato_snapshot)) THEN
  INSERT INTO pliego.pedido_entrega(pedido_id,metodo) VALUES(o_order_id,mode);
  IF mode='HOME_DELIVERY' THEN
   WITH shipment AS (
    INSERT INTO pliego.envio(pedido_id,estado,fecha_cancelacion) VALUES(o_order_id,CASE WHEN o_order_state='CANCELLED' THEN 'CANCELLED' ELSE 'PENDING' END,
     CASE WHEN o_order_state='CANCELLED' THEN CURRENT_TIMESTAMP END) RETURNING envio_id,estado)
   INSERT INTO pliego.envio_historial(envio_id,tipo,origen,estado_nuevo) SELECT envio_id,'STATUS','SYSTEM',estado FROM shipment;
  ELSE
   now_at:=clock_timestamp();
   INSERT INTO pliego.pedido_retiro(pedido_id,ubicacion_retiro_id,nombre,direccion,ciudad,provincia,pais_codigo,codigo_postal,latitud,longitud,
    zona_horaria,apertura,cierre,preparacion_minutos,estimado_desde,listo_desde,codigo)
   VALUES(o_order_id,location.ubicacion_retiro_id,location.nombre,location.direccion,location.ciudad,location.provincia,location.pais_codigo,location.codigo_postal,
    location.latitud,location.longitud,location.zona_horaria,location.apertura,location.cierre,location.preparacion_minutos,
    now_at,now_at+make_interval(mins=>location.preparacion_minutos),pliego.fn_generate_pickup_code());
  END IF;
 END IF;
 PERFORM pliego.fn_order_confirmation_enqueue(o_order_id);
END; $$;

CREATE OR REPLACE PROCEDURE pliego.sp_checkout(IN p_actor_user_id BIGINT,IN p_address_id BIGINT,IN p_payment_method VARCHAR,IN p_payment_outcome VARCHAR,
 OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 CALL pliego.sp_checkout(p_actor_user_id,p_address_id,p_payment_method,p_payment_outcome,'HOME_DELIVERY',NULL,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
END; $$;

ALTER TABLE pliego.checkout_attempt ADD COLUMN fulfillment_method VARCHAR(16) NOT NULL DEFAULT 'HOME_DELIVERY', ADD COLUMN pickup_location_id BIGINT;
ALTER TABLE pliego.checkout_attempt ADD CONSTRAINT ck_checkout_fulfillment CHECK(
 fulfillment_method IN ('HOME_DELIVERY','STORE_PICKUP') AND (state='NOT_CREATED' OR
 (fulfillment_method='HOME_DELIVERY' AND address_id IS NOT NULL AND pickup_location_id IS NULL) OR
 (fulfillment_method='STORE_PICKUP' AND address_id IS NULL AND pickup_location_id IS NOT NULL)));

CREATE PROCEDURE pliego.sp_checkout_idempotent(IN p_actor BIGINT,IN p_key UUID,IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,
 IN p_fulfillment VARCHAR,IN p_pickup BIGINT,OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE receipt pliego.checkout_attempt%ROWTYPE; customer_id BIGINT; cart_id BIGINT; mode VARCHAR:=COALESCE(p_fulfillment,'HOME_DELIVERY');
BEGIN
 SELECT a.cliente_id INTO customer_id FROM pliego.fn_assert_actor(p_actor,'CUSTOMER') a;
 IF p_key IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('checkout:'||p_actor||':'||p_key,0));
 SELECT * INTO receipt FROM pliego.checkout_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key;
 IF FOUND THEN
  IF receipt.state='NOT_CREATED' THEN PERFORM pliego.fn_raise_domain_error('P1011','ATTEMPT_NOT_CREATED'); END IF;
  IF receipt.address_id IS DISTINCT FROM p_address OR receipt.payment_method IS DISTINCT FROM p_method OR receipt.simulation_outcome IS DISTINCT FROM p_outcome
  OR receipt.cart_id IS DISTINCT FROM p_cart OR receipt.fulfillment_method IS DISTINCT FROM mode OR receipt.pickup_location_id IS DISTINCT FROM p_pickup THEN
   PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT'); END IF;
  o_order_id:=receipt.order_id; o_order_state:=receipt.order_state; o_payment_state:=receipt.payment_state; o_total:=receipt.total; o_payment_reference:=receipt.payment_reference;
  RETURN;
 END IF;
 IF p_cart IS NOT NULL THEN
  SELECT carrito_id INTO cart_id FROM pliego.carrito WHERE cliente_id=customer_id AND estado='ACTIVE' FOR UPDATE;
  IF cart_id IS DISTINCT FROM p_cart THEN PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE'); END IF;
 END IF;
 CALL pliego.sp_checkout(p_actor,p_address,p_method,p_outcome,mode,p_pickup,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
 INSERT INTO pliego.checkout_attempt(actor_user_id,attempt_key,state,address_id,cart_id,payment_method,simulation_outcome,order_id,order_state,payment_state,total,payment_reference,fulfillment_method,pickup_location_id)
 VALUES(p_actor,p_key,'CREATED',p_address,p_cart,p_method,p_outcome,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference,mode,p_pickup);
END; $$;
CREATE OR REPLACE PROCEDURE pliego.sp_checkout_idempotent(IN p_actor BIGINT,IN p_key UUID,IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,
 OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 CALL pliego.sp_checkout_idempotent(p_actor,p_key,p_address,p_method,p_outcome,p_cart,'HOME_DELIVERY',NULL,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
END; $$;

CREATE PROCEDURE pliego.sp_pickup_collect(IN p_actor BIGINT,IN p_order BIGINT,IN p_code VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE order_state VARCHAR; pickup pliego.pedido_retiro%ROWTYPE;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'ADMIN');
 SELECT estado INTO order_state FROM pliego.pedido WHERE pedido_id=p_order FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
 SELECT * INTO pickup FROM pliego.pedido_retiro WHERE pedido_id=p_order FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END IF;
 IF p_code IS NULL OR p_code<>pickup.codigo THEN PERFORM pliego.fn_raise_domain_error('P5013','PICKUP_CODE_INVALID'); END IF;
 IF pickup.fecha_retiro IS NOT NULL AND order_state='DELIVERED' THEN RETURN; END IF;
 IF order_state<>'CONFIRMED' OR NOT EXISTS(SELECT FROM pliego.pago WHERE pedido_id=p_order AND estado='APPROVED') THEN
  PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END IF;
 UPDATE pliego.pedido_retiro SET fecha_retiro=clock_timestamp() WHERE pedido_id=p_order;
 UPDATE pliego.pedido SET estado='DELIVERED' WHERE pedido_id=p_order;
 INSERT INTO pliego.pedido_estado_historial(pedido_id,usuario_actor_id,origen,estado_anterior,estado_nuevo)
 VALUES(p_order,p_actor,'USER',order_state,'DELIVERED');
END; $$;

CREATE OR REPLACE FUNCTION pliego.fn_order_post_purchase(p_order_id BIGINT)
RETURNS TABLE(purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
SELECT pliego.fn_order_purchase_state(p.estado),
    pliego.fn_order_fulfillment(p.pedido_id,FALSE),
    (SELECT jsonb_build_object('shipmentId',e.envio_id,'state',e.estado,'carrier',e.transportista,
        'trackingCode',e.seguimiento_codigo,'trackingUrl',e.seguimiento_url,
        'estimatedDeliveryFrom',e.entrega_estimada_desde,'estimatedDeliveryTo',e.entrega_estimada_hasta,
        'createdAt',e.fecha_creacion,'preparingAt',e.fecha_preparacion,'shippedAt',e.fecha_envio,
        'outForDeliveryAt',e.fecha_en_reparto,'deliveredAt',e.fecha_entrega,'canceledAt',e.fecha_cancelacion,
        'history',COALESCE((SELECT jsonb_agg(jsonb_build_object('eventId',h.envio_historial_id,'type',h.tipo,
            'origin',h.origen,'actorUserId',h.usuario_actor_id,'previousState',h.estado_anterior,'newState',h.estado_nuevo,
            'carrier',h.transportista,'trackingCode',h.seguimiento_codigo,'trackingUrl',h.seguimiento_url,'at',h.fecha)
            ORDER BY h.fecha,h.envio_historial_id) FROM pliego.envio_historial h WHERE h.envio_id=e.envio_id),'[]'::JSONB))
        FROM pliego.envio e WHERE e.pedido_id=p.pedido_id),
    (SELECT jsonb_build_object('invoiceId',i.factura_id,'documentNumber',i.numero_documento,'state',i.estado,
        'buyerName',i.comprador_nombre,'identityType',i.identidad_tipo,'identityNumber',i.identidad_numero,
        'buyerEmail',i.comprador_email,'currency',i.moneda,'subtotal',i.subtotal,'taxTotal',i.impuesto_total,'total',i.total,
        'issuedAt',i.fecha_emision,'billingAddress',(SELECT jsonb_build_object('line1',d.direccion_linea1,
            'line2',d.direccion_linea2,'city',d.ciudad,'province',d.provincia,'countryCode',d.pais_codigo,'postalCode',d.codigo_postal)
            FROM pliego.factura_direccion d WHERE d.factura_id=i.factura_id),
        'items',(SELECT jsonb_agg(jsonb_build_object('invoiceItemId',l.factura_item_id,'orderItemId',l.pedido_item_id,
            'description',l.descripcion,'quantity',l.cantidad,'unitPrice',l.precio_unitario,'subtotal',l.subtotal,
            'taxTreatment',l.tratamiento_impuesto,'taxRate',l.impuesto_tasa,'taxAmount',l.impuesto_monto,'total',l.total)
            ORDER BY l.factura_item_id) FROM pliego.factura_item l WHERE l.factura_id=i.factura_id),
        'electronicIssuance',(SELECT jsonb_build_object('provider',el.proveedor,'state',el.estado,
            'externalReference',el.referencia_externa,'submittedAt',el.fecha_presentacion,'authorizedAt',el.fecha_autorizacion)
            FROM pliego.factura_emision_electronica el WHERE el.factura_id=i.factura_id),
        'pdfAvailable',EXISTS(SELECT 1 FROM pliego.factura_archivo ar WHERE ar.factura_id=i.factura_id AND ar.tipo='PDF'),
        'xmlAvailable',EXISTS(SELECT 1 FROM pliego.factura_archivo ar WHERE ar.factura_id=i.factura_id AND ar.tipo='XML'))
        FROM pliego.factura i WHERE i.pedido_id=p.pedido_id AND i.estado='ISSUED'),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('creditNoteId',n.nota_credito_id,'invoiceId',n.factura_id,
        'documentNumber',n.numero_documento,'state',n.estado,'reason',n.motivo,'subtotal',n.subtotal,
        'taxTotal',n.impuesto_total,'total',n.total,'issuedAt',n.fecha_emision) ORDER BY n.fecha_emision,n.nota_credito_id)
        FROM pliego.nota_credito n JOIN pliego.factura i USING(factura_id) WHERE i.pedido_id=p.pedido_id),'[]'::JSONB),
    jsonb_build_object('cancel',p.estado IN ('CONFIRMED','PREPARING') AND pa.estado='APPROVED'
        AND NOT EXISTS(SELECT 1 FROM pliego.envio e WHERE e.pedido_id=p.pedido_id AND e.estado NOT IN ('PENDING','PREPARING')),
        'changeShippingAddress',FALSE)
FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id) WHERE p.pedido_id=p_order_id;
$$;


-- Pickup must use collection, never the legacy digital/shipment fallback.
CREATE OR REPLACE PROCEDURE pliego.sp_order_change_status(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,
    IN p_new_state VARCHAR,OUT o_order_id BIGINT,OUT o_previous_state VARCHAR,OUT o_order_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    PERFORM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
    IF p_new_state IS NULL OR p_new_state NOT IN ('PREPARING','SHIPPED','DELIVERED') THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    SELECT estado INTO o_previous_state FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
    IF EXISTS (SELECT 1 FROM pliego.pedido_entrega WHERE pedido_id=p_order_id AND metodo='STORE_PICKUP') THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
    IF EXISTS (SELECT 1 FROM pliego.envio WHERE pedido_id=p_order_id) THEN
        CALL pliego.sp_shipment_transition(p_actor_user_id,p_order_id,p_new_state);
    ELSE
        -- Legacy digital workflow retained; this creates no physical fulfillment or entitlement.
        IF NOT ((o_previous_state='CONFIRMED' AND p_new_state='PREPARING') OR
            (o_previous_state='PREPARING' AND p_new_state='SHIPPED') OR
            (o_previous_state='SHIPPED' AND p_new_state='DELIVERED')) THEN
            PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
        END IF;
        UPDATE pliego.pedido SET estado=p_new_state WHERE pedido_id=p_order_id;
        INSERT INTO pliego.pedido_estado_historial(pedido_id,usuario_actor_id,origen,estado_anterior,estado_nuevo)
        VALUES(p_order_id,p_actor_user_id,'USER',o_previous_state,p_new_state);
    END IF;
    o_order_id:=p_order_id; o_order_state:=p_new_state;
END; $$;
