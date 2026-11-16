-- Read-only source audit. Execute with psql -X -v ON_ERROR_STOP=1 -f <this file>.
-- No reconciliation, writes, deletion or refunds. One row per ACTIVE source.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH duplicate_identities AS (
    SELECT o.cliente_id, o.edicion_id, o.owned_item_id, count(*) AS active_source_count
    FROM pliego.digital_ownership AS o
    JOIN pliego.digital_grant AS g USING (owned_item_id)
    WHERE g.state = 'ACTIVE'
    GROUP BY o.cliente_id, o.edicion_id, o.owned_item_id
    HAVING count(*) > 1
)
SELECT d.cliente_id AS customer_id,
       c.usuario_id AS customer_user_id,
       d.edicion_id AS edition_id,
       e.sku AS edition_sku,
       d.owned_item_id,
       d.active_source_count,
       g.pedido_item_id AS source_order_item_id,
       i.titulo_snapshot AS purchased_title,
       i.formato_snapshot AS purchased_format,
       p.pedido_id AS source_order_id,
       p.estado AS order_state,
       p.fecha_creacion AS ordered_at,
       p.cancelacion_hasta AS cancellation_deadline,
       p.finalizado_en AS finalized_at,
       pa.pago_id AS source_payment_id,
       pa.metodo AS payment_method,
       pa.estado AS payment_state,
       pa.referencia AS payment_reference,
       pa.monto AS whole_order_payment_amount,
       pa.fecha_creacion AS payment_created_at,
       pa.fecha_aprobacion AS payment_approved_at,
       i.cantidad AS digital_quantity,
       i.precio_unitario AS digital_unit_price,
       i.subtotal AS digital_line_subtotal,
       i.impuesto_monto AS digital_line_tax,
       i.subtotal + i.impuesto_monto AS digital_line_total,
       p.total AS whole_order_total,
       g.acquired_at AS acquired_at,
       g.state AS grant_state
FROM duplicate_identities AS d
JOIN pliego.cliente AS c ON c.cliente_id = d.cliente_id
JOIN pliego.edicion AS e ON e.edicion_id = d.edicion_id
JOIN pliego.digital_grant AS g ON g.owned_item_id = d.owned_item_id AND g.state = 'ACTIVE'
JOIN pliego.pedido_item AS i ON i.pedido_item_id = g.pedido_item_id
JOIN pliego.pedido AS p ON p.pedido_id = i.pedido_id
JOIN pliego.pago AS pa ON pa.pedido_id = p.pedido_id
ORDER BY d.cliente_id, d.edicion_id, d.owned_item_id, g.acquired_at, p.pedido_id, g.pedido_item_id;
COMMIT;
