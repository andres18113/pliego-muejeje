BEGIN;
DO $gate$
DECLARE a BIGINT; u BIGINT; d BIGINT; customer BIGINT; author_id BIGINT; pub BIGINT; cat BIGINT; book BIGINT;
 edition BIGINT; ebook BIGINT; movement BIGINT; before_stock INTEGER; after_stock INTEGER; cart BIGINT; item BIGINT; qty INTEGER;
 state VARCHAR; w RECORD; today DATE; zone TEXT;
BEGIN
 -- Normal dates: the store's day through two days later.
 SELECT * INTO w FROM pliego.fn_delivery_window_at('2026-10-05T12:00:00-05');
 IF w.estimated_from<>DATE '2026-10-05' OR w.estimated_to<>DATE '2026-10-07' THEN RAISE EXCEPTION 'RED: normal delivery window incorrect: % - %',w.estimated_from,w.estimated_to; END IF;
 -- Month boundary.
 SELECT * INTO w FROM pliego.fn_delivery_window_at('2026-11-30T09:00:00-05');
 IF w.estimated_from<>DATE '2026-11-30' OR w.estimated_to<>DATE '2026-12-02' THEN RAISE EXCEPTION 'RED: month boundary incorrect: % - %',w.estimated_from,w.estimated_to; END IF;
 -- Year boundary.
 SELECT * INTO w FROM pliego.fn_delivery_window_at('2026-12-31T09:00:00-05');
 IF w.estimated_from<>DATE '2026-12-31' OR w.estimated_to<>DATE '2027-01-02' THEN RAISE EXCEPTION 'RED: year boundary incorrect: % - %',w.estimated_from,w.estimated_to; END IF;
 -- Leap day.
 SELECT * INTO w FROM pliego.fn_delivery_window_at('2028-02-28T09:00:00-05');
 IF w.estimated_from<>DATE '2028-02-28' OR w.estimated_to<>DATE '2028-03-01' THEN RAISE EXCEPTION 'RED: leap-year window incorrect: % - %',w.estimated_from,w.estimated_to; END IF;
 -- Time zone: the calendar day is Ecuador's (UTC-5), whatever zone the session or server uses.
 -- 03:30 UTC on 1 Jan 2027 is still 22:30 on 31 Dec 2026 in Guayaquil; 04:59:59 UTC is 23:59:59; 05:00 UTC is midnight.
 FOREACH zone IN ARRAY ARRAY['UTC','Asia/Tokyo','America/Los_Angeles','America/Guayaquil'] LOOP
  PERFORM set_config('TimeZone',zone,true);
  SELECT * INTO w FROM pliego.fn_delivery_window_at('2027-01-01T03:30:00Z');
  IF w.estimated_from<>DATE '2026-12-31' OR w.estimated_to<>DATE '2027-01-02' THEN RAISE EXCEPTION 'RED: window follows session zone % instead of Ecuador: % - %',zone,w.estimated_from,w.estimated_to; END IF;
  SELECT * INTO w FROM pliego.fn_delivery_window_at('2027-01-01T04:59:59Z');
  IF w.estimated_from<>DATE '2026-12-31' THEN RAISE EXCEPTION 'RED: last second of the Ecuador day moved in zone %',zone; END IF;
  SELECT * INTO w FROM pliego.fn_delivery_window_at('2027-01-01T05:00:00Z');
  IF w.estimated_from<>DATE '2027-01-01' OR w.estimated_to<>DATE '2027-01-03' THEN RAISE EXCEPTION 'RED: Ecuador midnight not honoured in zone %: % - %',zone,w.estimated_from,w.estimated_to; END IF;
 END LOOP;
 PERFORM set_config('TimeZone','Asia/Tokyo',true);
 today := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guayaquil')::DATE;

 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado) VALUES('window-gate-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
 CALL pliego.sp_author_create(a,'Autora de ventana',NULL,author_id);
 CALL pliego.sp_publisher_create(a,'Editorial de ventana',NULL,pub);
 CALL pliego.sp_category_create(a,'Ventana','window-gate',NULL,NULL,cat);
 CALL pliego.sp_book_create(a,'Libro de ventana',NULL,NULL,jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(cat),book);
 CALL pliego.sp_edition_create(a,book,pub,'WINDOW-GATE-P',NULL,'es','PAPERBACK',100,NULL,10.00,NULL,NULL,NULL,NULL,edition);
 CALL pliego.sp_inventory_entry(a,edition,5,'fixture',movement,before_stock,after_stock);
 CALL pliego.sp_edition_create(a,book,pub,'WINDOW-GATE-E',NULL,'es','EBOOK',NULL,NULL,6.00,NULL,NULL,NULL,NULL,ebook);
 CALL pliego.sp_customer_register('window-gate@example.invalid','fixture','Ana','Pérez',NULL,u,customer,state);
 CALL pliego.sp_customer_register('window-gate-digital@example.invalid','fixture','Luis','Mora',NULL,d,customer,state);

 -- No cart: one row, no window.
 SELECT * INTO w FROM pliego.fn_cart_delivery_window(u);
 IF NOT FOUND OR w.estimated_from IS NOT NULL OR w.estimated_to IS NOT NULL THEN RAISE EXCEPTION 'RED: empty cart must yield one row without a window'; END IF;
 -- A cart that ships: today in Ecuador through two days later, even from a session on the other side of the date line.
 CALL pliego.sp_cart_add_item(u,edition,1,cart,item,qty);
 SELECT * INTO w FROM pliego.fn_cart_delivery_window(u);
 IF w.estimated_from IS DISTINCT FROM today OR w.estimated_to IS DISTINCT FROM today+2 THEN RAISE EXCEPTION 'RED: physical cart window incorrect: % - % (Ecuador today %)',w.estimated_from,w.estimated_to,today; END IF;
 -- Mixed carts ship their physical part.
 CALL pliego.sp_cart_add_item(u,ebook,1,cart,item,qty);
 SELECT * INTO w FROM pliego.fn_cart_delivery_window(u);
 IF w.estimated_from IS DISTINCT FROM today OR w.estimated_to IS DISTINCT FROM today+2 THEN RAISE EXCEPTION 'RED: mixed cart lost its delivery window'; END IF;
 -- Digital-only carts have nothing to deliver.
 CALL pliego.sp_cart_add_item(d,ebook,1,cart,item,qty);
 SELECT * INTO w FROM pliego.fn_cart_delivery_window(d);
 IF w.estimated_from IS NOT NULL OR w.estimated_to IS NOT NULL THEN RAISE EXCEPTION 'RED: digital-only cart must not state a delivery window'; END IF;
END $gate$;
ROLLBACK;
