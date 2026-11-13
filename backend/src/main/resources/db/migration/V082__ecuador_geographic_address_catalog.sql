-- V082: INEC geographic reference data, evidence-backed aliases and catalog-backed editable address inputs (ADR-0044).
-- Official source: https://aplicaciones2.ecuadorencifras.gob.ec/SIN/descargas/cge2026.xls
-- Clasificador Geográfico Estadístico 2026, sheet DPA 2025, updated through 2025-12-31.
-- Source SHA-256: 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e
-- Cross-check PDF: https://aplicaciones2.ecuadorencifras.gob.ec/SIN/descargas/cge2026.pdf
-- PDF SHA-256: d77a2216ad976d84dfa1a9ce0d42abbaea47f9d11ef3897f40eea05b80f3dfe5
-- Source counts: 24 provinces, 223 canton-seat rows and 948 rural-parish rows (1171 localities, 1048 active).
-- Starred (*) jurisdictions seed inactive. The sheet places several code/name groups side by side on one row,
-- and a seat row may omit the words "CABECERA CANTONAL" (1413 Sevilla Don Bosco): both forms are included.
-- 278 province-scoped aliases map other INEC names (urban parishes, starred former names) to one active locality.
-- Names may repeat; city selection is disambiguated by canton name. DPA codes, not names, are unique.

CREATE TABLE pliego.provincia (
    provincia_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo_dpa CHAR(2) NOT NULL UNIQUE CHECK (codigo_dpa ~ '^[0-9]{2}$'),
    nombre VARCHAR(100) NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 100),
    search_key TEXT GENERATED ALWAYS AS (pliego.fn_search_fold(nombre)) STORED,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE pliego.provincia IS 'Read-only INEC Clasificador Geográfico Estadístico 2026 province reference data; updated 2025-12-31.';
COMMENT ON COLUMN pliego.provincia.search_key IS 'Accent/case folded with pliego.fn_search_fold for legacy matching.';

INSERT INTO pliego.provincia (provincia_id,codigo_dpa,nombre,activo) OVERRIDING SYSTEM VALUE VALUES
    (1,'01','Azuay',TRUE),
    (2,'02','Bolívar',TRUE),
    (3,'03','Cañar',TRUE),
    (4,'04','Carchi',TRUE),
    (5,'05','Cotopaxi',TRUE),
    (6,'06','Chimborazo',TRUE),
    (7,'07','El Oro',TRUE),
    (8,'08','Esmeraldas',TRUE),
    (9,'09','Guayas',TRUE),
    (10,'10','Imbabura',TRUE),
    (11,'11','Loja',TRUE),
    (12,'12','Los Ríos',TRUE),
    (13,'13','Manabí',TRUE),
    (14,'14','Morona Santiago',TRUE),
    (15,'15','Napo',TRUE),
    (16,'16','Pastaza',TRUE),
    (17,'17','Pichincha',TRUE),
    (18,'18','Tungurahua',TRUE),
    (19,'19','Zamora Chinchipe',TRUE),
    (20,'20','Galápagos',TRUE),
    (21,'21','Sucumbíos',TRUE),
    (22,'22','Orellana',TRUE),
    (23,'23','Santo Domingo de los Tsáchilas',TRUE),
    (24,'24','Santa Elena',TRUE);
SELECT setval(pg_get_serial_sequence('pliego.provincia','provincia_id'),(SELECT max(provincia_id) FROM pliego.provincia),TRUE);

CREATE TABLE pliego.ciudad (
    ciudad_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provincia_id BIGINT NOT NULL REFERENCES pliego.provincia(provincia_id) ON DELETE RESTRICT,
    codigo_dpa VARCHAR(6) NOT NULL CHECK (codigo_dpa ~ '^[0-9]{4}([0-9]{2})?$'),
    nombre VARCHAR(100) NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 100),
    tipo VARCHAR(24) NOT NULL CHECK (tipo IN ('CABECERA_CANTONAL','PARROQUIA_RURAL')),
    canton_nombre VARCHAR(100) NOT NULL CHECK (char_length(btrim(canton_nombre)) BETWEEN 1 AND 100),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    search_key TEXT GENERATED ALWAYS AS (pliego.fn_search_fold(nombre)) STORED,
    CONSTRAINT ck_ciudad_dpa_kind CHECK ((tipo='CABECERA_CANTONAL' AND char_length(codigo_dpa)=4) OR (tipo='PARROQUIA_RURAL' AND char_length(codigo_dpa)=6)),
    CONSTRAINT uq_ciudad_provincia_dpa UNIQUE (provincia_id,codigo_dpa),
    CONSTRAINT uq_ciudad_provincia_id UNIQUE (provincia_id,ciudad_id)
);
CREATE INDEX ix_ciudad_active_province_name ON pliego.ciudad (provincia_id,search_key,canton_nombre,codigo_dpa) WHERE activo;
COMMENT ON TABLE pliego.ciudad IS 'INEC selectable canton seats and rural-parish entries; starred changed jurisdictions are inactive.';
COMMENT ON COLUMN pliego.ciudad.canton_nombre IS 'Disambiguates locality names that repeat within or across provinces.';
COMMENT ON COLUMN pliego.ciudad.search_key IS 'Accent/case folded with pliego.fn_search_fold for legacy matching.';

