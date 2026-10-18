# 0035 — Orden español estable de los títulos del catálogo

Fecha: 2026-10-10. Estado: Aceptado.

El catálogo ordenaba `lower(titulo)` con la colación predeterminada de la base. En producción, «Anestesiología» precedía a «Análisis» aun seleccionando A–Z. Ordenar la página visible en React perdería el orden global y cambiaría la pertenencia a cada página.

V069 conserva las cuatro firmas públicas de búsqueda y sus filtros. Aplica una colación ICU española únicamente a `ORDER BY`, antes de `LIMIT/OFFSET`: `es-u-ka-shifted-kn-true-ks-level1`, con comparación insensible a mayúsculas, acentos y puntuación y secuencias numéricas naturales. La letra ñ mantiene su posición española entre n y o. La colación no desempata por bytes (`deterministic=false`); `edicion_id ASC` proporciona un desempate explícito y reproducible en ambas direcciones. La API y el selector admiten `TITLE_DESC` además de los órdenes anteriores.

La colación no cambia igualdad, unicidad, búsqueda parcial, precios, disponibilidad ni índices existentes. PostgreSQL debe disponer de ICU; la migración falla claramente si no está disponible, en vez de ofrecer un orden incorrecto. La versión de ICU debe seguir el procedimiento normal de actualización de colaciones de PostgreSQL al actualizar el sistema. No se realiza ordenación adicional en el frontend.

Regresión: títulos acentuados y sin acento, mayúsculas, signos, 2/10/50, n/ñ/o, empates de títulos, siete páginas y las cuatro firmas de catálogo; navegación conserva búsqueda, filtros y dirección al paginar y usar historial.

Referencia: [PostgreSQL 18: ICU y colaciones personalizadas](https://www.postgresql.org/docs/18/collation.html).
