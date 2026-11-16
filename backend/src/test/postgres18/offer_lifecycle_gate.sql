-- Disposable PG18 regression gate. Fixtures, queue changes and events roll back.
\set ON_ERROR_STOP on
BEGIN;
DO $gate$
DECLARE
 admin BIGINT; buyer BIGINT; customer BIGINT; author_id BIGINT; publisher BIGINT;
 category BIGINT; book BIGINT; edition BIGINT; offer BIGINT; state VARCHAR;
 cart BIGINT; item BIGINT; quantity INTEGER; projection RECORD; quote RECORD;
 starts TIMESTAMPTZ:='2026-11-04 09:00:00-05'; ends TIMESTAMPTZ:='2026-11-05 00:00:00-05';
 at_time TIMESTAMPTZ; expected_price NUMERIC; zone TEXT; history JSONB; result JSONB;
 before_events BIGINT; due_at TIMESTAMPTZ; invalid_limit INTEGER; refresh JSONB;
 status_before JSONB; operational JSONB; invalid_scope RECORD;
 admin_connection UUID:=uuidv4(); customer_connection UUID:=uuidv4(); cursor_before BIGINT;
 connection UUID; stream JSONB; event JSONB;
BEGIN
 IF to_regprocedure('pliego.fn_edition_offer_at(bigint,timestamp with time zone)') IS NULL THEN
  RAISE EXCEPTION 'RED: offer pricing has no explicit half-open evaluation instant';
 END IF;
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('offer-lifecycle-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO admin;
 CALL pliego.sp_author_create(admin,'Autora ciclo de ofertas',NULL,author_id);
 CALL pliego.sp_publisher_create(admin,'Editorial ciclo de ofertas',NULL,publisher);
 CALL pliego.sp_category_create(admin,'Ciclo de ofertas','offer-lifecycle-gate',NULL,NULL,category);
 CALL pliego.sp_book_create(admin,'Libro ciclo de ofertas',NULL,NULL,
  jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(category),book);
 CALL pliego.sp_edition_create(admin,book,publisher,'OFFER-LIFECYCLE-GATE',NULL,'es','EBOOK',NULL,NULL,
  20.00,NULL,NULL,NULL,NULL,NULL,NULL,NULL,edition);
 CALL pliego.sp_customer_register('offer-lifecycle-customer@example.invalid','fixture','Ana','Pérez',NULL,buyer,customer,state);
 CALL pliego.sp_cart_add_item(buyer,edition,1,cart,item,quantity);

 -- A <= end predicate, a missing inclusive start, or a session-local calendar
 -- makes one of these independently specified prices/calendar values fail.
 CALL pliego.sp_edition_offer_set(admin,edition,15.00,starts,ends,'Oferta de prueba','Condiciones',offer);
 FOREACH zone IN ARRAY ARRAY['UTC','America/Guayaquil','Pacific/Auckland'] LOOP
  PERFORM set_config('TimeZone',zone,TRUE);
  FOR at_time,expected_price IN SELECT * FROM (VALUES
   (starts-INTERVAL '1 microsecond',20.00),(starts,15.00),
   (ends-INTERVAL '1 microsecond',15.00),(ends,20.00),
   (ends+INTERVAL '1 microsecond',20.00)) boundary(at_time,expected_price) LOOP
   SELECT * INTO projection FROM pliego.fn_edition_offer_at(edition,at_time);
   IF projection.price IS DISTINCT FROM expected_price OR projection.original_price IS DISTINCT FROM 20.00
    OR projection.discount_amount IS DISTINCT FROM (20.00-expected_price)
    OR (projection.offer_id IS NOT NULL) IS DISTINCT FROM (expected_price=15.00)
   THEN RAISE EXCEPTION 'Half-open offer boundary failed in % at %: %',zone,at_time,row_to_json(projection); END IF;
   IF expected_price=15.00 AND (projection.offer_id IS DISTINCT FROM offer
    OR projection.starts_at IS DISTINCT FROM starts OR projection.ends_at IS DISTINCT FROM ends
    OR projection.days_remaining IS DISTINCT FROM 1 OR projection.ending_soon IS DISTINCT FROM TRUE)
   THEN RAISE EXCEPTION 'Offer identity/calendar changed with session timezone %',zone; END IF;
  END LOOP;
 END LOOP;
 PERFORM set_config('TimeZone','UTC',TRUE);

 -- Expiry removes the offer from every ordinary read without a worker run.
 CALL pliego.sp_edition_offer_set(admin,edition,15.00,statement_timestamp()-INTERVAL '2 days',
  statement_timestamp()-INTERVAL '1 second',offer);
 SELECT * INTO projection FROM pliego.fn_edition_offer(edition);
 SELECT * INTO quote FROM pliego.fn_cart_offer_quote(buyer);
 IF projection.price IS DISTINCT FROM 20.00 OR projection.offer_id IS NOT NULL
  OR (SELECT price FROM pliego.fn_edition_detail(edition)) IS DISTINCT FROM 20.00
  OR (SELECT price FROM pliego.fn_catalog_search(NULL,NULL,NULL,'offer-lifecycle-gate',NULL,NULL,NULL,NULL,'PRICE_ASC',0,20)
      WHERE edition_id=edition) IS DISTINCT FROM 20.00
  OR EXISTS(SELECT FROM pliego.fn_catalog_search_offers(NULL,NULL,NULL,'offer-lifecycle-gate',NULL,NULL,NULL,NULL,NULL,'RELEVANCE',0,20)
      WHERE edition_id=edition)
  OR EXISTS(SELECT FROM jsonb_array_elements(pliego.fn_offers_filter_options()->'categories') f
      WHERE f->>'slug'='offer-lifecycle-gate' AND (f->>'count')::BIGINT>0)
  OR quote.current_subtotal IS DISTINCT FROM 20.00 OR quote.savings_total IS DISTINCT FROM 0.00
  OR (quote.items->0->>'currentPrice')::NUMERIC IS DISTINCT FROM 20.00
  OR (quote.items->0->>'lineSavings')::NUMERIC IS DISTINCT FROM 0.00
 THEN RAISE EXCEPTION 'Expired offer retained a public price, catalog facet or cart savings'; END IF;

 -- Reproduce a restart after BOTH boundaries were missed. A stale durable
 -- start marker must coalesce to one current-state hint, preserving history.
 UPDATE pliego.offer_transition SET next_transition_at=statement_timestamp()-INTERVAL '2 days' WHERE offer_id=offer;
 SELECT to_jsonb(o) INTO history FROM pliego.edicion_oferta o WHERE oferta_id=offer;
 SELECT count(*) INTO before_events FROM pliego.realtime_event
  WHERE event_name='catalog.offers.changed' AND resource_id=edition::TEXT;
 status_before:=pliego.fn_offer_lifecycle_status();
 IF NOT status_before ?& ARRAY['serverTime','lastAttemptAt','lastSuccessAt','lastFailureAt','lastFailureCode',
  'pendingCount','oldestPendingAt','successCount','failureCount','transitionCount','lagSeconds','nextTransitionAt']
  OR status_before->>'pendingCount' IS NULL OR status_before->>'lagSeconds' IS NULL
  OR status_before->>'successCount' IS NULL OR status_before->>'transitionCount' IS NULL
  OR (status_before->>'pendingCount')::BIGINT<1 OR (status_before->>'lagSeconds')::NUMERIC<172799
 THEN RAISE EXCEPTION 'Lifecycle status hid an overdue transition: %',status_before; END IF;
 result:=pliego.fn_offer_lifecycle_advance(1000);
 IF result->>'state' IS DISTINCT FROM 'OK' OR (result->>'transitionCount')::INTEGER<1
  OR result->>'maxLagSeconds' IS NULL OR (result->>'maxLagSeconds')::NUMERIC<172799
  OR (SELECT count(*) FROM pliego.realtime_event WHERE event_name='catalog.offers.changed' AND resource_id=edition::TEXT)<>before_events+1
  OR NOT EXISTS(SELECT FROM pliego.offer_transition WHERE offer_id=offer AND next_transition_at IS NULL)
  OR (SELECT to_jsonb(o) FROM pliego.edicion_oferta o WHERE oferta_id=offer) IS DISTINCT FROM history
 THEN RAISE EXCEPTION 'Missed boundaries did not converge once without rewriting offer history: %',result; END IF;
 operational:=pliego.fn_offer_lifecycle_status();
 IF (operational->>'successCount')::BIGINT IS DISTINCT FROM (status_before->>'successCount')::BIGINT+1
  OR (operational->>'transitionCount')::BIGINT IS DISTINCT FROM
    (status_before->>'transitionCount')::BIGINT+(result->>'transitionCount')::BIGINT
  OR (operational->>'lastTransitionCount')::INTEGER IS DISTINCT FROM (result->>'transitionCount')::INTEGER
  OR (operational->>'lastMaxLagSeconds')::NUMERIC IS DISTINCT FROM (result->>'maxLagSeconds')::NUMERIC
  OR operational->>'lastSuccessAt' IS NULL
 THEN RAISE EXCEPTION 'Lifecycle operational counters disagree with committed work: %',operational; END IF;
 result:=pliego.fn_offer_lifecycle_advance(1000);
 IF (SELECT count(*) FROM pliego.realtime_event WHERE event_name='catalog.offers.changed' AND resource_id=edition::TEXT)<>before_events+1
 THEN RAISE EXCEPTION 'Lifecycle rerun duplicated an observed expired transition'; END IF;

 -- A transaction failure after advancement rolls back queue and event together.
 due_at:=statement_timestamp()-INTERVAL '3 seconds';
 UPDATE pliego.offer_transition SET next_transition_at=due_at WHERE offer_id=offer;
 status_before:=pliego.fn_offer_lifecycle_status();
 BEGIN
  PERFORM pliego.fn_offer_lifecycle_advance(1000);
  RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='fixture rollback after real lifecycle advance';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL; END;
 IF (SELECT next_transition_at FROM pliego.offer_transition WHERE offer_id=offer) IS DISTINCT FROM due_at
  OR (SELECT count(*) FROM pliego.realtime_event WHERE event_name='catalog.offers.changed' AND resource_id=edition::TEXT)<>before_events+1
  OR pliego.fn_offer_lifecycle_status() IS DISTINCT FROM status_before
 THEN RAISE EXCEPTION 'Lifecycle failure committed queue observation or an event'; END IF;
 PERFORM pliego.fn_offer_lifecycle_advance(1000);
 IF (SELECT count(*) FROM pliego.realtime_event WHERE event_name='catalog.offers.changed' AND resource_id=edition::TEXT)<>before_events+2
 THEN RAISE EXCEPTION 'Rolled-back transition could not recover exactly once'; END IF;

 FOREACH invalid_limit IN ARRAY ARRAY[NULL,0,1001]::INTEGER[] LOOP
  BEGIN
   PERFORM pliego.fn_offer_lifecycle_advance(invalid_limit);
   RAISE EXCEPTION 'Invalid lifecycle batch limit accepted: %',invalid_limit;
  EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 END LOOP;
 -- Editing a scheduled offer must move the durable marker; clearing removes it.
 starts:=clock_timestamp()+INTERVAL '1 day'; ends:=starts+INTERVAL '1 day';
 CALL pliego.sp_edition_offer_set(admin,edition,15.00,starts,ends,offer);
 IF NOT EXISTS(SELECT FROM pliego.offer_transition WHERE offer_id=offer AND next_transition_at=starts)
 THEN RAISE EXCEPTION 'Scheduled edit did not persist its next start'; END IF;
 refresh:=pliego.fn_offer_refresh_clock();
 IF NOT refresh ?& ARRAY['serverTime','nextTransitionAt','revalidateAfterSeconds']
  OR refresh->>'serverTime' IS NULL OR (refresh->>'serverTime')::TIMESTAMPTZ>clock_timestamp()
  OR (refresh->>'serverTime')::TIMESTAMPTZ<statement_timestamp()
  OR (refresh->>'nextTransitionAt')::TIMESTAMPTZ>starts
  OR refresh->>'nextTransitionAt' IS NULL
  OR (refresh->>'revalidateAfterSeconds')::INTEGER IS DISTINCT FROM 60
 THEN RAISE EXCEPTION 'Offer refresh clock cannot bound a client revalidation: %',refresh; END IF;

 -- Public hints reach BOTH authenticated roles and contain only canonical ids.
 UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id=buyer;
 IF NOT pliego.fn_auth_session_create_checked(admin,repeat('7',64),clock_timestamp()+INTERVAL '1 day','fixture')
  OR NOT pliego.fn_auth_session_create_checked(buyer,repeat('8',64),clock_timestamp()+INTERVAL '1 day','fixture')
 THEN RAISE EXCEPTION 'Lifecycle stream sessions were not created'; END IF;
 IF pliego.fn_realtime_connect(repeat('7',64),admin_connection)->>'state'<>'CONNECTED'
  OR pliego.fn_realtime_connect(repeat('8',64),customer_connection)->>'state'<>'CONNECTED'
 THEN RAISE EXCEPTION 'Lifecycle streams could not connect'; END IF;
 PERFORM pliego.fn_realtime_publish(1000);
 SELECT head INTO cursor_before FROM pliego.realtime_cursor WHERE singleton;
 SELECT count(*) INTO before_events FROM pliego.realtime_event WHERE resource_id=edition::TEXT AND event_name='catalog.offers.changed';
 CALL pliego.sp_edition_offer_clear(admin,edition);
 IF (SELECT count(*) FROM pliego.realtime_event WHERE resource_id=edition::TEXT AND event_name='catalog.offers.changed')<>before_events+1
  OR EXISTS(SELECT FROM pliego.offer_transition WHERE offer_id=offer AND next_transition_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Clear did not invalidate catalog once and remove its transition'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.realtime_event WHERE event_name='catalog.offers.changed'
  AND resource_id=edition::TEXT AND resource_type='edition' AND public_scope AND user_id IS NULL AND NOT admin_scope)
 THEN RAISE EXCEPTION 'Offer hint is not publicly scoped to its canonical edition'; END IF;
 PERFORM pliego.fn_realtime_publish(1000);
 FOREACH connection IN ARRAY ARRAY[admin_connection,customer_connection] LOOP
  stream:=pliego.fn_realtime_read(connection,cursor_before);
  IF stream->>'state' IS DISTINCT FROM 'OPEN' OR (stream->>'resync')::BOOLEAN IS DISTINCT FROM FALSE
   OR jsonb_array_length(stream->'events') IS DISTINCT FROM 1
  THEN RAISE EXCEPTION 'Authenticated role did not receive exactly one public offer hint: %',stream; END IF;
  event:=stream->'events'->0;
  IF event->>'name' IS DISTINCT FROM 'catalog.offers.changed' OR event->>'resourceType' IS DISTINCT FROM 'edition'
   OR event->>'resourceId' IS DISTINCT FROM edition::TEXT
   OR event-ARRAY['id','name','resourceType','resourceId'] IS DISTINCT FROM '{}'::JSONB
  THEN RAISE EXCEPTION 'Public offer payload included noncanonical or private fields: %',event; END IF;
 END LOOP;
 FOR invalid_scope IN SELECT * FROM (VALUES
  (NULL::BIGINT,FALSE,'order.changed','order','1'),
  (NULL::BIGINT,FALSE,'catalog.offers.changed','order','1'),
  (NULL::BIGINT,FALSE,'catalog.offers.changed','edition','private@example.invalid'),
  (buyer,FALSE,'catalog.offers.changed','edition','1'),
  (NULL::BIGINT,TRUE,'catalog.offers.changed','edition','1')
 ) invalid(user_id,admin_scope,event_name,resource_type,resource_id) LOOP
  BEGIN
   INSERT INTO pliego.realtime_event(user_id,admin_scope,public_scope,event_name,resource_type,resource_id)
   VALUES(invalid_scope.user_id,invalid_scope.admin_scope,TRUE,invalid_scope.event_name,
    invalid_scope.resource_type,invalid_scope.resource_id);
   RAISE EXCEPTION 'Public offer scope accepted a private/invalid hint: %',row_to_json(invalid_scope);
  EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
END $gate$;
ROLLBACK;
SELECT 'PASS: offer half-open microseconds, session timezones, expiry reads, missed transitions, history, atomic rollback, refresh clock and public scoped hints';
