CREATE TABLE pliego.carrito (
    carrito_id BIGINT GENERATED ALWAYS AS IDENTITY,
    cliente_id BIGINT NOT NULL,
    estado VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_carrito PRIMARY KEY (carrito_id),
    CONSTRAINT fk_carrito_cliente FOREIGN KEY (cliente_id) REFERENCES pliego.cliente(cliente_id) ON DELETE RESTRICT,
    CONSTRAINT ck_carrito_estado CHECK (estado IN ('ACTIVE','CHECKED_OUT'))
);
CREATE TABLE pliego.carrito_item (
    carrito_item_id BIGINT GENERATED ALWAYS AS IDENTITY,
    carrito_id BIGINT NOT NULL,
    edicion_id BIGINT NOT NULL,
    cantidad INTEGER NOT NULL,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_carrito_item PRIMARY KEY (carrito_item_id),
    CONSTRAINT fk_carrito_item_carrito FOREIGN KEY (carrito_id) REFERENCES pliego.carrito(carrito_id) ON DELETE RESTRICT,
    CONSTRAINT fk_carrito_item_edicion FOREIGN KEY (edicion_id) REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT,
    CONSTRAINT uq_carrito_item_edicion UNIQUE (carrito_id,edicion_id),
    CONSTRAINT ck_carrito_item_cantidad CHECK (cantidad>0)
);
