-- RQ-IDX01/03: V103's selected access paths are valid full B-tree prefixes.
-- Deferred absences are explicit review decisions in ADR-0057; a new unreviewed
-- absence fails this gate. No data, schemas, routines, or indexes are changed.
BEGIN;
DO $gate$
DECLARE missing text[]; candidate text;
BEGIN
  FOREACH candidate IN ARRAY ARRAY['digital_ownership_edicion_id_fkey','fk_sesion_autenticacion_usuario'] LOOP
    IF NOT EXISTS (
      SELECT FROM pg_constraint c JOIN pg_index i ON i.indrelid=c.conrelid
      JOIN pg_class ix ON ix.oid=i.indexrelid JOIN pg_am am ON am.oid=ix.relam
      WHERE c.connamespace='pliego'::regnamespace AND c.conname=candidate
        AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL
        AND am.amname='btree' AND i.indnkeyatts>=cardinality(c.conkey)
        AND (i.indkey::smallint[])[0:cardinality(c.conkey)-1]=c.conkey
    ) THEN RAISE EXCEPTION 'Missing unconditional valid FK prefix: %',candidate; END IF;
  END LOOP;
  SELECT array_agg(c.conname ORDER BY c.conname) INTO missing
  FROM pg_constraint c WHERE c.connamespace='pliego'::regnamespace AND c.contype='f'
    AND NOT EXISTS (
      SELECT FROM pg_index i JOIN pg_class ix ON ix.oid=i.indexrelid JOIN pg_am am ON am.oid=ix.relam
      WHERE i.indrelid=c.conrelid AND i.indisvalid AND i.indisready AND i.indislive
        AND am.amname='btree' AND i.indnkeyatts>=cardinality(c.conkey)
        AND (i.indkey::smallint[])[0:cardinality(c.conkey)-1]=c.conkey)
    AND c.conname NOT IN (
      'ayuda_articulo_categoria_id_fkey','checkout_attempt_order_id_fkey',
      'fk_cliente_favorito_edicion','cliente_identificacion_solicitud_correccion_decidido_por_fkey',
      'envio_historial_usuario_actor_id_fkey','factura_usuario_emisor_id_fkey',
      'factura_item_pedido_item_id_fkey','fk_movimiento_inventario_usuario',
      'nota_credito_usuario_emisor_id_fkey','fk_pedido_estado_historial_usuario',
      'pedido_retiro_ubicacion_retiro_id_fkey');
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Unreviewed FK index absence: %',missing; END IF;
END $gate$;
ROLLBACK;
\echo FK prefix review and selected V103 index gate passed.
