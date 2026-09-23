CREATE TABLE pliego.inventario (
    edicion_id BIGINT NOT NULL,
    stock_actual INTEGER NOT NULL DEFAULT 0,
    stock_minimo INTEGER NOT NULL DEFAULT 0,
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_inventario PRIMARY KEY (edicion_id),
    CONSTRAINT fk_inventario_edicion FOREIGN KEY (edicion_id) REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT,
    CONSTRAINT ck_inventario_stock_actual CHECK (stock_actual>=0),
    CONSTRAINT ck_inventario_stock_minimo CHECK (stock_minimo>=0)
);
