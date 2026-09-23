CREATE OR REPLACE FUNCTION pliego.fn_inventory_search(p_actor_user_id BIGINT,p_edition_id BIGINT,p_title_query VARCHAR,p_sku VARCHAR,p_low_stock_only BOOLEAN,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(edition_id BIGINT,book_id BIGINT,title VARCHAR,sku VARCHAR,isbn13 CHAR(13),edition_state VARCHAR,stock_actual INTEGER,stock_minimo INTEGER,low_stock BOOLEAN,updated_at TIMESTAMPTZ,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_title TEXT:=NULLIF(lower(btrim(p_title_query)),'');v_sku TEXT:=CASE WHEN p_sku IS NULL OR btrim(p_sku)='' THEN NULL ELSE pliego.fn_normalize_sku(p_sku) END;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 RETURN QUERY SELECT e.edicion_id,l.libro_id,l.titulo,e.sku,e.isbn13,e.estado,i.stock_actual,i.stock_minimo,(i.stock_minimo>0 AND i.stock_actual<=i.stock_minimo),i.fecha_actualizacion,count(*) OVER()::BIGINT FROM pliego.inventario i JOIN pliego.edicion e ON e.edicion_id=i.edicion_id JOIN pliego.libro l ON l.libro_id=e.libro_id WHERE (p_edition_id IS NULL OR e.edicion_id=p_edition_id) AND (v_title IS NULL OR lower(l.titulo) LIKE '%'||v_title||'%') AND (v_sku IS NULL OR e.sku=v_sku) AND (NOT COALESCE(p_low_stock_only,FALSE) OR (i.stock_minimo>0 AND i.stock_actual<=i.stock_minimo)) ORDER BY lower(l.titulo),e.edicion_id LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_inventory_movements(p_actor_user_id BIGINT,p_edition_id BIGINT,p_type VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(movement_id BIGINT,edition_id BIGINT,order_id BIGINT,actor_user_id BIGINT,type VARCHAR,quantity INTEGER,stock_before INTEGER,stock_after INTEGER,reason VARCHAR,event_at TIMESTAMPTZ,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_type IS NOT NULL AND p_type NOT IN('ENTRY','ADJUSTMENT_IN','ADJUSTMENT_OUT','SALE','CANCELLATION') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');END IF;
 IF NOT EXISTS(SELECT 1 FROM pliego.inventario i WHERE i.edicion_id=p_edition_id) THEN PERFORM pliego.fn_raise_domain_error('P3001','INVENTORY_NOT_FOUND');END IF;
 RETURN QUERY SELECT m.movimiento_inventario_id,m.edicion_id,m.pedido_id,m.usuario_actor_id,m.tipo,m.cantidad,m.stock_anterior,m.stock_posterior,m.motivo,m.fecha,count(*) OVER()::BIGINT FROM pliego.movimiento_inventario m WHERE m.edicion_id=p_edition_id AND (p_type IS NULL OR m.tipo=p_type) ORDER BY m.fecha DESC,m.movimiento_inventario_id DESC LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_inventory_entry(IN p_actor_user_id BIGINT,IN p_edition_id BIGINT,IN p_quantity INTEGER,IN p_reason VARCHAR,OUT o_movement_id BIGINT,OUT o_stock_before INTEGER,OUT o_stock_after INTEGER)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');IF p_quantity IS NULL OR p_quantity<=0 OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN PERFORM pliego.fn_raise_domain_error('P3003','STOCK_QUANTITY_INVALID');END IF;
 SELECT i.stock_actual INTO o_stock_before FROM pliego.inventario i WHERE i.edicion_id=p_edition_id FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P3001','INVENTORY_NOT_FOUND');END IF;o_stock_after:=o_stock_before+p_quantity;
 UPDATE pliego.inventario SET stock_actual=o_stock_after WHERE edicion_id=p_edition_id;INSERT INTO pliego.movimiento_inventario(edicion_id,pedido_id,usuario_actor_id,tipo,cantidad,stock_anterior,stock_posterior,motivo)VALUES(p_edition_id,NULL,p_actor_user_id,'ENTRY',p_quantity,o_stock_before,o_stock_after,btrim(p_reason))RETURNING movimiento_inventario_id INTO o_movement_id;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_inventory_adjust(IN p_actor_user_id BIGINT,IN p_edition_id BIGINT,IN p_adjustment_type VARCHAR,IN p_quantity INTEGER,IN p_reason VARCHAR,OUT o_movement_id BIGINT,OUT o_stock_before INTEGER,OUT o_stock_after INTEGER)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');IF p_adjustment_type NOT IN('ADJUSTMENT_IN','ADJUSTMENT_OUT') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');END IF;IF p_quantity IS NULL OR p_quantity<=0 OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN PERFORM pliego.fn_raise_domain_error('P3003','STOCK_QUANTITY_INVALID');END IF;
 SELECT i.stock_actual INTO o_stock_before FROM pliego.inventario i WHERE i.edicion_id=p_edition_id FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P3001','INVENTORY_NOT_FOUND');END IF;IF p_adjustment_type='ADJUSTMENT_OUT' AND o_stock_before<p_quantity THEN PERFORM pliego.fn_raise_domain_error('P3002','INSUFFICIENT_STOCK');END IF;o_stock_after:=CASE WHEN p_adjustment_type='ADJUSTMENT_IN' THEN o_stock_before+p_quantity ELSE o_stock_before-p_quantity END;
 UPDATE pliego.inventario SET stock_actual=o_stock_after WHERE edicion_id=p_edition_id;INSERT INTO pliego.movimiento_inventario(edicion_id,pedido_id,usuario_actor_id,tipo,cantidad,stock_anterior,stock_posterior,motivo)VALUES(p_edition_id,NULL,p_actor_user_id,p_adjustment_type,p_quantity,o_stock_before,o_stock_after,btrim(p_reason))RETURNING movimiento_inventario_id INTO o_movement_id;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_inventory_set_minimum(IN p_actor_user_id BIGINT,IN p_edition_id BIGINT,IN p_stock_minimum INTEGER,OUT o_stock_minimum INTEGER)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');IF p_stock_minimum IS NULL OR p_stock_minimum<0 THEN PERFORM pliego.fn_raise_domain_error('P3004','STOCK_MINIMUM_INVALID');END IF;UPDATE pliego.inventario SET stock_minimo=p_stock_minimum WHERE edicion_id=p_edition_id;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P3001','INVENTORY_NOT_FOUND');END IF;o_stock_minimum:=p_stock_minimum;
END;$$;
