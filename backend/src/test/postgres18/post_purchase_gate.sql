-- Public commands against a disposable PostgreSQL 18 database. All fixtures roll back.
BEGIN;
DO $gate$
DECLARE
    a BIGINT; u BIGINT; c BIGINT; address_id BIGINT; author_id BIGINT; pub BIGINT;
    cat BIGINT; book BIGINT; edition BIGINT; digital BIGINT; movement BIGINT;
    before_stock INTEGER; after_stock INTEGER; cart BIGINT; item BIGINT; qty INTEGER;
    o BIGINT; delivered BIGINT; digital_order BIGINT; state VARCHAR; pay VARCHAR;
    total NUMERIC; ref VARCHAR; result_id BIGINT; previous VARCHAR; restored BIGINT;
    invoice_id BIGINT; note_id BIGINT; d RECORD; page RECORD;
    items_before JSONB; address_before JSONB; invoice_before JSONB;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
    VALUES ('post-purchase-gate@pliego.local','fixture-hash','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
    CALL pliego.sp_author_create(a,'Autor histórico',NULL,author_id);
    CALL pliego.sp_publisher_create(a,'Editorial histórica',NULL,pub);
    CALL pliego.sp_category_create(a,'Postcompra','post-purchase-gate',NULL,NULL,cat);
    CALL pliego.sp_book_create(a,'Libro histórico',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(cat),book);
    CALL pliego.sp_edition_create(a,book,pub,'POST-PURCHASE-GATE',NULL,
        'es','PAPERBACK',100,NULL,12.50,NULL,NULL,NULL,NULL,edition);
    CALL pliego.sp_inventory_entry(a,edition,10,'fixture',movement,before_stock,after_stock);
    CALL pliego.sp_customer_register('post-purchase-customer@pliego.local','fixture-hash',
        'Comprador','Original',NULL,u,c,state);
    CALL pliego.sp_address_create(u,'Casa','Destinatario original','Calle original',NULL,
        'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,address_id);
    CALL pliego.sp_cart_add_item(u,edition,2,cart,item,qty);
    CALL pliego.sp_checkout(u,address_id,'CARD','APPROVED',o,state,pay,total,ref);
    SELECT * INTO d FROM pliego.fn_customer_order_detail(u,o);
    IF to_jsonb(d)->>'purchase_state' IS DISTINCT FROM 'CONFIRMED'
        OR to_jsonb(d)->'shipment'->>'state' IS DISTINCT FROM 'PREPARING' THEN
        RAISE EXCEPTION 'RED: checkout must project independent purchase and shipment states';
    END IF;
    BEGIN
        CALL pliego.sp_order_change_status(a,o,'UNSUPPORTED',result_id,previous,state);
        RAISE EXCEPTION 'unsupported legacy state succeeded';
    EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
    BEGIN
        CALL pliego.sp_order_change_status(a,9223372036854775807,'UNSUPPORTED',result_id,previous,state);
        RAISE EXCEPTION 'legacy target validation lost precedence';
    EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
    items_before := d.items; address_before := d.address;
    CALL pliego.sp_customer_update(u,'Comprador','Modificado','+59325550999');
    CALL pliego.sp_address_update(u,address_id,'Casa nueva','Otro destinatario','Otra calle',NULL,
        'Cuenca','Azuay','EC',NULL,NULL,'+59325550999');
    UPDATE pliego.libro SET titulo='Título nuevo' WHERE libro_id=book;
    UPDATE pliego.edicion SET precio=99.00 WHERE edicion_id=edition;
    SELECT * INTO d FROM pliego.fn_customer_order_detail(u,o);
    IF d.items IS DISTINCT FROM items_before OR d.address IS DISTINCT FROM address_before THEN
        RAISE EXCEPTION 'profile/address/catalog edits changed purchased snapshots';
    END IF;
    IF d.available_actions->>'cancel' <> 'true' OR d.available_actions->>'changeShippingAddress' <> 'false' THEN
        RAISE EXCEPTION 'server-authoritative initial actions mismatch';
    END IF;
    CALL pliego.sp_invoice_issue(a,o,'COMMERCIAL-GATE-1','Comprador facturado','OTHER','fixture-identity',
        'invoice@example.invalid','Dirección fiscal',NULL,'Quito','Pichincha','EC',NULL,invoice_id);
    SELECT * INTO d FROM pliego.fn_customer_order_detail(u,o);
    invoice_before := d.invoice;
    IF d.invoice->>'state' <> 'ISSUED' OR d.invoice->>'buyerName' <> 'Comprador facturado'
       OR d.invoice->'billingAddress'->>'line1' <> 'Dirección fiscal'
       OR (d.invoice->>'total')::NUMERIC <> 28.75
       OR d.invoice->'items'->0->>'description' <> 'Libro histórico'
       OR (d.invoice->'items'->0->>'unitPrice')::NUMERIC <> 12.50
       OR (d.invoice->>'taxTotal')::NUMERIC <> 3.75 THEN
        RAISE EXCEPTION 'invoice did not preserve explicit issuance identity and purchased lines';
    END IF;
    CALL pliego.sp_customer_update(u,'Comprador','Después de emisión','+59325550111');
    CALL pliego.sp_address_update(u,address_id,'Otra casa','Cambio posterior','Tercera calle',NULL,
        'Guayaquil','Guayas','EC',NULL,NULL,'+59325550111');
    UPDATE pliego.libro SET titulo='Título después de emisión' WHERE libro_id=book;
    UPDATE pliego.edicion SET precio=88.00 WHERE edicion_id=edition;
    SELECT * INTO d FROM pliego.fn_customer_order_detail(u,o);
    IF d.invoice IS DISTINCT FROM invoice_before OR d.items IS DISTINCT FROM items_before
       OR d.address IS DISTINCT FROM address_before THEN
        RAISE EXCEPTION 'post-issuance profile/address/catalog edits changed historical data';
    END IF;
    BEGIN
        UPDATE pliego.factura SET comprador_nombre='Otro' WHERE factura_id=invoice_id;
        RAISE EXCEPTION 'issued invoice was mutable';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
    BEGIN
        DELETE FROM pliego.factura_direccion WHERE factura_id=invoice_id;
        RAISE EXCEPTION 'issued invoice address was deleted';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
    BEGIN
        INSERT INTO pliego.factura_item(factura_id,pedido_item_id,descripcion,cantidad,precio_unitario,subtotal,
            tratamiento_impuesto,impuesto_monto,total)
        SELECT invoice_id,pedido_item_id,'Additional line',1,1,1,'NOT_ASSESSED',0,1
        FROM pliego.pedido_item WHERE pedido_id=o LIMIT 1;
        RAISE EXCEPTION 'issued invoice gained an additional line';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
    BEGIN
        UPDATE pliego.factura_item SET descripcion='Otra' WHERE factura_id=invoice_id;
        RAISE EXCEPTION 'issued invoice line was mutable';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
    BEGIN
        CALL pliego.sp_credit_note_issue(a,o,'CN-BEFORE-REFUND','Cancelación',note_id);
        RAISE EXCEPTION 'credit note issued before refund';
    EXCEPTION WHEN SQLSTATE 'P5006' THEN NULL; END;
    CALL pliego.sp_order_cancel(u,o,result_id,previous,state,pay,restored);
    SELECT * INTO d FROM pliego.fn_customer_order_detail(u,o);
    IF d.purchase_state <> 'CANCELLED' OR d.payment->>'state' <> 'REFUNDED'
       OR d.shipment->>'state' <> 'CANCELLED' OR d.invoice IS DISTINCT FROM invoice_before
       OR d.available_actions->>'cancel' <> 'false' OR restored <> 2 THEN
        RAISE EXCEPTION 'cancellation did not preserve independent states and issued invoice';
    END IF;
    CALL pliego.sp_credit_note_issue(a,o,'COMMERCIAL-CN-1','Cancelación reembolsada',note_id);
    BEGIN
        UPDATE pliego.nota_credito SET motivo='Otro motivo' WHERE nota_credito_id=note_id;
        RAISE EXCEPTION 'issued credit note was mutable';
    EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
    SELECT * INTO d FROM pliego.fn_customer_order_detail(u,o);
    IF d.invoice IS DISTINCT FROM invoice_before OR jsonb_array_length(d.credit_notes) <> 1
       OR d.credit_notes->0->>'state' <> 'ISSUED'
       OR (d.credit_notes->0->>'total')::NUMERIC <> 28.75 THEN
        RAISE EXCEPTION 'credit note rewrote invoice or lost refunded total';
    END IF;
    BEGIN
        CALL pliego.sp_credit_note_issue(a,o,'COMMERCIAL-CN-2','Duplicado',note_id);
        RAISE EXCEPTION 'second full credit note succeeded';
    EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
    SELECT * INTO page FROM pliego.fn_customer_orders(u,0,20) WHERE order_id=o;
    IF page.purchase_state <> d.purchase_state OR page.payment_state <> d.payment->>'state'
       OR page.shipment_state <> d.shipment->>'state' OR page.invoice_state <> d.invoice->>'state'
       OR page.total <> d.total OR page.item_count <> 1 OR page.unit_count <> 2
       OR page.item_summary->0->>'title' <> 'Libro histórico' THEN
        RAISE EXCEPTION 'list/detail projections are inconsistent';
    END IF;
    -- Separate purchase remains confirmed through complete physical delivery.
    CALL pliego.sp_cart_add_item(u,edition,1,cart,item,qty);
    CALL pliego.sp_checkout(u,address_id,'TRANSFER','APPROVED',delivered,state,pay,total,ref);
    CALL pliego.sp_shipment_update_tracking(a,delivered,'Carrier fixture','TRACK-1','https://example.invalid/track/1',
        CURRENT_TIMESTAMP + INTERVAL '1 day',CURRENT_TIMESTAMP + INTERVAL '3 days');
    UPDATE pliego.envio SET fecha_confirmacion=fecha_confirmacion-INTERVAL '7 minutes',
        transito_desde=transito_desde-INTERVAL '7 minutes',reparto_desde=reparto_desde-INTERVAL '7 minutes',
        entrega_desde=entrega_desde-INTERVAL '7 minutes' WHERE pedido_id=delivered;
    CALL pliego.sp_home_delivery_reconcile(delivered);
    SELECT * INTO d FROM pliego.fn_customer_order_detail(u,delivered);
    IF d.purchase_state <> 'CONFIRMED' OR d.order_state <> 'CONFIRMED'
       OR d.shipment->>'state' <> 'DELIVERED' OR d.payment->>'state' <> 'APPROVED'
       OR d.shipment->>'trackingCode' <> 'TRACK-1'
       OR d.shipment->>'shippedAt' IS NULL OR d.shipment->>'outForDeliveryAt' IS NULL
       OR d.shipment->>'deliveredAt' IS NULL OR jsonb_array_length(d.shipment->'history') <> 5
       OR d.available_actions->>'cancel' <> 'false' THEN
        RAISE EXCEPTION 'delivered shipment lifecycle mismatch';
    END IF;
    BEGIN
        CALL pliego.sp_order_cancel(u,delivered,result_id,previous,state,pay,restored);
        RAISE EXCEPTION 'delivered order cancellation succeeded';
    EXCEPTION WHEN SQLSTATE 'P5003' THEN NULL; END;
    BEGIN
        CALL pliego.sp_shipment_transition(a,delivered,'PREPARING');
        RAISE EXCEPTION 'delivered shipment regressed';
    EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
    BEGIN
        CALL pliego.sp_shipment_update_tracking(a,delivered,'Other',NULL,NULL,NULL,NULL);
        RAISE EXCEPTION 'terminal shipment tracking changed';
    EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
    CALL pliego.sp_edition_create(a,book,pub,'POST-PURCHASE-DIGITAL',NULL,
        'es','EBOOK',NULL,NULL,10.00,NULL,NULL,NULL,NULL,NULL,NULL,ARRAY[]::TEXT[],digital);
    CALL pliego.sp_cart_add_item(u,digital,1,cart,item,qty);
    CALL pliego.sp_checkout(u,NULL,'CARD','APPROVED','DIGITAL_ONLY',NULL,digital_order,state,pay,total,ref);
    SELECT * INTO d FROM pliego.fn_customer_order_detail(u,digital_order);
    IF d.address IS NOT NULL OR d.fulfillment IS NOT NULL OR d.shipment IS NOT NULL THEN
        RAISE EXCEPTION 'digital-only purchase acquired a fake physical shipment';
    END IF;
END;
$gate$;
ROLLBACK;