INSERT INTO pliego.ciudad (ciudad_id,provincia_id,codigo_dpa,nombre,tipo,canton_nombre,activo) OVERRIDING SYSTEM VALUE VALUES
    (1,1,'0101','Cuenca','CABECERA_CANTONAL','Cuenca',TRUE),
    (2,1,'010151','Baños','PARROQUIA_RURAL','Cuenca',TRUE),
    (3,1,'010152','Cumbe','PARROQUIA_RURAL','Cuenca',TRUE),
    (4,1,'010153','Chaucha','PARROQUIA_RURAL','Cuenca',TRUE),
    (5,1,'010154','Checa','PARROQUIA_RURAL','Cuenca',TRUE),
    (6,1,'010155','Chiquintad','PARROQUIA_RURAL','Cuenca',TRUE),
    (7,1,'010156','Llacao','PARROQUIA_RURAL','Cuenca',TRUE),
    (8,1,'010157','Molleturo','PARROQUIA_RURAL','Cuenca',TRUE),
    (9,1,'010158','Nulti','PARROQUIA_RURAL','Cuenca',TRUE),
    (10,1,'010159','Octavio Cordero Palacios','PARROQUIA_RURAL','Cuenca',TRUE),
    (11,1,'010160','Paccha','PARROQUIA_RURAL','Cuenca',TRUE),
    (12,1,'010161','Quingeo','PARROQUIA_RURAL','Cuenca',TRUE),
    (13,1,'010162','Ricaurte','PARROQUIA_RURAL','Cuenca',TRUE),
    (14,1,'010163','San Joaquín','PARROQUIA_RURAL','Cuenca',TRUE),
    (15,1,'010164','Santa Ana','PARROQUIA_RURAL','Cuenca',TRUE),
    (16,1,'010165','Sayausí','PARROQUIA_RURAL','Cuenca',TRUE),
    (17,1,'010166','Sidcay','PARROQUIA_RURAL','Cuenca',TRUE),
    (18,1,'010167','Sinincay','PARROQUIA_RURAL','Cuenca',TRUE),
    (19,1,'010168','Tarqui','PARROQUIA_RURAL','Cuenca',TRUE),
    (20,1,'010169','Turi','PARROQUIA_RURAL','Cuenca',TRUE),
    (21,1,'010170','Valle','PARROQUIA_RURAL','Cuenca',TRUE),
    (22,1,'010171','Victoria del Portete','PARROQUIA_RURAL','Cuenca',TRUE),
    (23,1,'0102','Girón','CABECERA_CANTONAL','Girón',TRUE),
    (24,1,'010251','La Asunción','PARROQUIA_RURAL','Girón',TRUE),
    (25,1,'010252','San Gerardo','PARROQUIA_RURAL','Girón',TRUE),
    (26,1,'0103','Gualaceo','CABECERA_CANTONAL','Gualaceo',TRUE),
    (27,1,'010351','Chordeleg','PARROQUIA_RURAL','Gualaceo',FALSE),
    (28,1,'010352','Daniel Córdova Toral','PARROQUIA_RURAL','Gualaceo',TRUE),
    (29,1,'010353','Jadán','PARROQUIA_RURAL','Gualaceo',TRUE),
    (30,1,'010354','Mariano Moreno','PARROQUIA_RURAL','Gualaceo',TRUE),
    (31,1,'010355','Principal','PARROQUIA_RURAL','Gualaceo',FALSE),
    (32,1,'010356','Remigio Crespo Toral','PARROQUIA_RURAL','Gualaceo',TRUE),
    (33,1,'010357','San Juan','PARROQUIA_RURAL','Gualaceo',TRUE),
    (34,1,'010358','Zhidmad','PARROQUIA_RURAL','Gualaceo',TRUE),
    (35,1,'010359','Luis Cordero Vega','PARROQUIA_RURAL','Gualaceo',TRUE),
    (36,1,'010360','Simón Bolívar','PARROQUIA_RURAL','Gualaceo',TRUE),
    (37,1,'0104','Nabón','CABECERA_CANTONAL','Nabón',TRUE),
    (38,1,'010451','Cochapata','PARROQUIA_RURAL','Nabón',TRUE),
    (39,1,'010452','El Progreso','PARROQUIA_RURAL','Nabón',TRUE),
    (40,1,'010453','Las Nieves','PARROQUIA_RURAL','Nabón',TRUE),
    (41,1,'010454','Oña','PARROQUIA_RURAL','Nabón',FALSE),
    (42,1,'010455','La Paz','PARROQUIA_RURAL','Nabón',FALSE),
    (43,1,'0105','Paute','CABECERA_CANTONAL','Paute',TRUE),
    (44,1,'010551','Amaluza','PARROQUIA_RURAL','Paute',FALSE),
    (45,1,'010552','Bulán','PARROQUIA_RURAL','Paute',TRUE),
    (46,1,'010553','Chicán','PARROQUIA_RURAL','Paute',TRUE),
    (47,1,'010554','El Cabo','PARROQUIA_RURAL','Paute',TRUE),
    (48,1,'010555','Guachapala','PARROQUIA_RURAL','Paute',FALSE),
    (49,1,'010556','Guarainag','PARROQUIA_RURAL','Paute',TRUE),
    (50,1,'010557','Palmas','PARROQUIA_RURAL','Paute',FALSE),
    (51,1,'010558','Pan','PARROQUIA_RURAL','Paute',FALSE),
    (52,1,'010559','San Cristóbal','PARROQUIA_RURAL','Paute',TRUE),
    (53,1,'010560','Sevilla de Oro','PARROQUIA_RURAL','Paute',FALSE),
    (54,1,'010561','Tomebamba','PARROQUIA_RURAL','Paute',TRUE),
    (55,1,'010562','Dug Dug','PARROQUIA_RURAL','Paute',TRUE),
    (56,1,'0106','Pucará','CABECERA_CANTONAL','Pucara',TRUE),
    (57,1,'010651','Camilo Ponce Enríquez','PARROQUIA_RURAL','Pucara',FALSE),
    (58,1,'010652','San Rafael de Sharug','PARROQUIA_RURAL','Pucara',TRUE),
    (59,1,'0107','San Fernando','CABECERA_CANTONAL','San Fernando',TRUE),
    (60,1,'010751','Chumblín','PARROQUIA_RURAL','San Fernando',TRUE),
    (61,1,'0108','Santa Isabel','CABECERA_CANTONAL','Santa Isabel',TRUE),
    (62,1,'010851','Abdón Calderón','PARROQUIA_RURAL','Santa Isabel',TRUE),
    (63,1,'010852','El Carmen de Pijilí','PARROQUIA_RURAL','Santa Isabel',TRUE),
    (64,1,'010853','Shaglli','PARROQUIA_RURAL','Santa Isabel',TRUE),
    (65,1,'010854','San Salvador de Cañaribamba','PARROQUIA_RURAL','Santa Isabel',TRUE),
    (66,1,'0109','Sígsig','CABECERA_CANTONAL','Sígsig',TRUE),
    (67,1,'010951','Cuchil','PARROQUIA_RURAL','Sígsig',TRUE),
    (68,1,'010952','Jima','PARROQUIA_RURAL','Sígsig',TRUE),
    (69,1,'010953','Güel','PARROQUIA_RURAL','Sígsig',TRUE),
    (70,1,'010954','Ludo','PARROQUIA_RURAL','Sígsig',TRUE),
    (71,1,'010955','San Bartolomé','PARROQUIA_RURAL','Sígsig',TRUE),
    (72,1,'010956','San José de Raranga','PARROQUIA_RURAL','Sígsig',TRUE),
    (73,1,'0110','San Felipe de Oña','CABECERA_CANTONAL','Oña',TRUE),
    (74,1,'011051','Susudel','PARROQUIA_RURAL','Oña',TRUE),
    (75,1,'0111','Chordeleg','CABECERA_CANTONAL','Chordeleg',TRUE),
    (76,1,'011151','Principal','PARROQUIA_RURAL','Chordeleg',TRUE),
    (77,1,'011152','La Unión','PARROQUIA_RURAL','Chordeleg',TRUE),
    (78,1,'011153','Luis Galarza Orellana','PARROQUIA_RURAL','Chordeleg',TRUE),
    (79,1,'011154','San Martín de Puzhio','PARROQUIA_RURAL','Chordeleg',TRUE),
    (80,1,'0112','El Pan','CABECERA_CANTONAL','El Pan',TRUE),
    (81,1,'011251','Amaluza','PARROQUIA_RURAL','El Pan',FALSE),
    (82,1,'011252','Palmas','PARROQUIA_RURAL','El Pan',FALSE),
    (83,1,'011253','San Vicente','PARROQUIA_RURAL','El Pan',TRUE),
    (84,1,'0113','Sevilla de Oro','CABECERA_CANTONAL','Sevilla de Oro',TRUE),
    (85,1,'011351','Amaluza','PARROQUIA_RURAL','Sevilla de Oro',TRUE),
    (86,1,'011352','Palmas','PARROQUIA_RURAL','Sevilla de Oro',TRUE),
    (87,1,'0114','Guachapala','CABECERA_CANTONAL','Guachapala',TRUE),
    (88,1,'0115','Camilo Ponce Enríquez','CABECERA_CANTONAL','Camilo Ponce Enríquez',TRUE),
    (89,1,'011551','El Carmen de Pijilí','PARROQUIA_RURAL','Camilo Ponce Enríquez',FALSE),
    (90,2,'0201','Guaranda','CABECERA_CANTONAL','Guaranda',TRUE),
    (91,2,'020151','Facundo Vela','PARROQUIA_RURAL','Guaranda',TRUE),
    (92,2,'020152','Guanujo','PARROQUIA_RURAL','Guaranda',FALSE),
    (93,2,'020153','Julio E. Moreno','PARROQUIA_RURAL','Guaranda',TRUE),
    (94,2,'020154','Las Naves','PARROQUIA_RURAL','Guaranda',FALSE),
    (95,2,'020155','Salinas','PARROQUIA_RURAL','Guaranda',TRUE),
    (96,2,'020156','San Lorenzo','PARROQUIA_RURAL','Guaranda',TRUE),
    (97,2,'020157','San Simón','PARROQUIA_RURAL','Guaranda',TRUE),
    (98,2,'020158','Santa Fe','PARROQUIA_RURAL','Guaranda',TRUE),
    (99,2,'020159','Simiátug','PARROQUIA_RURAL','Guaranda',TRUE),
    (100,2,'020160','San Luis de Pambil','PARROQUIA_RURAL','Guaranda',TRUE),
    (101,2,'0202','Chillanes','CABECERA_CANTONAL','Chillanes',TRUE),
    (102,2,'020251','San José del Tambo','PARROQUIA_RURAL','Chillanes',TRUE),
    (103,2,'0203','San José de Chimbo','CABECERA_CANTONAL','Chimbo',TRUE),
    (104,2,'020351','Asunción','PARROQUIA_RURAL','Chimbo',TRUE),
    (105,2,'020352','Caluma','PARROQUIA_RURAL','Chimbo',FALSE),
    (106,2,'020353','La Magdalena','PARROQUIA_RURAL','Chimbo',TRUE),
    (107,2,'020354','San Sebastián','PARROQUIA_RURAL','Chimbo',TRUE),
    (108,2,'020355','Telimbela','PARROQUIA_RURAL','Chimbo',TRUE),
    (109,2,'0204','Echeandía','CABECERA_CANTONAL','Echeandía',TRUE),
    (110,2,'0205','San Miguel','CABECERA_CANTONAL','San Miguel',TRUE),
    (111,2,'020551','Balsapamba','PARROQUIA_RURAL','San Miguel',TRUE),
    (112,2,'020552','Bilován','PARROQUIA_RURAL','San Miguel',TRUE),
    (113,2,'020553','Régulo de Mora','PARROQUIA_RURAL','San Miguel',TRUE),
    (114,2,'020554','San Pablo','PARROQUIA_RURAL','San Miguel',TRUE),
    (115,2,'020555','Santiago','PARROQUIA_RURAL','San Miguel',TRUE),
    (116,2,'020556','San Vicente','PARROQUIA_RURAL','San Miguel',TRUE),
    (117,2,'0206','Caluma','CABECERA_CANTONAL','Caluma',TRUE),
    (118,2,'0207','Las Naves','CABECERA_CANTONAL','Las Naves',TRUE),
    (119,3,'0301','Azogues','CABECERA_CANTONAL','Azogues',TRUE),
    (120,3,'030151','Cojitambo','PARROQUIA_RURAL','Azogues',TRUE),
    (121,3,'030152','Déleg','PARROQUIA_RURAL','Azogues',FALSE),
    (122,3,'030153','Guapán','PARROQUIA_RURAL','Azogues',TRUE),
    (123,3,'030154','Javier Loyola','PARROQUIA_RURAL','Azogues',TRUE),
    (124,3,'030155','Luis Cordero','PARROQUIA_RURAL','Azogues',TRUE),
    (125,3,'030156','Pindilig','PARROQUIA_RURAL','Azogues',TRUE),
    (126,3,'030157','Rivera','PARROQUIA_RURAL','Azogues',TRUE),
    (127,3,'030158','San Miguel','PARROQUIA_RURAL','Azogues',TRUE),
    (128,3,'030159','Solano','PARROQUIA_RURAL','Azogues',FALSE),
    (129,3,'030160','Taday','PARROQUIA_RURAL','Azogues',TRUE),
    (130,3,'0302','Biblián','CABECERA_CANTONAL','Biblián',TRUE),
    (131,3,'030251','Nazón','PARROQUIA_RURAL','Biblián',TRUE),
    (132,3,'030252','San Francisco de Sageo','PARROQUIA_RURAL','Biblián',TRUE),
    (133,3,'030253','Turupamba','PARROQUIA_RURAL','Biblián',TRUE),
    (134,3,'030254','Jerusalén','PARROQUIA_RURAL','Biblián',TRUE),
    (135,3,'0303','Cañar','CABECERA_CANTONAL','Cañar',TRUE),
    (136,3,'030351','Chontamarca','PARROQUIA_RURAL','Cañar',TRUE),
    (137,3,'030352','Chorocopte','PARROQUIA_RURAL','Cañar',TRUE),
    (138,3,'030353','General Morales','PARROQUIA_RURAL','Cañar',TRUE),
    (139,3,'030354','Gualleturo','PARROQUIA_RURAL','Cañar',TRUE),
    (140,3,'030355','Honorato Vásquez','PARROQUIA_RURAL','Cañar',TRUE),
    (141,3,'030356','Ingapirca','PARROQUIA_RURAL','Cañar',TRUE),
    (142,3,'030357','Juncal','PARROQUIA_RURAL','Cañar',TRUE),
    (143,3,'030358','San Antonio','PARROQUIA_RURAL','Cañar',TRUE),
    (144,3,'030359','Suscal','PARROQUIA_RURAL','Cañar',FALSE),
    (145,3,'030360','Tambo','PARROQUIA_RURAL','Cañar',FALSE),
    (146,3,'030361','Zhud','PARROQUIA_RURAL','Cañar',TRUE),
    (147,3,'030362','Ventura','PARROQUIA_RURAL','Cañar',TRUE),
    (148,3,'030363','Ducur','PARROQUIA_RURAL','Cañar',TRUE),
    (149,3,'0304','La Troncal','CABECERA_CANTONAL','La Troncal',TRUE),
    (150,3,'030451','Manuel J. Calle','PARROQUIA_RURAL','La Troncal',TRUE),
    (151,3,'030452','Pancho Negro','PARROQUIA_RURAL','La Troncal',TRUE),
    (152,3,'0305','El Tambo','CABECERA_CANTONAL','El Tambo',TRUE),
    (153,3,'0306','Déleg','CABECERA_CANTONAL','Déleg',TRUE),
    (154,3,'030651','Solano','PARROQUIA_RURAL','Déleg',TRUE),
    (155,3,'0307','Suscal','CABECERA_CANTONAL','Suscal',TRUE),
    (156,4,'0401','Tulcán','CABECERA_CANTONAL','Tulcán',TRUE),
    (157,4,'040151','El Carmelo','PARROQUIA_RURAL','Tulcán',TRUE),
    (158,4,'040152','Huaca','PARROQUIA_RURAL','Tulcán',FALSE),
    (159,4,'040153','Julio Andrade','PARROQUIA_RURAL','Tulcán',TRUE),
    (160,4,'040154','Maldonado','PARROQUIA_RURAL','Tulcán',TRUE),
    (161,4,'040155','Pioter','PARROQUIA_RURAL','Tulcán',TRUE),
    (162,4,'040156','Tobar Donoso','PARROQUIA_RURAL','Tulcán',TRUE),
    (163,4,'040157','Tufiño','PARROQUIA_RURAL','Tulcán',TRUE),
    (164,4,'040158','Urbina','PARROQUIA_RURAL','Tulcán',TRUE),
    (165,4,'040159','El Chical','PARROQUIA_RURAL','Tulcán',TRUE),
    (166,4,'040160','Mariscal Sucre','PARROQUIA_RURAL','Tulcán',FALSE),
    (167,4,'040161','Santa Martha de Cuba','PARROQUIA_RURAL','Tulcán',TRUE),
    (168,4,'0402','Bolívar','CABECERA_CANTONAL','Bolívar',TRUE),
    (169,4,'040251','García Moreno','PARROQUIA_RURAL','Bolívar',TRUE),
    (170,4,'040252','Los Andes','PARROQUIA_RURAL','Bolívar',TRUE),
    (171,4,'040253','Monte Olivo','PARROQUIA_RURAL','Bolívar',TRUE),
    (172,4,'040254','San Vicente de Pusir','PARROQUIA_RURAL','Bolívar',TRUE),
    (173,4,'040255','San Rafael','PARROQUIA_RURAL','Bolívar',TRUE),
    (174,4,'0403','El Ángel','CABECERA_CANTONAL','Espejo',TRUE),
    (175,4,'040351','El Goaltal','PARROQUIA_RURAL','Espejo',TRUE),
    (176,4,'040352','La Libertad','PARROQUIA_RURAL','Espejo',TRUE),
    (177,4,'040353','San Isidro','PARROQUIA_RURAL','Espejo',TRUE),
    (178,4,'0404','Mira','CABECERA_CANTONAL','Mira',TRUE),
    (179,4,'040451','Concepción','PARROQUIA_RURAL','Mira',TRUE),
    (180,4,'040452','Jijón y Caamaño','PARROQUIA_RURAL','Mira',TRUE),
    (181,4,'040453','Juan Montalvo','PARROQUIA_RURAL','Mira',TRUE),
    (182,4,'0405','San Gabriel','CABECERA_CANTONAL','Montúfar',TRUE),
    (183,4,'040551','Cristóbal Colón','PARROQUIA_RURAL','Montúfar',TRUE),
    (184,4,'040552','Chitán de Navarrete','PARROQUIA_RURAL','Montúfar',TRUE),
    (185,4,'040553','Fernández Salvador','PARROQUIA_RURAL','Montúfar',TRUE),
    (186,4,'040554','La Paz','PARROQUIA_RURAL','Montúfar',TRUE),
    (187,4,'040555','Piartal','PARROQUIA_RURAL','Montúfar',TRUE),
    (188,4,'0406','Huaca','CABECERA_CANTONAL','San Pedro de Huaca',TRUE),
    (189,4,'040651','Mariscal Sucre','PARROQUIA_RURAL','San Pedro de Huaca',TRUE),
    (190,5,'0501','Latacunga','CABECERA_CANTONAL','Latacunga',TRUE),
    (191,5,'050151','Aláquez','PARROQUIA_RURAL','Latacunga',TRUE),
    (192,5,'050152','Belisario Quevedo','PARROQUIA_RURAL','Latacunga',TRUE),
    (193,5,'050153','Guaytacama','PARROQUIA_RURAL','Latacunga',TRUE),
    (194,5,'050154','Joseguango Bajo','PARROQUIA_RURAL','Latacunga',TRUE),
    (195,5,'050155','Las Pampas','PARROQUIA_RURAL','Latacunga',FALSE),
    (196,5,'050156','Mulaló','PARROQUIA_RURAL','Latacunga',TRUE),
    (197,5,'050157','Once de Noviembre','PARROQUIA_RURAL','Latacunga',TRUE),
    (198,5,'050158','Poaló','PARROQUIA_RURAL','Latacunga',TRUE),
    (199,5,'050159','San Juan de Pastocalle','PARROQUIA_RURAL','Latacunga',TRUE),
    (200,5,'050160','Sigchos','PARROQUIA_RURAL','Latacunga',FALSE),
    (201,5,'050161','Tanicuchí','PARROQUIA_RURAL','Latacunga',TRUE),
    (202,5,'050162','Toacaso','PARROQUIA_RURAL','Latacunga',TRUE),
    (203,5,'050163','Palo Quemado','PARROQUIA_RURAL','Latacunga',FALSE),
    (204,5,'0502','La Maná','CABECERA_CANTONAL','La Maná',TRUE),
    (205,5,'050251','Guasaganda','PARROQUIA_RURAL','La Maná',TRUE),
    (206,5,'050252','Pucayacu','PARROQUIA_RURAL','La Maná',TRUE),
    (207,5,'0503','El Corazón','CABECERA_CANTONAL','Pangua',TRUE),
    (208,5,'050351','Moraspungo','PARROQUIA_RURAL','Pangua',TRUE),
    (209,5,'050352','Pinllopata','PARROQUIA_RURAL','Pangua',TRUE),
    (210,5,'050353','Ramón Campaña','PARROQUIA_RURAL','Pangua',TRUE),
    (211,5,'0504','Pujilí','CABECERA_CANTONAL','Pujili',TRUE),
    (212,5,'050451','Angamarca','PARROQUIA_RURAL','Pujili',TRUE),
    (213,5,'050452','Chucchilán (Chugchilán)','PARROQUIA_RURAL','Pujili',FALSE),
    (214,5,'050453','Guangaje','PARROQUIA_RURAL','Pujili',TRUE),
    (215,5,'050454','Isinlibí (Isinliví)','PARROQUIA_RURAL','Pujili',FALSE),
    (216,5,'050455','La Victoria','PARROQUIA_RURAL','Pujili',TRUE),
    (217,5,'050456','Pilaló','PARROQUIA_RURAL','Pujili',TRUE),
    (218,5,'050457','Tingo','PARROQUIA_RURAL','Pujili',TRUE),
    (219,5,'050458','Zumbahua','PARROQUIA_RURAL','Pujili',TRUE),
    (220,5,'0505','San Miguel','CABECERA_CANTONAL','Salcedo',TRUE),
    (221,5,'050551','Antonio José Holguín','PARROQUIA_RURAL','Salcedo',TRUE),
    (222,5,'050552','Cusubamba','PARROQUIA_RURAL','Salcedo',TRUE),
    (223,5,'050553','Mulalillo','PARROQUIA_RURAL','Salcedo',TRUE),
    (224,5,'050554','Mulliquindil','PARROQUIA_RURAL','Salcedo',TRUE),
    (225,5,'050555','Pansaleo','PARROQUIA_RURAL','Salcedo',TRUE),
    (226,5,'0506','Saquisilí','CABECERA_CANTONAL','Saquisilí',TRUE),
    (227,5,'050651','Canchagua','PARROQUIA_RURAL','Saquisilí',TRUE),
    (228,5,'050652','Chantilín','PARROQUIA_RURAL','Saquisilí',TRUE),
    (229,5,'050653','Cochapamba','PARROQUIA_RURAL','Saquisilí',TRUE),
    (230,5,'0507','Sigchos','CABECERA_CANTONAL','Sigchos',TRUE),
    (231,5,'050751','Chugchillán','PARROQUIA_RURAL','Sigchos',TRUE),
    (232,5,'050752','Isinlivi','PARROQUIA_RURAL','Sigchos',TRUE),
    (233,5,'050753','Las Pampas','PARROQUIA_RURAL','Sigchos',TRUE),
    (234,5,'050754','Palo Quemado','PARROQUIA_RURAL','Sigchos',TRUE),
    (235,6,'0601','Riobamba','CABECERA_CANTONAL','Riobamba',TRUE),
    (236,6,'060151','Cacha','PARROQUIA_RURAL','Riobamba',TRUE),
    (237,6,'060152','Calpi','PARROQUIA_RURAL','Riobamba',TRUE),
    (238,6,'060153','Cubijíes','PARROQUIA_RURAL','Riobamba',TRUE),
    (239,6,'060154','Flores','PARROQUIA_RURAL','Riobamba',TRUE),
    (240,6,'060155','Licán','PARROQUIA_RURAL','Riobamba',TRUE),
    (241,6,'060156','Licto','PARROQUIA_RURAL','Riobamba',TRUE),
    (242,6,'060157','Pungalá','PARROQUIA_RURAL','Riobamba',TRUE),
    (243,6,'060158','Punín','PARROQUIA_RURAL','Riobamba',TRUE),
    (244,6,'060159','Quimiag','PARROQUIA_RURAL','Riobamba',TRUE),
    (245,6,'060160','San Juan','PARROQUIA_RURAL','Riobamba',TRUE),
    (246,6,'060161','San Luis','PARROQUIA_RURAL','Riobamba',TRUE),
    (247,6,'0602','Alausí','CABECERA_CANTONAL','Alausi',TRUE),
    (248,6,'060251','Achupallas','PARROQUIA_RURAL','Alausi',TRUE),
    (249,6,'060252','Cumandá','PARROQUIA_RURAL','Alausi',FALSE),
    (250,6,'060253','Guasuntos','PARROQUIA_RURAL','Alausi',TRUE),
    (251,6,'060254','Huigra','PARROQUIA_RURAL','Alausi',TRUE),
    (252,6,'060255','Multitud','PARROQUIA_RURAL','Alausi',TRUE),
    (253,6,'060256','Pistishi','PARROQUIA_RURAL','Alausi',TRUE),
    (254,6,'060257','Pumallacta','PARROQUIA_RURAL','Alausi',TRUE),
    (255,6,'060258','Sevilla','PARROQUIA_RURAL','Alausi',TRUE),
    (256,6,'060259','Sibambe','PARROQUIA_RURAL','Alausi',TRUE),
    (257,6,'060260','Tixán','PARROQUIA_RURAL','Alausi',TRUE),
    (258,6,'0603','Villa la Unión','CABECERA_CANTONAL','Colta',TRUE),
    (259,6,'060351','Cañi','PARROQUIA_RURAL','Colta',TRUE),
    (260,6,'060352','Columbe','PARROQUIA_RURAL','Colta',TRUE),
    (261,6,'060353','Juan de Velasco','PARROQUIA_RURAL','Colta',TRUE),
    (262,6,'060354','Santiago de Quito','PARROQUIA_RURAL','Colta',TRUE),
    (263,6,'0604','Chambo','CABECERA_CANTONAL','Chambo',TRUE),
    (264,6,'0605','Chunchi','CABECERA_CANTONAL','Chunchi',TRUE),
    (265,6,'060551','Capzol','PARROQUIA_RURAL','Chunchi',TRUE),
    (266,6,'060552','Compud','PARROQUIA_RURAL','Chunchi',TRUE),
    (267,6,'060553','Gonzol','PARROQUIA_RURAL','Chunchi',TRUE),
    (268,6,'060554','Llagos','PARROQUIA_RURAL','Chunchi',TRUE),
    (269,6,'0606','Guamote','CABECERA_CANTONAL','Guamote',TRUE),
    (270,6,'060651','Cebadas','PARROQUIA_RURAL','Guamote',TRUE),
    (271,6,'060652','Palmira','PARROQUIA_RURAL','Guamote',TRUE),
    (272,6,'0607','Guano','CABECERA_CANTONAL','Guano',TRUE),
    (273,6,'060751','Guanando','PARROQUIA_RURAL','Guano',TRUE),
    (274,6,'060752','Ilapo','PARROQUIA_RURAL','Guano',TRUE),
    (275,6,'060753','La Providencia','PARROQUIA_RURAL','Guano',TRUE),
    (276,6,'060754','San Andrés','PARROQUIA_RURAL','Guano',TRUE),
    (277,6,'060755','San Gerardo','PARROQUIA_RURAL','Guano',TRUE),
    (278,6,'060756','San Isidro de Patulú','PARROQUIA_RURAL','Guano',TRUE),
    (279,6,'060757','San José del Chazo','PARROQUIA_RURAL','Guano',TRUE),
    (280,6,'060758','Santa Fé de Galán','PARROQUIA_RURAL','Guano',TRUE),
    (281,6,'060759','Valparaiso','PARROQUIA_RURAL','Guano',TRUE),
    (282,6,'0608','Pallatanga','CABECERA_CANTONAL','Pallatanga',TRUE),
    (283,6,'0609','Penipe','CABECERA_CANTONAL','Penipe',TRUE),
    (284,6,'060951','El Altar','PARROQUIA_RURAL','Penipe',TRUE),
    (285,6,'060952','Matus','PARROQUIA_RURAL','Penipe',TRUE),
    (286,6,'060953','Puela','PARROQUIA_RURAL','Penipe',TRUE),
    (287,6,'060954','San Antonio de Bayushig','PARROQUIA_RURAL','Penipe',TRUE),
    (288,6,'060955','La Candelaria','PARROQUIA_RURAL','Penipe',TRUE),
    (289,6,'060956','Bilbao','PARROQUIA_RURAL','Penipe',TRUE),
    (290,6,'0610','Cumandá','CABECERA_CANTONAL','Cumandá',TRUE),
    (291,7,'0701','Machala','CABECERA_CANTONAL','Machala',TRUE),
    (292,7,'070151','El Cambio','PARROQUIA_RURAL','Machala',FALSE),
    (293,7,'070152','El Retiro','PARROQUIA_RURAL','Machala',TRUE),
    (294,7,'0702','Arenillas','CABECERA_CANTONAL','Arenillas',TRUE),
    (295,7,'070251','Chacras','PARROQUIA_RURAL','Arenillas',TRUE),
    (296,7,'070252','La Libertad','PARROQUIA_RURAL','Arenillas',FALSE),
    (297,7,'070253','Las Lajas','PARROQUIA_RURAL','Arenillas',FALSE),
    (298,7,'070254','Palmales','PARROQUIA_RURAL','Arenillas',TRUE),
    (299,7,'070255','Carcabón','PARROQUIA_RURAL','Arenillas',TRUE),
    (300,7,'070256','La Cuca','PARROQUIA_RURAL','Arenillas',TRUE),
    (301,7,'0703','Paccha','CABECERA_CANTONAL','Atahualpa',TRUE),
    (302,7,'070351','Ayapamba','PARROQUIA_RURAL','Atahualpa',TRUE),
    (303,7,'070352','Cordoncillo','PARROQUIA_RURAL','Atahualpa',TRUE),
    (304,7,'070353','Milagro','PARROQUIA_RURAL','Atahualpa',TRUE),
    (305,7,'070354','San José','PARROQUIA_RURAL','Atahualpa',TRUE),
    (306,7,'070355','San Juan de Cerro Azul','PARROQUIA_RURAL','Atahualpa',TRUE),
    (307,7,'0704','Balsas','CABECERA_CANTONAL','Balsas',TRUE),
    (308,7,'070451','Bellamaría','PARROQUIA_RURAL','Balsas',TRUE),
    (309,7,'0705','Chilla','CABECERA_CANTONAL','Chilla',TRUE),
    (310,7,'0706','El Guabo','CABECERA_CANTONAL','El Guabo',TRUE),
    (311,7,'070651','Barbones','PARROQUIA_RURAL','El Guabo',TRUE),
    (312,7,'070652','La Iberia','PARROQUIA_RURAL','El Guabo',TRUE),
    (313,7,'070653','Tendales','PARROQUIA_RURAL','El Guabo',TRUE),
    (314,7,'070654','Río Bonito','PARROQUIA_RURAL','El Guabo',TRUE),
    (315,7,'0707','Huaquillas','CABECERA_CANTONAL','Huaquillas',TRUE),
    (316,7,'0708','Marcabelí','CABECERA_CANTONAL','Marcabelí',TRUE),
    (317,7,'070851','El Ingenio','PARROQUIA_RURAL','Marcabelí',TRUE),
    (318,7,'0709','Pasaje','CABECERA_CANTONAL','Pasaje',TRUE),
    (319,7,'070951','Buenavista','PARROQUIA_RURAL','Pasaje',TRUE),
    (320,7,'070952','Casacay','PARROQUIA_RURAL','Pasaje',TRUE),
    (321,7,'070953','La Peaña','PARROQUIA_RURAL','Pasaje',TRUE),
    (322,7,'070954','Progreso','PARROQUIA_RURAL','Pasaje',TRUE),
    (323,7,'070955','Uzhcurrumi','PARROQUIA_RURAL','Pasaje',TRUE),
    (324,7,'070956','Cañaquemada','PARROQUIA_RURAL','Pasaje',TRUE),
    (325,7,'0710','Piñas','CABECERA_CANTONAL','Piñas',TRUE),
    (326,7,'071051','Capiro','PARROQUIA_RURAL','Piñas',TRUE),
    (327,7,'071052','La Bocana','PARROQUIA_RURAL','Piñas',TRUE),
    (328,7,'071053','Moromoro','PARROQUIA_RURAL','Piñas',TRUE),
    (329,7,'071054','Piedras','PARROQUIA_RURAL','Piñas',TRUE),
    (330,7,'071055','San Roque','PARROQUIA_RURAL','Piñas',TRUE),
    (331,7,'071056','Saracay','PARROQUIA_RURAL','Piñas',TRUE),
    (332,7,'0711','Portovelo','CABECERA_CANTONAL','Portovelo',TRUE),
    (333,7,'071151','Curtincapa','PARROQUIA_RURAL','Portovelo',TRUE),
    (334,7,'071152','Morales','PARROQUIA_RURAL','Portovelo',TRUE),
    (335,7,'071153','Salatí','PARROQUIA_RURAL','Portovelo',TRUE),
    (336,7,'0712','Santa Rosa','CABECERA_CANTONAL','Santa Rosa',TRUE),
    (337,7,'071251','Bellavista','PARROQUIA_RURAL','Santa Rosa',TRUE),
    (338,7,'071252','Jambelí','PARROQUIA_RURAL','Santa Rosa',TRUE),
    (339,7,'071253','La Avanzada','PARROQUIA_RURAL','Santa Rosa',TRUE),
    (340,7,'071254','San Antonio','PARROQUIA_RURAL','Santa Rosa',TRUE),
    (341,7,'071255','Torata','PARROQUIA_RURAL','Santa Rosa',TRUE),
    (342,7,'071256','Victoria','PARROQUIA_RURAL','Santa Rosa',TRUE),
    (343,7,'071257','Bellamaría','PARROQUIA_RURAL','Santa Rosa',TRUE),
    (344,7,'0713','Zaruma','CABECERA_CANTONAL','Zaruma',TRUE),
    (345,7,'071351','Abañín','PARROQUIA_RURAL','Zaruma',TRUE),
    (346,7,'071352','Arcapamba','PARROQUIA_RURAL','Zaruma',TRUE),
    (347,7,'071353','Guanazán','PARROQUIA_RURAL','Zaruma',TRUE),
    (348,7,'071354','Guizhaguiña','PARROQUIA_RURAL','Zaruma',TRUE),
    (349,7,'071355','Huertas','PARROQUIA_RURAL','Zaruma',TRUE),
    (350,7,'071356','Malvas','PARROQUIA_RURAL','Zaruma',TRUE),
    (351,7,'071357','Muluncay Grande','PARROQUIA_RURAL','Zaruma',TRUE),
    (352,7,'071358','Sinsao','PARROQUIA_RURAL','Zaruma',TRUE),
    (353,7,'071359','Salvias','PARROQUIA_RURAL','Zaruma',TRUE),
    (354,7,'0714','La Victoria','CABECERA_CANTONAL','Las Lajas',TRUE),
    (355,7,'071451','La Libertad','PARROQUIA_RURAL','Las Lajas',TRUE),
    (356,7,'071452','El Paraíso','PARROQUIA_RURAL','Las Lajas',TRUE),
    (357,7,'071453','San Isidro','PARROQUIA_RURAL','Las Lajas',TRUE),
    (358,8,'0801','Esmeraldas','CABECERA_CANTONAL','Esmeraldas',TRUE),
    (359,8,'080151','Atacames','PARROQUIA_RURAL','Esmeraldas',FALSE),
    (360,8,'080152','Camarones','PARROQUIA_RURAL','Esmeraldas',TRUE),
    (361,8,'080153','Coronel Carlos Concha Torres','PARROQUIA_RURAL','Esmeraldas',TRUE),
    (362,8,'080154','Chinca','PARROQUIA_RURAL','Esmeraldas',TRUE),
    (363,8,'080155','Chontaduro','PARROQUIA_RURAL','Esmeraldas',FALSE),
    (364,8,'080156','Chumundé','PARROQUIA_RURAL','Esmeraldas',FALSE),
    (365,8,'080157','Lagarto','PARROQUIA_RURAL','Esmeraldas',FALSE),
    (366,8,'080158','La Unión','PARROQUIA_RURAL','Esmeraldas',FALSE),
    (367,8,'080159','Majua','PARROQUIA_RURAL','Esmeraldas',TRUE),
    (368,8,'080160','Montalvo','PARROQUIA_RURAL','Esmeraldas',FALSE),
    (369,8,'080161','Río Verde','PARROQUIA_RURAL','Esmeraldas',FALSE),
    (370,8,'080162','Rocafuerte','PARROQUIA_RURAL','Esmeraldas',FALSE),
    (371,8,'080163','San Mateo','PARROQUIA_RURAL','Esmeraldas',TRUE),
    (372,8,'080164','Súa','PARROQUIA_RURAL','Esmeraldas',FALSE),
    (373,8,'080165','Tabiazo','PARROQUIA_RURAL','Esmeraldas',TRUE),
    (374,8,'080166','Tachina','PARROQUIA_RURAL','Esmeraldas',TRUE),
    (375,8,'080167','Tonchigüe','PARROQUIA_RURAL','Esmeraldas',FALSE),
    (376,8,'080168','Vuelta Larga','PARROQUIA_RURAL','Esmeraldas',TRUE),
    (377,8,'0802','Valdez (Limones)','CABECERA_CANTONAL','Eloy Alfaro',TRUE),
    (378,8,'080251','Anchayacu','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (379,8,'080252','Atahualpa','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (380,8,'080253','Borbón','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (381,8,'080254','La Tola','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (382,8,'080255','Luis Vargas Torres','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (383,8,'080256','Maldonado','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (384,8,'080257','Pampanal de Bolívar','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (385,8,'080258','San Francisco de Onzole','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (386,8,'080259','Santo Domingo de Onzole','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (387,8,'080260','Selva Alegre','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (388,8,'080261','Telembí','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (389,8,'080262','Colón Eloy del María','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (390,8,'080263','San José de Cayapas','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (391,8,'080264','Timbiré','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (392,8,'080265','Santa Lucía de las Peñas','PARROQUIA_RURAL','Eloy Alfaro',TRUE),
    (393,8,'0803','Muisne','CABECERA_CANTONAL','Muisne',TRUE),
    (394,8,'080351','Bolívar','PARROQUIA_RURAL','Muisne',TRUE),
    (395,8,'080352','Daule','PARROQUIA_RURAL','Muisne',TRUE),
    (396,8,'080353','Galera','PARROQUIA_RURAL','Muisne',TRUE),
    (397,8,'080354','Quingue','PARROQUIA_RURAL','Muisne',TRUE),
    (398,8,'080355','Sálima','PARROQUIA_RURAL','Muisne',TRUE),
    (399,8,'080356','San Francisco','PARROQUIA_RURAL','Muisne',TRUE),
    (400,8,'080357','San Gregorio','PARROQUIA_RURAL','Muisne',TRUE),
    (401,8,'080358','San José de Chamanga','PARROQUIA_RURAL','Muisne',TRUE),
    (402,8,'0804','Rosa Zárate','CABECERA_CANTONAL','Quinindé',TRUE),
    (403,8,'080451','Cube','PARROQUIA_RURAL','Quinindé',TRUE),
    (404,8,'080452','Chura','PARROQUIA_RURAL','Quinindé',TRUE),
    (405,8,'080453','Malimpia','PARROQUIA_RURAL','Quinindé',TRUE),
    (406,8,'080454','Viche','PARROQUIA_RURAL','Quinindé',TRUE),
    (407,8,'080455','La Unión','PARROQUIA_RURAL','Quinindé',TRUE),
    (408,8,'0805','San Lorenzo','CABECERA_CANTONAL','San Lorenzo',TRUE),
    (409,8,'080551','Alto Tambo','PARROQUIA_RURAL','San Lorenzo',TRUE),
    (410,8,'080552','Ancón','PARROQUIA_RURAL','San Lorenzo',TRUE),
    (411,8,'080553','Calderón','PARROQUIA_RURAL','San Lorenzo',TRUE),
    (412,8,'080554','Carondelet','PARROQUIA_RURAL','San Lorenzo',TRUE),
    (413,8,'080555','5 de Junio','PARROQUIA_RURAL','San Lorenzo',TRUE),
    (414,8,'080556','Concepción','PARROQUIA_RURAL','San Lorenzo',TRUE),
    (415,8,'080557','Mataje','PARROQUIA_RURAL','San Lorenzo',TRUE),
    (416,8,'080558','San Javier de Cachaví','PARROQUIA_RURAL','San Lorenzo',TRUE),
    (417,8,'080559','Santa Rita','PARROQUIA_RURAL','San Lorenzo',TRUE),
    (418,8,'080560','Tambillo','PARROQUIA_RURAL','San Lorenzo',TRUE),
    (419,8,'080561','Tululbí','PARROQUIA_RURAL','San Lorenzo',TRUE),
    (420,8,'080562','Urbina','PARROQUIA_RURAL','San Lorenzo',TRUE),
    (421,8,'0806','Atacames','CABECERA_CANTONAL','Atacames',TRUE),
    (422,8,'080651','La Unión','PARROQUIA_RURAL','Atacames',TRUE),
    (423,8,'080652','Súa','PARROQUIA_RURAL','Atacames',TRUE),
    (424,8,'080653','Tonchigüe','PARROQUIA_RURAL','Atacames',TRUE),
    (425,8,'080654','Tonsupa','PARROQUIA_RURAL','Atacames',TRUE),
    (426,8,'0807','Ríoverde','CABECERA_CANTONAL','Ríoverde',TRUE),
    (427,8,'080751','Chontaduro','PARROQUIA_RURAL','Ríoverde',TRUE),
    (428,8,'080752','Chumundé','PARROQUIA_RURAL','Ríoverde',TRUE),
    (429,8,'080753','Lagarto','PARROQUIA_RURAL','Ríoverde',TRUE),
    (430,8,'080754','Montalvo','PARROQUIA_RURAL','Ríoverde',TRUE),
    (431,8,'080755','Rocafuerte','PARROQUIA_RURAL','Ríoverde',TRUE),
    (432,9,'0901','Guayaquil','CABECERA_CANTONAL','Guayaquil',TRUE),
    (433,9,'090151','Chongón','PARROQUIA_RURAL','Guayaquil',FALSE),
    (434,9,'090152','Juan Gómez Rendón','PARROQUIA_RURAL','Guayaquil',TRUE),
    (435,9,'090153','Morro','PARROQUIA_RURAL','Guayaquil',TRUE),
    (436,9,'090154','Pascuales','PARROQUIA_RURAL','Guayaquil',FALSE),
    (437,9,'090155','Playas (Gral. Villamil)','PARROQUIA_RURAL','Guayaquil',FALSE),
    (438,9,'090156','Posorja','PARROQUIA_RURAL','Guayaquil',TRUE),
    (439,9,'090157','Puná','PARROQUIA_RURAL','Guayaquil',TRUE),
    (440,9,'090158','Tenguel','PARROQUIA_RURAL','Guayaquil',TRUE),
    (441,9,'0902','Alfredo Baquerizo Moreno (Juján)','CABECERA_CANTONAL','Alfredo Baquerizo Moreno',TRUE),
    (442,9,'0903','Balao','CABECERA_CANTONAL','Balao',TRUE),
    (443,9,'0904','Balzar','CABECERA_CANTONAL','Balzar',TRUE),
    (444,9,'0905','Colimes','CABECERA_CANTONAL','Colimes',TRUE),
    (445,9,'090551','San Jacinto','PARROQUIA_RURAL','Colimes',TRUE),
    (446,9,'0906','Daule','CABECERA_CANTONAL','Daule',TRUE),
    (447,9,'090651','Isidro Ayora (Soledad)','PARROQUIA_RURAL','Daule',FALSE),
    (448,9,'090652','Juan Bautista Aguirre','PARROQUIA_RURAL','Daule',TRUE),
    (449,9,'090653','Laurel','PARROQUIA_RURAL','Daule',TRUE),
    (450,9,'090654','Limonal','PARROQUIA_RURAL','Daule',TRUE),
    (451,9,'090655','Lomas de Sargentillo','PARROQUIA_RURAL','Daule',FALSE),
    (452,9,'090656','Los Lojas','PARROQUIA_RURAL','Daule',TRUE),
    (453,9,'090657','Piedrahita (Nobol)','PARROQUIA_RURAL','Daule',FALSE),
    (454,9,'0907','Eloy Alfaro','CABECERA_CANTONAL','Durán',TRUE),
    (455,9,'0908','Velasco Ibarra','CABECERA_CANTONAL','El Empalme',TRUE),
    (456,9,'090851','Guayas','PARROQUIA_RURAL','El Empalme',TRUE),
    (457,9,'090852','El Rosario','PARROQUIA_RURAL','El Empalme',TRUE),
    (458,9,'0909','El Triunfo','CABECERA_CANTONAL','El Triunfo',TRUE),
    (459,9,'0910','Milagro','CABECERA_CANTONAL','Milagro',TRUE),
    (460,9,'091051','Chobo','PARROQUIA_RURAL','Milagro',TRUE),
    (461,9,'091052','General Elizalde (Bucay)','PARROQUIA_RURAL','Milagro',FALSE),
    (462,9,'091053','Mariscal Sucre','PARROQUIA_RURAL','Milagro',TRUE),
    (463,9,'091054','Roberto Astudillo','PARROQUIA_RURAL','Milagro',TRUE),
    (464,9,'0911','Naranjal','CABECERA_CANTONAL','Naranjal',TRUE),
    (465,9,'091151','Jesús María','PARROQUIA_RURAL','Naranjal',TRUE),
    (466,9,'091152','San Carlos','PARROQUIA_RURAL','Naranjal',TRUE),
    (467,9,'091153','Santa Rosa de Flandes','PARROQUIA_RURAL','Naranjal',TRUE),
    (468,9,'091154','Taura','PARROQUIA_RURAL','Naranjal',TRUE),
    (469,9,'0912','Naranjito','CABECERA_CANTONAL','Naranjito',TRUE),
    (470,9,'0913','Palestina','CABECERA_CANTONAL','Palestina',TRUE),
    (471,9,'0914','Pedro Carbo','CABECERA_CANTONAL','Pedro Carbo',TRUE),
    (472,9,'091451','Valle de la Virgen','PARROQUIA_RURAL','Pedro Carbo',TRUE),
    (473,9,'091452','Sabanilla','PARROQUIA_RURAL','Pedro Carbo',TRUE),
    (474,9,'0916','Samborondón','CABECERA_CANTONAL','Samborondón',TRUE),
    (475,9,'091651','Tarifa','PARROQUIA_RURAL','Samborondón',TRUE),
    (476,9,'0918','Santa Lucía','CABECERA_CANTONAL','Santa Lucía',TRUE),
    (477,9,'0919','El Salitre','CABECERA_CANTONAL','Salitre',TRUE),
    (478,9,'091951','General Vernaza','PARROQUIA_RURAL','Salitre',TRUE),
    (479,9,'091952','La Victoria','PARROQUIA_RURAL','Salitre',TRUE),
    (480,9,'091953','Junquillal','PARROQUIA_RURAL','Salitre',TRUE),
    (481,9,'0920','San Jacinto de Yaguachi','CABECERA_CANTONAL','San Jacinto de Yaguachi',TRUE),
    (482,9,'092051','Coronel Lorenzo de Garaicoa (Pedregal)','PARROQUIA_RURAL','San Jacinto de Yaguachi',FALSE),
    (483,9,'092052','Coronel Marcelino Maridueña (San Carlos)','PARROQUIA_RURAL','San Jacinto de Yaguachi',FALSE),
    (484,9,'092053','General Pedro J. Montero','PARROQUIA_RURAL','San Jacinto de Yaguachi',TRUE),
    (485,9,'092054','Simón Bolívar','PARROQUIA_RURAL','San Jacinto de Yaguachi',FALSE),
    (486,9,'092055','Yaguachi Viejo','PARROQUIA_RURAL','San Jacinto de Yaguachi',TRUE),
    (487,9,'092056','Virgen de Fátima','PARROQUIA_RURAL','San Jacinto de Yaguachi',TRUE),
    (488,9,'0921','General Villamil','CABECERA_CANTONAL','Playas',TRUE),
    (489,9,'0922','Simón Bolívar','CABECERA_CANTONAL','Simón Bolívar',TRUE),
    (490,9,'092251','Coronel Lorenzo de Garaycoa','PARROQUIA_RURAL','Simón Bolívar',TRUE),
    (491,9,'0923','Coronel Marcelino Maridueña','CABECERA_CANTONAL','Coronel Marcelino Maridueña',TRUE),
    (492,9,'0924','Lomas de Sargentillo','CABECERA_CANTONAL','Lomas de Sargentillo',TRUE),
    (493,9,'092451','Isidro Ayora (Soledad)','PARROQUIA_RURAL','Lomas de Sargentillo',FALSE),
    (494,9,'0925','Narcisa de Jesús','CABECERA_CANTONAL','Nobol',TRUE),
    (495,9,'0927','General Antonio Elizalde','CABECERA_CANTONAL','General Antonio Elizalde',TRUE),
    (496,9,'0928','Isidro Ayora','CABECERA_CANTONAL','Isidro Ayora',TRUE),
    (497,10,'1001','San Miguel de Ibarra','CABECERA_CANTONAL','Ibarra',TRUE),
    (498,10,'100151','Ambuquí','PARROQUIA_RURAL','Ibarra',TRUE),
    (499,10,'100152','Angochagua','PARROQUIA_RURAL','Ibarra',TRUE),
    (500,10,'100153','La Carolina','PARROQUIA_RURAL','Ibarra',TRUE),
    (501,10,'100154','La Esperanza','PARROQUIA_RURAL','Ibarra',TRUE),
    (502,10,'100155','Lita','PARROQUIA_RURAL','Ibarra',TRUE),
    (503,10,'100156','Salinas','PARROQUIA_RURAL','Ibarra',TRUE),
    (504,10,'100157','San Antonio','PARROQUIA_RURAL','Ibarra',TRUE),
    (505,10,'1002','Atuntaqui','CABECERA_CANTONAL','Antonio Ante',TRUE),
    (506,10,'100251','Imbaya','PARROQUIA_RURAL','Antonio Ante',TRUE),
    (507,10,'100252','San Francisco de Natabuela','PARROQUIA_RURAL','Antonio Ante',TRUE),
    (508,10,'100253','San José de Chaltura','PARROQUIA_RURAL','Antonio Ante',TRUE),
    (509,10,'100254','San Roque','PARROQUIA_RURAL','Antonio Ante',TRUE),
    (510,10,'1003','Cotacachi','CABECERA_CANTONAL','Cotacachi',TRUE),
    (511,10,'100351','Apuela','PARROQUIA_RURAL','Cotacachi',TRUE),
    (512,10,'100352','García Moreno','PARROQUIA_RURAL','Cotacachi',TRUE),
    (513,10,'100353','Imantag','PARROQUIA_RURAL','Cotacachi',TRUE),
    (514,10,'100354','Peñaherrera','PARROQUIA_RURAL','Cotacachi',TRUE),
    (515,10,'100355','Plaza Gutiérrez','PARROQUIA_RURAL','Cotacachi',TRUE),
    (516,10,'100356','Quiroga','PARROQUIA_RURAL','Cotacachi',TRUE),
    (517,10,'100357','Seis de Julio de Cuellaje','PARROQUIA_RURAL','Cotacachi',TRUE),
    (518,10,'100358','Vacas Galindo','PARROQUIA_RURAL','Cotacachi',TRUE),
    (519,10,'1004','Otavalo','CABECERA_CANTONAL','Otavalo',TRUE),
    (520,10,'100451','Dr. Miguel Egas Cabezas','PARROQUIA_RURAL','Otavalo',TRUE),
    (521,10,'100452','Eugenio Espejo','PARROQUIA_RURAL','Otavalo',TRUE),
    (522,10,'100453','González Suárez','PARROQUIA_RURAL','Otavalo',TRUE),
    (523,10,'100454','Pataquí','PARROQUIA_RURAL','Otavalo',TRUE),
    (524,10,'100455','San José de Quichinche','PARROQUIA_RURAL','Otavalo',TRUE),
    (525,10,'100456','San Juan de Ilumán','PARROQUIA_RURAL','Otavalo',TRUE),
    (526,10,'100457','San Pablo','PARROQUIA_RURAL','Otavalo',TRUE),
    (527,10,'100458','San Rafael','PARROQUIA_RURAL','Otavalo',TRUE),
    (528,10,'100459','Selva Alegre','PARROQUIA_RURAL','Otavalo',TRUE),
    (529,10,'1005','Pimampiro','CABECERA_CANTONAL','Pimampiro',TRUE),
    (530,10,'100551','Chugá','PARROQUIA_RURAL','Pimampiro',TRUE),
    (531,10,'100552','Mariano Acosta','PARROQUIA_RURAL','Pimampiro',TRUE),
    (532,10,'100553','San Francisco de Sigsipamba','PARROQUIA_RURAL','Pimampiro',TRUE),
    (533,10,'1006','Urcuquí','CABECERA_CANTONAL','San Miguel de Urcuquí',TRUE),
    (534,10,'100651','Cahuasquí','PARROQUIA_RURAL','San Miguel de Urcuquí',TRUE),
    (535,10,'100652','La Merced de Buenos Aires','PARROQUIA_RURAL','San Miguel de Urcuquí',TRUE),
    (536,10,'100653','Pablo Arenas','PARROQUIA_RURAL','San Miguel de Urcuquí',TRUE),
    (537,10,'100654','San Blas','PARROQUIA_RURAL','San Miguel de Urcuquí',TRUE),
    (538,10,'100655','Tumbabiro','PARROQUIA_RURAL','San Miguel de Urcuquí',TRUE),
    (539,11,'1101','Loja','CABECERA_CANTONAL','Loja',TRUE),
    (540,11,'110151','Chantaco','PARROQUIA_RURAL','Loja',TRUE),
    (541,11,'110152','Chuquiribamba','PARROQUIA_RURAL','Loja',TRUE),
    (542,11,'110153','El Cisne','PARROQUIA_RURAL','Loja',TRUE),
    (543,11,'110154','Gualel','PARROQUIA_RURAL','Loja',TRUE),
    (544,11,'110155','Jimbilla','PARROQUIA_RURAL','Loja',TRUE),
    (545,11,'110156','Malacatos','PARROQUIA_RURAL','Loja',TRUE),
    (546,11,'110157','San Lucas','PARROQUIA_RURAL','Loja',TRUE),
    (547,11,'110158','San Pedro de Vilcabamba','PARROQUIA_RURAL','Loja',TRUE),
    (548,11,'110159','Santiago','PARROQUIA_RURAL','Loja',TRUE),
    (549,11,'110160','Taquil','PARROQUIA_RURAL','Loja',TRUE),
    (550,11,'110161','Vilcabamba','PARROQUIA_RURAL','Loja',TRUE),
    (551,11,'110162','Yangana','PARROQUIA_RURAL','Loja',TRUE),
    (552,11,'110163','Quinara','PARROQUIA_RURAL','Loja',TRUE),
    (553,11,'1102','Cariamanga','CABECERA_CANTONAL','Calvas',TRUE),
    (554,11,'110251','Colaisaca','PARROQUIA_RURAL','Calvas',TRUE),
    (555,11,'110252','El Lucero','PARROQUIA_RURAL','Calvas',TRUE),
    (556,11,'110253','Utuana','PARROQUIA_RURAL','Calvas',TRUE),
    (557,11,'110254','Sanguillín','PARROQUIA_RURAL','Calvas',TRUE),
    (558,11,'1103','Catamayo','CABECERA_CANTONAL','Catamayo',TRUE),
    (559,11,'110351','El Tambo','PARROQUIA_RURAL','Catamayo',TRUE),
    (560,11,'110352','Guayquichuma','PARROQUIA_RURAL','Catamayo',TRUE),
    (561,11,'110353','San Pedro de la Bendita','PARROQUIA_RURAL','Catamayo',TRUE),
    (562,11,'110354','Zambi','PARROQUIA_RURAL','Catamayo',TRUE),
    (563,11,'1104','Celica','CABECERA_CANTONAL','Celica',TRUE),
    (564,11,'110451','Cruzpamba','PARROQUIA_RURAL','Celica',TRUE),
    (565,11,'110452','Chaquinal','PARROQUIA_RURAL','Celica',FALSE),
    (566,11,'110453','12 de Diciembre','PARROQUIA_RURAL','Celica',FALSE),
    (567,11,'110454','Pindal (Federico Páez)','PARROQUIA_RURAL','Celica',FALSE),
    (568,11,'110455','Pózul','PARROQUIA_RURAL','Celica',TRUE),
    (569,11,'110456','Sabanilla','PARROQUIA_RURAL','Celica',TRUE),
    (570,11,'110457','Teniente Maximiliano Rodríguez Loaiza','PARROQUIA_RURAL','Celica',TRUE),
    (571,11,'1105','Chaguarpamba','CABECERA_CANTONAL','Chaguarpamba',TRUE),
    (572,11,'110551','Buenavista','PARROQUIA_RURAL','Chaguarpamba',TRUE),
    (573,11,'110552','El Rosario','PARROQUIA_RURAL','Chaguarpamba',TRUE),
    (574,11,'110553','Santa Rufina','PARROQUIA_RURAL','Chaguarpamba',TRUE),
    (575,11,'110554','Amarillos','PARROQUIA_RURAL','Chaguarpamba',TRUE),
    (576,11,'1106','Amaluza','CABECERA_CANTONAL','Espíndola',TRUE),
    (577,11,'110651','Bellavista','PARROQUIA_RURAL','Espíndola',TRUE),
    (578,11,'110652','Jimbura','PARROQUIA_RURAL','Espíndola',TRUE),
    (579,11,'110653','Santa Teresita','PARROQUIA_RURAL','Espíndola',TRUE),
    (580,11,'110654','27 de Abril','PARROQUIA_RURAL','Espíndola',TRUE),
    (581,11,'110655','El Ingenio','PARROQUIA_RURAL','Espíndola',TRUE),
    (582,11,'110656','El Airo','PARROQUIA_RURAL','Espíndola',TRUE),
    (583,11,'1107','Gonzanamá','CABECERA_CANTONAL','Gonzanamá',TRUE),
    (584,11,'110751','Changaimina','PARROQUIA_RURAL','Gonzanamá',TRUE),
    (585,11,'110752','Fundochamba','PARROQUIA_RURAL','Gonzanamá',FALSE),
    (586,11,'110753','Nambacola','PARROQUIA_RURAL','Gonzanamá',TRUE),
    (587,11,'110754','Purunuma','PARROQUIA_RURAL','Gonzanamá',TRUE),
    (588,11,'110755','Quilanga (la Paz)','PARROQUIA_RURAL','Gonzanamá',FALSE),
    (589,11,'110756','Sacapalca','PARROQUIA_RURAL','Gonzanamá',TRUE),
    (590,11,'110757','San Antonio de las Aradas','PARROQUIA_RURAL','Gonzanamá',FALSE),
    (591,11,'1108','Macará','CABECERA_CANTONAL','Macará',TRUE),
    (592,11,'110851','Larama','PARROQUIA_RURAL','Macará',TRUE),
    (593,11,'110852','La Victoria','PARROQUIA_RURAL','Macará',TRUE),
    (594,11,'110853','Sabiango','PARROQUIA_RURAL','Macará',TRUE),
    (595,11,'1109','Catacocha','CABECERA_CANTONAL','Paltas',TRUE),
    (596,11,'110951','Cangonamá','PARROQUIA_RURAL','Paltas',TRUE),
    (597,11,'110952','Guachanamá','PARROQUIA_RURAL','Paltas',TRUE),
    (598,11,'110953','La Tingue','PARROQUIA_RURAL','Paltas',FALSE),
    (599,11,'110954','Lauro Guerrero','PARROQUIA_RURAL','Paltas',TRUE),
    (600,11,'110955','Olmedo (Santa Bárbara)','PARROQUIA_RURAL','Paltas',FALSE),
    (601,11,'110956','Orianga','PARROQUIA_RURAL','Paltas',TRUE),
    (602,11,'110957','San Antonio','PARROQUIA_RURAL','Paltas',TRUE),
    (603,11,'110958','Casanga','PARROQUIA_RURAL','Paltas',TRUE),
    (604,11,'110959','Yamana','PARROQUIA_RURAL','Paltas',TRUE),
    (605,11,'1110','Alamor','CABECERA_CANTONAL','Puyango',TRUE),
    (606,11,'111051','Ciano','PARROQUIA_RURAL','Puyango',TRUE),
    (607,11,'111052','El Arenal','PARROQUIA_RURAL','Puyango',TRUE),
    (608,11,'111053','El Limo','PARROQUIA_RURAL','Puyango',TRUE),
    (609,11,'111054','Mercadillo','PARROQUIA_RURAL','Puyango',TRUE),
    (610,11,'111055','Vicentino','PARROQUIA_RURAL','Puyango',TRUE),
    (611,11,'1111','Saraguro','CABECERA_CANTONAL','Saraguro',TRUE),
    (612,11,'111151','El Paraíso de Celen','PARROQUIA_RURAL','Saraguro',TRUE),
    (613,11,'111152','El Tablón','PARROQUIA_RURAL','Saraguro',TRUE),
    (614,11,'111153','Lluzhapa','PARROQUIA_RURAL','Saraguro',TRUE),
    (615,11,'111154','Manú','PARROQUIA_RURAL','Saraguro',TRUE),
    (616,11,'111155','San Antonio de Qumbe','PARROQUIA_RURAL','Saraguro',TRUE),
    (617,11,'111156','San Pablo de Tenta','PARROQUIA_RURAL','Saraguro',TRUE),
    (618,11,'111157','San Sebastián de Yúluc','PARROQUIA_RURAL','Saraguro',TRUE),
    (619,11,'111158','Selva Alegre','PARROQUIA_RURAL','Saraguro',TRUE),
    (620,11,'111159','Urdaneta','PARROQUIA_RURAL','Saraguro',TRUE),
    (621,11,'111160','Sumaypamba','PARROQUIA_RURAL','Saraguro',TRUE),
    (622,11,'1112','Sozoranga','CABECERA_CANTONAL','Sozoranga',TRUE),
    (623,11,'111251','Nueva Fátima','PARROQUIA_RURAL','Sozoranga',TRUE),
    (624,11,'111252','Tacamoros','PARROQUIA_RURAL','Sozoranga',TRUE),
    (625,11,'1113','Zapotillo','CABECERA_CANTONAL','Zapotillo',TRUE),
    (626,11,'111351','Mangahurco','PARROQUIA_RURAL','Zapotillo',TRUE),
    (627,11,'111352','Garzareal','PARROQUIA_RURAL','Zapotillo',TRUE),
    (628,11,'111353','Limones','PARROQUIA_RURAL','Zapotillo',TRUE),
    (629,11,'111354','Paletillas','PARROQUIA_RURAL','Zapotillo',TRUE),
    (630,11,'111355','Bolaspamba','PARROQUIA_RURAL','Zapotillo',TRUE),
    (631,11,'111356','Cazaderos','PARROQUIA_RURAL','Zapotillo',TRUE),
    (632,11,'1114','Pindal','CABECERA_CANTONAL','Pindal',TRUE),
    (633,11,'111451','Chaquinal','PARROQUIA_RURAL','Pindal',TRUE),
    (634,11,'111452','12 de Diciembre','PARROQUIA_RURAL','Pindal',TRUE),
    (635,11,'111453','Milagros','PARROQUIA_RURAL','Pindal',TRUE),
    (636,11,'1115','Quilanga','CABECERA_CANTONAL','Quilanga',TRUE),
    (637,11,'111551','Fundochamba','PARROQUIA_RURAL','Quilanga',TRUE),
    (638,11,'111552','San Antonio de las Aradas','PARROQUIA_RURAL','Quilanga',TRUE),
    (639,11,'1116','Olmedo','CABECERA_CANTONAL','Olmedo',TRUE),
    (640,11,'111651','La Tingue','PARROQUIA_RURAL','Olmedo',TRUE),
    (641,12,'1201','Babahoyo','CABECERA_CANTONAL','Babahoyo',TRUE),
    (642,12,'120151','Barreiro (Santa Rita)','PARROQUIA_RURAL','Babahoyo',FALSE),
    (643,12,'120152','Caracol','PARROQUIA_RURAL','Babahoyo',TRUE),
    (644,12,'120153','Febres Cordero','PARROQUIA_RURAL','Babahoyo',TRUE),
    (645,12,'120154','Pimocha','PARROQUIA_RURAL','Babahoyo',TRUE),
    (646,12,'120155','La Unión','PARROQUIA_RURAL','Babahoyo',TRUE),
    (647,12,'1202','Baba','CABECERA_CANTONAL','Baba',TRUE),
    (648,12,'120251','Guare','PARROQUIA_RURAL','Baba',TRUE),
    (649,12,'120252','Isla de Bejucal','PARROQUIA_RURAL','Baba',TRUE),
    (650,12,'1203','Montalvo','CABECERA_CANTONAL','Montalvo',TRUE),
    (651,12,'120351','La Esmeralda','PARROQUIA_RURAL','Montalvo',TRUE),
    (652,12,'1204','Puebloviejo','CABECERA_CANTONAL','Puebloviejo',TRUE),
    (653,12,'120451','Puerto Pechiche','PARROQUIA_RURAL','Puebloviejo',TRUE),
    (654,12,'120452','San Juan','PARROQUIA_RURAL','Puebloviejo',TRUE),
    (655,12,'1205','Quevedo','CABECERA_CANTONAL','Quevedo',TRUE),
    (656,12,'120551','Buena Fé','PARROQUIA_RURAL','Quevedo',FALSE),
    (657,12,'120552','Mocache','PARROQUIA_RURAL','Quevedo',FALSE),
    (658,12,'120553','San Carlos','PARROQUIA_RURAL','Quevedo',TRUE),
    (659,12,'120554','Valencia','PARROQUIA_RURAL','Quevedo',FALSE),
    (660,12,'120555','La Esperanza','PARROQUIA_RURAL','Quevedo',TRUE),
    (661,12,'1206','Catarama','CABECERA_CANTONAL','Urdaneta',TRUE),
    (662,12,'120651','Ricaurte','PARROQUIA_RURAL','Urdaneta',TRUE),
    (663,12,'1207','Ventanas','CABECERA_CANTONAL','Ventanas',TRUE),
    (664,12,'120751','Quinsaloma','PARROQUIA_RURAL','Ventanas',FALSE),
    (665,12,'120752','Zapotal','PARROQUIA_RURAL','Ventanas',TRUE),
    (666,12,'120753','Chacarita','PARROQUIA_RURAL','Ventanas',TRUE),
    (667,12,'120754','Los Ángeles','PARROQUIA_RURAL','Ventanas',TRUE),
    (668,12,'1208','Vinces','CABECERA_CANTONAL','Vinces',TRUE),
    (669,12,'120851','Antonio Sotomayor','PARROQUIA_RURAL','Vinces',TRUE),
    (670,12,'120852','Palenque','PARROQUIA_RURAL','Vinces',FALSE),
    (671,12,'1209','Palenque','CABECERA_CANTONAL','Palenque',TRUE),
    (672,12,'1210','San Jacinto de Buena Fé','CABECERA_CANTONAL','Buena Fé',TRUE),
    (673,12,'121051','Patricia Pilar','PARROQUIA_RURAL','Buena Fé',TRUE),
    (674,12,'1211','Valencia','CABECERA_CANTONAL','Valencia',TRUE),
    (675,12,'1212','Mocache','CABECERA_CANTONAL','Mocache',TRUE),
    (676,12,'1213','Quinsaloma','CABECERA_CANTONAL','Quinsaloma',TRUE),
    (677,13,'1301','Portoviejo','CABECERA_CANTONAL','Portoviejo',TRUE),
    (678,13,'130151','Abdón Calderón','PARROQUIA_RURAL','Portoviejo',TRUE),
    (679,13,'130152','Alhajuela','PARROQUIA_RURAL','Portoviejo',TRUE),
    (680,13,'130153','Crucita','PARROQUIA_RURAL','Portoviejo',TRUE),
    (681,13,'130154','Pueblo Nuevo','PARROQUIA_RURAL','Portoviejo',TRUE),
    (682,13,'130155','Riochico','PARROQUIA_RURAL','Portoviejo',TRUE),
    (683,13,'130156','San Plácido','PARROQUIA_RURAL','Portoviejo',TRUE),
    (684,13,'130157','Chirijos','PARROQUIA_RURAL','Portoviejo',TRUE),
    (685,13,'1302','Calceta','CABECERA_CANTONAL','Bolívar',TRUE),
    (686,13,'130251','Membrillo','PARROQUIA_RURAL','Bolívar',TRUE),
    (687,13,'130252','Quiroga','PARROQUIA_RURAL','Bolívar',TRUE),
    (688,13,'1303','Chone','CABECERA_CANTONAL','Chone',TRUE),
    (689,13,'130351','Boyacá','PARROQUIA_RURAL','Chone',TRUE),
    (690,13,'130352','Canuto','PARROQUIA_RURAL','Chone',TRUE),
    (691,13,'130353','Convento','PARROQUIA_RURAL','Chone',TRUE),
    (692,13,'130354','Chibunga','PARROQUIA_RURAL','Chone',TRUE),
    (693,13,'130355','Eloy Alfaro','PARROQUIA_RURAL','Chone',TRUE),
    (694,13,'130356','Ricaurte','PARROQUIA_RURAL','Chone',TRUE),
    (695,13,'130357','San Antonio','PARROQUIA_RURAL','Chone',TRUE),
    (696,13,'1304','El Carmen','CABECERA_CANTONAL','El Carmen',TRUE),
    (697,13,'130451','Wilfrido Loor Moreira','PARROQUIA_RURAL','El Carmen',TRUE),
    (698,13,'130452','San Pedro de Suma','PARROQUIA_RURAL','El Carmen',TRUE),
    (699,13,'130453','Santa María','PARROQUIA_RURAL','El Carmen',TRUE),
    (700,13,'130454','El Paraíso la 14','PARROQUIA_RURAL','El Carmen',TRUE),
    (701,13,'1305','Flavio Alfaro','CABECERA_CANTONAL','Flavio Alfaro',TRUE),
    (702,13,'130551','San Francisco de Novillo','PARROQUIA_RURAL','Flavio Alfaro',TRUE),
    (703,13,'130552','Zapallo','PARROQUIA_RURAL','Flavio Alfaro',TRUE),
    (704,13,'1306','Jipijapa','CABECERA_CANTONAL','Jipijapa',TRUE),
    (705,13,'130651','América','PARROQUIA_RURAL','Jipijapa',TRUE),
    (706,13,'130652','El Anegado','PARROQUIA_RURAL','Jipijapa',TRUE),
    (707,13,'130653','Julcuy','PARROQUIA_RURAL','Jipijapa',TRUE),
    (708,13,'130654','La Unión','PARROQUIA_RURAL','Jipijapa',TRUE),
    (709,13,'130655','Machalilla','PARROQUIA_RURAL','Jipijapa',FALSE),
    (710,13,'130656','Membrillal','PARROQUIA_RURAL','Jipijapa',TRUE),
    (711,13,'130657','Pedro Pablo Gómez','PARROQUIA_RURAL','Jipijapa',TRUE),
    (712,13,'130658','Puerto de Cayo','PARROQUIA_RURAL','Jipijapa',TRUE),
    (713,13,'130659','Puerto López','PARROQUIA_RURAL','Jipijapa',FALSE),
    (714,13,'1307','Junín','CABECERA_CANTONAL','Junín',TRUE),
    (715,13,'1308','Manta','CABECERA_CANTONAL','Manta',TRUE),
    (716,13,'130851','San Lorenzo','PARROQUIA_RURAL','Manta',TRUE),
    (717,13,'130852','Santa Marianita','PARROQUIA_RURAL','Manta',TRUE),
    (718,13,'1309','Montecristi','CABECERA_CANTONAL','Montecristi',TRUE),
    (719,13,'130951','Jaramijó','PARROQUIA_RURAL','Montecristi',FALSE),
    (720,13,'130952','La Pila','PARROQUIA_RURAL','Montecristi',TRUE),
    (721,13,'1310','Paján','CABECERA_CANTONAL','Paján',TRUE),
    (722,13,'131051','Campozano','PARROQUIA_RURAL','Paján',TRUE),
    (723,13,'131052','Cascol','PARROQUIA_RURAL','Paján',TRUE),
    (724,13,'131053','Guale','PARROQUIA_RURAL','Paján',TRUE),
    (725,13,'131054','Lascano','PARROQUIA_RURAL','Paján',TRUE),
    (726,13,'1311','Pichincha','CABECERA_CANTONAL','Pichincha',TRUE),
    (727,13,'131151','Barraganete','PARROQUIA_RURAL','Pichincha',TRUE),
    (728,13,'131152','San Sebastián','PARROQUIA_RURAL','Pichincha',TRUE),
    (729,13,'1312','Rocafuerte','CABECERA_CANTONAL','Rocafuerte',TRUE),
    (730,13,'131251','Sosote','PARROQUIA_RURAL','Rocafuerte',TRUE),
    (731,13,'1313','Santa Ana de Vuelta Larga','CABECERA_CANTONAL','Santa Ana',TRUE),
    (732,13,'131351','Ayacucho','PARROQUIA_RURAL','Santa Ana',TRUE),
    (733,13,'131352','Honorato Vásquez','PARROQUIA_RURAL','Santa Ana',TRUE),
    (734,13,'131353','La Unión','PARROQUIA_RURAL','Santa Ana',TRUE),
    (735,13,'131354','Olmedo','PARROQUIA_RURAL','Santa Ana',FALSE),
    (736,13,'131355','San Pablo','PARROQUIA_RURAL','Santa Ana',TRUE),
    (737,13,'1314','Bahía de Caráquez','CABECERA_CANTONAL','Sucre',TRUE),
    (738,13,'131451','Canoa','PARROQUIA_RURAL','Sucre',FALSE),
    (739,13,'131452','Cojimíes','PARROQUIA_RURAL','Sucre',FALSE),
    (740,13,'131453','Charapotó','PARROQUIA_RURAL','Sucre',TRUE),
    (741,13,'131454','10 de Agosto','PARROQUIA_RURAL','Sucre',FALSE),
    (742,13,'131455','Jama','PARROQUIA_RURAL','Sucre',FALSE),
    (743,13,'131456','Pedernales','PARROQUIA_RURAL','Sucre',FALSE),
    (744,13,'131457','San Isidro','PARROQUIA_RURAL','Sucre',TRUE),
    (745,13,'131458','San Vicente','PARROQUIA_RURAL','Sucre',FALSE),
    (746,13,'1315','Tosagua','CABECERA_CANTONAL','Tosagua',TRUE),
    (747,13,'131551','Bachillero','PARROQUIA_RURAL','Tosagua',TRUE),
    (748,13,'131552','Ángel Pedro Giler','PARROQUIA_RURAL','Tosagua',TRUE),
    (749,13,'1316','Sucre','CABECERA_CANTONAL','24 de Mayo',TRUE),
    (750,13,'131651','Bellavista','PARROQUIA_RURAL','24 de Mayo',TRUE),
    (751,13,'131652','Noboa','PARROQUIA_RURAL','24 de Mayo',TRUE),
    (752,13,'131653','Arquitecto Sixto Durán Ballén','PARROQUIA_RURAL','24 de Mayo',TRUE),
    (753,13,'1317','Pedernales','CABECERA_CANTONAL','Pedernales',TRUE),
    (754,13,'131751','Cojimíes','PARROQUIA_RURAL','Pedernales',TRUE),
    (755,13,'131752','Diez de Agosto','PARROQUIA_RURAL','Pedernales',TRUE),
    (756,13,'131753','Atahualpa','PARROQUIA_RURAL','Pedernales',TRUE),
    (757,13,'1318','Olmedo','CABECERA_CANTONAL','Olmedo',TRUE),
    (758,13,'1319','Puerto López','CABECERA_CANTONAL','Puerto López',TRUE),
    (759,13,'131951','Machalilla','PARROQUIA_RURAL','Puerto López',TRUE),
    (760,13,'131952','Salango','PARROQUIA_RURAL','Puerto López',TRUE),
    (761,13,'1320','Jama','CABECERA_CANTONAL','Jama',TRUE),
    (762,13,'1321','Jaramijó','CABECERA_CANTONAL','Jaramijó',TRUE),
    (763,13,'1322','San Vicente','CABECERA_CANTONAL','San Vicente',TRUE),
    (764,13,'132251','Canoa','PARROQUIA_RURAL','San Vicente',TRUE),
    (765,14,'1401','Macas','CABECERA_CANTONAL','Morona',TRUE),
    (766,14,'140151','Alshi','PARROQUIA_RURAL','Morona',TRUE),
    (767,14,'140152','Chiguaza','PARROQUIA_RURAL','Morona',FALSE),
    (768,14,'140153','General Proaño','PARROQUIA_RURAL','Morona',TRUE),
    (769,14,'140154','Huasaga','PARROQUIA_RURAL','Morona',FALSE),
    (770,14,'140155','Macuma','PARROQUIA_RURAL','Morona',FALSE),
    (771,14,'140156','San Isidro','PARROQUIA_RURAL','Morona',TRUE),
    (772,14,'140157','Sevilla Don Bosco','PARROQUIA_RURAL','Morona',FALSE),
    (773,14,'140158','Sinaí','PARROQUIA_RURAL','Morona',TRUE),
    (774,14,'140159','Taisha','PARROQUIA_RURAL','Morona',FALSE),
    (775,14,'140160','Zuña','PARROQUIA_RURAL','Morona',TRUE),
    (776,14,'140161','Tuutinentza','PARROQUIA_RURAL','Morona',FALSE),
    (777,14,'140162','Cuchaentza','PARROQUIA_RURAL','Morona',TRUE),
    (778,14,'140163','San José de Morona','PARROQUIA_RURAL','Morona',FALSE),
    (779,14,'140164','Río Blanco','PARROQUIA_RURAL','Morona',TRUE),
    (780,14,'1402','Gualaquiza','CABECERA_CANTONAL','Gualaquiza',TRUE),
    (781,14,'140251','Amazonas','PARROQUIA_RURAL','Gualaquiza',TRUE),
    (782,14,'140252','Bermejos','PARROQUIA_RURAL','Gualaquiza',TRUE),
    (783,14,'140253','Bomboíza','PARROQUIA_RURAL','Gualaquiza',TRUE),
    (784,14,'140254','Chigüinda','PARROQUIA_RURAL','Gualaquiza',TRUE),
    (785,14,'140255','El Rosario','PARROQUIA_RURAL','Gualaquiza',TRUE),
    (786,14,'140256','Nueva Tarqui','PARROQUIA_RURAL','Gualaquiza',TRUE),
    (787,14,'140257','San Miguel de Cuyes','PARROQUIA_RURAL','Gualaquiza',TRUE),
    (788,14,'140258','El Ideal','PARROQUIA_RURAL','Gualaquiza',TRUE),
    (789,14,'1403','General Leonidas Plaza Gutiérrez','CABECERA_CANTONAL','Limón Indanza',TRUE),
    (790,14,'140351','Indanza','PARROQUIA_RURAL','Limón Indanza',TRUE),
    (791,14,'140352','Pan de Azúcar','PARROQUIA_RURAL','Limón Indanza',FALSE),
    (792,14,'140353','San Antonio','PARROQUIA_RURAL','Limón Indanza',TRUE),
    (793,14,'140354','San Carlos de Limón (San Carlos del Zamora)','PARROQUIA_RURAL','Limón Indanza',FALSE),
    (794,14,'140355','San Juan Bosco','PARROQUIA_RURAL','Limón Indanza',FALSE),
    (795,14,'140356','San Miguel de Conchay','PARROQUIA_RURAL','Limón Indanza',TRUE),
    (796,14,'140357','Santa Susana de Chiviaza','PARROQUIA_RURAL','Limón Indanza',TRUE),
    (797,14,'140358','Yunganza','PARROQUIA_RURAL','Limón Indanza',TRUE),
    (798,14,'1404','Palora (Metzera)','CABECERA_CANTONAL','Palora',TRUE),
    (799,14,'140451','Arapicos','PARROQUIA_RURAL','Palora',TRUE),
    (800,14,'140452','Cumandá','PARROQUIA_RURAL','Palora',TRUE),
    (801,14,'140453','Huamboya','PARROQUIA_RURAL','Palora',FALSE),
    (802,14,'140454','Sangay','PARROQUIA_RURAL','Palora',TRUE),
    (803,14,'140455','16 de Agosto','PARROQUIA_RURAL','Palora',TRUE),
    (804,14,'1405','Santiago de Méndez','CABECERA_CANTONAL','Santiago',TRUE),
    (805,14,'140551','Copal','PARROQUIA_RURAL','Santiago',TRUE),
    (806,14,'140552','Chupianza','PARROQUIA_RURAL','Santiago',TRUE),
    (807,14,'140553','Patuca','PARROQUIA_RURAL','Santiago',TRUE),
    (808,14,'140554','San Luis de el Acho','PARROQUIA_RURAL','Santiago',TRUE),
    (809,14,'140555','Santiago','PARROQUIA_RURAL','Santiago',FALSE),
    (810,14,'140556','Tayuza','PARROQUIA_RURAL','Santiago',TRUE),
    (811,14,'140557','San Francisco de Chinimbimi','PARROQUIA_RURAL','Santiago',TRUE),
    (812,14,'1406','Sucúa','CABECERA_CANTONAL','Sucúa',TRUE),
    (813,14,'140651','Asunción','PARROQUIA_RURAL','Sucúa',TRUE),
    (814,14,'140652','Huambi','PARROQUIA_RURAL','Sucúa',TRUE),
    (815,14,'140653','Logroño','PARROQUIA_RURAL','Sucúa',FALSE),
    (816,14,'140654','Yaupi','PARROQUIA_RURAL','Sucúa',FALSE),
    (817,14,'140655','Santa Marianita de Jesús','PARROQUIA_RURAL','Sucúa',TRUE),
    (818,14,'1407','Huamboya','CABECERA_CANTONAL','Huamboya',TRUE),
    (819,14,'140751','Chiguaza','PARROQUIA_RURAL','Huamboya',TRUE),
    (820,14,'140752','Pablo Sexto','PARROQUIA_RURAL','Huamboya',FALSE),
    (821,14,'1408','San Juan Bosco','CABECERA_CANTONAL','San Juan Bosco',TRUE),
    (822,14,'140851','Pan de Azúcar','PARROQUIA_RURAL','San Juan Bosco',TRUE),
    (823,14,'140852','San Carlos de Limón','PARROQUIA_RURAL','San Juan Bosco',TRUE),
    (824,14,'140853','San Jacinto de Wakambeis','PARROQUIA_RURAL','San Juan Bosco',TRUE),
    (825,14,'140854','Santiago de Pananza','PARROQUIA_RURAL','San Juan Bosco',TRUE),
    (826,14,'1409','Taisha','CABECERA_CANTONAL','Taisha',TRUE),
    (827,14,'140951','Huasaga','PARROQUIA_RURAL','Taisha',TRUE),
    (828,14,'140952','Macuma','PARROQUIA_RURAL','Taisha',TRUE),
    (829,14,'140953','Tuutinentsa','PARROQUIA_RURAL','Taisha',TRUE),
    (830,14,'140954','Pumpuentsa','PARROQUIA_RURAL','Taisha',TRUE),
    (831,14,'1410','Logroño','CABECERA_CANTONAL','Logroño',TRUE),
    (832,14,'141051','Yaupi','PARROQUIA_RURAL','Logroño',TRUE),
    (833,14,'141052','Shimpis','PARROQUIA_RURAL','Logroño',TRUE),
    (834,14,'1411','Pablo Sexto','CABECERA_CANTONAL','Pablo Sexto',TRUE),
    (835,14,'1412','Santiago','CABECERA_CANTONAL','Tiwintza',TRUE),
    (836,14,'141251','San José de Morona','PARROQUIA_RURAL','Tiwintza',TRUE),
    (837,14,'1413','Sevilla Don Bosco','CABECERA_CANTONAL','Sevilla Don Bosco',TRUE),
    (838,15,'1501','Tena','CABECERA_CANTONAL','Tena',TRUE),
    (839,15,'150151','Ahuano','PARROQUIA_RURAL','Tena',TRUE),
    (840,15,'150152','Carlos Julio Arosemena Tola (Zatza-Yacu)','PARROQUIA_RURAL','Tena',FALSE),
    (841,15,'150153','Chontapunta','PARROQUIA_RURAL','Tena',TRUE),
    (842,15,'150154','Pano','PARROQUIA_RURAL','Tena',TRUE),
    (843,15,'150155','Puerto Misahuallí','PARROQUIA_RURAL','Tena',TRUE),
    (844,15,'150156','Puerto Napo','PARROQUIA_RURAL','Tena',TRUE),
    (845,15,'150157','Tálag','PARROQUIA_RURAL','Tena',TRUE),
    (846,15,'150158','San Juan de Muyuna','PARROQUIA_RURAL','Tena',TRUE),
    (847,15,'1503','Archidona','CABECERA_CANTONAL','Archidona',TRUE),
    (848,15,'150351','Ávila','PARROQUIA_RURAL','Archidona',FALSE),
    (849,15,'150352','Cotundo','PARROQUIA_RURAL','Archidona',TRUE),
    (850,15,'150353','Loreto','PARROQUIA_RURAL','Archidona',FALSE),
    (851,15,'150354','San Pablo de Ushpayacu','PARROQUIA_RURAL','Archidona',TRUE),
    (852,15,'150355','Puerto Murialdo','PARROQUIA_RURAL','Archidona',FALSE),
    (853,15,'150356','Hatun Sumaku','PARROQUIA_RURAL','Archidona',TRUE),
    (854,15,'1504','El Chaco','CABECERA_CANTONAL','El Chaco',TRUE),
    (855,15,'150451','Gonzalo Díaz de Pineda','PARROQUIA_RURAL','El Chaco',TRUE),
    (856,15,'150452','Linares','PARROQUIA_RURAL','El Chaco',TRUE),
    (857,15,'150453','Oyacachi','PARROQUIA_RURAL','El Chaco',TRUE),
    (858,15,'150454','Santa Rosa','PARROQUIA_RURAL','El Chaco',TRUE),
    (859,15,'150455','Sardinas','PARROQUIA_RURAL','El Chaco',TRUE),
    (860,15,'1507','Baeza','CABECERA_CANTONAL','Quijos',TRUE),
    (861,15,'150751','Cosanga','PARROQUIA_RURAL','Quijos',TRUE),
    (862,15,'150752','Cuyuja','PARROQUIA_RURAL','Quijos',TRUE),
    (863,15,'150753','Papallacta','PARROQUIA_RURAL','Quijos',TRUE),
    (864,15,'150754','San Francisco de Borja','PARROQUIA_RURAL','Quijos',TRUE),
    (865,15,'150755','San José del Payamino','PARROQUIA_RURAL','Quijos',FALSE),
    (866,15,'150756','Sumaco','PARROQUIA_RURAL','Quijos',TRUE),
    (867,15,'1509','Carlos Julio Arosemena Tola','CABECERA_CANTONAL','Carlos Julio Arosemena Tola',TRUE),
    (868,16,'1601','Puyo','CABECERA_CANTONAL','Pastaza',TRUE),
    (869,16,'160151','Arajuno','PARROQUIA_RURAL','Pastaza',FALSE),
    (870,16,'160152','Canelos','PARROQUIA_RURAL','Pastaza',TRUE),
    (871,16,'160153','Curaray','PARROQUIA_RURAL','Pastaza',FALSE),
    (872,16,'160154','Diez de Agosto','PARROQUIA_RURAL','Pastaza',TRUE),
    (873,16,'160155','Fátima','PARROQUIA_RURAL','Pastaza',TRUE),
    (874,16,'160156','Montalvo','PARROQUIA_RURAL','Pastaza',TRUE),
    (875,16,'160157','Pomona','PARROQUIA_RURAL','Pastaza',TRUE),
    (876,16,'160158','Río Corrientes','PARROQUIA_RURAL','Pastaza',TRUE),
    (877,16,'160159','Río Tigre','PARROQUIA_RURAL','Pastaza',TRUE),
    (878,16,'160160','Santa Clara','PARROQUIA_RURAL','Pastaza',FALSE),
    (879,16,'160161','Sarayacu','PARROQUIA_RURAL','Pastaza',TRUE),
    (880,16,'160162','Simón Bolívar','PARROQUIA_RURAL','Pastaza',TRUE),
    (881,16,'160163','Tarqui','PARROQUIA_RURAL','Pastaza',TRUE),
    (882,16,'160164','Teniente Hugo Ortiz','PARROQUIA_RURAL','Pastaza',TRUE),
    (883,16,'160165','Veracruz','PARROQUIA_RURAL','Pastaza',TRUE),
    (884,16,'160166','El Triunfo','PARROQUIA_RURAL','Pastaza',TRUE),
    (885,16,'160167','Shuar Pastaza','PARROQUIA_RURAL','Pastaza',TRUE),
    (886,16,'1602','Mera','CABECERA_CANTONAL','Mera',TRUE),
    (887,16,'160251','Madre Tierra','PARROQUIA_RURAL','Mera',TRUE),
    (888,16,'160252','Shell','PARROQUIA_RURAL','Mera',TRUE),
    (889,16,'1603','Santa Clara','CABECERA_CANTONAL','Santa Clara',TRUE),
    (890,16,'160351','San José','PARROQUIA_RURAL','Santa Clara',TRUE),
    (891,16,'1604','Arajuno','CABECERA_CANTONAL','Arajuno',TRUE),
    (892,16,'160451','Curaray','PARROQUIA_RURAL','Arajuno',TRUE),
    (893,17,'1701','Quito','CABECERA_CANTONAL','Distrito Metropolitano de Quito',TRUE),
    (894,17,'170151','Alangasí','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (895,17,'170152','Amaguaña','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (896,17,'170153','Atahualpa','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (897,17,'170154','Calacalí','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (898,17,'170155','Calderón','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (899,17,'170156','Conocoto','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (900,17,'170157','Cumbayá','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (901,17,'170158','Chavezpamba','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (902,17,'170159','Checa','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (903,17,'170160','El Quinche','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (904,17,'170161','Gualea','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (905,17,'170162','Guangopolo','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (906,17,'170163','Guayllabamba','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (907,17,'170164','La Merced','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (908,17,'170165','Llano Chico','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (909,17,'170166','Lloa','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (910,17,'170167','Mindo','PARROQUIA_RURAL','Distrito Metropolitano de Quito',FALSE),
    (911,17,'170168','Nanegal','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (912,17,'170169','Nanegalito','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (913,17,'170170','Nayón','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (914,17,'170171','Nono','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (915,17,'170172','Pacto','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (916,17,'170173','Pedro Vicente Maldonado','PARROQUIA_RURAL','Distrito Metropolitano de Quito',FALSE),
    (917,17,'170174','Perucho','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (918,17,'170175','Pifo','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (919,17,'170176','Píntag','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (920,17,'170177','Pomasqui','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (921,17,'170178','Puéllaro','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (922,17,'170179','Puembo','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (923,17,'170180','San Antonio','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (924,17,'170181','San José de Minas','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (925,17,'170182','San Miguel de los Bancos','PARROQUIA_RURAL','Distrito Metropolitano de Quito',FALSE),
    (926,17,'170183','Tababela','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (927,17,'170184','Tumbaco','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (928,17,'170185','Yaruquí','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (929,17,'170186','Zámbiza','PARROQUIA_RURAL','Distrito Metropolitano de Quito',TRUE),
    (930,17,'170187','Puerto Quito','PARROQUIA_RURAL','Distrito Metropolitano de Quito',FALSE),
    (931,17,'1702','Cayambe','CABECERA_CANTONAL','Cayambe',TRUE),
    (932,17,'170251','Ascázubi','PARROQUIA_RURAL','Cayambe',TRUE),
    (933,17,'170252','Cangahua','PARROQUIA_RURAL','Cayambe',TRUE),
    (934,17,'170253','Olmedo','PARROQUIA_RURAL','Cayambe',TRUE),
    (935,17,'170254','Otón','PARROQUIA_RURAL','Cayambe',TRUE),
    (936,17,'170255','Santa Rosa de Cuzubamba','PARROQUIA_RURAL','Cayambe',TRUE),
    (937,17,'170256','San José de Ayora','PARROQUIA_RURAL','Cayambe',TRUE),
    (938,17,'170257','Juan Montalvo','PARROQUIA_RURAL','Cayambe',TRUE),
    (939,17,'1703','Machachi','CABECERA_CANTONAL','Mejia',TRUE),
    (940,17,'170351','Aloag','PARROQUIA_RURAL','Mejia',TRUE),
    (941,17,'170352','Aloasí','PARROQUIA_RURAL','Mejia',TRUE),
    (942,17,'170353','Cutuglahua','PARROQUIA_RURAL','Mejia',TRUE),
    (943,17,'170354','El Chaupi','PARROQUIA_RURAL','Mejia',TRUE),
    (944,17,'170355','Manuel Cornejo Astorga','PARROQUIA_RURAL','Mejia',TRUE),
    (945,17,'170356','Tambillo','PARROQUIA_RURAL','Mejia',TRUE),
    (946,17,'170357','Uyumbicho','PARROQUIA_RURAL','Mejia',TRUE),
    (947,17,'1704','Tabacundo','CABECERA_CANTONAL','Pedro Moncayo',TRUE),
    (948,17,'170451','La Esperanza','PARROQUIA_RURAL','Pedro Moncayo',TRUE),
    (949,17,'170452','Malchinguí','PARROQUIA_RURAL','Pedro Moncayo',TRUE),
    (950,17,'170453','Tocachi','PARROQUIA_RURAL','Pedro Moncayo',TRUE),
    (951,17,'170454','Tupigachi','PARROQUIA_RURAL','Pedro Moncayo',TRUE),
    (952,17,'1705','Sangolquí','CABECERA_CANTONAL','Rumiñahui',TRUE),
    (953,17,'170551','Cotogchoa','PARROQUIA_RURAL','Rumiñahui',TRUE),
    (954,17,'170552','Rumipamba','PARROQUIA_RURAL','Rumiñahui',TRUE),
    (955,17,'1707','San Miguel de los Bancos','CABECERA_CANTONAL','San Miguel de los Bancos',TRUE),
    (956,17,'170751','Mindo','PARROQUIA_RURAL','San Miguel de los Bancos',TRUE),
    (957,17,'170752','Pedro Vicente Maldonado','PARROQUIA_RURAL','San Miguel de los Bancos',FALSE),
    (958,17,'170753','Puerto Quito','PARROQUIA_RURAL','San Miguel de los Bancos',FALSE),
    (959,17,'1708','Pedro Vicente Maldonado','CABECERA_CANTONAL','Pedro Vicente Maldonado',TRUE),
    (960,17,'1709','Puerto Quito','CABECERA_CANTONAL','Puerto Quito',TRUE),
    (961,18,'1801','Ambato','CABECERA_CANTONAL','Ambato',TRUE),
    (962,18,'180151','Ambatillo','PARROQUIA_RURAL','Ambato',TRUE),
    (963,18,'180152','Atahualpa','PARROQUIA_RURAL','Ambato',TRUE),
    (964,18,'180153','Augusto N. Martínez','PARROQUIA_RURAL','Ambato',TRUE),
    (965,18,'180154','Constantino Fernández','PARROQUIA_RURAL','Ambato',TRUE),
    (966,18,'180155','Huachi Grande','PARROQUIA_RURAL','Ambato',TRUE),
    (967,18,'180156','Izamba','PARROQUIA_RURAL','Ambato',TRUE),
    (968,18,'180157','Juan Benigno Vela','PARROQUIA_RURAL','Ambato',TRUE),
    (969,18,'180158','Montalvo','PARROQUIA_RURAL','Ambato',TRUE),
    (970,18,'180159','Pasa','PARROQUIA_RURAL','Ambato',TRUE),
    (971,18,'180160','Picaihua','PARROQUIA_RURAL','Ambato',TRUE),
    (972,18,'180161','Pilagüín','PARROQUIA_RURAL','Ambato',TRUE),
    (973,18,'180162','Quisapincha','PARROQUIA_RURAL','Ambato',TRUE),
    (974,18,'180163','San Bartolomé de Pinllo','PARROQUIA_RURAL','Ambato',TRUE),
    (975,18,'180164','San Fernando','PARROQUIA_RURAL','Ambato',TRUE),
    (976,18,'180165','Santa Rosa','PARROQUIA_RURAL','Ambato',TRUE),
    (977,18,'180166','Totoras','PARROQUIA_RURAL','Ambato',TRUE),
    (978,18,'180167','Cunchibamba','PARROQUIA_RURAL','Ambato',TRUE),
    (979,18,'180168','Unamuncho','PARROQUIA_RURAL','Ambato',TRUE),
    (980,18,'1802','Baños','CABECERA_CANTONAL','Baños de Agua Santa',TRUE),
    (981,18,'180251','Lligua','PARROQUIA_RURAL','Baños de Agua Santa',TRUE),
    (982,18,'180252','Río Negro','PARROQUIA_RURAL','Baños de Agua Santa',TRUE),
    (983,18,'180253','Río Verde','PARROQUIA_RURAL','Baños de Agua Santa',TRUE),
    (984,18,'180254','Ulba','PARROQUIA_RURAL','Baños de Agua Santa',TRUE),
    (985,18,'1803','Cevallos','CABECERA_CANTONAL','Cevallos',TRUE),
    (986,18,'1804','Mocha','CABECERA_CANTONAL','Mocha',TRUE),
    (987,18,'180451','Pinguilí','PARROQUIA_RURAL','Mocha',TRUE),
    (988,18,'1805','Patate','CABECERA_CANTONAL','Patate',TRUE),
    (989,18,'180551','El Triunfo','PARROQUIA_RURAL','Patate',TRUE),
    (990,18,'180552','Los Andes','PARROQUIA_RURAL','Patate',TRUE),
    (991,18,'180553','Sucre','PARROQUIA_RURAL','Patate',TRUE),
    (992,18,'1806','Quero','CABECERA_CANTONAL','Quero',TRUE),
    (993,18,'180651','Rumipamba','PARROQUIA_RURAL','Quero',TRUE),
    (994,18,'180652','Yanayacu-Mochapata','PARROQUIA_RURAL','Quero',TRUE),
    (995,18,'1807','Pelileo','CABECERA_CANTONAL','San Pedro de Pelileo',TRUE),
    (996,18,'180751','Benítez','PARROQUIA_RURAL','San Pedro de Pelileo',TRUE),
    (997,18,'180752','Bolívar','PARROQUIA_RURAL','San Pedro de Pelileo',TRUE),
    (998,18,'180753','Cotaló','PARROQUIA_RURAL','San Pedro de Pelileo',TRUE),
    (999,18,'180754','Chiquicha','PARROQUIA_RURAL','San Pedro de Pelileo',TRUE),
    (1000,18,'180755','El Rosario','PARROQUIA_RURAL','San Pedro de Pelileo',TRUE),
    (1001,18,'180756','García Moreno','PARROQUIA_RURAL','San Pedro de Pelileo',TRUE),
    (1002,18,'180757','Guambaló','PARROQUIA_RURAL','San Pedro de Pelileo',TRUE),
    (1003,18,'180758','Salasaca','PARROQUIA_RURAL','San Pedro de Pelileo',TRUE),
    (1004,18,'1808','Píllaro','CABECERA_CANTONAL','Santiago de Píllaro',TRUE),
    (1005,18,'180851','Baquerizo Moreno','PARROQUIA_RURAL','Santiago de Píllaro',TRUE),
    (1006,18,'180852','Emilio María Terán','PARROQUIA_RURAL','Santiago de Píllaro',TRUE),
    (1007,18,'180853','Marcos Espinel','PARROQUIA_RURAL','Santiago de Píllaro',TRUE),
    (1008,18,'180854','Presidente Urbina','PARROQUIA_RURAL','Santiago de Píllaro',TRUE),
    (1009,18,'180855','San Andrés','PARROQUIA_RURAL','Santiago de Píllaro',TRUE),
    (1010,18,'180856','San José de Poaló','PARROQUIA_RURAL','Santiago de Píllaro',TRUE),
    (1011,18,'180857','San Miguelito','PARROQUIA_RURAL','Santiago de Píllaro',TRUE),
    (1012,18,'1809','Tisaleo','CABECERA_CANTONAL','Tisaleo',TRUE),
    (1013,18,'180951','Quinchicoto','PARROQUIA_RURAL','Tisaleo',TRUE),
    (1014,19,'1901','Zamora','CABECERA_CANTONAL','Zamora',TRUE),
    (1015,19,'190151','Cumbaratza','PARROQUIA_RURAL','Zamora',TRUE),
    (1016,19,'190152','Guadalupe','PARROQUIA_RURAL','Zamora',TRUE),
    (1017,19,'190153','Imbana','PARROQUIA_RURAL','Zamora',TRUE),
    (1018,19,'190154','Paquisha','PARROQUIA_RURAL','Zamora',FALSE),
    (1019,19,'190155','Sabanilla','PARROQUIA_RURAL','Zamora',TRUE),
    (1020,19,'190156','Timbara','PARROQUIA_RURAL','Zamora',TRUE),
    (1021,19,'190157','Zumbi','PARROQUIA_RURAL','Zamora',FALSE),
    (1022,19,'190158','San Carlos de las Minas','PARROQUIA_RURAL','Zamora',TRUE),
    (1023,19,'1902','Zumba','CABECERA_CANTONAL','Chinchipe',TRUE),
    (1024,19,'190251','Chito','PARROQUIA_RURAL','Chinchipe',TRUE),
    (1025,19,'190252','El Chorro','PARROQUIA_RURAL','Chinchipe',TRUE),
    (1026,19,'190253','El Porvenir del Carmen','PARROQUIA_RURAL','Chinchipe',FALSE),
    (1027,19,'190254','La Chonta','PARROQUIA_RURAL','Chinchipe',TRUE),
    (1028,19,'190255','Palanda','PARROQUIA_RURAL','Chinchipe',FALSE),
    (1029,19,'190256','Pucapamba','PARROQUIA_RURAL','Chinchipe',TRUE),
    (1030,19,'190257','San Francisco del Vergel','PARROQUIA_RURAL','Chinchipe',FALSE),
    (1031,19,'190258','Valladolid','PARROQUIA_RURAL','Chinchipe',FALSE),
    (1032,19,'190259','San Andrés','PARROQUIA_RURAL','Chinchipe',TRUE),
    (1033,19,'1903','Guayzimi','CABECERA_CANTONAL','Nangaritza',TRUE),
    (1034,19,'190351','Zurmi','PARROQUIA_RURAL','Nangaritza',TRUE),
    (1035,19,'190352','Nuevo Paraíso','PARROQUIA_RURAL','Nangaritza',TRUE),
    (1036,19,'190353','Nankais','PARROQUIA_RURAL','Nangaritza',TRUE),
    (1037,19,'1904','28 de Mayo','CABECERA_CANTONAL','Yacuambi',TRUE),
    (1038,19,'190451','La Paz','PARROQUIA_RURAL','Yacuambi',TRUE),
    (1039,19,'190452','Tutupali','PARROQUIA_RURAL','Yacuambi',TRUE),
    (1040,19,'1905','Yantzaza','CABECERA_CANTONAL','Yantzaza',TRUE),
    (1041,19,'190551','Chicaña','PARROQUIA_RURAL','Yantzaza',TRUE),
    (1042,19,'190552','El Pangui','PARROQUIA_RURAL','Yantzaza',FALSE),
    (1043,19,'190553','Los Encuentros','PARROQUIA_RURAL','Yantzaza',TRUE),
    (1044,19,'1906','El Pangui','CABECERA_CANTONAL','El Pangui',TRUE),
    (1045,19,'190651','El Guisme','PARROQUIA_RURAL','El Pangui',TRUE),
    (1046,19,'190652','Pachicutza','PARROQUIA_RURAL','El Pangui',TRUE),
    (1047,19,'190653','Tundayme','PARROQUIA_RURAL','El Pangui',TRUE),
    (1048,19,'1907','Zumbi','CABECERA_CANTONAL','Centinela del Cóndor',TRUE),
    (1049,19,'190751','Paquisha','PARROQUIA_RURAL','Centinela del Cóndor',FALSE),
    (1050,19,'190752','Triunfo Dorado','PARROQUIA_RURAL','Centinela del Cóndor',TRUE),
    (1051,19,'190753','Panguintza','PARROQUIA_RURAL','Centinela del Cóndor',TRUE),
    (1052,19,'1908','Palanda','CABECERA_CANTONAL','Palanda',TRUE),
    (1053,19,'190851','El Porvenir del Carmen','PARROQUIA_RURAL','Palanda',TRUE),
    (1054,19,'190852','San Francisco del Vergel','PARROQUIA_RURAL','Palanda',TRUE),
    (1055,19,'190853','Valladolid','PARROQUIA_RURAL','Palanda',TRUE),
    (1056,19,'190854','La Canela','PARROQUIA_RURAL','Palanda',TRUE),
    (1057,19,'1909','Paquisha','CABECERA_CANTONAL','Paquisha',TRUE),
    (1058,19,'190951','Bellavista','PARROQUIA_RURAL','Paquisha',TRUE),
    (1059,19,'190952','Nuevo Quito','PARROQUIA_RURAL','Paquisha',TRUE),
    (1060,20,'2001','Puerto Baquerizo Moreno','CABECERA_CANTONAL','San Cristóbal',TRUE),
    (1061,20,'200151','El Progreso','PARROQUIA_RURAL','San Cristóbal',TRUE),
    (1062,20,'200152','Isla Santa María Floreana','PARROQUIA_RURAL','San Cristóbal',TRUE),
    (1063,20,'2002','Puerto Villamil','CABECERA_CANTONAL','Isabela',TRUE),
    (1064,20,'200251','Tomás de Berlanga','PARROQUIA_RURAL','Isabela',TRUE),
    (1065,20,'2003','Puerto Ayora','CABECERA_CANTONAL','Santa Cruz',TRUE),
    (1066,20,'200351','Bella Vista','PARROQUIA_RURAL','Santa Cruz',TRUE),
    (1067,20,'200352','Santa Rosa','PARROQUIA_RURAL','Santa Cruz',TRUE),
    (1068,21,'2101','Nueva Loja','CABECERA_CANTONAL','Lago Agrio',TRUE),
    (1069,21,'210151','Cuyabeno','PARROQUIA_RURAL','Lago Agrio',FALSE),
    (1070,21,'210152','Dureno','PARROQUIA_RURAL','Lago Agrio',TRUE),
    (1071,21,'210153','General Farfán','PARROQUIA_RURAL','Lago Agrio',TRUE),
    (1072,21,'210154','Tarapoa','PARROQUIA_RURAL','Lago Agrio',FALSE),
    (1073,21,'210155','El Eno','PARROQUIA_RURAL','Lago Agrio',TRUE),
    (1074,21,'210156','Pacayacu','PARROQUIA_RURAL','Lago Agrio',TRUE),
    (1075,21,'210157','Jambelí','PARROQUIA_RURAL','Lago Agrio',TRUE),
    (1076,21,'210158','Santa Cecilia','PARROQUIA_RURAL','Lago Agrio',TRUE),
    (1077,21,'210159','Aguas Negras','PARROQUIA_RURAL','Lago Agrio',FALSE),
    (1078,21,'210160','10 de Agosto','PARROQUIA_RURAL','Lago Agrio',TRUE),
    (1079,21,'2102','Lumbaquí','CABECERA_CANTONAL','Gonzalo Pizarro',TRUE),
    (1080,21,'210251','El Reventador','PARROQUIA_RURAL','Gonzalo Pizarro',TRUE),
    (1081,21,'210252','Gonzalo Pizarro','PARROQUIA_RURAL','Gonzalo Pizarro',TRUE),
    (1082,21,'210253','Lumbaquí','PARROQUIA_RURAL','Gonzalo Pizarro',FALSE),
    (1083,21,'210254','Puerto Libre','PARROQUIA_RURAL','Gonzalo Pizarro',TRUE),
    (1084,21,'210255','Santa Rosa de Sucumbíos','PARROQUIA_RURAL','Gonzalo Pizarro',FALSE),
    (1085,21,'2103','Puerto el Carmen del Putumayo','CABECERA_CANTONAL','Putumayo',TRUE),
    (1086,21,'210351','Palma Roja','PARROQUIA_RURAL','Putumayo',TRUE),
    (1087,21,'210352','Puerto Bolívar','PARROQUIA_RURAL','Putumayo',TRUE),
    (1088,21,'210353','Puerto Rodríguez','PARROQUIA_RURAL','Putumayo',TRUE),
    (1089,21,'210354','Santa Elena','PARROQUIA_RURAL','Putumayo',TRUE),
    (1090,21,'210355','Sansahuari','PARROQUIA_RURAL','Putumayo',TRUE),
    (1091,21,'2104','Shushufindi','CABECERA_CANTONAL','Shushufindi',TRUE),
    (1092,21,'210451','Limoncocha','PARROQUIA_RURAL','Shushufindi',TRUE),
    (1093,21,'210452','Pañacocha','PARROQUIA_RURAL','Shushufindi',TRUE),
    (1094,21,'210453','San Roque','PARROQUIA_RURAL','Shushufindi',TRUE),
    (1095,21,'210454','San Pedro de los Cofánes','PARROQUIA_RURAL','Shushufindi',TRUE),
    (1096,21,'210455','Siete de Julio','PARROQUIA_RURAL','Shushufindi',TRUE),
    (1097,21,'210456','La Magdalena','PARROQUIA_RURAL','Shushufindi',TRUE),
    (1098,21,'210457','La Primavera','PARROQUIA_RURAL','Shushufindi',TRUE),
    (1099,21,'2105','La Bonita','CABECERA_CANTONAL','Sucumbíos',TRUE),
    (1100,21,'210551','El Playón de San Francisco','PARROQUIA_RURAL','Sucumbíos',TRUE),
    (1101,21,'210552','La Sofía','PARROQUIA_RURAL','Sucumbíos',TRUE),
    (1102,21,'210553','Rosa Florida','PARROQUIA_RURAL','Sucumbíos',TRUE),
    (1103,21,'210554','Santa Bárbara','PARROQUIA_RURAL','Sucumbíos',TRUE),
    (1104,21,'2106','El Dorado de Cascales','CABECERA_CANTONAL','Cascales',TRUE),
    (1105,21,'210651','Santa Rosa de Sucumbíos','PARROQUIA_RURAL','Cascales',TRUE),
    (1106,21,'210652','Sevilla','PARROQUIA_RURAL','Cascales',TRUE),
    (1107,21,'210653','Nueva Troncal','PARROQUIA_RURAL','Cascales',TRUE),
    (1108,21,'2107','Tarapoa','CABECERA_CANTONAL','Cuyabeno',TRUE),
    (1109,21,'210751','Cuyabeno','PARROQUIA_RURAL','Cuyabeno',TRUE),
    (1110,21,'210752','Aguas Negras','PARROQUIA_RURAL','Cuyabeno',TRUE),
    (1111,22,'2201','El Coca (Puerto Francisco de Orellana)','CABECERA_CANTONAL','Francisco de Orellana',TRUE),
    (1112,22,'220151','Dayuma','PARROQUIA_RURAL','Francisco de Orellana',TRUE),
    (1113,22,'220152','Taracoa','PARROQUIA_RURAL','Francisco de Orellana',TRUE),
    (1114,22,'220153','Alejandro Labaka','PARROQUIA_RURAL','Francisco de Orellana',TRUE),
    (1115,22,'220154','El Dorado','PARROQUIA_RURAL','Francisco de Orellana',TRUE),
    (1116,22,'220155','El Edén','PARROQUIA_RURAL','Francisco de Orellana',TRUE),
    (1117,22,'220156','García Moreno','PARROQUIA_RURAL','Francisco de Orellana',TRUE),
    (1118,22,'220157','Inés Arango','PARROQUIA_RURAL','Francisco de Orellana',TRUE),
    (1119,22,'220158','La Belleza','PARROQUIA_RURAL','Francisco de Orellana',TRUE),
    (1120,22,'220159','Nuevo Paraíso','PARROQUIA_RURAL','Francisco de Orellana',TRUE),
    (1121,22,'220160','San José de Guayusa','PARROQUIA_RURAL','Francisco de Orellana',TRUE),
    (1122,22,'220161','San Luis de Armenia','PARROQUIA_RURAL','Francisco de Orellana',TRUE),
    (1123,22,'2202','Nuevo Rocafuerte','CABECERA_CANTONAL','Aguarico',TRUE),
    (1124,22,'220251','Capitán Augusto Rivadeneyra','PARROQUIA_RURAL','Aguarico',TRUE),
    (1125,22,'220252','Cononaco','PARROQUIA_RURAL','Aguarico',TRUE),
    (1126,22,'220253','Santa María de Huiririma','PARROQUIA_RURAL','Aguarico',TRUE),
    (1127,22,'220254','Tiputini','PARROQUIA_RURAL','Aguarico',FALSE),
    (1128,22,'220255','Yasuní','PARROQUIA_RURAL','Aguarico',TRUE),
    (1129,22,'2203','La Joya de los Sachas','CABECERA_CANTONAL','La Joya de los Sachas',TRUE),
    (1130,22,'220351','Enokanqui','PARROQUIA_RURAL','La Joya de los Sachas',TRUE),
    (1131,22,'220352','Pompeya','PARROQUIA_RURAL','La Joya de los Sachas',TRUE),
    (1132,22,'220353','San Carlos','PARROQUIA_RURAL','La Joya de los Sachas',TRUE),
    (1133,22,'220354','San Sebastián del Coca','PARROQUIA_RURAL','La Joya de los Sachas',TRUE),
    (1134,22,'220355','Lago San Pedro','PARROQUIA_RURAL','La Joya de los Sachas',TRUE),
    (1135,22,'220356','Rumipamba','PARROQUIA_RURAL','La Joya de los Sachas',TRUE),
    (1136,22,'220357','Tres de Noviembre','PARROQUIA_RURAL','La Joya de los Sachas',TRUE),
    (1137,22,'220358','Unión Milagreña','PARROQUIA_RURAL','La Joya de los Sachas',TRUE),
    (1138,22,'2204','Loreto','CABECERA_CANTONAL','Loreto',TRUE),
    (1139,22,'220451','Ávila','PARROQUIA_RURAL','Loreto',TRUE),
    (1140,22,'220452','Puerto Murialdo','PARROQUIA_RURAL','Loreto',TRUE),
    (1141,22,'220453','San José de Payamino','PARROQUIA_RURAL','Loreto',TRUE),
    (1142,22,'220454','San José de Dahuano','PARROQUIA_RURAL','Loreto',TRUE),
    (1143,22,'220455','San Vicente de Huaticocha','PARROQUIA_RURAL','Loreto',TRUE),
    (1144,23,'2301','Santo Domingo de los Colorados','CABECERA_CANTONAL','Santo Domingo',TRUE),
    (1145,23,'230151','Alluriquín','PARROQUIA_RURAL','Santo Domingo',TRUE),
    (1146,23,'230152','Puerto Limón','PARROQUIA_RURAL','Santo Domingo',TRUE),
    (1147,23,'230153','Luz de América','PARROQUIA_RURAL','Santo Domingo',TRUE),
    (1148,23,'230154','San Jacinto del Búa','PARROQUIA_RURAL','Santo Domingo',TRUE),
    (1149,23,'230155','Valle Hermoso','PARROQUIA_RURAL','Santo Domingo',TRUE),
    (1150,23,'230156','El Esfuerzo','PARROQUIA_RURAL','Santo Domingo',TRUE),
    (1151,23,'230157','Santa María del Toachi','PARROQUIA_RURAL','Santo Domingo',TRUE),
    (1152,24,'2401','Santa Elena','CABECERA_CANTONAL','Santa Elena',TRUE),
    (1153,24,'240151','Atahualpa','PARROQUIA_RURAL','Santa Elena',TRUE),
    (1154,24,'240152','Colonche','PARROQUIA_RURAL','Santa Elena',TRUE),
    (1155,24,'240153','Chanduy','PARROQUIA_RURAL','Santa Elena',TRUE),
    (1156,24,'240154','Manglaralto','PARROQUIA_RURAL','Santa Elena',TRUE),
    (1157,24,'240155','Simón Bolívar','PARROQUIA_RURAL','Santa Elena',TRUE),
    (1158,24,'240156','San José de Ancón','PARROQUIA_RURAL','Santa Elena',TRUE),
    (1159,24,'2402','La Libertad','CABECERA_CANTONAL','La Libertad',TRUE),
    (1160,24,'2403','Salinas','CABECERA_CANTONAL','Salinas',TRUE),
    (1161,24,'240351','Anconcito','PARROQUIA_RURAL','Salinas',TRUE),
    (1162,24,'240352','José Luis Tamayo','PARROQUIA_RURAL','Salinas',TRUE),
    (1163,8,'080853','Plan Piloto','PARROQUIA_RURAL','La Concordia',FALSE),
    (1164,8,'080852','La Villegas','PARROQUIA_RURAL','La Concordia',FALSE),
    (1165,8,'080851','Monterrey','PARROQUIA_RURAL','La Concordia',FALSE),
    (1166,8,'0808','La Concordia','CABECERA_CANTONAL','La Concordia',FALSE),
    (1167,14,'140190','Sinaí-Cuchaentza','PARROQUIA_RURAL','Morona',TRUE),
    (1168,23,'230253','Plan Piloto','PARROQUIA_RURAL','La Concordia',TRUE),
    (1169,23,'230252','La Villegas','PARROQUIA_RURAL','La Concordia',TRUE),
    (1170,23,'230251','Monterrey','PARROQUIA_RURAL','La Concordia',TRUE),
    (1171,23,'2302','La Concordia','CABECERA_CANTONAL','La Concordia',TRUE);
SELECT setval(pg_get_serial_sequence('pliego.ciudad','ciudad_id'),(SELECT max(ciudad_id) FROM pliego.ciudad),TRUE);

CREATE TABLE pliego.ciudad_alias (
    ciudad_alias_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provincia_id BIGINT NOT NULL,
    ciudad_id BIGINT NOT NULL,
    nombre_alias VARCHAR(120) NOT NULL CHECK (char_length(btrim(nombre_alias)) BETWEEN 1 AND 120),
    search_key TEXT GENERATED ALWAYS AS (pliego.fn_search_fold(nombre_alias)) STORED,
    fuente_evidencia TEXT NOT NULL CHECK (char_length(btrim(fuente_evidencia)) BETWEEN 1 AND 1200),
    CONSTRAINT fk_ciudad_alias_target FOREIGN KEY (provincia_id,ciudad_id)
        REFERENCES pliego.ciudad(provincia_id,ciudad_id) ON DELETE RESTRICT,
    CONSTRAINT uq_ciudad_alias_provincia_key UNIQUE (provincia_id,search_key)
);
CREATE INDEX ix_ciudad_alias_target ON pliego.ciudad_alias(provincia_id,ciudad_id);
COMMENT ON TABLE pliego.ciudad_alias IS
    'Read-only INEC CGE 2026 evidence-backed aliases for active selectable localities; see ADR-0044.';
COMMENT ON COLUMN pliego.ciudad_alias.fuente_evidencia IS
    'INEC CGE 2026 DPA 2025 worksheet row(s), target DPA row and source workbook SHA-256.';

CREATE FUNCTION pliego.fn_geo_validate_city_alias()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE target_active BOOLEAN; target_key TEXT; alias_key TEXT;
BEGIN
    alias_key := pliego.fn_search_fold(NEW.nombre_alias);
    SELECT c.activo,c.search_key INTO target_active,target_key
      FROM pliego.ciudad c
     WHERE c.provincia_id=NEW.provincia_id AND c.ciudad_id=NEW.ciudad_id
     FOR KEY SHARE;
    IF NOT FOUND OR NOT target_active THEN
        RAISE EXCEPTION USING ERRCODE='P5015',MESSAGE='GEO_CITY_UNAVAILABLE';
    END IF;
    IF alias_key=target_key THEN
        RAISE EXCEPTION USING ERRCODE='P5015',MESSAGE='GEO_CITY_UNAVAILABLE';
    END IF;
    IF EXISTS (
        SELECT FROM pliego.ciudad c
         WHERE c.provincia_id=NEW.provincia_id AND c.activo AND c.ciudad_id<>NEW.ciudad_id
           AND (c.search_key=alias_key OR
                (c.tipo='CABECERA_CANTONAL' AND pliego.fn_search_fold(c.canton_nombre)=alias_key))
    ) THEN
        RAISE EXCEPTION USING ERRCODE='P5015',MESSAGE='GEO_CITY_UNAVAILABLE';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_ciudad_alias_validate
BEFORE INSERT OR UPDATE OF provincia_id,ciudad_id,nombre_alias ON pliego.ciudad_alias
FOR EACH ROW EXECUTE FUNCTION pliego.fn_geo_validate_city_alias();

CREATE FUNCTION pliego.fn_geo_guard_city_alias_collisions()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE city_key TEXT; canton_key TEXT;
BEGIN
    IF NEW.activo THEN
        city_key := pliego.fn_search_fold(NEW.nombre);
        IF EXISTS (SELECT FROM pliego.ciudad_alias a
                    WHERE a.provincia_id=NEW.provincia_id AND a.search_key=city_key) THEN
            RAISE EXCEPTION USING ERRCODE='P5015',MESSAGE='GEO_CITY_UNAVAILABLE';
        END IF;
        IF NEW.tipo='CABECERA_CANTONAL' THEN
            canton_key := pliego.fn_search_fold(NEW.canton_nombre);
            IF EXISTS (SELECT FROM pliego.ciudad_alias a
                        WHERE a.provincia_id=NEW.provincia_id AND a.search_key=canton_key
                          AND a.ciudad_id<>NEW.ciudad_id) THEN
                RAISE EXCEPTION USING ERRCODE='P5015',MESSAGE='GEO_CITY_UNAVAILABLE';
            END IF;
        END IF;
    ELSIF TG_OP='UPDATE' THEN
        IF OLD.activo AND NOT NEW.activo AND EXISTS (
            SELECT FROM pliego.ciudad_alias a
             WHERE a.provincia_id=OLD.provincia_id AND a.ciudad_id=OLD.ciudad_id
        ) THEN
            RAISE EXCEPTION USING ERRCODE='P5015',MESSAGE='GEO_CITY_UNAVAILABLE';
        END IF;
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_city_alias_collision_guard
BEFORE INSERT OR UPDATE OF provincia_id,nombre,canton_nombre,tipo,activo ON pliego.ciudad
FOR EACH ROW EXECUTE FUNCTION pliego.fn_geo_guard_city_alias_collisions();

INSERT INTO pliego.ciudad_alias (provincia_id,ciudad_id,nombre_alias,fuente_evidencia)
SELECT p.provincia_id,c.ciudad_id,seed.nombre_alias,seed.fuente_evidencia
  FROM (VALUES
    ('01','0101','Yanuncay','INEC CGE 2026, hoja DPA 2025, fila 36 (localidad DPA 010114), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','Totoracocha','INEC CGE 2026, hoja DPA 2025, fila 35 (localidad DPA 010113), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','Sucre','INEC CGE 2026, hoja DPA 2025, fila 34 (localidad DPA 010112), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','San Sebastián','INEC CGE 2026, hoja DPA 2025, fila 33 (localidad DPA 010111), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','San Blas','INEC CGE 2026, hoja DPA 2025, fila 32 (localidad DPA 010110), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','Monay','INEC CGE 2026, hoja DPA 2025, fila 31 (localidad DPA 010109), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','Machángara','INEC CGE 2026, hoja DPA 2025, fila 38 (localidad DPA 010108), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','Huaynacápac','INEC CGE 2026, hoja DPA 2025, fila 37 (localidad DPA 010107), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','Hermano Miguel','INEC CGE 2026, hoja DPA 2025, fila 37 (localidad DPA 010115), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','Gil Ramírez Dávalos','INEC CGE 2026, hoja DPA 2025, fila 36 (localidad DPA 010106), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','El Vecino','INEC CGE 2026, hoja DPA 2025, fila 35 (localidad DPA 010105), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','El Sagrario','INEC CGE 2026, hoja DPA 2025, fila 34 (localidad DPA 010104), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','El Batán','INEC CGE 2026, hoja DPA 2025, fila 33 (localidad DPA 010103), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','Cañaribamba','INEC CGE 2026, hoja DPA 2025, fila 32 (localidad DPA 010102), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0101','Bellavista','INEC CGE 2026, hoja DPA 2025, fila 31 (localidad DPA 010101), fila 27 (cabecera actual DPA 010150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0110','Oña','INEC CGE 2026, hoja DPA 2025, fila 87 (localidad DPA 010454), fila 153 (cabecera actual DPA 011050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('01','0112','Pan','INEC CGE 2026, hoja DPA 2025, fila 98 (localidad DPA 010558), fila 174 (cabecera actual DPA 011250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('02','0201','Guanujo','INEC CGE 2026, hoja DPA 2025, fila 226 (localidad DPA 020103), fila 232 (localidad DPA 020152), fila 222 (cabecera actual DPA 020150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('02','0201','Gabriel Ignacio Veintimilla','INEC CGE 2026, hoja DPA 2025, fila 227 (localidad DPA 020102), fila 222 (cabecera actual DPA 020150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('02','0201','Ángel Polibio Cháves','INEC CGE 2026, hoja DPA 2025, fila 226 (localidad DPA 020101), fila 222 (cabecera actual DPA 020150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('02','0207','Las Mercedes','INEC CGE 2026, hoja DPA 2025, fila 291 (localidad DPA 020701), fila 287 (cabecera actual DPA 020750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('03','0301','San Francisco','INEC CGE 2026, hoja DPA 2025, fila 311 (localidad DPA 030104), fila 306 (cabecera actual DPA 030150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('03','0301','Borrero','INEC CGE 2026, hoja DPA 2025, fila 310 (localidad DPA 030103), fila 306 (cabecera actual DPA 030150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('03','0301','Aurelio Bayas Martínez','INEC CGE 2026, hoja DPA 2025, fila 310 (localidad DPA 030101), fila 306 (cabecera actual DPA 030150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('03','0305','Tambo','INEC CGE 2026, hoja DPA 2025, fila 342 (localidad DPA 030360), fila 362 (cabecera actual DPA 030550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('04','0403','27 de Septiembre','INEC CGE 2026, hoja DPA 2025, fila 427 (localidad DPA 040302), fila 423 (cabecera actual DPA 040350); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('04','0405','San José','INEC CGE 2026, hoja DPA 2025, fila 453 (localidad DPA 040502), fila 449 (cabecera actual DPA 040550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','0501','San Sebastián','INEC CGE 2026, hoja DPA 2025, fila 490 (localidad DPA 050103), fila 484 (cabecera actual DPA 050150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','0501','San Felipe','INEC CGE 2026, hoja DPA 2025, fila 488 (localidad DPA 050101), fila 484 (cabecera actual DPA 050150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','0501','San Buenaventura','INEC CGE 2026, hoja DPA 2025, fila 489 (localidad DPA 050105), fila 484 (cabecera actual DPA 050150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','0501','Parque Flores','INEC CGE 2026, hoja DPA 2025, fila 489 (localidad DPA 050102), fila 484 (cabecera actual DPA 050150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','0501','La Matriz','INEC CGE 2026, hoja DPA 2025, fila 488 (localidad DPA 050104), fila 484 (cabecera actual DPA 050150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','0501','Juan Montalvo','INEC CGE 2026, hoja DPA 2025, fila 490 (localidad DPA 050103), fila 484 (cabecera actual DPA 050150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','0501','Ignacio Flores','INEC CGE 2026, hoja DPA 2025, fila 489 (localidad DPA 050102), fila 484 (cabecera actual DPA 050150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','0501','Eloy Alfaro','INEC CGE 2026, hoja DPA 2025, fila 488 (localidad DPA 050101), fila 484 (cabecera actual DPA 050150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','0502','El Triunfo','INEC CGE 2026, hoja DPA 2025, fila 510 (localidad DPA 050203), fila 506 (cabecera actual DPA 050250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','0502','El Carmen','INEC CGE 2026, hoja DPA 2025, fila 510 (localidad DPA 050201), fila 506 (cabecera actual DPA 050250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','050751','Chugchilán','INEC CGE 2026, hoja DPA 2025, fila 537 (localidad DPA 050452), fila 572 (cabecera actual DPA 050751); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','050751','Chucchilán','INEC CGE 2026, hoja DPA 2025, fila 537 (localidad DPA 050452), fila 572 (cabecera actual DPA 050751); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','050752','Isinlibí','INEC CGE 2026, hoja DPA 2025, fila 539 (localidad DPA 050454), fila 573 (cabecera actual DPA 050752); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('06','0601','Yaruquíes','INEC CGE 2026, hoja DPA 2025, fila 594 (localidad DPA 060105), fila 589 (cabecera actual DPA 060150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('06','0601','Veloz','INEC CGE 2026, hoja DPA 2025, fila 593 (localidad DPA 060104), fila 589 (cabecera actual DPA 060150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('06','0601','Velasco','INEC CGE 2026, hoja DPA 2025, fila 595 (localidad DPA 060103), fila 589 (cabecera actual DPA 060150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('06','0601','Maldonado','INEC CGE 2026, hoja DPA 2025, fila 594 (localidad DPA 060102), fila 589 (cabecera actual DPA 060150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('06','0601','Lizarzaburu','INEC CGE 2026, hoja DPA 2025, fila 593 (localidad DPA 060101), fila 589 (cabecera actual DPA 060150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('06','0603','Sicalpa','INEC CGE 2026, hoja DPA 2025, fila 628 (localidad DPA 060302), fila 624 (cabecera actual DPA 060350); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('06','0603','Cajabamba','INEC CGE 2026, hoja DPA 2025, fila 628 (localidad DPA 060301), fila 624 (cabecera actual DPA 060350); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('06','0607','La Matriz','INEC CGE 2026, hoja DPA 2025, fila 671 (localidad DPA 060702), fila 667 (cabecera actual DPA 060750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('06','0607','El Rosario','INEC CGE 2026, hoja DPA 2025, fila 671 (localidad DPA 060701), fila 667 (cabecera actual DPA 060750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0701','Puerto Bolívar','INEC CGE 2026, hoja DPA 2025, fila 728 (localidad DPA 070103), fila 722 (cabecera actual DPA 070150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0701','Nueve de Mayo','INEC CGE 2026, hoja DPA 2025, fila 726 (localidad DPA 070104), fila 722 (cabecera actual DPA 070150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0701','La Providencia','INEC CGE 2026, hoja DPA 2025, fila 726 (localidad DPA 070101), fila 722 (cabecera actual DPA 070150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0701','El Cambio','INEC CGE 2026, hoja DPA 2025, fila 727 (localidad DPA 070105), fila 732 (localidad DPA 070151), fila 722 (cabecera actual DPA 070150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0707','Unión Lojana','INEC CGE 2026, hoja DPA 2025, fila 794 (localidad DPA 070705), fila 789 (cabecera actual DPA 070750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0707','Milton Reyes','INEC CGE 2026, hoja DPA 2025, fila 793 (localidad DPA 070704), fila 789 (cabecera actual DPA 070750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0707','Hualtaco','INEC CGE 2026, hoja DPA 2025, fila 795 (localidad DPA 070703), fila 789 (cabecera actual DPA 070750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0707','Ecuador','INEC CGE 2026, hoja DPA 2025, fila 793 (localidad DPA 070701), fila 789 (cabecera actual DPA 070750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0709','Tres Cerritos','INEC CGE 2026, hoja DPA 2025, fila 816 (localidad DPA 070904), fila 811 (cabecera actual DPA 070950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0709','Ochoa León','INEC CGE 2026, hoja DPA 2025, fila 815 (localidad DPA 070903), fila 811 (cabecera actual DPA 070950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0709','Matriz','INEC CGE 2026, hoja DPA 2025, fila 815 (localidad DPA 070903), fila 811 (cabecera actual DPA 070950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0709','Loma de Franco','INEC CGE 2026, hoja DPA 2025, fila 816 (localidad DPA 070902), fila 811 (cabecera actual DPA 070950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0709','Bolívar','INEC CGE 2026, hoja DPA 2025, fila 815 (localidad DPA 070901), fila 811 (cabecera actual DPA 070950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0710','Piñas Grande','INEC CGE 2026, hoja DPA 2025, fila 832 (localidad DPA 071003), fila 828 (cabecera actual DPA 071050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0710','La Susaya','INEC CGE 2026, hoja DPA 2025, fila 833 (localidad DPA 071002), fila 828 (cabecera actual DPA 071050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0710','La Matriz','INEC CGE 2026, hoja DPA 2025, fila 832 (localidad DPA 071001), fila 828 (cabecera actual DPA 071050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0712','Puerto Jelí','INEC CGE 2026, hoja DPA 2025, fila 861 (localidad DPA 071202), fila 856 (cabecera actual DPA 071250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0712','Nuevo Santa Rosa','INEC CGE 2026, hoja DPA 2025, fila 861 (localidad DPA 071205), fila 856 (cabecera actual DPA 071250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0712','Jumón','INEC CGE 2026, hoja DPA 2025, fila 860 (localidad DPA 071204), fila 856 (cabecera actual DPA 071250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0712','Balneario Jambelí','INEC CGE 2026, hoja DPA 2025, fila 862 (localidad DPA 071203), fila 856 (cabecera actual DPA 071250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0714','Valle Hermoso','INEC CGE 2026, hoja DPA 2025, fila 893 (localidad DPA 071403), fila 889 (cabecera actual DPA 071450); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('07','0714','Platanillos','INEC CGE 2026, hoja DPA 2025, fila 894 (localidad DPA 071402), fila 889 (cabecera actual DPA 071450); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('08','0801','Simón Plata Torres','INEC CGE 2026, hoja DPA 2025, fila 919 (localidad DPA 080105), fila 914 (cabecera actual DPA 080150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('08','0801','Luis Tello','INEC CGE 2026, hoja DPA 2025, fila 918 (localidad DPA 080104), fila 914 (cabecera actual DPA 080150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('08','0801','Las Palmas','INEC CGE 2026, hoja DPA 2025, fila 918 (localidad DPA 080104), fila 914 (cabecera actual DPA 080150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('08','0801','César Franco Carrión','INEC CGE 2026, hoja DPA 2025, fila 918 (localidad DPA 080101), fila 914 (cabecera actual DPA 080150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('08','0801','Bartolomé Ruiz','INEC CGE 2026, hoja DPA 2025, fila 918 (localidad DPA 080101), fila 914 (cabecera actual DPA 080150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('08','0801','5 de Agosto','INEC CGE 2026, hoja DPA 2025, fila 919 (localidad DPA 080102), fila 914 (cabecera actual DPA 080150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('08','0802','Valdez','INEC CGE 2026, hoja DPA 2025, fila 938 (localidad DPA 080250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('08','0802','Limones','INEC CGE 2026, hoja DPA 2025, fila 938 (localidad DPA 080250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('08','0807','Río Verde','INEC CGE 2026, hoja DPA 2025, fila 925 (localidad DPA 080161), fila 1006 (cabecera actual DPA 080750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Ximena','INEC CGE 2026, hoja DPA 2025, fila 1057 (localidad DPA 090114), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Urdaneta','INEC CGE 2026, hoja DPA 2025, fila 1056 (localidad DPA 090113), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Tarqui','INEC CGE 2026, hoja DPA 2025, fila 1055 (localidad DPA 090112), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Sucre','INEC CGE 2026, hoja DPA 2025, fila 1054 (localidad DPA 090111), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','San Alejo','INEC CGE 2026, hoja DPA 2025, fila 1059 (localidad DPA 090108), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Sagrario','INEC CGE 2026, hoja DPA 2025, fila 1053 (localidad DPA 090102), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Rocafuerte','INEC CGE 2026, hoja DPA 2025, fila 1053 (localidad DPA 090110), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Roca','INEC CGE 2026, hoja DPA 2025, fila 1052 (localidad DPA 090109), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Pascuales','INEC CGE 2026, hoja DPA 2025, fila 1058 (localidad DPA 090115), fila 1066 (localidad DPA 090154), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Olmedo','INEC CGE 2026, hoja DPA 2025, fila 1059 (localidad DPA 090108), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Nueve de Octubre','INEC CGE 2026, hoja DPA 2025, fila 1058 (localidad DPA 090107), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Letamendi','INEC CGE 2026, hoja DPA 2025, fila 1057 (localidad DPA 090106), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','García Moreno','INEC CGE 2026, hoja DPA 2025, fila 1056 (localidad DPA 090105), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Febres Cordero','INEC CGE 2026, hoja DPA 2025, fila 1055 (localidad DPA 090104), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Concepción','INEC CGE 2026, hoja DPA 2025, fila 1054 (localidad DPA 090103), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Carbo','INEC CGE 2026, hoja DPA 2025, fila 1054 (localidad DPA 090103), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Bolívar','INEC CGE 2026, hoja DPA 2025, fila 1053 (localidad DPA 090102), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0901','Ayacucho','INEC CGE 2026, hoja DPA 2025, fila 1052 (localidad DPA 090101), fila 1048 (cabecera actual DPA 090150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0902','Juján','INEC CGE 2026, hoja DPA 2025, fila 1072 (localidad DPA 090250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0906','Vicente Piedrahita','INEC CGE 2026, hoja DPA 2025, fila 1107 (localidad DPA 090608), fila 1100 (cabecera actual DPA 090650); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0906','Santa Clara','INEC CGE 2026, hoja DPA 2025, fila 1106 (localidad DPA 090607), fila 1100 (cabecera actual DPA 090650); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0906','Padre Juan Bautista Aguirre','INEC CGE 2026, hoja DPA 2025, fila 1105 (localidad DPA 090606), fila 1100 (cabecera actual DPA 090650); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0906','Magro','INEC CGE 2026, hoja DPA 2025, fila 1104 (localidad DPA 090605), fila 1100 (cabecera actual DPA 090650); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0906','La Aurora','INEC CGE 2026, hoja DPA 2025, fila 1105 (localidad DPA 090602), fila 1100 (cabecera actual DPA 090650); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0906','Emiliano Caicedo Marcos','INEC CGE 2026, hoja DPA 2025, fila 1107 (localidad DPA 090604), fila 1100 (cabecera actual DPA 090650); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0906','Banife','INEC CGE 2026, hoja DPA 2025, fila 1106 (localidad DPA 090603), fila 1100 (cabecera actual DPA 090650); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0907','El Recreo','INEC CGE 2026, hoja DPA 2025, fila 1125 (localidad DPA 090702), fila 1120 (cabecera actual DPA 090750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0907','Divino Niño','INEC CGE 2026, hoja DPA 2025, fila 1124 (localidad DPA 090703), fila 1120 (cabecera actual DPA 090750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0910','Vicente Rocafuerte','INEC CGE 2026, hoja DPA 2025, fila 1152 (localidad DPA 091007), fila 1147 (cabecera actual DPA 091050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0910','Rosa María','INEC CGE 2026, hoja DPA 2025, fila 1155 (localidad DPA 091005), fila 1147 (cabecera actual DPA 091050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0910','Las Piñas','INEC CGE 2026, hoja DPA 2025, fila 1154 (localidad DPA 091009), fila 1147 (cabecera actual DPA 091050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0910','José María Velasco Ibarra','INEC CGE 2026, hoja DPA 2025, fila 1151 (localidad DPA 091006), fila 1147 (cabecera actual DPA 091050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0910','Ernesto Seminario','INEC CGE 2026, hoja DPA 2025, fila 1153 (localidad DPA 091008), fila 1147 (cabecera actual DPA 091050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0910','Coronel Enrique Valdez','INEC CGE 2026, hoja DPA 2025, fila 1154 (localidad DPA 091004), fila 1147 (cabecera actual DPA 091050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0910','Chirijos','INEC CGE 2026, hoja DPA 2025, fila 1153 (localidad DPA 091003), fila 1147 (cabecera actual DPA 091050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0910','Camilo Andrade','INEC CGE 2026, hoja DPA 2025, fila 1151 (localidad DPA 091001), fila 1147 (cabecera actual DPA 091050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0916','La Puntilla','INEC CGE 2026, hoja DPA 2025, fila 1205 (localidad DPA 091602), fila 1201 (cabecera actual DPA 091650); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0919','San Mateo','INEC CGE 2026, hoja DPA 2025, fila 1228 (localidad DPA 091905), fila 1223 (cabecera actual DPA 091950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0919','Paraíso','INEC CGE 2026, hoja DPA 2025, fila 1227 (localidad DPA 091904), fila 1223 (cabecera actual DPA 091950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0919','Central','INEC CGE 2026, hoja DPA 2025, fila 1229 (localidad DPA 091903), fila 1223 (cabecera actual DPA 091950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0919','Candilejos','INEC CGE 2026, hoja DPA 2025, fila 1228 (localidad DPA 091902), fila 1223 (cabecera actual DPA 091950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0919','Bocana','INEC CGE 2026, hoja DPA 2025, fila 1227 (localidad DPA 091901), fila 1223 (cabecera actual DPA 091950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0921','Playas','INEC CGE 2026, hoja DPA 2025, fila 1063 (localidad DPA 090155), fila 1252 (cabecera actual DPA 092150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0921','Gral. Villamil','INEC CGE 2026, hoja DPA 2025, fila 1063 (localidad DPA 090155), fila 1252 (cabecera actual DPA 092150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','092251','Pedregal','INEC CGE 2026, hoja DPA 2025, fila 1244 (localidad DPA 092051), fila 1262 (cabecera actual DPA 092251); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0925','Piedrahita','INEC CGE 2026, hoja DPA 2025, fila 1113 (localidad DPA 090657), fila 1284 (cabecera actual DPA 092550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0925','Nobol','INEC CGE 2026, hoja DPA 2025, fila 1113 (localidad DPA 090657), fila 1284 (cabecera actual DPA 092550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0927','General Elizalde','INEC CGE 2026, hoja DPA 2025, fila 1160 (localidad DPA 091052), fila 1292 (cabecera actual DPA 092750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0927','Bucay','INEC CGE 2026, hoja DPA 2025, fila 1160 (localidad DPA 091052), fila 1292 (cabecera actual DPA 092750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','0928','Soledad','INEC CGE 2026, hoja DPA 2025, fila 1111 (localidad DPA 090651), fila 1278 (localidad DPA 092451), fila 1298 (cabecera actual DPA 092850); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('10','1001','La Dolorosa del Priorato','INEC CGE 2026, hoja DPA 2025, fila 1317 (localidad DPA 100105), fila 1312 (cabecera actual DPA 100150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('10','1001','Guayaquil de Alpachaca','INEC CGE 2026, hoja DPA 2025, fila 1317 (localidad DPA 100102), fila 1312 (cabecera actual DPA 100150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('10','1001','Caranqui','INEC CGE 2026, hoja DPA 2025, fila 1316 (localidad DPA 100101), fila 1312 (cabecera actual DPA 100150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('10','1002','Lourdes','INEC CGE 2026, hoja DPA 2025, fila 1335 (localidad DPA 100201), fila 1331 (cabecera actual DPA 100250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('10','1002','Andrade Marín','INEC CGE 2026, hoja DPA 2025, fila 1335 (localidad DPA 100201), fila 1331 (cabecera actual DPA 100250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('10','1004','San Luis','INEC CGE 2026, hoja DPA 2025, fila 1367 (localidad DPA 100402), fila 1363 (cabecera actual DPA 100450); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('10','1004','Jordán','INEC CGE 2026, hoja DPA 2025, fila 1367 (localidad DPA 100401), fila 1363 (cabecera actual DPA 100450); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1101','Valle','INEC CGE 2026, hoja DPA 2025, fila 1421 (localidad DPA 110104), fila 1417 (cabecera actual DPA 110150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1101','Sucre','INEC CGE 2026, hoja DPA 2025, fila 1423 (localidad DPA 110103), fila 1417 (cabecera actual DPA 110150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1101','Punzara','INEC CGE 2026, hoja DPA 2025, fila 1423 (localidad DPA 110106), fila 1417 (cabecera actual DPA 110150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1101','El Sagrario','INEC CGE 2026, hoja DPA 2025, fila 1421 (localidad DPA 110101), fila 1417 (cabecera actual DPA 110150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1101','Carigán','INEC CGE 2026, hoja DPA 2025, fila 1422 (localidad DPA 110105), fila 1417 (cabecera actual DPA 110150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1102','San Vicente','INEC CGE 2026, hoja DPA 2025, fila 1443 (localidad DPA 110203), fila 1439 (cabecera actual DPA 110250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1102','Chile','INEC CGE 2026, hoja DPA 2025, fila 1444 (localidad DPA 110202), fila 1439 (cabecera actual DPA 110250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1103','San José','INEC CGE 2026, hoja DPA 2025, fila 1459 (localidad DPA 110302), fila 1455 (cabecera actual DPA 110350); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1108','Manuel Enrique Rengel Suquilanda','INEC CGE 2026, hoja DPA 2025, fila 1523 (localidad DPA 110802), fila 1519 (cabecera actual DPA 110850); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1108','General Eloy Alfaro','INEC CGE 2026, hoja DPA 2025, fila 1523 (localidad DPA 110801), fila 1519 (cabecera actual DPA 110850); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1109','Lourdes','INEC CGE 2026, hoja DPA 2025, fila 1538 (localidad DPA 110902), fila 1534 (cabecera actual DPA 110950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1114','Federico Páez','INEC CGE 2026, hoja DPA 2025, fila 1477 (localidad DPA 110454), fila 1600 (cabecera actual DPA 111450); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1115','La Paz','INEC CGE 2026, hoja DPA 2025, fila 1510 (localidad DPA 110755), fila 1611 (cabecera actual DPA 111550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('11','1116','Santa Bárbara','INEC CGE 2026, hoja DPA 2025, fila 1546 (localidad DPA 110955), fila 1621 (cabecera actual DPA 111650); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1201','Santa Rita','INEC CGE 2026, hoja DPA 2025, fila 1652 (localidad DPA 120151), fila 1643 (cabecera actual DPA 120150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1201','El Salto','INEC CGE 2026, hoja DPA 2025, fila 1648 (localidad DPA 120104), fila 1643 (cabecera actual DPA 120150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1201','Doctor Camilo Ponce','INEC CGE 2026, hoja DPA 2025, fila 1648 (localidad DPA 120102), fila 1643 (cabecera actual DPA 120150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1201','Clemente Baquerizo','INEC CGE 2026, hoja DPA 2025, fila 1647 (localidad DPA 120101), fila 1643 (cabecera actual DPA 120150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1201','Barreiro','INEC CGE 2026, hoja DPA 2025, fila 1647 (localidad DPA 120103), fila 1652 (localidad DPA 120151), fila 1643 (cabecera actual DPA 120150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1205','Viva Alfaro','INEC CGE 2026, hoja DPA 2025, fila 1698 (localidad DPA 120510), fila 1690 (cabecera actual DPA 120550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1205','Venus del Río Quevedo','INEC CGE 2026, hoja DPA 2025, fila 1697 (localidad DPA 120509), fila 1690 (cabecera actual DPA 120550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1205','Siete de Octubre','INEC CGE 2026, hoja DPA 2025, fila 1695 (localidad DPA 120507), fila 1690 (cabecera actual DPA 120550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1205','San Cristóbal','INEC CGE 2026, hoja DPA 2025, fila 1694 (localidad DPA 120506), fila 1690 (cabecera actual DPA 120550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1205','San Camilo','INEC CGE 2026, hoja DPA 2025, fila 1695 (localidad DPA 120502), fila 1690 (cabecera actual DPA 120550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1205','Nicolás Infante Díaz','INEC CGE 2026, hoja DPA 2025, fila 1698 (localidad DPA 120505), fila 1690 (cabecera actual DPA 120550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1205','Guayacán','INEC CGE 2026, hoja DPA 2025, fila 1697 (localidad DPA 120504), fila 1690 (cabecera actual DPA 120550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1205','24 de Mayo','INEC CGE 2026, hoja DPA 2025, fila 1696 (localidad DPA 120508), fila 1690 (cabecera actual DPA 120550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1207','10 de Noviembre','INEC CGE 2026, hoja DPA 2025, fila 1724 (localidad DPA 120701), fila 1720 (cabecera actual DPA 120750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1208','Vinces Central','INEC CGE 2026, hoja DPA 2025, fila 1740 (localidad DPA 120802), fila 1735 (cabecera actual DPA 120850); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1208','San Lorenzo de Vinces','INEC CGE 2026, hoja DPA 2025, fila 1739 (localidad DPA 120803), fila 1735 (cabecera actual DPA 120850); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1208','Balzar de Vinces','INEC CGE 2026, hoja DPA 2025, fila 1739 (localidad DPA 120801), fila 1735 (cabecera actual DPA 120850); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1210','Buena Fé','INEC CGE 2026, hoja DPA 2025, fila 1702 (localidad DPA 120551), fila 1756 (cabecera actual DPA 121050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1210','7 de Agosto','INEC CGE 2026, hoja DPA 2025, fila 1761 (localidad DPA 121002), fila 1756 (cabecera actual DPA 121050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1210','11 de Octubre','INEC CGE 2026, hoja DPA 2025, fila 1760 (localidad DPA 121003), fila 1756 (cabecera actual DPA 121050); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('12','1211','La Nueva Unión','INEC CGE 2026, hoja DPA 2025, fila 1775 (localidad DPA 121103), fila 1771 (cabecera actual DPA 121150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1301','Simón Bolívar','INEC CGE 2026, hoja DPA 2025, fila 1817 (localidad DPA 130109), fila 1810 (cabecera actual DPA 130150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1301','Picoazá','INEC CGE 2026, hoja DPA 2025, fila 1817 (localidad DPA 130104), fila 1810 (cabecera actual DPA 130150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1301','Francisco Pacheco','INEC CGE 2026, hoja DPA 2025, fila 1815 (localidad DPA 130107), fila 1810 (cabecera actual DPA 130150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1301','Colón','INEC CGE 2026, hoja DPA 2025, fila 1816 (localidad DPA 130103), fila 1810 (cabecera actual DPA 130150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1301','Andrés de Vera','INEC CGE 2026, hoja DPA 2025, fila 1814 (localidad DPA 130106), fila 1810 (cabecera actual DPA 130150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1301','18 de Octubre','INEC CGE 2026, hoja DPA 2025, fila 1816 (localidad DPA 130108), fila 1810 (cabecera actual DPA 130150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1301','12 de Marzo','INEC CGE 2026, hoja DPA 2025, fila 1815 (localidad DPA 130102), fila 1810 (cabecera actual DPA 130150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1303','Santa Rita','INEC CGE 2026, hoja DPA 2025, fila 1845 (localidad DPA 130302), fila 1841 (cabecera actual DPA 130350); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1304','4 de Diciembre','INEC CGE 2026, hoja DPA 2025, fila 1862 (localidad DPA 130402), fila 1858 (cabecera actual DPA 130450); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1306','San Lorenzo de Jipijapa','INEC CGE 2026, hoja DPA 2025, fila 1887 (localidad DPA 130603), fila 1883 (cabecera actual DPA 130650); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1306','Manuel Inocencio Parrales y Guale','INEC CGE 2026, hoja DPA 2025, fila 1888 (localidad DPA 130602), fila 1883 (cabecera actual DPA 130650); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1306','Doctor Miguel Morán Lucio','INEC CGE 2026, hoja DPA 2025, fila 1887 (localidad DPA 130601), fila 1883 (cabecera actual DPA 130650); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1308','Urbimanta','INEC CGE 2026, hoja DPA 2025, fila 1914 (localidad DPA 130806), fila 1908 (cabecera actual DPA 130850); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1308','Tarqui','INEC CGE 2026, hoja DPA 2025, fila 1912 (localidad DPA 130804), fila 1908 (cabecera actual DPA 130850); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1308','San Mateo','INEC CGE 2026, hoja DPA 2025, fila 1914 (localidad DPA 130803), fila 1908 (cabecera actual DPA 130850); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1308','Los Esteros','INEC CGE 2026, hoja DPA 2025, fila 1912 (localidad DPA 130801), fila 1908 (cabecera actual DPA 130850); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1309','Leonidas Proaño','INEC CGE 2026, hoja DPA 2025, fila 1929 (localidad DPA 130905), fila 1924 (cabecera actual DPA 130950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1309','Isabel Muentes','INEC CGE 2026, hoja DPA 2025, fila 1930 (localidad DPA 130906), fila 1924 (cabecera actual DPA 130950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1309','General Eloy Alfaro','INEC CGE 2026, hoja DPA 2025, fila 1928 (localidad DPA 130904), fila 1924 (cabecera actual DPA 130950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1309','El Colorado','INEC CGE 2026, hoja DPA 2025, fila 1930 (localidad DPA 130903), fila 1924 (cabecera actual DPA 130950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1309','Aníbal San Andrés','INEC CGE 2026, hoja DPA 2025, fila 1928 (localidad DPA 130901), fila 1924 (cabecera actual DPA 130950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1313','Lodana','INEC CGE 2026, hoja DPA 2025, fila 1975 (localidad DPA 131302), fila 1971 (cabecera actual DPA 131350); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','1314','Leonidas Plaza Gutiérrez','INEC CGE 2026, hoja DPA 2025, fila 1991 (localidad DPA 131402), fila 1987 (cabecera actual DPA 131450); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('14','1402','Mercedes Molina','INEC CGE 2026, hoja DPA 2025, fila 2106 (localidad DPA 140202), fila 2102 (cabecera actual DPA 140250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('14','1404','Metzera','INEC CGE 2026, hoja DPA 2025, fila 2133 (localidad DPA 140450); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('14','140852','San Carlos del Zamora','INEC CGE 2026, hoja DPA 2025, fila 2126 (localidad DPA 140354), fila 2127 (localidad DPA 140354), fila 2185 (cabecera actual DPA 140852); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('15','1509','Zatza-Yacu','INEC CGE 2026, hoja DPA 2025, fila 2250 (localidad DPA 150152), fila 2303 (cabecera actual DPA 150950); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Turubamba','INEC CGE 2026, hoja DPA 2025, fila 2395 (localidad DPA 170132), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Solanda','INEC CGE 2026, hoja DPA 2025, fila 2394 (localidad DPA 170131), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','San Juan','INEC CGE 2026, hoja DPA 2025, fila 2393 (localidad DPA 170130), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','San Isidro del Inca','INEC CGE 2026, hoja DPA 2025, fila 2392 (localidad DPA 170129), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','San Bartolo','INEC CGE 2026, hoja DPA 2025, fila 2391 (localidad DPA 170128), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Quitumbe','INEC CGE 2026, hoja DPA 2025, fila 2389 (localidad DPA 170126), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Puengasí','INEC CGE 2026, hoja DPA 2025, fila 2388 (localidad DPA 170125), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Ponceano','INEC CGE 2026, hoja DPA 2025, fila 2387 (localidad DPA 170124), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Mariscal Sucre','INEC CGE 2026, hoja DPA 2025, fila 2386 (localidad DPA 170123), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','La Mena','INEC CGE 2026, hoja DPA 2025, fila 2385 (localidad DPA 170122), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','La Magdalena','INEC CGE 2026, hoja DPA 2025, fila 2384 (localidad DPA 170121), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','La Libertad','INEC CGE 2026, hoja DPA 2025, fila 2444 (localidad DPA 170120), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','La Ferroviaria','INEC CGE 2026, hoja DPA 2025, fila 2434 (localidad DPA 170119), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','La Ecuatoriana','INEC CGE 2026, hoja DPA 2025, fila 2427 (localidad DPA 170118), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','La Concepción','INEC CGE 2026, hoja DPA 2025, fila 2380 (localidad DPA 170117), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','La Argelia','INEC CGE 2026, hoja DPA 2025, fila 2395 (localidad DPA 170116), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Kennedy','INEC CGE 2026, hoja DPA 2025, fila 2394 (localidad DPA 170115), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Jipijapa','INEC CGE 2026, hoja DPA 2025, fila 2393 (localidad DPA 170114), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Itchimbia','INEC CGE 2026, hoja DPA 2025, fila 2392 (localidad DPA 170113), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Iñaquito','INEC CGE 2026, hoja DPA 2025, fila 2391 (localidad DPA 170112), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Guamaní','INEC CGE 2026, hoja DPA 2025, fila 2390 (localidad DPA 170111), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','El Condado','INEC CGE 2026, hoja DPA 2025, fila 2389 (localidad DPA 170110), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Cotocollao','INEC CGE 2026, hoja DPA 2025, fila 2385 (localidad DPA 170106), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Comité del Pueblo','INEC CGE 2026, hoja DPA 2025, fila 2384 (localidad DPA 170105), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Cochapamba','INEC CGE 2026, hoja DPA 2025, fila 2383 (localidad DPA 170104), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Chimbacalle','INEC CGE 2026, hoja DPA 2025, fila 2388 (localidad DPA 170109), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Chillogallo','INEC CGE 2026, hoja DPA 2025, fila 2387 (localidad DPA 170108), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Chilibulo','INEC CGE 2026, hoja DPA 2025, fila 2386 (localidad DPA 170107), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Centro Histórico','INEC CGE 2026, hoja DPA 2025, fila 2382 (localidad DPA 170103), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Carcelén','INEC CGE 2026, hoja DPA 2025, fila 2381 (localidad DPA 170102), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1701','Belisario Quevedo','INEC CGE 2026, hoja DPA 2025, fila 2380 (localidad DPA 170101), fila 2374 (cabecera actual DPA 170150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1705','San Rafael','INEC CGE 2026, hoja DPA 2025, fila 2553 (localidad DPA 170503), fila 2549 (cabecera actual DPA 170550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1705','San Pedro de Taboada','INEC CGE 2026, hoja DPA 2025, fila 2554 (localidad DPA 170502), fila 2549 (cabecera actual DPA 170550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('17','1705','Fajardo','INEC CGE 2026, hoja DPA 2025, fila 2554 (localidad DPA 170504), fila 2549 (cabecera actual DPA 170550); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('18','1801','San Francisco','INEC CGE 2026, hoja DPA 2025, fila 2607 (localidad DPA 180109), fila 2600 (cabecera actual DPA 180150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('18','1801','Pishilata','INEC CGE 2026, hoja DPA 2025, fila 2606 (localidad DPA 180108), fila 2600 (cabecera actual DPA 180150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('18','1801','Matriz','INEC CGE 2026, hoja DPA 2025, fila 2605 (localidad DPA 180107), fila 2600 (cabecera actual DPA 180150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('18','1801','La Península','INEC CGE 2026, hoja DPA 2025, fila 2604 (localidad DPA 180106), fila 2600 (cabecera actual DPA 180150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('18','1801','La Merced','INEC CGE 2026, hoja DPA 2025, fila 2608 (localidad DPA 180105), fila 2600 (cabecera actual DPA 180150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('18','1801','Huachi Loreto','INEC CGE 2026, hoja DPA 2025, fila 2607 (localidad DPA 180104), fila 2600 (cabecera actual DPA 180150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('18','1801','Huachi Chico','INEC CGE 2026, hoja DPA 2025, fila 2606 (localidad DPA 180103), fila 2600 (cabecera actual DPA 180150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('18','1801','Celiano Monge','INEC CGE 2026, hoja DPA 2025, fila 2605 (localidad DPA 180102), fila 2600 (cabecera actual DPA 180150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('18','1801','Atocha – Ficoa','INEC CGE 2026, hoja DPA 2025, fila 2604 (localidad DPA 180101), fila 2600 (cabecera actual DPA 180150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('18','1807','Pelileo Grande','INEC CGE 2026, hoja DPA 2025, fila 2678 (localidad DPA 180702), fila 2674 (cabecera actual DPA 180750); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('18','1808','Ciudad Nueva','INEC CGE 2026, hoja DPA 2025, fila 2695 (localidad DPA 180801), fila 2691 (cabecera actual DPA 180850); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('19','1901','El Limón','INEC CGE 2026, hoja DPA 2025, fila 2732 (localidad DPA 190101), fila 2728 (cabecera actual DPA 190150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('22','2201','Puerto Francisco de Orellana','INEC CGE 2026, hoja DPA 2025, fila 3000 (localidad DPA 220150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('22','2201','El Coca','INEC CGE 2026, hoja DPA 2025, fila 3000 (localidad DPA 220150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('22','2202','Tiputini','INEC CGE 2026, hoja DPA 2025, fila 3019 (localidad DPA 220202), fila 3015 (cabecera actual DPA 220250); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('23','2301','Zaracay','INEC CGE 2026, hoja DPA 2025, fila 3068 (localidad DPA 230107), fila 3062 (cabecera actual DPA 230150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('23','2301','Río Verde','INEC CGE 2026, hoja DPA 2025, fila 3066 (localidad DPA 230105), fila 3062 (cabecera actual DPA 230150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('23','2301','Río Toachi','INEC CGE 2026, hoja DPA 2025, fila 3069 (localidad DPA 230104), fila 3062 (cabecera actual DPA 230150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('23','2301','Chiguilpe','INEC CGE 2026, hoja DPA 2025, fila 3068 (localidad DPA 230103), fila 3062 (cabecera actual DPA 230150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('23','2301','Bombolí','INEC CGE 2026, hoja DPA 2025, fila 3067 (localidad DPA 230102), fila 3062 (cabecera actual DPA 230150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('23','2301','Abraham Calazacón','INEC CGE 2026, hoja DPA 2025, fila 3066 (localidad DPA 230101), fila 3062 (cabecera actual DPA 230150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('24','2401','Ballenita','INEC CGE 2026, hoja DPA 2025, fila 3106 (localidad DPA 240101), fila 3102 (cabecera actual DPA 240150); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('24','2403','Vicente Rocafuerte','INEC CGE 2026, hoja DPA 2025, fila 3128 (localidad DPA 240303), fila 3124 (cabecera actual DPA 240350); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('24','2403','Santa Rosa','INEC CGE 2026, hoja DPA 2025, fila 3129 (localidad DPA 240304), fila 3124 (cabecera actual DPA 240350); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('24','2403','General Alberto Enríquez Gallo','INEC CGE 2026, hoja DPA 2025, fila 3129 (localidad DPA 240302), fila 3124 (cabecera actual DPA 240350); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('24','2403','Carlos Espinoza Larrea','INEC CGE 2026, hoja DPA 2025, fila 3128 (localidad DPA 240301), fila 3124 (cabecera actual DPA 240350); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('09','092251','Coronel Lorenzo de Garaicoa','INEC CGE 2026, hoja DPA 2025, fila 1244 (localidad histórica DPA 092051) y fila 1262 (localidad actual DPA 092251); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('13','131752','10 de Agosto','INEC CGE 2026, hoja DPA 2025, fila 1998 (localidad histórica DPA 131454) y fila 2030 (localidad actual DPA 131752); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('14','140953','Tuutinentza','INEC CGE 2026, hoja DPA 2025, fila 2093 (localidad histórica DPA 140161) y fila 2195 (localidad actual DPA 140953); cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e'),
    ('05','050751','Chucchilán (Chugchilán)','INEC CGE 2026, hoja DPA 2025: fila 537, parroquia histórica DPA 050452 *CHUCCHILÁN (CHUGCHILÁN); fila 572, parroquia vigente DPA 050751 CHUGCHILLÁN; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('05','050752','Isinlibí (Isinliví)','INEC CGE 2026, hoja DPA 2025: fila 539, parroquia histórica DPA 050454 *ISINLIBÍ (ISINLIVÍ); fila 573, parroquia vigente DPA 050752 ISINLIVI; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('07','0714','Las Lajas','INEC CGE 2026, hoja DPA 2025: fila 744, parroquia histórica DPA 070253 *LAS LAJAS (CAB. EN LA VICTORIA); fila 885, Cantón Las Lajas; fila 889, cabecera vigente DPA 071450 LA VICTORIA; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('09','0921','Playas (Gral. Villamil)','INEC CGE 2026, hoja DPA 2025: fila 1063, parroquia histórica DPA 090155 *PLAYAS (GRAL. VILLAMIL); fila 1035, cantón vigente Playas; fila 1252, cabecera vigente DPA 092150 GENERAL VILLAMIL; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('09','092251','Coronel Lorenzo de Garaicoa (Pedregal)','INEC CGE 2026, hoja DPA 2025: fila 1244, parroquia histórica DPA 092051 *CORONEL LORENZO DE GARAICOA (PEDREGAL); fila 1262, parroquia vigente DPA 092251 CORONEL LORENZO DE GARAYCOA; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('09','0923','Coronel Marcelino Maridueña (San Carlos)','INEC CGE 2026, hoja DPA 2025: fila 1245, parroquia histórica DPA 092052 *CORONEL MARCELINO MARIDUEÑA (SAN CARLOS); fila 1037, cantón vigente Coronel Marcelino Maridueña; fila 1268, cabecera vigente DPA 092350; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('09','0925','Piedrahita (Nobol)','INEC CGE 2026, hoja DPA 2025: fila 1113, parroquia histórica DPA 090657 *PIEDRAHITA (NOBOL); fila 1039, cantón vigente Nobol; fila 1284, cabecera vigente DPA 092550 NARCISA DE JESÚS; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('09','0927','General Elizalde (Bucay)','INEC CGE 2026, hoja DPA 2025: fila 1160, parroquia histórica DPA 091052 *GENERAL ELIZALDE (BUCAY); fila 1041, cantón vigente DPA 0927 GENERAL ANTONIO ELIZALDE; fila 1292, cabecera vigente DPA 092750; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('09','0928','Isidro Ayora (Soledad)','INEC CGE 2026, hoja DPA 2025: filas 1111 y 1278, parroquias históricas DPA 090651 y 092451 *ISIDRO AYORA (SOLEDAD); fila 1042, cantón vigente Isidro Ayora; fila 1298, cabecera vigente DPA 092850; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('11','1114','Pindal (Federico Páez)','INEC CGE 2026, hoja DPA 2025: fila 1477, parroquia histórica DPA 110454 *PINDAL (FEDERICO PÁEZ); fila 1409, cantón vigente Pindal; fila 1600, cabecera vigente DPA 111450 PINDAL; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('11','1115','Quilanga (La Paz)','INEC CGE 2026, hoja DPA 2025: fila 1510, parroquia histórica DPA 110755 *QUILANGA (LA PAZ); fila 1410, cantón vigente Quilanga; fila 1611, cabecera vigente DPA 111550 QUILANGA; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('11','1116','Olmedo (Santa Bárbara)','INEC CGE 2026, hoja DPA 2025: fila 1546, parroquia histórica DPA 110955 *OLMEDO (SANTA BÁRBARA); fila 1411, cantón vigente Olmedo; fila 1621, cabecera vigente DPA 111650 OLMEDO; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('12','1201','Barreiro (Santa Rita)','INEC CGE 2026, hoja DPA 2025: fila 1652, parroquia histórica DPA 120151 *BARREIRO (SANTA RITA); fila 1647, parroquia urbana vigente DPA 120103 BARREIRO bajo Babahoyo; fila 1643, cabecera vigente DPA 120150 BABAHOYO; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('14','140852','San Carlos de Limón (San Carlos del Zamora)','INEC CGE 2026, hoja DPA 2025: fila 2126–2127, parroquia histórica DPA 140354 *SAN CARLOS DE LIMÓN (SAN CARLOS DEL ZAMORA); fila 2185, parroquia vigente DPA 140852 SAN CARLOS DE LIMÓN; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('15','1509','Carlos Julio Arosemena Tola (Zatza-Yacu)','INEC CGE 2026, hoja DPA 2025: fila 2250, parroquia histórica DPA 150152 *CARLOS JULIO AROSEMENA TOLA (ZATZA-YACU); fila 2238, cantón vigente Carlos Julio Arosemena Tola; fila 2303, cabecera vigente DPA 150950; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.'),
    ('09','0901','Chongón','INEC CGE 2026, hoja DPA 2025: fila 1063, parroquia histórica DPA 090151 *CHONGÓN del cantón 0901 Guayaquil; la nota de la fila 7 la clasifica como rural que pasó a urbana o fue suprimida y no figura bajo otro cantón ni provincia; fila 1048, cabecera vigente DPA 090150 GUAYAQUIL; cge2026.xls SHA-256 6e547717403a0b3894e3ff09cbcf2f0257ec7416cca2e6fb1b87e8885dc90c4e.')
  ) AS seed(province_code,city_code,nombre_alias,fuente_evidencia)
  JOIN pliego.provincia p ON p.codigo_dpa=seed.province_code
  JOIN pliego.ciudad c ON c.provincia_id=p.provincia_id AND c.codigo_dpa=seed.city_code AND c.activo;

DO $$
BEGIN
    IF (SELECT count(*) FROM pliego.provincia)<>24
       OR (SELECT count(*) FROM pliego.ciudad)<>1171
       OR (SELECT count(*) FROM pliego.ciudad WHERE tipo='CABECERA_CANTONAL')<>223
       OR (SELECT count(*) FROM pliego.ciudad WHERE tipo='CABECERA_CANTONAL' AND activo)<>222
       OR (SELECT count(*) FROM pliego.ciudad WHERE activo)<>1048
       OR (SELECT count(*) FROM pliego.ciudad_alias)<>278 THEN
        RAISE EXCEPTION 'INEC CGE 2026 catalog seed count mismatch';
    END IF;
END; $$;

ALTER TABLE pliego.direccion ADD COLUMN provincia_id BIGINT;
ALTER TABLE pliego.direccion ADD COLUMN ciudad_id BIGINT;
ALTER TABLE pliego.direccion ADD CONSTRAINT ck_direccion_geo_pair CHECK ((provincia_id IS NULL) = (ciudad_id IS NULL));
ALTER TABLE pliego.direccion ADD CONSTRAINT fk_direccion_provincia_ciudad FOREIGN KEY (provincia_id,ciudad_id) REFERENCES pliego.ciudad(provincia_id,ciudad_id) ON DELETE RESTRICT;
CREATE INDEX ix_direccion_geo_pair ON pliego.direccion(provincia_id,ciudad_id) WHERE provincia_id IS NOT NULL;

ALTER TABLE pliego.ubicacion_retiro ADD COLUMN provincia_id BIGINT;
ALTER TABLE pliego.ubicacion_retiro ADD COLUMN ciudad_id BIGINT;
ALTER TABLE pliego.ubicacion_retiro ADD CONSTRAINT ck_ubicacion_retiro_geo_pair CHECK ((provincia_id IS NULL) = (ciudad_id IS NULL));
ALTER TABLE pliego.ubicacion_retiro ADD CONSTRAINT fk_ubicacion_retiro_provincia_ciudad FOREIGN KEY (provincia_id,ciudad_id) REFERENCES pliego.ciudad(provincia_id,ciudad_id) ON DELETE RESTRICT;
CREATE INDEX ix_ubicacion_retiro_geo_pair ON pliego.ubicacion_retiro(provincia_id,ciudad_id) WHERE provincia_id IS NOT NULL;

-- Legacy name matching is exact after the repository accent/case fold: a city name, a canton name for its seat,
-- or one official alias. Only one province and one active city may match; ambiguous and unmatched rows keep
-- their original text and null identifiers. Immutable order/invoice/pickup snapshots are untouched.
WITH matches AS (
    SELECT d.direccion_id,ids.province_id,ids.city_id
      FROM pliego.direccion d
      LEFT JOIN LATERAL (
        SELECT min(p.provincia_id) AS province_id,min(c.ciudad_id) AS city_id
          FROM pliego.provincia p
          JOIN pliego.ciudad c ON c.provincia_id=p.provincia_id AND c.activo
         WHERE p.activo AND p.search_key=pliego.fn_search_fold(btrim(d.provincia))
           AND (c.search_key=pliego.fn_search_fold(btrim(d.ciudad))
                OR (c.tipo='CABECERA_CANTONAL' AND pliego.fn_search_fold(c.canton_nombre)=pliego.fn_search_fold(btrim(d.ciudad)))
                OR EXISTS (SELECT FROM pliego.ciudad_alias a
                            WHERE a.provincia_id=c.provincia_id AND a.ciudad_id=c.ciudad_id
                              AND a.search_key=pliego.fn_search_fold(btrim(d.ciudad))))
         HAVING (SELECT count(*) FROM pliego.provincia p2
                  WHERE p2.activo AND p2.search_key=pliego.fn_search_fold(btrim(d.provincia)))=1
            AND count(DISTINCT c.ciudad_id)=1
      ) ids ON TRUE
     WHERE d.provincia_id IS NULL AND d.ciudad_id IS NULL
)
UPDATE pliego.direccion d SET provincia_id=m.province_id,ciudad_id=m.city_id
  FROM matches m
 WHERE d.direccion_id=m.direccion_id AND m.province_id IS NOT NULL AND m.city_id IS NOT NULL;

WITH matches AS (
    SELECT u.ubicacion_retiro_id,ids.province_id,ids.city_id
      FROM pliego.ubicacion_retiro u
      LEFT JOIN LATERAL (
        SELECT min(p.provincia_id) AS province_id,min(c.ciudad_id) AS city_id
          FROM pliego.provincia p
          JOIN pliego.ciudad c ON c.provincia_id=p.provincia_id AND c.activo
         WHERE p.activo AND p.search_key=pliego.fn_search_fold(btrim(u.provincia))
           AND (c.search_key=pliego.fn_search_fold(btrim(u.ciudad))
                OR (c.tipo='CABECERA_CANTONAL' AND pliego.fn_search_fold(c.canton_nombre)=pliego.fn_search_fold(btrim(u.ciudad)))
                OR EXISTS (SELECT FROM pliego.ciudad_alias a
                            WHERE a.provincia_id=c.provincia_id AND a.ciudad_id=c.ciudad_id
                              AND a.search_key=pliego.fn_search_fold(btrim(u.ciudad))))
         HAVING (SELECT count(*) FROM pliego.provincia p2
                  WHERE p2.activo AND p2.search_key=pliego.fn_search_fold(btrim(u.provincia)))=1
            AND count(DISTINCT c.ciudad_id)=1
      ) ids ON TRUE
     WHERE u.provincia_id IS NULL AND u.ciudad_id IS NULL
)
UPDATE pliego.ubicacion_retiro u SET provincia_id=m.province_id,ciudad_id=m.city_id
  FROM matches m
 WHERE u.ubicacion_retiro_id=m.ubicacion_retiro_id AND m.province_id IS NOT NULL AND m.city_id IS NOT NULL;

-- No runtime role can mutate reference values; migrations execute as the owning database role.
REVOKE ALL ON TABLE pliego.provincia,pliego.ciudad FROM PUBLIC;
GRANT SELECT ON TABLE pliego.provincia,pliego.ciudad TO PUBLIC;
REVOKE ALL ON TABLE pliego.ciudad_alias FROM PUBLIC;
GRANT SELECT ON TABLE pliego.ciudad_alias TO PUBLIC;
-- Production default privileges grant DML to pliego_app on new tables; PUBLIC revokes alone do not remove them.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
        EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE pliego.provincia,pliego.ciudad,pliego.ciudad_alias FROM pliego_app';
        EXECUTE 'GRANT SELECT ON TABLE pliego.provincia,pliego.ciudad,pliego.ciudad_alias TO pliego_app';
    END IF;
END; $$;

CREATE FUNCTION pliego.fn_assert_geo_city(p_province_id BIGINT,p_city_id BIGINT)
RETURNS TABLE(province_name VARCHAR,city_name VARCHAR)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE selected_province VARCHAR; city_province BIGINT; selected_city VARCHAR;
        city_active BOOLEAN; actual_province_active BOOLEAN;
BEGIN
    SELECT p.nombre INTO selected_province
      FROM pliego.provincia p WHERE p.provincia_id=p_province_id AND p.activo;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5015','GEO_CITY_UNAVAILABLE'); END IF;
    SELECT c.provincia_id,c.nombre,c.activo,p.activo
      INTO city_province,selected_city,city_active,actual_province_active
      FROM pliego.ciudad c JOIN pliego.provincia p USING (provincia_id)
     WHERE c.ciudad_id=p_city_id;
    IF NOT FOUND OR NOT city_active OR NOT actual_province_active THEN
        PERFORM pliego.fn_raise_domain_error('P5015','GEO_CITY_UNAVAILABLE');
    END IF;
    IF city_province IS DISTINCT FROM p_province_id THEN
        PERFORM pliego.fn_raise_domain_error('P5014','GEO_CITY_PROVINCE_INVALID');
    END IF;
    RETURN QUERY SELECT selected_province,selected_city;
END; $$;

CREATE FUNCTION pliego.fn_geo_provinces()
RETURNS TABLE(province_id BIGINT,code CHAR(2),name VARCHAR)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT p.provincia_id,p.codigo_dpa,p.nombre
      FROM pliego.provincia p
     WHERE p.activo
     ORDER BY p.nombre COLLATE pliego.catalog_title_es,p.codigo_dpa;
$$;

-- Name-only compatibility adapters resolve canonical city names, canton-seat names or one official alias.
CREATE FUNCTION pliego.fn_geo_ids_from_names(p_city TEXT,p_province TEXT)
RETURNS TABLE(province_id BIGINT,city_id BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE matched_province BIGINT; province_matches BIGINT; matched_city BIGINT; city_matches BIGINT;
        city_key TEXT:=pliego.fn_search_fold(btrim(p_city));
BEGIN
    SELECT min(p.provincia_id),count(*) INTO matched_province,province_matches
      FROM pliego.provincia p
     WHERE p.activo AND p.search_key=pliego.fn_search_fold(btrim(p_province));
    IF province_matches IS DISTINCT FROM 1 OR city_key IS NULL OR city_key='' THEN
        PERFORM pliego.fn_raise_domain_error('P5015','GEO_CITY_UNAVAILABLE');
    END IF;
    SELECT min(c.ciudad_id),count(DISTINCT c.ciudad_id) INTO matched_city,city_matches
      FROM pliego.ciudad c
     WHERE c.provincia_id=matched_province AND c.activo
       AND (c.search_key=city_key
            OR (c.tipo='CABECERA_CANTONAL' AND pliego.fn_search_fold(c.canton_nombre)=city_key)
            OR EXISTS (SELECT FROM pliego.ciudad_alias a
                        WHERE a.provincia_id=c.provincia_id AND a.ciudad_id=c.ciudad_id AND a.search_key=city_key));
    IF city_matches=0 AND EXISTS (
        SELECT FROM pliego.ciudad c
         WHERE c.activo AND c.provincia_id<>matched_province
           AND (c.search_key=city_key
                OR (c.tipo='CABECERA_CANTONAL' AND pliego.fn_search_fold(c.canton_nombre)=city_key)
                OR EXISTS (SELECT FROM pliego.ciudad_alias a
                            WHERE a.provincia_id=c.provincia_id AND a.ciudad_id=c.ciudad_id AND a.search_key=city_key))
    ) THEN
        PERFORM pliego.fn_raise_domain_error('P5014','GEO_CITY_PROVINCE_INVALID');
    END IF;
    IF city_matches IS DISTINCT FROM 1 THEN
        PERFORM pliego.fn_raise_domain_error('P5015','GEO_CITY_UNAVAILABLE');
    END IF;
    RETURN QUERY SELECT matched_province,matched_city;
END; $$;

CREATE FUNCTION pliego.fn_geo_cities(p_province_id BIGINT)
RETURNS TABLE(city_id BIGINT,code VARCHAR,name VARCHAR,kind VARCHAR,canton_name VARCHAR,aliases TEXT[])
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT c.ciudad_id,c.codigo_dpa,c.nombre,c.tipo,c.canton_nombre,
           COALESCE(array_agg(a.nombre_alias ORDER BY a.nombre_alias COLLATE pliego.catalog_title_es)
                    FILTER (WHERE a.ciudad_alias_id IS NOT NULL),ARRAY[]::TEXT[])
      FROM pliego.ciudad c
      JOIN pliego.provincia p USING (provincia_id)
      LEFT JOIN pliego.ciudad_alias a ON a.provincia_id=c.provincia_id AND a.ciudad_id=c.ciudad_id
     WHERE c.provincia_id=p_province_id AND c.activo AND p.activo
     GROUP BY c.ciudad_id,c.codigo_dpa,c.nombre,c.tipo,c.canton_nombre
     ORDER BY c.nombre COLLATE pliego.catalog_title_es,
              c.canton_nombre COLLATE pliego.catalog_title_es,c.codigo_dpa;
$$;

DROP FUNCTION pliego.fn_address_list(BIGINT);
CREATE FUNCTION pliego.fn_address_list(p_actor_user_id BIGINT)
RETURNS TABLE(address_id BIGINT,alias VARCHAR,recipient VARCHAR,line1 VARCHAR,line2 VARCHAR,city VARCHAR,province VARCHAR,
    province_id BIGINT,city_id BIGINT,city_needs_review BOOLEAN,country_code CHAR(2),postal_code VARCHAR,
    reference VARCHAR,phone VARCHAR,is_primary BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE customer_id BIGINT;
BEGIN
    SELECT a.cliente_id INTO customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER') a;
    RETURN QUERY
        SELECT d.direccion_id,d.alias,d.destinatario,d.direccion_linea1,d.direccion_linea2,d.ciudad,d.provincia,
               d.provincia_id,d.ciudad_id,(d.provincia_id IS NULL OR d.ciudad_id IS NULL),
               d.pais_codigo,d.codigo_postal,d.referencia,d.telefono,d.es_principal
          FROM pliego.direccion d
         WHERE d.cliente_id=customer_id
         ORDER BY d.es_principal DESC,d.fecha_creacion,d.direccion_id;
END; $$;

DROP PROCEDURE pliego.sp_address_create(BIGINT,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,BOOLEAN);
DROP PROCEDURE pliego.sp_address_update(BIGINT,BIGINT,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR);
DROP PROCEDURE pliego.sp_address_create_idempotent(BIGINT,UUID,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,BOOLEAN);

CREATE PROCEDURE pliego.sp_address_create(IN p_actor_user_id BIGINT,IN p_alias VARCHAR,IN p_recipient VARCHAR,
    IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_province_id BIGINT,IN p_city_id BIGINT,IN p_country_code VARCHAR,
    IN p_postal_code VARCHAR,IN p_reference VARCHAR,IN p_phone VARCHAR,IN p_make_primary BOOLEAN,OUT o_address_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE customer_id BIGINT; country_code TEXT; normalized_phone TEXT; province_name VARCHAR; city_name VARCHAR;
BEGIN
    SELECT a.cliente_id INTO customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER') a;
    SELECT names.province_name,names.city_name INTO province_name,city_name
      FROM pliego.fn_assert_geo_city(p_province_id,p_city_id) names;
    country_code:=pliego.fn_normalize_country_code(p_country_code);
    normalized_phone:=pliego.fn_normalize_phone(p_phone);
    IF p_alias IS NULL OR char_length(btrim(p_alias)) NOT BETWEEN 1 AND 80
       OR p_recipient IS NULL OR char_length(btrim(p_recipient)) NOT BETWEEN 1 AND 241
       OR p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 1 AND 200
       OR char_length(p_line2)>200 OR country_code IS DISTINCT FROM 'EC'
       OR NOT pliego.fn_is_valid_country_code(country_code)
       OR char_length(p_postal_code)>20 OR char_length(p_reference)>300
       OR normalized_phone IS NULL OR normalized_phone !~ '^\+?[0-9]{7,19}$' THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    IF COALESCE(p_make_primary,FALSE) THEN
        PERFORM 1 FROM pliego.cliente c WHERE c.cliente_id=customer_id FOR UPDATE;
        UPDATE pliego.direccion SET es_principal=FALSE WHERE cliente_id=customer_id AND es_principal;
    END IF;
    INSERT INTO pliego.direccion(cliente_id,alias,destinatario,direccion_linea1,direccion_linea2,
        ciudad,provincia,provincia_id,ciudad_id,pais_codigo,codigo_postal,referencia,telefono,es_principal)
    VALUES(customer_id,btrim(p_alias),btrim(p_recipient),btrim(p_line1),NULLIF(btrim(p_line2),''),
        city_name,province_name,p_province_id,p_city_id,country_code::CHAR(2),NULLIF(btrim(p_postal_code),''),
        NULLIF(btrim(p_reference),''),normalized_phone,COALESCE(p_make_primary,FALSE))
    RETURNING direccion_id INTO o_address_id;
END; $$;

CREATE PROCEDURE pliego.sp_address_update(IN p_actor_user_id BIGINT,IN p_address_id BIGINT,IN p_alias VARCHAR,
    IN p_recipient VARCHAR,IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_province_id BIGINT,IN p_city_id BIGINT,
    IN p_country_code VARCHAR,IN p_postal_code VARCHAR,IN p_reference VARCHAR,IN p_phone VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE customer_id BIGINT; country_code TEXT; normalized_phone TEXT; province_name VARCHAR; city_name VARCHAR;
BEGIN
    SELECT a.cliente_id INTO customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER') a;
    SELECT names.province_name,names.city_name INTO province_name,city_name
      FROM pliego.fn_assert_geo_city(p_province_id,p_city_id) names;
    country_code:=pliego.fn_normalize_country_code(p_country_code);
    normalized_phone:=pliego.fn_normalize_phone(p_phone);
    IF p_alias IS NULL OR char_length(btrim(p_alias)) NOT BETWEEN 1 AND 80
       OR p_recipient IS NULL OR char_length(btrim(p_recipient)) NOT BETWEEN 1 AND 241
       OR p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 1 AND 200
       OR char_length(p_line2)>200 OR country_code IS DISTINCT FROM 'EC'
       OR NOT pliego.fn_is_valid_country_code(country_code)
       OR char_length(p_postal_code)>20 OR char_length(p_reference)>300
       OR normalized_phone IS NULL OR normalized_phone !~ '^\+?[0-9]{7,19}$' THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    UPDATE pliego.direccion SET alias=btrim(p_alias),destinatario=btrim(p_recipient),
        direccion_linea1=btrim(p_line1),direccion_linea2=NULLIF(btrim(p_line2),''),
        ciudad=city_name,provincia=province_name,provincia_id=p_province_id,ciudad_id=p_city_id,
        pais_codigo=country_code::CHAR(2),codigo_postal=NULLIF(btrim(p_postal_code),''),
        referencia=NULLIF(btrim(p_reference),''),telefono=normalized_phone
     WHERE direccion_id=p_address_id AND cliente_id=customer_id;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P1103','ADDRESS_NOT_FOUND'); END IF;
END; $$;

CREATE PROCEDURE pliego.sp_address_create_idempotent(IN p_actor BIGINT,IN p_key UUID,IN p_alias VARCHAR,
    IN p_recipient VARCHAR,IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_province_id BIGINT,IN p_city_id BIGINT,
    IN p_country VARCHAR,IN p_postal VARCHAR,IN p_reference VARCHAR,IN p_phone VARCHAR,IN p_primary BOOLEAN,
    OUT o_address_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE attempt pliego.address_create_attempt%ROWTYPE; fingerprint TEXT;
BEGIN
    PERFORM * FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
    IF p_key IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
    fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_alias,p_recipient,p_line1,p_line2,
        p_province_id,p_city_id,p_country,p_postal,p_reference,p_phone,p_primary)::TEXT,'UTF8')),'hex');
    PERFORM pg_advisory_xact_lock(hashtextextended('address:'||p_actor||':'||p_key,0));
    SELECT * INTO attempt FROM pliego.address_create_attempt
     WHERE actor_user_id=p_actor AND attempt_key=p_key;
    IF FOUND THEN
        IF attempt.state='NOT_CREATED' THEN PERFORM pliego.fn_raise_domain_error('P1011','ATTEMPT_NOT_CREATED'); END IF;
        IF attempt.fingerprint IS DISTINCT FROM fingerprint THEN
            PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT');
        END IF;
        o_address_id:=attempt.address_id;
        RETURN;
    END IF;
    CALL pliego.sp_address_create(p_actor,p_alias,p_recipient,p_line1,p_line2,p_province_id,p_city_id,
        p_country,p_postal,p_reference,p_phone,p_primary,o_address_id);
    INSERT INTO pliego.address_create_attempt VALUES(p_actor,p_key,'CREATED',fingerprint,o_address_id);
END; $$;

DROP FUNCTION pliego.fn_pickup_locations();
CREATE FUNCTION pliego.fn_pickup_locations()
RETURNS TABLE(pickup_location_id BIGINT,name VARCHAR,address VARCHAR,city VARCHAR,province VARCHAR,
    province_id BIGINT,city_id BIGINT,country_code CHAR(2),postal_code VARCHAR,latitude NUMERIC,longitude NUMERIC,
    timezone VARCHAR,opens_at TIME,closes_at TIME,active BOOLEAN,preparation_minutes INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT u.ubicacion_retiro_id,u.nombre,u.direccion,u.ciudad,u.provincia,u.provincia_id,u.ciudad_id,
           u.pais_codigo,u.codigo_postal,u.latitud,u.longitud,u.zona_horaria,u.apertura,u.cierre,u.activo,u.preparacion_minutos
      FROM pliego.ubicacion_retiro u WHERE u.activo
     ORDER BY u.nombre,u.ubicacion_retiro_id;
$$;

DROP PROCEDURE pliego.sp_pickup_location_update(BIGINT,BIGINT,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,NUMERIC,NUMERIC,VARCHAR,TIME,TIME,BOOLEAN,INTEGER);
CREATE PROCEDURE pliego.sp_pickup_location_update(IN p_actor BIGINT,IN p_location BIGINT,IN p_name VARCHAR,
    IN p_address VARCHAR,IN p_province_id BIGINT,IN p_city_id BIGINT,IN p_country VARCHAR,IN p_postal VARCHAR,
    IN p_latitude NUMERIC,IN p_longitude NUMERIC,IN p_timezone VARCHAR,IN p_opens TIME,IN p_closes TIME,
    IN p_active BOOLEAN,IN p_preparation INTEGER)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE province_name VARCHAR;city_name VARCHAR;country_code TEXT;
BEGIN
    PERFORM * FROM pliego.fn_assert_actor(p_actor,'ADMIN');
    SELECT names.province_name,names.city_name INTO province_name,city_name
      FROM pliego.fn_assert_geo_city(p_province_id,p_city_id) names;
    country_code:=pliego.fn_normalize_country_code(p_country);
    IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 200
       OR p_address IS NULL OR char_length(btrim(p_address)) NOT BETWEEN 1 AND 200
       OR country_code IS DISTINCT FROM 'EC' OR NOT pliego.fn_is_valid_country_code(country_code)
       OR p_latitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90
       OR p_longitude IS NULL OR p_longitude NOT BETWEEN -180 AND 180
       OR p_timezone IS NULL OR NOT pliego.fn_pickup_timezone_valid(p_timezone) OR char_length(p_timezone)>80
       OR p_opens IS NULL OR p_closes IS NULL OR p_opens=p_closes
       OR p_active IS NULL OR p_preparation IS NULL OR p_preparation NOT BETWEEN 1 AND 1440
       OR char_length(p_postal)>20 THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    UPDATE pliego.ubicacion_retiro SET nombre=btrim(p_name),direccion=btrim(p_address),ciudad=city_name,
        provincia=province_name,provincia_id=p_province_id,ciudad_id=p_city_id,pais_codigo=country_code,
        codigo_postal=p_postal,latitud=p_latitude,longitud=p_longitude,zona_horaria=p_timezone,
        apertura=p_opens,cierre=p_closes,activo=p_active,preparacion_minutos=p_preparation
     WHERE ubicacion_retiro_id=p_location;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5010','PICKUP_LOCATION_NOT_FOUND'); END IF;
END; $$;

-- Retain the text-based database signature as a strict resolver for older SQL callers.
CREATE PROCEDURE pliego.sp_pickup_location_update(IN p_actor BIGINT,IN p_location BIGINT,IN p_name VARCHAR,
    IN p_address VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,IN p_country VARCHAR,IN p_postal VARCHAR,
    IN p_latitude NUMERIC,IN p_longitude NUMERIC,IN p_timezone VARCHAR,IN p_opens TIME,IN p_closes TIME,
    IN p_active BOOLEAN,IN p_preparation INTEGER)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE province_id BIGINT;city_id BIGINT;
BEGIN
    SELECT ids.province_id,ids.city_id INTO province_id,city_id
      FROM pliego.fn_geo_ids_from_names(p_city,p_province) ids;
    CALL pliego.sp_pickup_location_update(p_actor,p_location,p_name,p_address,province_id,city_id,
        p_country,p_postal,p_latitude,p_longitude,p_timezone,p_opens,p_closes,p_active,p_preparation);
END; $$;

DROP PROCEDURE pliego.sp_invoice_issue(BIGINT,BIGINT,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR);
CREATE PROCEDURE pliego.sp_invoice_issue(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,
    IN p_document_number VARCHAR,IN p_buyer_name VARCHAR,IN p_identity_type VARCHAR,IN p_identity_number VARCHAR,
    IN p_buyer_email VARCHAR,IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_province_id BIGINT,IN p_city_id BIGINT,
    IN p_country_code VARCHAR,IN p_postal_code VARCHAR,OUT o_invoice_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE order_row pliego.pedido%ROWTYPE;country_code VARCHAR;province_name VARCHAR;city_name VARCHAR;
BEGIN
    PERFORM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
    SELECT * INTO order_row FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
    IF EXISTS (SELECT FROM pliego.factura WHERE pedido_id=p_order_id) THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
    IF order_row.estado IN ('PENDING_PAYMENT','CANCELLED') OR NOT EXISTS (
        SELECT FROM pliego.pago WHERE pedido_id=p_order_id AND estado='APPROVED') THEN
        PERFORM pliego.fn_raise_domain_error('P5006','PAYMENT_STATE_INVALID');
    END IF;
    SELECT names.province_name,names.city_name INTO province_name,city_name
      FROM pliego.fn_assert_geo_city(p_province_id,p_city_id) names;
    country_code:=pliego.fn_normalize_country_code(p_country_code);
    IF p_document_number IS NULL OR char_length(btrim(p_document_number)) NOT BETWEEN 1 AND 80
       OR p_buyer_name IS NULL OR char_length(btrim(p_buyer_name)) NOT BETWEEN 1 AND 240
       OR p_identity_type IS NULL OR p_identity_type NOT IN ('NATIONAL_ID','TAX_ID','PASSPORT','OTHER')
       OR p_identity_number IS NULL OR char_length(btrim(p_identity_number)) NOT BETWEEN 1 AND 80
       OR (p_buyer_email IS NOT NULL AND (char_length(p_buyer_email)>254 OR p_buyer_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
       OR p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 1 AND 200 OR char_length(p_line2)>200
       OR country_code IS DISTINCT FROM 'EC' OR NOT pliego.fn_is_valid_country_code(country_code)
       OR char_length(p_postal_code)>20 THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    IF NOT EXISTS (SELECT FROM pliego.pedido_item WHERE pedido_id=p_order_id)
       OR (SELECT sum(subtotal) FROM pliego.pedido_item WHERE pedido_id=p_order_id)<>order_row.subtotal THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
    BEGIN
        INSERT INTO pliego.factura(pedido_id,numero_documento,estado,comprador_nombre,identidad_tipo,identidad_numero,
            comprador_email,subtotal,impuesto_total,total,usuario_emisor_id,impuesto_tasa,envio_monto)
        VALUES(p_order_id,btrim(p_document_number),'DRAFT',btrim(p_buyer_name),p_identity_type,btrim(p_identity_number),
            p_buyer_email,order_row.subtotal,order_row.impuesto_monto,order_row.total,p_actor_user_id,
            order_row.impuesto_tasa,order_row.envio_monto) RETURNING factura_id INTO o_invoice_id;
    EXCEPTION WHEN unique_violation THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END;
    INSERT INTO pliego.factura_direccion VALUES(o_invoice_id,btrim(p_line1),NULLIF(btrim(p_line2),''),
        city_name,province_name,country_code::CHAR(2),NULLIF(btrim(p_postal_code),''));
    INSERT INTO pliego.factura_item(factura_id,pedido_item_id,descripcion,cantidad,precio_unitario,subtotal,
        tratamiento_impuesto,impuesto_tasa,impuesto_monto,total)
    SELECT o_invoice_id,pedido_item_id,titulo_snapshot,cantidad,precio_unitario,subtotal,
        CASE WHEN impuesto_tasa=0 THEN 'NOT_ASSESSED' ELSE 'ASSESSED' END,
        CASE WHEN impuesto_tasa=0 THEN NULL ELSE impuesto_tasa END,impuesto_monto,subtotal+impuesto_monto
      FROM pliego.pedido_item WHERE pedido_id=p_order_id ORDER BY pedido_item_id;
    UPDATE pliego.factura SET estado='ISSUED',fecha_emision=CURRENT_TIMESTAMP WHERE factura_id=o_invoice_id;
END; $$;

DROP PROCEDURE pliego.sp_checkout_billed_quoted(BIGINT,UUID,BIGINT,VARCHAR,VARCHAR,BIGINT,VARCHAR,BIGINT,VARCHAR,
    VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR);
DROP PROCEDURE pliego.sp_checkout_billed_quoted(BIGINT,UUID,BIGINT,VARCHAR,VARCHAR,BIGINT,VARCHAR,BIGINT,VARCHAR,
    VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR);

CREATE PROCEDURE pliego.sp_checkout_billed_quoted(IN p_actor BIGINT,IN p_key UUID,IN p_address BIGINT,
    IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,IN p_fulfillment VARCHAR,IN p_pickup BIGINT,
    IN p_quote VARCHAR,IN p_recipient_kind VARCHAR,IN p_identity_type VARCHAR,IN p_identity_number VARCHAR,
    IN p_buyer_name VARCHAR,IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_province_id BIGINT,IN p_city_id BIGINT,
    IN p_country VARCHAR,IN p_postal VARCHAR,OUT o_order_id BIGINT,OUT o_order_state VARCHAR,
    OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR,OUT o_invoice_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE fingerprint VARCHAR;legacy_fingerprint VARCHAR;previous VARCHAR;email VARCHAR;
        receipt_exists BOOLEAN;receipt pliego.checkout_attempt%ROWTYPE;customer BIGINT;identity_matches BOOLEAN;
        recipient_kind TEXT:=COALESCE(p_recipient_kind,'ACCOUNT');
        province_name VARCHAR;city_name VARCHAR;country_code TEXT;
BEGIN
    SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
    IF p_key IS NULL OR recipient_kind NOT IN ('ACCOUNT','OTHER') THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    SELECT names.province_name,names.city_name INTO province_name,city_name
      FROM pliego.fn_assert_geo_city(p_province_id,p_city_id) names;
    country_code:=pliego.fn_normalize_country_code(p_country);
    IF country_code IS DISTINCT FROM 'EC' THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('checkout:'||p_actor||':'||p_key,0));
    legacy_fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_identity_type,btrim(p_identity_number),
        btrim(p_buyer_name),btrim(p_line1),NULLIF(btrim(p_line2),''),city_name,province_name,
        country_code,NULLIF(btrim(p_postal),''))::TEXT,'UTF8')),'hex');
    fingerprint:=encode(sha256(convert_to(jsonb_build_array(recipient_kind,p_identity_type,btrim(p_identity_number),
        btrim(p_buyer_name),btrim(p_line1),NULLIF(btrim(p_line2),''),p_province_id,p_city_id,
        country_code,NULLIF(btrim(p_postal),''))::TEXT,'UTF8')),'hex');
    SELECT * INTO receipt FROM pliego.checkout_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key;
    receipt_exists:=FOUND;
    SELECT payload_fingerprint INTO previous FROM pliego.checkout_billing_attempt
     WHERE actor_user_id=p_actor AND attempt_key=p_key;
    IF receipt_exists AND previous IS DISTINCT FROM fingerprint
       AND NOT (recipient_kind='ACCOUNT' AND previous IS NOT DISTINCT FROM legacy_fingerprint)
       AND NOT EXISTS (SELECT FROM pliego.checkout_attempt
                        WHERE actor_user_id=p_actor AND attempt_key=p_key AND state='NOT_CREATED') THEN
        PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT');
    END IF;
    IF receipt_exists THEN
        IF receipt.state='NOT_CREATED' THEN PERFORM pliego.fn_raise_domain_error('P1011','ATTEMPT_NOT_CREATED'); END IF;
        IF receipt.quote_fingerprint IS DISTINCT FROM p_quote OR receipt.address_id IS DISTINCT FROM p_address
           OR receipt.payment_method IS DISTINCT FROM p_method OR receipt.simulation_outcome IS DISTINCT FROM p_outcome
           OR receipt.cart_id IS DISTINCT FROM p_cart
           OR receipt.fulfillment_method IS DISTINCT FROM COALESCE(p_fulfillment,'HOME_DELIVERY')
           OR receipt.pickup_location_id IS DISTINCT FROM p_pickup THEN
            PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT');
        END IF;
        o_order_id:=receipt.order_id;o_order_state:=receipt.order_state;o_payment_state:=receipt.payment_state;
        o_total:=receipt.total;o_payment_reference:=receipt.payment_reference;
        SELECT factura_id INTO o_invoice_id FROM pliego.factura WHERE pedido_id=o_order_id;
        RETURN;
    END IF;

    IF NOT pliego.fn_is_valid_ec_identification(p_identity_type,p_identity_number)
       OR p_buyer_name IS NULL OR char_length(btrim(p_buyer_name)) NOT BETWEEN 1 AND 240
       OR p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 1 AND 200 OR char_length(p_line2)>200
       OR char_length(p_postal)>20 THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    IF recipient_kind='ACCOUNT' THEN
        CALL pliego.sp_customer_identity_claim(customer,p_identity_type,p_identity_number,'CHECKOUT',identity_matches);
        IF NOT identity_matches THEN PERFORM pliego.fn_raise_domain_error('P1106','BILLING_IDENTITY_MISMATCH'); END IF;
    END IF;
    CALL pliego.sp_checkout_quoted(p_actor,p_key,p_address,p_method,p_outcome,p_cart,p_fulfillment,p_pickup,p_quote,
        o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
    INSERT INTO pliego.checkout_billing_attempt VALUES(p_actor,p_key,fingerprint);
    IF o_payment_state='REJECTED' THEN RETURN; END IF;
    SELECT email_normalizado INTO email FROM pliego.usuario WHERE usuario_id=p_actor;
    INSERT INTO pliego.factura(pedido_id,numero_documento,estado,comprador_nombre,identidad_tipo,identidad_numero,
        comprador_email,subtotal,impuesto_total,total,usuario_emisor_id,impuesto_tasa,envio_monto,destinatario_tipo,
        procedencia,emisor_nombre,emisor_identificacion,emisor_direccion,establecimiento,punto_emision)
    SELECT p.pedido_id,'DRAFT-'||p.pedido_id,'DRAFT',btrim(p_buyer_name),
        CASE p_identity_type WHEN 'EC_RUC' THEN 'TAX_ID' ELSE 'NATIONAL_ID' END,btrim(p_identity_number),email,
        p.subtotal,p.impuesto_monto,p.total,p_actor,p.impuesto_tasa,p.envio_monto,recipient_kind,'SIMULATED',
        'PLIEGO - EMISOR ACADEMICO','9999999999001','Entorno academico sin validez tributaria','999','999'
      FROM pliego.pedido p WHERE p.pedido_id=o_order_id RETURNING factura_id INTO o_invoice_id;
    INSERT INTO pliego.factura_direccion VALUES(o_invoice_id,btrim(p_line1),NULLIF(btrim(p_line2),''),
        city_name,province_name,country_code::CHAR(2),NULLIF(btrim(p_postal),''));
    INSERT INTO pliego.factura_item(factura_id,pedido_item_id,descripcion,cantidad,precio_unitario,subtotal,
        tratamiento_impuesto,impuesto_tasa,impuesto_monto,total)
    SELECT o_invoice_id,pedido_item_id,titulo_snapshot,cantidad,precio_unitario,subtotal,'ASSESSED',
        impuesto_tasa,impuesto_monto,subtotal+impuesto_monto
      FROM pliego.pedido_item WHERE pedido_id=o_order_id ORDER BY pedido_item_id;
    CALL pliego.sp_invoice_finalize_for_order(p_actor,o_order_id,o_invoice_id);
END; $$;

-- Keep the prior Database API overloads as catalog-resolving adapters; no text-only path can persist an arbitrary city.
CREATE PROCEDURE pliego.sp_checkout_billed_quoted(IN p_actor BIGINT,IN p_key UUID,IN p_address BIGINT,
    IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,IN p_fulfillment VARCHAR,IN p_pickup BIGINT,
    IN p_quote VARCHAR,IN p_identity_type VARCHAR,IN p_identity_number VARCHAR,IN p_buyer_name VARCHAR,
    IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,IN p_country VARCHAR,IN p_postal VARCHAR,
    OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,
    OUT o_payment_reference VARCHAR,OUT o_invoice_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE province_id BIGINT;city_id BIGINT;
BEGIN
    SELECT ids.province_id,ids.city_id INTO province_id,city_id
      FROM pliego.fn_geo_ids_from_names(p_city,p_province) ids;
    CALL pliego.sp_checkout_billed_quoted(p_actor,p_key,p_address,p_method,p_outcome,p_cart,p_fulfillment,p_pickup,
        p_quote,'ACCOUNT',p_identity_type,p_identity_number,p_buyer_name,p_line1,p_line2,province_id,city_id,
        p_country,p_postal,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference,o_invoice_id);
END; $$;

CREATE PROCEDURE pliego.sp_checkout_billed_quoted(IN p_actor BIGINT,IN p_key UUID,IN p_address BIGINT,
    IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,IN p_fulfillment VARCHAR,IN p_pickup BIGINT,
    IN p_quote VARCHAR,IN p_recipient_kind VARCHAR,IN p_identity_type VARCHAR,IN p_identity_number VARCHAR,
    IN p_buyer_name VARCHAR,IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,
    IN p_country VARCHAR,IN p_postal VARCHAR,OUT o_order_id BIGINT,OUT o_order_state VARCHAR,
    OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR,OUT o_invoice_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE province_id BIGINT;city_id BIGINT;
BEGIN
    SELECT ids.province_id,ids.city_id INTO province_id,city_id
      FROM pliego.fn_geo_ids_from_names(p_city,p_province) ids;
    CALL pliego.sp_checkout_billed_quoted(p_actor,p_key,p_address,p_method,p_outcome,p_cart,p_fulfillment,p_pickup,
        p_quote,p_recipient_kind,p_identity_type,p_identity_number,p_buyer_name,p_line1,p_line2,province_id,city_id,
        p_country,p_postal,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference,o_invoice_id);
END; $$;

-- Compatibility adapter resolves old invoice text through the same active catalog before creating the snapshot.
CREATE PROCEDURE pliego.sp_invoice_issue(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,
    IN p_document_number VARCHAR,IN p_buyer_name VARCHAR,IN p_identity_type VARCHAR,IN p_identity_number VARCHAR,
    IN p_buyer_email VARCHAR,IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,
    IN p_country_code VARCHAR,IN p_postal_code VARCHAR,OUT o_invoice_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE province_id BIGINT;city_id BIGINT;
BEGIN
    SELECT ids.province_id,ids.city_id INTO province_id,city_id
      FROM pliego.fn_geo_ids_from_names(p_city,p_province) ids;
    CALL pliego.sp_invoice_issue(p_actor_user_id,p_order_id,p_document_number,p_buyer_name,p_identity_type,
        p_identity_number,p_buyer_email,p_line1,p_line2,province_id,city_id,p_country_code,p_postal_code,o_invoice_id);
END; $$;

-- Text-based database signatures remain as strict adapters for older SQL callers; they cannot write unlinked names.
CREATE PROCEDURE pliego.sp_address_create(IN p_actor_user_id BIGINT,IN p_alias VARCHAR,IN p_recipient VARCHAR,
    IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,IN p_country_code VARCHAR,
    IN p_postal_code VARCHAR,IN p_reference VARCHAR,IN p_phone VARCHAR,IN p_make_primary BOOLEAN,OUT o_address_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE province_id BIGINT; city_id BIGINT;
BEGIN
    SELECT ids.province_id,ids.city_id INTO province_id,city_id
      FROM pliego.fn_geo_ids_from_names(p_city,p_province) ids;
    CALL pliego.sp_address_create(p_actor_user_id,p_alias,p_recipient,p_line1,p_line2,province_id,city_id,
        p_country_code,p_postal_code,p_reference,p_phone,p_make_primary,o_address_id);
END; $$;

CREATE PROCEDURE pliego.sp_address_update(IN p_actor_user_id BIGINT,IN p_address_id BIGINT,IN p_alias VARCHAR,
    IN p_recipient VARCHAR,IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,
    IN p_country_code VARCHAR,IN p_postal_code VARCHAR,IN p_reference VARCHAR,IN p_phone VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE province_id BIGINT; city_id BIGINT;
BEGIN
    SELECT ids.province_id,ids.city_id INTO province_id,city_id
      FROM pliego.fn_geo_ids_from_names(p_city,p_province) ids;
    CALL pliego.sp_address_update(p_actor_user_id,p_address_id,p_alias,p_recipient,p_line1,p_line2,
        province_id,city_id,p_country_code,p_postal_code,p_reference,p_phone);
END; $$;

CREATE PROCEDURE pliego.sp_address_create_idempotent(IN p_actor BIGINT,IN p_key UUID,IN p_alias VARCHAR,
    IN p_recipient VARCHAR,IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,
    IN p_country VARCHAR,IN p_postal VARCHAR,IN p_reference VARCHAR,IN p_phone VARCHAR,IN p_primary BOOLEAN,
    OUT o_address_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE attempt pliego.address_create_attempt%ROWTYPE; fingerprint TEXT; province_id BIGINT; city_id BIGINT;
BEGIN
    PERFORM * FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
    IF p_key IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
    fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_alias,p_recipient,p_line1,p_line2,
        p_city,p_province,p_country,p_postal,p_reference,p_phone,p_primary)::TEXT,'UTF8')),'hex');
    PERFORM pg_advisory_xact_lock(hashtextextended('address:'||p_actor||':'||p_key,0));
    SELECT * INTO attempt FROM pliego.address_create_attempt
     WHERE actor_user_id=p_actor AND attempt_key=p_key;
    IF FOUND THEN
        IF attempt.state='NOT_CREATED' THEN PERFORM pliego.fn_raise_domain_error('P1011','ATTEMPT_NOT_CREATED'); END IF;
        IF attempt.fingerprint IS DISTINCT FROM fingerprint THEN
            PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT');
        END IF;
        o_address_id:=attempt.address_id;
        RETURN;
    END IF;
    SELECT ids.province_id,ids.city_id INTO province_id,city_id
      FROM pliego.fn_geo_ids_from_names(p_city,p_province) ids;
    CALL pliego.sp_address_create(p_actor,p_alias,p_recipient,p_line1,p_line2,
        province_id,city_id,p_country,p_postal,p_reference,p_phone,p_primary,o_address_id);
    INSERT INTO pliego.address_create_attempt VALUES(p_actor,p_key,'CREATED',fingerprint,o_address_id);
END; $$;

