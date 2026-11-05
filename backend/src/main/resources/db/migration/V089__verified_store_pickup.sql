-- Existing codes and collected rows remain valid. New codes use 40 random bits.
-- PostgreSQL's built-in gen_random_uuid() uses a cryptographic random source;
-- its first five bytes contain no UUID version/variant bits. No extension is needed.
CREATE OR REPLACE FUNCTION pliego.fn_generate_pickup_code() RETURNS VARCHAR
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE
 alphabet CONSTANT TEXT:='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
 random_bits BIT(40); candidate VARCHAR; attempt INTEGER; i INTEGER;
BEGIN
 FOR attempt IN 1..128 LOOP
  random_bits:=('x'||substr(replace(pg_catalog.gen_random_uuid()::TEXT,'-',''),1,10))::BIT(40);
  candidate:='P-';
  FOR i IN 0..7 LOOP
   candidate:=candidate||substr(alphabet,substring(random_bits FROM i*5+1 FOR 5)::INTEGER+1,1);
  END LOOP;
  -- Hold a candidate reservation until the caller commits its snapshot insert.
  -- A concurrent generator that draws the same code waits, then retries after
  -- observing the committed unique row. The unique constraint remains the final guard.
  PERFORM pg_advisory_xact_lock(hashtextextended('pickup-code:'||candidate,0));
  IF NOT EXISTS(SELECT FROM pliego.pedido_retiro WHERE codigo=candidate) THEN RETURN candidate; END IF;
 END LOOP;
 RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='INVALID_ARGUMENT',
  DETAIL='No fue posible generar un código de retiro. Inténtalo de nuevo.';
END; $$;

