-- PLIEGO V019 — 18 technical triggers.

CREATE TRIGGER trg_usuario_set_updated_at
BEFORE UPDATE ON pliego.usuario
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();

CREATE TRIGGER trg_cliente_set_updated_at
BEFORE UPDATE ON pliego.cliente
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();

CREATE TRIGGER trg_direccion_set_updated_at
BEFORE UPDATE ON pliego.direccion
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();

CREATE TRIGGER trg_autor_set_updated_at
BEFORE UPDATE ON pliego.autor
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();

CREATE TRIGGER trg_editorial_set_updated_at
BEFORE UPDATE ON pliego.editorial
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();

CREATE TRIGGER trg_categoria_set_updated_at
BEFORE UPDATE ON pliego.categoria
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();

CREATE TRIGGER trg_libro_set_updated_at
BEFORE UPDATE ON pliego.libro
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();

CREATE TRIGGER trg_edicion_set_updated_at
BEFORE UPDATE ON pliego.edicion
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();

CREATE TRIGGER trg_inventario_set_updated_at
BEFORE UPDATE ON pliego.inventario
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();

CREATE TRIGGER trg_carrito_set_updated_at
BEFORE UPDATE ON pliego.carrito
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();

CREATE TRIGGER trg_carrito_item_set_updated_at
BEFORE UPDATE ON pliego.carrito_item
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();

CREATE TRIGGER trg_pedido_set_updated_at
BEFORE UPDATE ON pliego.pedido
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();

CREATE TRIGGER trg_pago_set_updated_at
BEFORE UPDATE ON pliego.pago
FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();

CREATE TRIGGER trg_movimiento_inventario_append_only
BEFORE UPDATE OR DELETE ON pliego.movimiento_inventario
FOR EACH ROW EXECUTE FUNCTION pliego.fn_prevent_update_delete();

CREATE TRIGGER trg_pedido_item_append_only
BEFORE UPDATE OR DELETE ON pliego.pedido_item
FOR EACH ROW EXECUTE FUNCTION pliego.fn_prevent_update_delete();

CREATE TRIGGER trg_pedido_direccion_append_only
BEFORE UPDATE OR DELETE ON pliego.pedido_direccion
FOR EACH ROW EXECUTE FUNCTION pliego.fn_prevent_update_delete();

CREATE TRIGGER trg_pedido_estado_historial_append_only
BEFORE UPDATE OR DELETE ON pliego.pedido_estado_historial
FOR EACH ROW EXECUTE FUNCTION pliego.fn_prevent_update_delete();

CREATE TRIGGER trg_categoria_validate_hierarchy
BEFORE INSERT OR UPDATE OF categoria_padre_id ON pliego.categoria
FOR EACH ROW EXECUTE FUNCTION pliego.fn_validate_category_hierarchy();
