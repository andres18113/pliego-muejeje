CREATE TABLE pliego.pedido (
    pedido_id BIGINT GENERATED ALWAYS AS IDENTITY,
    cliente_id BIGINT NOT NULL,
    estado VARCHAR(32) NOT NULL,
    subtotal NUMERIC(30,2) NOT NULL,
    total NUMERIC(30,2) NOT NULL,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_pedido PRIMARY KEY (pedido_id),
    CONSTRAINT fk_pedido_cliente FOREIGN KEY (cliente_id) REFERENCES pliego.cliente(cliente_id) ON DELETE RESTRICT,
    CONSTRAINT ck_pedido_estado CHECK (estado IN ('PENDING_PAYMENT','CONFIRMED','PREPARING','SHIPPED','DELIVERED','CANCELLED')),
    CONSTRAINT ck_pedido_subtotal CHECK (subtotal>0),
    CONSTRAINT ck_pedido_total CHECK (total>0),
    CONSTRAINT ck_pedido_total_v1 CHECK (total=subtotal)
);
CREATE TABLE pliego.pedido_item (
    pedido_item_id BIGINT GENERATED ALWAYS AS IDENTITY,
    pedido_id BIGINT NOT NULL,
    edicion_id BIGINT NOT NULL,
    sku_snapshot VARCHAR(64) NOT NULL,
    isbn_snapshot CHAR(13),
    titulo_snapshot VARCHAR(300) NOT NULL,
    autores_snapshot VARCHAR(1000) NOT NULL,
    editorial_snapshot VARCHAR(200) NOT NULL,
    formato_snapshot VARCHAR(16) NOT NULL,
    idioma_snapshot VARCHAR(3) NOT NULL,
    precio_unitario NUMERIC(11,2) NOT NULL,
    cantidad INTEGER NOT NULL,
    subtotal NUMERIC(30,2) NOT NULL,
    CONSTRAINT pk_pedido_item PRIMARY KEY (pedido_item_id),
    CONSTRAINT fk_pedido_item_pedido FOREIGN KEY (pedido_id) REFERENCES pliego.pedido(pedido_id) ON DELETE RESTRICT,
    CONSTRAINT fk_pedido_item_edicion FOREIGN KEY (edicion_id) REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT,
    CONSTRAINT uq_pedido_item_edicion UNIQUE (pedido_id,edicion_id),
    CONSTRAINT ck_pedido_item_isbn CHECK (isbn_snapshot IS NULL OR isbn_snapshot ~ '^[0-9]{13}$'),
    CONSTRAINT ck_pedido_item_formato CHECK (formato_snapshot IN ('PAPERBACK','HARDCOVER')),
    CONSTRAINT ck_pedido_item_idioma CHECK (idioma_snapshot=lower(idioma_snapshot) AND idioma_snapshot ~ '^[a-z]{2,3}$'),
    CONSTRAINT ck_pedido_item_precio CHECK (precio_unitario>0),
    CONSTRAINT ck_pedido_item_cantidad CHECK (cantidad>0),
    CONSTRAINT ck_pedido_item_subtotal CHECK (subtotal>0 AND subtotal=precio_unitario*cantidad)
);
CREATE TABLE pliego.pedido_direccion (
    pedido_id BIGINT NOT NULL,
    destinatario VARCHAR(200) NOT NULL,
    direccion_linea1 VARCHAR(200) NOT NULL,
    direccion_linea2 VARCHAR(200),
    ciudad VARCHAR(100) NOT NULL,
    provincia VARCHAR(100) NOT NULL,
    pais_codigo CHAR(2) NOT NULL,
    codigo_postal VARCHAR(20),
    referencia VARCHAR(300),
    telefono VARCHAR(20) NOT NULL,
    CONSTRAINT pk_pedido_direccion PRIMARY KEY (pedido_id),
    CONSTRAINT fk_pedido_direccion_pedido FOREIGN KEY (pedido_id) REFERENCES pliego.pedido(pedido_id) ON DELETE RESTRICT,
    CONSTRAINT ck_pedido_direccion_pais_formato CHECK (pais_codigo ~ '^[A-Z]{2}$'),
    CONSTRAINT ck_pedido_direccion_telefono CHECK (telefono ~ '^\+?[0-9]{7,19}$')
);
CREATE TABLE pliego.pago (
    pago_id BIGINT GENERATED ALWAYS AS IDENTITY,
    pedido_id BIGINT NOT NULL,
    metodo VARCHAR(16) NOT NULL,
    estado VARCHAR(16) NOT NULL,
    monto NUMERIC(30,2) NOT NULL,
    referencia VARCHAR(100),
    detalle_resultado VARCHAR(500),
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_pago PRIMARY KEY (pago_id),
    CONSTRAINT uq_pago_pedido UNIQUE (pedido_id),
    CONSTRAINT uq_pago_referencia UNIQUE (referencia),
    CONSTRAINT fk_pago_pedido FOREIGN KEY (pedido_id) REFERENCES pliego.pedido(pedido_id) ON DELETE RESTRICT,
    CONSTRAINT ck_pago_metodo CHECK (metodo IN ('CARD','TRANSFER')),
    CONSTRAINT ck_pago_estado CHECK (estado IN ('PENDING','APPROVED','REJECTED','REFUNDED')),
    CONSTRAINT ck_pago_monto CHECK (monto>0),
    CONSTRAINT ck_pago_referencia_estado CHECK (
        (estado='PENDING' AND referencia IS NULL) OR
        (estado='APPROVED' AND referencia IS NOT NULL) OR
        (estado='REJECTED' AND referencia IS NULL) OR
        (estado='REFUNDED' AND referencia IS NOT NULL)
    )
);
CREATE TABLE pliego.pedido_estado_historial (
    pedido_estado_historial_id BIGINT GENERATED ALWAYS AS IDENTITY,
    pedido_id BIGINT NOT NULL,
    usuario_actor_id BIGINT,
    origen VARCHAR(16) NOT NULL,
    estado_anterior VARCHAR(32),
    estado_nuevo VARCHAR(32) NOT NULL,
    fecha TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_pedido_estado_historial PRIMARY KEY (pedido_estado_historial_id),
    CONSTRAINT fk_pedido_estado_historial_pedido FOREIGN KEY (pedido_id) REFERENCES pliego.pedido(pedido_id) ON DELETE RESTRICT,
    CONSTRAINT fk_pedido_estado_historial_usuario FOREIGN KEY (usuario_actor_id) REFERENCES pliego.usuario(usuario_id) ON DELETE RESTRICT,
    CONSTRAINT ck_pedido_historial_origen CHECK (origen IN ('USER','SYSTEM')),
    CONSTRAINT ck_pedido_historial_estado_anterior CHECK (estado_anterior IS NULL OR estado_anterior IN ('PENDING_PAYMENT','CONFIRMED','PREPARING','SHIPPED','DELIVERED','CANCELLED')),
    CONSTRAINT ck_pedido_historial_estado_nuevo CHECK (estado_nuevo IN ('PENDING_PAYMENT','CONFIRMED','PREPARING','SHIPPED','DELIVERED','CANCELLED')),
    CONSTRAINT ck_pedido_historial_actor CHECK ((origen='USER' AND usuario_actor_id IS NOT NULL) OR (origen='SYSTEM' AND usuario_actor_id IS NULL)),
    CONSTRAINT ck_pedido_historial_inicial CHECK (estado_anterior IS NOT NULL OR (estado_nuevo='PENDING_PAYMENT' AND origen='SYSTEM' AND usuario_actor_id IS NULL))
);
