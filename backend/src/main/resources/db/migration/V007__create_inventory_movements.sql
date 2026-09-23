CREATE TABLE pliego.movimiento_inventario (
    movimiento_inventario_id BIGINT GENERATED ALWAYS AS IDENTITY,
    edicion_id BIGINT NOT NULL,
    pedido_id BIGINT,
    usuario_actor_id BIGINT,
    tipo VARCHAR(24) NOT NULL,
    cantidad INTEGER NOT NULL,
    stock_anterior INTEGER NOT NULL,
    stock_posterior INTEGER NOT NULL,
    motivo VARCHAR(500),
    fecha TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_movimiento_inventario PRIMARY KEY (movimiento_inventario_id),
    CONSTRAINT fk_movimiento_inventario_edicion FOREIGN KEY (edicion_id) REFERENCES pliego.inventario(edicion_id) ON DELETE RESTRICT,
    CONSTRAINT fk_movimiento_inventario_pedido FOREIGN KEY (pedido_id) REFERENCES pliego.pedido(pedido_id) ON DELETE RESTRICT,
    CONSTRAINT fk_movimiento_inventario_usuario FOREIGN KEY (usuario_actor_id) REFERENCES pliego.usuario(usuario_id) ON DELETE RESTRICT,
    CONSTRAINT ck_movimiento_inventario_tipo CHECK (tipo IN ('ENTRY','ADJUSTMENT_IN','ADJUSTMENT_OUT','SALE','CANCELLATION')),
    CONSTRAINT ck_movimiento_inventario_cantidad CHECK (cantidad>0),
    CONSTRAINT ck_movimiento_inventario_stocks CHECK (stock_anterior>=0 AND stock_posterior>=0),
    CONSTRAINT ck_movimiento_inventario_contexto CHECK (
        (tipo IN ('ENTRY','ADJUSTMENT_IN','ADJUSTMENT_OUT') AND pedido_id IS NULL AND usuario_actor_id IS NOT NULL AND motivo IS NOT NULL AND char_length(btrim(motivo))>0)
        OR
        (tipo IN ('SALE','CANCELLATION') AND pedido_id IS NOT NULL AND usuario_actor_id IS NULL)
    ),
    CONSTRAINT ck_movimiento_inventario_aritmetica CHECK (
        (tipo IN ('ENTRY','ADJUSTMENT_IN','CANCELLATION') AND stock_posterior=stock_anterior+cantidad)
        OR
        (tipo IN ('ADJUSTMENT_OUT','SALE') AND stock_posterior=stock_anterior-cantidad)
    )
);
