PLIEGO · Libros físicos · Catálogo académico DEMO

180 portadas de libros reales, 30 por carpeta: Medicina, Psicología, Filosofía, Matemáticas, Infantil y Juvenil, Literatura.

IMPORTACIÓN
- inventario_fisicos.csv usa UTF-8, comas como separador, punto decimal y una cabecera exacta de ocho campos: categoria,titulo,autor,isbn,descripcion,precio,nombre_archivo,fuente_portada. No contiene celdas vacías.
- precio es numérico y está expresado en USD. Los 180 precios son DEMO, calculados de manera determinista para la demostración académica. No son precios consultados, cotizaciones ni ofertas. Cada descripción lo indica.
- isbn es texto. 128 filas contienen un PRINT ISBN observado con dígito de control válido. 52 usan DEMO-ISBN-FIS-NNNN: identificador de demostración que NO es un ISBN real. El importador debe tratarlo como identificador DEMO y nunca guardarlo como ISBN oficial. No se inventaron ISBN de apariencia válida ni se reemplazaron por E-ISBN.
- Para localizar una imagen, combine categoria + / + nombre_archivo. Los nombres siguen Título - Autor.ext y explicitan editores, coordinadores o compiladores cuando corresponde. Solo se sustituyeron caracteres no válidos en Windows.
- Las descripciones que empiezan por DEMO son textos académicos creados a partir del título, las materias o el índice, no sinopsis editoriales. Las demás son paráfrasis breves del resumen consultado.

FUENTES Y ALCANCE
Las portadas proceden de fichas de eLibro en el catálogo de PUCE. fuente_portada es la página bibliográfica de origen; puede requerir acceso institucional. Se conservaron los bytes originales de las imágenes, sin ampliación, recorte, retoque ni conversión. No se descargaron libros completos.

La etiqueta físico es simulada para este catálogo académico. No se comprobó disponibilidad de ejemplares físicos, stock ni oferta comercial. Un PRINT ISBN observado identifica una edición impresa en la ficha y no demuestra existencias.

metadata_provenance.json conserva procedencia por campo, roles, E-ISBN separado, datos observados, estados DEMO, dimensiones y SHA-256 de cada portada. resumen_por_categoria.csv detalla conteos e incidencias; incidencias_detalle.csv contiene los candidatos descartados o reasignados. Los conteos de duplicados evitados se basan en registros de selección y distinguen coincidencias confirmadas de exclusiones conservadoras. No son duplicados presentes en la entrega; un candidato descartado en dos categorías puede contarse en ambas.

USO
Material preparado para una demostración académica. Esta recopilación no acredita ni concede una licencia de reproducción o publicación de las portadas; los derechos pertenecen a sus titulares.
