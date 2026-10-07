-- The eBooks and Audiolibros Help articles speak to customers: the sentences about the academic simulation are removed.
-- Content only; categories, slugs, positions and publication state are unchanged.
UPDATE pliego.ayuda_articulo
SET cuerpo='Un eBook es una edición digital. Después de una compra con pago aprobado aparece en Mi biblioteca y puedes abrir su detalle para comprobar la propiedad.'
WHERE slug='ebooks'
  AND cuerpo='Un eBook es una edición digital. Después de una compra con pago aprobado aparece en Mi biblioteca y puedes abrir su detalle para comprobar la propiedad. Esta simulación académica no incluye lector, archivos, descargas ni entrega de contenido.';

UPDATE pliego.ayuda_articulo
SET cuerpo='Un audiolibro es una edición digital con duración y narradores cuando estos datos están disponibles. Después de un pago aprobado aparece en Mi biblioteca y puedes abrir su detalle para comprobar la propiedad.'
WHERE slug='audiolibros'
  AND cuerpo='Un audiolibro es una edición digital con duración y narradores cuando estos datos están disponibles. Después de un pago aprobado aparece en Mi biblioteca. Esta simulación académica permite comprobar la propiedad en su detalle; no incluye reproductor, streaming ni descargas.';