CREATE FUNCTION pliego.fn_normalize_pickup_code(p_code TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER
RETURN regexp_replace(upper(btrim(p_code)),'[[:space:]-]+','','g');

ALTER TABLE pliego.pedido_retiro
 ADD COLUMN retirado_por BIGINT REFERENCES pliego.usuario(usuario_id) ON DELETE RESTRICT,
 ADD COLUMN identidad_verificada BOOLEAN,
 ADD CONSTRAINT ck_pedido_retiro_audit CHECK (
  (fecha_retiro IS NULL AND retirado_por IS NULL AND identidad_verificada IS NULL)
  OR (fecha_retiro IS NOT NULL AND
    ((retirado_por IS NULL AND identidad_verificada IS NULL)
     OR (retirado_por IS NOT NULL AND identidad_verificada IS TRUE))));
CREATE INDEX ix_pedido_retiro_actor ON pliego.pedido_retiro(retirado_por) WHERE retirado_por IS NOT NULL;
CREATE INDEX ix_pedido_retiro_ready ON pliego.pedido_retiro(listo_desde,pedido_id) WHERE fecha_retiro IS NULL;
CREATE INDEX ix_pedido_retiro_collected ON pliego.pedido_retiro(fecha_retiro DESC,pedido_id DESC) WHERE fecha_retiro IS NOT NULL;

CREATE OR REPLACE FUNCTION pliego.fn_guard_pickup_snapshot() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.fecha_retiro IS NOT NULL OR NEW.retirado_por IS NOT NULL OR NEW.identidad_verificada IS NOT NULL THEN
   PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
  END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['fecha_retiro','retirado_por','identidad_verificada'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['fecha_retiro','retirado_por','identidad_verificada']) THEN
  PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
 END IF;
 IF ROW(NEW.fecha_retiro,NEW.retirado_por,NEW.identidad_verificada)
    IS DISTINCT FROM ROW(OLD.fecha_retiro,OLD.retirado_por,OLD.identidad_verificada) THEN
  IF OLD.fecha_retiro IS NOT NULL OR NEW.fecha_retiro IS NULL
     OR NEW.retirado_por IS NULL OR NEW.identidad_verificada IS DISTINCT FROM TRUE THEN
   PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
  END IF;
  PERFORM * FROM pliego.fn_assert_actor(NEW.retirado_por,'ADMIN');
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_pedido_retiro_new_audit BEFORE INSERT ON pliego.pedido_retiro
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_pickup_snapshot();

CREATE FUNCTION pliego.fn_pickup_state(p_order BIGINT) RETURNS VARCHAR
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT CASE WHEN p.estado='CANCELLED' THEN 'CANCELLED'
  WHEN r.fecha_retiro IS NOT NULL THEN 'COLLECTED'
  WHEN p.estado IN('CONFIRMED','PREPARING') AND pa.estado='APPROVED'
    -- Pre-V055 pickup snapshots have no cancellation window. Preserve their
    -- readiness without inventing timestamps or rewriting historical events.
    AND (p.cancelacion_hasta IS NULL OR (p.finalizado_en IS NOT NULL
      AND p.finalizado_en<=clock_timestamp() AND p.cancelacion_hasta<=clock_timestamp()))
    AND r.listo_desde<=clock_timestamp() THEN 'READY'
  ELSE 'PENDING' END::VARCHAR
 FROM pliego.pedido p JOIN pliego.pedido_entrega f USING(pedido_id)
 JOIN pliego.pedido_retiro r USING(pedido_id) LEFT JOIN pliego.pago pa USING(pedido_id)
 WHERE p.pedido_id=p_order AND f.metodo='STORE_PICKUP';
$$;

-- Confirmation remains an immutable checkout snapshot. Read paths already
-- reconcile the existing purchase lifecycle before projecting current state.
CREATE OR REPLACE FUNCTION pliego.fn_order_fulfillment(p_order BIGINT,p_confirmation BOOLEAN DEFAULT FALSE) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT jsonb_build_object('method',f.metodo)||CASE WHEN r.pedido_id IS NULL THEN '{}'::JSONB ELSE
 jsonb_build_object('pickup',jsonb_build_object(
  'location',jsonb_build_object('id',r.ubicacion_retiro_id::TEXT,'name',r.nombre,'address',r.direccion,'city',r.ciudad,'province',r.provincia,
   'countryCode',r.pais_codigo,'postalCode',r.codigo_postal,'latitude',r.latitud,'longitude',r.longitud,'timezone',r.zona_horaria,
   'openingHours',jsonb_build_object('opensAt',r.apertura,'closesAt',r.cierre),'active',TRUE,'preparationMinutes',r.preparacion_minutos),
  'estimatedAt',to_char(r.estimado_desde AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'readyAt',to_char(r.listo_desde AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'preparationMinutes',r.preparacion_minutos,'pickupCode',r.codigo))||CASE WHEN p_confirmation THEN '{}'::JSONB ELSE
 jsonb_build_object('state',pliego.fn_pickup_state(p_order),'collectedAt',r.fecha_retiro) END END
 FROM pliego.pedido_entrega f LEFT JOIN pliego.pedido_retiro r USING(pedido_id) WHERE f.pedido_id=p_order;
$$;

-- Remove the unverified entry point; omitting identity verification is never a collection.
DROP PROCEDURE pliego.sp_pickup_collect(BIGINT,BIGINT,VARCHAR);
CREATE PROCEDURE pliego.sp_pickup_collect(IN p_actor BIGINT,IN p_order BIGINT,IN p_code VARCHAR,IN p_identity_verified BOOLEAN)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE order_state VARCHAR; pickup pliego.pedido_retiro%ROWTYPE; code TEXT; at_time TIMESTAMPTZ;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'ADMIN');
 IF p_identity_verified IS DISTINCT FROM TRUE THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Debes verificar la identidad de quien retira.');
 END IF;
 -- Match the established cancellation/worker lock order: order first, pickup second.
 SELECT estado INTO order_state FROM pliego.pedido WHERE pedido_id=p_order FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
 SELECT r.* INTO pickup FROM pliego.pedido_retiro r JOIN pliego.pedido_entrega f USING(pedido_id)
  WHERE r.pedido_id=p_order AND f.metodo='STORE_PICKUP' FOR UPDATE OF r;
 IF NOT FOUND OR order_state='CANCELLED' OR NOT EXISTS(
  SELECT FROM pliego.pago WHERE pedido_id=p_order AND estado='APPROVED') THEN
  PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
 END IF;
 code:=pliego.fn_normalize_pickup_code(p_code);
 IF code IS NULL OR code NOT IN(replace(pickup.codigo,'-',''),substr(pickup.codigo,3)) THEN
  PERFORM pliego.fn_raise_domain_error('P5013','PICKUP_CODE_INVALID');
 END IF;
 IF pickup.fecha_retiro IS NOT NULL THEN
  PERFORM pliego.fn_raise_domain_error('P5017','PICKUP_ALREADY_COLLECTED');
 END IF;
 IF order_state NOT IN('CONFIRMED','PREPARING') THEN
  PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
 END IF;
 CALL pliego.sp_purchase_lifecycle_reconcile(p_order);
 IF pliego.fn_pickup_state(p_order) IS DISTINCT FROM 'READY' THEN
  PERFORM pliego.fn_raise_domain_error('P5018','PICKUP_NOT_READY');
 END IF;
 SELECT estado INTO order_state FROM pliego.pedido WHERE pedido_id=p_order;
 at_time:=clock_timestamp();
 UPDATE pliego.pedido_retiro SET fecha_retiro=at_time,retirado_por=p_actor,identidad_verificada=TRUE WHERE pedido_id=p_order;
 UPDATE pliego.pedido SET estado='DELIVERED' WHERE pedido_id=p_order;
 INSERT INTO pliego.pedido_estado_historial(pedido_id,usuario_actor_id,origen,estado_anterior,estado_nuevo,fecha)
  VALUES(p_order,p_actor,'USER',order_state,'DELIVERED',at_time);
END; $$;

CREATE FUNCTION pliego.fn_admin_pickup_view(p_actor BIGINT,p_order BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE result JSONB;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'ADMIN');
 SELECT jsonb_build_object(
  'orderId',p.pedido_id::TEXT,'orderReference',p.referencia_publica,'state',pliego.fn_pickup_state(p.pedido_id),
  'orderState',p.estado,'paymentState',pa.estado,'createdAt',p.fecha_creacion,
  'readyAt',r.listo_desde,'collectedAt',r.fecha_retiro,
  'collectedBy',CASE WHEN a.usuario_id IS NULL THEN NULL ELSE jsonb_build_object('userId',a.usuario_id::TEXT,'email',a.email_normalizado) END,
  'identityVerified',r.identidad_verificada,
  'location',jsonb_build_object('id',r.ubicacion_retiro_id::TEXT,'name',r.nombre,'address',r.direccion,'city',r.ciudad),
  'customer',jsonb_build_object('customerId',c.cliente_id::TEXT,'name',btrim(c.nombres||' '||c.apellidos),
   'email',u.email_normalizado,'identityType',ci.identidad_tipo,'identityNumber',ci.identidad_numero),
  'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('orderItemId',i.pedido_item_id::TEXT,'title',i.titulo_snapshot,
   'format',i.formato_snapshot,'quantity',i.cantidad) ORDER BY i.pedido_item_id)
   FROM pliego.pedido_item i WHERE i.pedido_id=p.pedido_id AND pliego.fn_is_physical_format(i.formato_snapshot)),'[]'::JSONB),
  'unitCount',(SELECT COALESCE(sum(i.cantidad),0) FROM pliego.pedido_item i WHERE i.pedido_id=p.pedido_id
   AND pliego.fn_is_physical_format(i.formato_snapshot)), 'total',p.total)
 INTO result FROM pliego.pedido p JOIN pliego.pedido_entrega f USING(pedido_id) JOIN pliego.pedido_retiro r USING(pedido_id)
 JOIN pliego.cliente c USING(cliente_id) JOIN pliego.usuario u USING(usuario_id) JOIN pliego.pago pa USING(pedido_id)
 LEFT JOIN pliego.cliente_identificacion ci USING(cliente_id) LEFT JOIN pliego.usuario a ON a.usuario_id=r.retirado_por
 WHERE p.pedido_id=p_order AND f.metodo='STORE_PICKUP';
 RETURN result;
