-- PLIEGO V003 — Catalog
CREATE TABLE pliego.autor (
    autor_id BIGINT GENERATED ALWAYS AS IDENTITY,
    nombre VARCHAR(200) NOT NULL,
    biografia VARCHAR(5000),
    estado VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_autor PRIMARY KEY (autor_id),
    CONSTRAINT ck_autor_nombre CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 200),
    CONSTRAINT ck_autor_estado CHECK (estado IN ('ACTIVE','INACTIVE'))
);
CREATE TABLE pliego.editorial (
    editorial_id BIGINT GENERATED ALWAYS AS IDENTITY,
    nombre VARCHAR(200) NOT NULL,
    descripcion VARCHAR(2000),
    estado VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_editorial PRIMARY KEY (editorial_id),
    CONSTRAINT ck_editorial_nombre CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 200),
    CONSTRAINT ck_editorial_estado CHECK (estado IN ('ACTIVE','INACTIVE'))
);
CREATE TABLE pliego.categoria (
    categoria_id BIGINT GENERATED ALWAYS AS IDENTITY,
    categoria_padre_id BIGINT,
    nombre VARCHAR(120) NOT NULL,
    slug VARCHAR(140) NOT NULL,
    descripcion VARCHAR(1000),
    estado VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_categoria PRIMARY KEY (categoria_id),
    CONSTRAINT uq_categoria_slug UNIQUE (slug),
    CONSTRAINT fk_categoria_padre FOREIGN KEY (categoria_padre_id) REFERENCES pliego.categoria(categoria_id) ON DELETE RESTRICT,
    CONSTRAINT ck_categoria_nombre CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 120),
    CONSTRAINT ck_categoria_slug CHECK (char_length(slug) BETWEEN 1 AND 140 AND slug = lower(btrim(slug)) AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT ck_categoria_estado CHECK (estado IN ('ACTIVE','INACTIVE')),
    CONSTRAINT ck_categoria_no_self_parent CHECK (categoria_padre_id IS NULL OR categoria_padre_id <> categoria_id)
);
CREATE TABLE pliego.libro (
    libro_id BIGINT GENERATED ALWAYS AS IDENTITY,
    titulo VARCHAR(300) NOT NULL,
    subtitulo VARCHAR(300),
    sinopsis VARCHAR(10000),
    estado VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_libro PRIMARY KEY (libro_id),
    CONSTRAINT ck_libro_titulo CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 300),
    CONSTRAINT ck_libro_estado CHECK (estado IN ('ACTIVE','INACTIVE'))
);
CREATE TABLE pliego.libro_autor (
    libro_id BIGINT NOT NULL,
    autor_id BIGINT NOT NULL,
    orden_autoria INTEGER NOT NULL,
    CONSTRAINT pk_libro_autor PRIMARY KEY (libro_id,autor_id),
    CONSTRAINT fk_libro_autor_libro FOREIGN KEY (libro_id) REFERENCES pliego.libro(libro_id) ON DELETE RESTRICT,
    CONSTRAINT fk_libro_autor_autor FOREIGN KEY (autor_id) REFERENCES pliego.autor(autor_id) ON DELETE RESTRICT,
    CONSTRAINT ck_libro_autor_orden CHECK (orden_autoria > 0),
    CONSTRAINT uq_libro_autor_orden UNIQUE (libro_id,orden_autoria) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE pliego.libro_categoria (
    libro_id BIGINT NOT NULL,
    categoria_id BIGINT NOT NULL,
    CONSTRAINT pk_libro_categoria PRIMARY KEY (libro_id,categoria_id),
    CONSTRAINT fk_libro_categoria_libro FOREIGN KEY (libro_id) REFERENCES pliego.libro(libro_id) ON DELETE RESTRICT,
    CONSTRAINT fk_libro_categoria_categoria FOREIGN KEY (categoria_id) REFERENCES pliego.categoria(categoria_id) ON DELETE RESTRICT
);
CREATE TABLE pliego.edicion (
    edicion_id BIGINT GENERATED ALWAYS AS IDENTITY,
    libro_id BIGINT NOT NULL,
    editorial_id BIGINT NOT NULL,
    sku VARCHAR(64) NOT NULL,
    isbn13 CHAR(13),
    idioma VARCHAR(3) NOT NULL,
    formato VARCHAR(16) NOT NULL,
    numero_paginas INTEGER NOT NULL,
    fecha_publicacion DATE,
    precio NUMERIC(11,2) NOT NULL,
    portada_url VARCHAR(2048),
    portada_licencia VARCHAR(32),
    portada_fuente_url VARCHAR(2048),
    portada_atribucion VARCHAR(500),
    estado VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_edicion PRIMARY KEY (edicion_id),
    CONSTRAINT uq_edicion_sku UNIQUE (sku),
    CONSTRAINT uq_edicion_isbn UNIQUE (isbn13),
    CONSTRAINT fk_edicion_libro FOREIGN KEY (libro_id) REFERENCES pliego.libro(libro_id) ON DELETE RESTRICT,
    CONSTRAINT fk_edicion_editorial FOREIGN KEY (editorial_id) REFERENCES pliego.editorial(editorial_id) ON DELETE RESTRICT,
    CONSTRAINT ck_edicion_sku CHECK (sku=upper(btrim(sku)) AND char_length(sku) BETWEEN 1 AND 64 AND sku ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
    CONSTRAINT ck_edicion_isbn_formato CHECK (isbn13 IS NULL OR isbn13 ~ '^[0-9]{13}$'),
    CONSTRAINT ck_edicion_idioma CHECK (idioma=lower(idioma) AND idioma ~ '^[a-z]{2,3}$'),
    CONSTRAINT ck_edicion_formato CHECK (formato IN ('PAPERBACK','HARDCOVER')),
    CONSTRAINT ck_edicion_paginas CHECK (numero_paginas BETWEEN 1 AND 100000),
    CONSTRAINT ck_edicion_precio CHECK (precio>0 AND precio<=999999999.99),
    CONSTRAINT ck_edicion_estado CHECK (estado IN ('ACTIVE','INACTIVE')),
    CONSTRAINT ck_edicion_portada_licencia CHECK (portada_licencia IS NULL OR portada_licencia IN ('PUBLIC_DOMAIN','CC0','CC_BY','CC_BY_SA','OWNED')),
    CONSTRAINT ck_edicion_portada_coherencia CHECK (
        (portada_url IS NULL AND portada_licencia IS NULL AND portada_fuente_url IS NULL AND portada_atribucion IS NULL)
        OR
        (portada_url IS NOT NULL AND portada_licencia IS NOT NULL AND portada_fuente_url IS NOT NULL
         AND (portada_licencia NOT IN ('CC_BY','CC_BY_SA') OR (portada_atribucion IS NOT NULL AND char_length(btrim(portada_atribucion))>0)))
    )
);
