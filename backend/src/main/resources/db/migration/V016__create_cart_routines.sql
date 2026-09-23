CREATE OR REPLACE FUNCTION pliego.fn_cart_get(p_actor_user_id BIGINT)
RETURNS TABLE(cart_id BIGINT,state VARCHAR,items JSONB,total_current NUMERIC(30,2))
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_cart_id BIGINT;v_state VARCHAR;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER')a;SELECT c.carrito_id,c.estado INTO v_cart_id,v_state FROM pliego.carrito c WHERE c.cliente_id=v_customer_id AND c.estado='ACTIVE';
 IF NOT FOUND THEN RETURN QUERY SELECT NULL::BIGINT,NULL::VARCHAR,'[]'::JSONB,0.00::NUMERIC(30,2);RETURN;END IF;
 RETURN QUERY SELECT v_cart_id,v_state,COALESCE((SELECT jsonb_agg(jsonb_build_object('cartItemId',ci.carrito_item_id,'editionId',e.edicion_id,'title',l.titulo,'authors',pliego.fn_build_authors_snapshot(l.libro_id),'sku',e.sku,'coverUrl',e.portada_url,'quantity',ci.cantidad,'currentPrice',e.precio,'currentSubtotal',(ci.cantidad*e.precio),'available',(l.estado='ACTIVE' AND e.estado='ACTIVE' AND i.stock_actual>=ci.cantidad),'unavailabilityReason',CASE WHEN l.estado<>'ACTIVE' THEN 'BOOK_INACTIVE' WHEN e.estado<>'ACTIVE' THEN 'EDITION_INACTIVE' WHEN i.stock_actual<ci.cantidad THEN 'INSUFFICIENT_STOCK' ELSE NULL END)ORDER BY ci.fecha_creacion,ci.carrito_item_id) FROM pliego.carrito_item ci JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id JOIN pliego.libro l ON l.libro_id=e.libro_id JOIN pliego.inventario i ON i.edicion_id=e.edicion_id WHERE ci.carrito_id=v_cart_id),'[]'::JSONB),COALESCE((SELECT sum(ci.cantidad*e.precio)::NUMERIC(30,2) FROM pliego.carrito_item ci JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id WHERE ci.carrito_id=v_cart_id),0.00::NUMERIC(30,2));
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_cart_add_item(IN p_actor_user_id BIGINT,IN p_edition_id BIGINT,IN p_quantity INTEGER,OUT o_cart_id BIGINT,OUT o_cart_item_id BIGINT,OUT o_quantity INTEGER)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_book_state VARCHAR;v_edition_state VARCHAR;v_stock INTEGER;v_current INTEGER;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER')a;IF p_quantity IS NULL OR p_quantity<=0 THEN PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID');END IF;
 SELECT l.estado,e.estado INTO v_book_state,v_edition_state FROM pliego.edicion e JOIN pliego.libro l ON l.libro_id=e.libro_id WHERE e.edicion_id=p_edition_id;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2041','EDITION_NOT_FOUND');END IF;IF v_edition_state<>'ACTIVE' THEN PERFORM pliego.fn_raise_domain_error('P2042','EDITION_INACTIVE');END IF;IF v_book_state<>'ACTIVE' THEN PERFORM pliego.fn_raise_domain_error('P2043','BOOK_INACTIVE');END IF;
 SELECT i.stock_actual INTO v_stock FROM pliego.inventario i WHERE i.edicion_id=p_edition_id;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P3001','INVENTORY_NOT_FOUND');END IF;
 INSERT INTO pliego.carrito(cliente_id,estado)VALUES(v_customer_id,'ACTIVE')ON CONFLICT(cliente_id)WHERE estado='ACTIVE' DO NOTHING;
 SELECT c.carrito_id INTO o_cart_id FROM pliego.carrito c WHERE c.cliente_id=v_customer_id AND c.estado='ACTIVE' FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE');END IF;
 SELECT ci.cantidad,ci.carrito_item_id INTO v_current,o_cart_item_id FROM pliego.carrito_item ci WHERE ci.carrito_id=o_cart_id AND ci.edicion_id=p_edition_id;
 IF FOUND THEN o_quantity:=v_current+p_quantity;IF o_quantity>v_stock THEN PERFORM pliego.fn_raise_domain_error('P3002','INSUFFICIENT_STOCK');END IF;UPDATE pliego.carrito_item SET cantidad=o_quantity WHERE carrito_item_id=o_cart_item_id;
 ELSE o_quantity:=p_quantity;IF o_quantity>v_stock THEN PERFORM pliego.fn_raise_domain_error('P3002','INSUFFICIENT_STOCK');END IF;INSERT INTO pliego.carrito_item(carrito_id,edicion_id,cantidad)VALUES(o_cart_id,p_edition_id,o_quantity)RETURNING carrito_item_id INTO o_cart_item_id;END IF;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_cart_update_item(IN p_actor_user_id BIGINT,IN p_cart_item_id BIGINT,IN p_quantity INTEGER,OUT o_cart_id BIGINT,OUT o_cart_item_id BIGINT,OUT o_quantity INTEGER)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_ed BIGINT;v_stock INTEGER;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER')a;IF p_quantity IS NULL OR p_quantity<=0 THEN PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID');END IF;SELECT c.carrito_id INTO o_cart_id FROM pliego.carrito c WHERE c.cliente_id=v_customer_id AND c.estado='ACTIVE' FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE');END IF;SELECT ci.edicion_id INTO v_ed FROM pliego.carrito_item ci WHERE ci.carrito_item_id=p_cart_item_id AND ci.carrito_id=o_cart_id;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4003','CART_ITEM_NOT_FOUND');END IF;SELECT i.stock_actual INTO v_stock FROM pliego.inventario i WHERE i.edicion_id=v_ed;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P3001','INVENTORY_NOT_FOUND');END IF;IF p_quantity>v_stock THEN PERFORM pliego.fn_raise_domain_error('P3002','INSUFFICIENT_STOCK');END IF;UPDATE pliego.carrito_item SET cantidad=p_quantity WHERE carrito_item_id=p_cart_item_id;o_cart_item_id:=p_cart_item_id;o_quantity:=p_quantity;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_cart_remove_item(IN p_actor_user_id BIGINT,IN p_cart_item_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_cart BIGINT;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER')a;SELECT c.carrito_id INTO v_cart FROM pliego.carrito c WHERE c.cliente_id=v_customer_id AND c.estado='ACTIVE' FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE');END IF;DELETE FROM pliego.carrito_item WHERE carrito_item_id=p_cart_item_id AND carrito_id=v_cart;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4003','CART_ITEM_NOT_FOUND');END IF;
END;$$;