END; $$;

CREATE FUNCTION pliego.fn_admin_pickup_detail(p_actor BIGINT,p_order BIGINT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE result JSONB;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'ADMIN');
 IF NOT EXISTS(SELECT FROM pliego.pedido_retiro WHERE pedido_id=p_order) THEN
  PERFORM pliego.fn_raise_domain_error('P5016','PICKUP_NOT_FOUND');
 END IF;
 CALL pliego.sp_purchase_lifecycle_reconcile(p_order);
 result:=pliego.fn_admin_pickup_view(p_actor,p_order);
 IF result IS NULL THEN PERFORM pliego.fn_raise_domain_error('P5016','PICKUP_NOT_FOUND'); END IF;
 RETURN result;
END; $$;

CREATE FUNCTION pliego.fn_admin_pickup_lookup(p_actor BIGINT,p_code VARCHAR) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE pickup_order BIGINT; code TEXT:=pliego.fn_normalize_pickup_code(p_code);
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'ADMIN');
 -- Both candidate values use the existing unique codigo index. Bare codes may
 -- themselves start with P, so never strip that character unconditionally.
 SELECT r.pedido_id INTO pickup_order FROM pliego.pedido_retiro r
 WHERE r.codigo='P-'||code OR (left(code,1)='P' AND r.codigo='P-'||substr(code,2))
 ORDER BY CASE WHEN left(code,1)='P' AND r.codigo='P-'||substr(code,2) THEN 0 ELSE 1 END LIMIT 1;
 IF pickup_order IS NULL THEN PERFORM pliego.fn_raise_domain_error('P5016','PICKUP_NOT_FOUND'); END IF;
 RETURN pliego.fn_admin_pickup_detail(p_actor,pickup_order);
