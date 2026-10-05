# Limpieza del catálogo, reparación de búsqueda y sinopsis

El catálogo activo final contiene **425 ediciones: 176 PAPERBACK, 135 EBOOK y 114 AUDIOBOOK**. Se desactivaron las 55 ediciones físicas históricas y, por instrucciones posteriores del usuario, otras 14 ediciones: cuatro físicas nuevas, siete eBooks y tres audiolibros. Los diez fixtures físicos anteriores ya estaban inactivos y permanecieron así. El conjunto activo se comprueba por identidad contra el manifiesto, no mediante un total global codificado.

Los [retiros físicos](retirement-receipts.json), [retiro de «24 ideas para una psicoterapia breve»](requested-audiobook-retirement.json) y [13 retiros adicionales](requested-list-retirements.json) conservan los registros originales. El manifiesto activo tiene 425 filas y `covers/retired-manifest.json` conserva 69 tombstones con los registros normalizados originales. Las 495 asignaciones SKU permanecen estables; PLG-BK-000042 está reservado y excluido. Los cuatro SKU físicos retirados siguen asignados y no se reutilizan.

Los originales y staging retirados están archivados bajo `covers/generated/retired/`. Se conservaron todos los objetos R2: [425 activos y 69 históricos, 494 en total](r2-preservation.json); no hubo borrados. El asignador, normalizador y publicadores rechazan la reintroducción de identidades retiradas. La sincronización R2 acepta únicamente los objetos históricos conocidos además del conjunto activo.

El HTTP 500 se debía a las llamadas JDBC nuevas de 12/10 argumentos frente a una base en Flyway 044 que solo tenía las firmas de 11/9. Las migraciones pendientes **V045–V046**, aplicadas mediante el entry point Flyway existente, ya suministraban el contrato correcto. No se reescribieron migraciones aplicadas ni se añadió una copia innecesaria. La base del catálogo está en V046 y el [registro de reparación](flyway-catalog-repair.json) acredita las cuatro firmas compatibles. La prueba nueva `catalog_contract_gate.sql` está incorporada al runner CI y usa fixtures aislados con rollback.

Se sustituyeron las sinopsis DEMO y se completaron las vacías: **425 textos descriptivos en español**, sin etiquetas administrativas. La redacción se apoya en resúmenes, textos, índices o materias/títulos comprobados. Las descripciones temáticas originales se distinguen internamente de las paráfrasis de sinopsis editoriales; no se presentan como citas de editores. Las [propuestas y sus fuentes](synopses-work/) conservan las capturas y verificaciones disponibles. La información de precio, páginas, formato y existencias simuladas permanece en la procedencia interna.

La [aplicación de sinopsis](apply-synopses.py) verificó que únicamente cambiaron `book.synopsis` y `book.updatedAt`: las 504 ediciones y el resto de la identidad bibliográfica se conservaron íntegros. Los staging activos, el generado físico y el lote digital preparado comparten ahora las mismas sinopsis/procedencias. Una regresión reproduce el problema anterior de republicación digital y comprueba que ya no vuelve a imponer textos viejos.

Validación final:

- [API en vivo](api-validation.json): 65 comprobaciones de búsqueda por texto/ISBN, categorías, formatos/tipos, cuatro órdenes y paginación; 425 detalles, disponibilidad y sinopsis correctos; 69 detalles retirados rechazados; agregar/actualizar/eliminar en carrito para los tres formatos y restauración del carrito previo.
- [Suite Python global](global-python-final.log): **132 pruebas aprobadas**. Pruebas enfocadas físicas, de retiro y de replay también aprobadas. CI conserva el entorno aislado con NumPy/Pillow y los fixtures sintéticos; no depende de los 55 libros retirados como datos activos.
- [Gates SQL globales](sql-gates/results.json): **21/21 aprobados** en una base PostgreSQL 18 aislada migrada mediante Flyway hasta V048. Las pruebas no cambiaron datos del catálogo real.
- [Diff check](diff-check-final.log): aprobado. La revisión independiente no dejó hallazgos importantes pendientes.

Tras dos reinicios del servidor de herramientas se recuperaron los procesos locales y se guardaron las propuestas de forma persistente. Se utilizó el backend compilado existente, sin recompilar ni desplegar la aplicación; se mantuvo la base del catálogo en V046. Un abort interno de CPython 3.13 al importar Pillow quedó registrado; la suite completa se verificó con Python 3.12 y las dependencias declaradas.

No se hicieron cambios propios de presentación frontend, navegación/discovery o biblioteca digital. No se hizo push ni despliegue. El commit fue solicitado posteriormente por el usuario. No quedan bloqueos de esta tarea.
