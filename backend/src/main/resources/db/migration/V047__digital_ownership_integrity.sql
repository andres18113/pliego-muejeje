-- Ownership identity and purchase snapshots are immutable; see ADR-0026.
CREATE FUNCTION pliego.fn_guard_digital_grant() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF TG_OP='UPDATE' AND (NEW.pedido_item_id IS DISTINCT FROM OLD.pedido_item_id OR
 NEW.owned_item_id IS DISTINCT FROM OLD.owned_item_id OR NEW.acquired_at IS DISTINCT FROM OLD.acquired_at OR
 NEW.metadata_snapshot IS DISTINCT FROM OLD.metadata_snapshot) THEN
 PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF NOT EXISTS(SELECT FROM pliego.digital_ownership o JOIN pliego.pedido_item i ON i.pedido_item_id=NEW.pedido_item_id
 JOIN pliego.pedido p USING(pedido_id) JOIN pliego.pago pa USING(pedido_id)
 WHERE o.owned_item_id=NEW.owned_item_id AND o.cliente_id=p.cliente_id AND o.edicion_id=i.edicion_id
 AND i.formato_snapshot IN('EBOOK','AUDIOBOOK') AND pa.estado IN('APPROVED','REFUNDED')
 AND (NEW.state='REVOKED' OR (pa.estado='APPROVED' AND p.estado<>'CANCELLED'))) THEN
 PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_digital_grant_guard BEFORE INSERT OR UPDATE OR DELETE ON pliego.digital_grant
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_digital_grant();
CREATE FUNCTION pliego.fn_guard_digital_ownership_identity() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); RETURN NULL;
END; $$;
CREATE TRIGGER trg_digital_ownership_identity BEFORE UPDATE OR DELETE ON pliego.digital_ownership
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_digital_ownership_identity();