END; $$;

CREATE FUNCTION pliego.fn_admin_pickups(p_actor BIGINT,p_state VARCHAR DEFAULT NULL,p_q VARCHAR DEFAULT NULL,
 p_page INTEGER DEFAULT 0,p_page_size INTEGER DEFAULT 20)
RETURNS TABLE(pickup JSONB,total_count BIGINT)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE state_filter TEXT:=NULLIF(upper(btrim(p_state)),'');
 query_filter TEXT:=NULLIF(pliego.fn_search_fold(btrim(p_q)),''); row_order RECORD;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'ADMIN');
 IF (state_filter IS NOT NULL AND state_filter NOT IN('PENDING','READY','COLLECTED','CANCELLED'))
  OR p_page IS NULL OR p_page<0 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 50
  OR char_length(p_q)>200 THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 -- Reconcile due matching orders before state filtering and pagination, so a
 -- missed worker never hides READY rows or changes a page's count after selection.
 FOR row_order IN SELECT p.pedido_id FROM pliego.pedido p JOIN pliego.pedido_retiro r USING(pedido_id)
  JOIN pliego.cliente c USING(cliente_id) JOIN pliego.usuario u USING(usuario_id)
  WHERE p.estado='CONFIRMED' AND p.finalizado_en IS NULL AND p.cancelacion_hasta<=clock_timestamp()
   AND (query_filter IS NULL
    OR position(regexp_replace(query_filter,'[[:space:]-]+','','g') IN regexp_replace(lower(p.referencia_publica),'[[:space:]-]+','','g'))>0
    OR position(query_filter IN pliego.fn_search_fold(c.nombres||' '||c.apellidos))>0
    OR position(query_filter IN pliego.fn_search_fold(u.email_normalizado))>0)
  ORDER BY p.pedido_id
 LOOP CALL pliego.sp_purchase_lifecycle_reconcile(row_order.pedido_id); END LOOP;
 RETURN QUERY WITH candidates AS (
  SELECT p.pedido_id,p.fecha_creacion,r.listo_desde,r.fecha_retiro,pliego.fn_pickup_state(p.pedido_id) AS pickup_state
  FROM pliego.pedido p JOIN pliego.pedido_retiro r USING(pedido_id)
  JOIN pliego.cliente c USING(cliente_id) JOIN pliego.usuario u USING(usuario_id)
  WHERE query_filter IS NULL
   OR position(regexp_replace(query_filter,'[[:space:]-]+','','g') IN regexp_replace(lower(p.referencia_publica),'[[:space:]-]+','','g'))>0
   OR position(query_filter IN pliego.fn_search_fold(c.nombres||' '||c.apellidos))>0
   OR position(query_filter IN pliego.fn_search_fold(u.email_normalizado))>0
 ), filtered AS (SELECT * FROM candidates WHERE state_filter IS NULL OR pickup_state=state_filter)
 SELECT pliego.fn_admin_pickup_view(p_actor,f.pedido_id),count(*) OVER()
 FROM filtered f
 ORDER BY CASE f.pickup_state WHEN 'READY' THEN 0 WHEN 'PENDING' THEN 1 WHEN 'COLLECTED' THEN 2 ELSE 3 END,
  CASE WHEN f.pickup_state IN('READY','PENDING') THEN f.listo_desde END ASC,
  CASE WHEN f.pickup_state='COLLECTED' THEN f.fecha_retiro END DESC,
  CASE WHEN f.pickup_state='CANCELLED' THEN f.fecha_creacion END DESC,f.pedido_id DESC
 LIMIT p_page_size OFFSET p_page::BIGINT*p_page_size;
