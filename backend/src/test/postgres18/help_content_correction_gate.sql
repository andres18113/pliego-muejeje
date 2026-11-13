-- PostgreSQL 18, Flyway through V087. Read-only Help correction contract.
BEGIN;
DO $gate$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public.flyway_schema_history
  WHERE version='087' AND description='restore committed help guidance' AND success
 ) THEN RAISE EXCEPTION 'V087 Help copy restoration was not recorded by Flyway'; END IF;

 IF EXISTS (
  SELECT 1
  FROM (VALUES
   ('ebooks','Dónde encuentras los eBooks que compras y qué incluye tu compra.'),
   ('audiolibros','Dónde encuentras los audiolibros que compras y qué incluye tu compra.'),
   ('compras','Cómo hacer un pedido, qué necesitas y dónde ves tu factura.'),
   ('entrega-a-domicilio','Cómo recibir tus libros impresos en casa y seguir tu envío.'),
   ('retiro','Cómo elegir un punto de retiro y recoger tu pedido.'),
   ('pagos','Con qué puedes pagar y cómo hacerlo con tarjeta o transferencia.'),
   ('cancelaciones-y-reembolsos','Cuándo puedes cancelar un pedido y qué pasa con tu pago.'),
   ('cuenta-y-correo','Verifica tu correo, recupera tu contraseña y cambia tus datos.'),
   ('cedula-o-ruc','Por qué lo solicitamos y cómo corregirlo.')
  ) AS expected(slug, summary)
  LEFT JOIN LATERAL pliego.fn_help_article(expected.slug) article ON TRUE
  WHERE article.slug IS NULL OR article.summary IS DISTINCT FROM expected.summary
 ) THEN RAISE EXCEPTION 'Help summaries differ from the committed V086 copy'; END IF;

 IF NOT EXISTS (
  SELECT 1 FROM pliego.fn_help_article('cedula-o-ruc') article
  WHERE position('Te respondemos en un plazo de 15 días. Mientras tanto, tu solicitud aparece como En revisión.' IN article.body)>0
 ) THEN RAISE EXCEPTION 'Cédula o RUC Help response-time copy was not restored'; END IF;
END $gate$;
ROLLBACK;