END; $$;

-- Staff obtain the verification code from the customer. The generic order
-- detail shares customer projections, so remove only the staff-visible code.
-- fn_admin_order_detail_priced delegates here and inherits this restriction.
CREATE OR REPLACE FUNCTION pliego.fn_admin_order_detail(p_actor_user_id BIGINT,p_order_id BIGINT)
RETURNS TABLE(order_id BIGINT,customer_id BIGINT,customer_email VARCHAR,customer_name VARCHAR,order_state VARCHAR,
 subtotal NUMERIC,total NUMERIC,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,items JSONB,address JSONB,payment JSONB,
 state_history JSONB,inventory_movements JSONB,purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,
 credit_notes JSONB,available_actions JSONB,order_reference VARCHAR)
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 SELECT b.order_id,b.customer_id,b.customer_email,b.customer_name,b.order_state,b.subtotal,b.total,b.created_at,b.updated_at,
  b.items,b.address,b.payment,b.state_history,b.inventory_movements,b.purchase_state,
  b.fulfillment #- '{pickup,pickupCode}',b.shipment,b.invoice,b.credit_notes,b.available_actions,p.referencia_publica
 FROM pliego.fn_admin_order_detail_internal_v088(p_actor_user_id,p_order_id) b
 JOIN pliego.pedido p ON p.pedido_id=b.order_id;
$$;

-- Public API execution is explicit, including installations whose default
-- privileges have already been tightened by the production ACL lifecycle.
REVOKE ALL ON FUNCTION pliego.fn_normalize_pickup_code(TEXT),pliego.fn_pickup_state(BIGINT),
 pliego.fn_admin_pickup_view(BIGINT,BIGINT),pliego.fn_admin_pickup_detail(BIGINT,BIGINT),
 pliego.fn_admin_pickup_lookup(BIGINT,VARCHAR),pliego.fn_admin_pickups(BIGINT,VARCHAR,VARCHAR,INTEGER,INTEGER) FROM PUBLIC;
REVOKE ALL ON PROCEDURE pliego.sp_pickup_collect(BIGINT,BIGINT,VARCHAR,BOOLEAN) FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
  GRANT SELECT,INSERT,UPDATE ON TABLE pliego.pedido_retiro TO pliego_app;
  GRANT EXECUTE ON FUNCTION pliego.fn_generate_pickup_code(),pliego.fn_normalize_pickup_code(TEXT),pliego.fn_pickup_state(BIGINT),
   pliego.fn_admin_pickup_view(BIGINT,BIGINT),pliego.fn_admin_pickup_detail(BIGINT,BIGINT),
   pliego.fn_admin_pickup_lookup(BIGINT,VARCHAR),pliego.fn_admin_pickups(BIGINT,VARCHAR,VARCHAR,INTEGER,INTEGER) TO pliego_app;
  GRANT EXECUTE ON PROCEDURE pliego.sp_pickup_collect(BIGINT,BIGINT,VARCHAR,BOOLEAN) TO pliego_app;
 END IF;
END $grants$;
