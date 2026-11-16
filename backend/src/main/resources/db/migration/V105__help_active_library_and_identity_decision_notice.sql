-- ADR-0055: the Help Center states the implemented behaviour.
-- * Mi biblioteca lists only titles the customer owns now; a cancelled order and its refund stay in Mis pedidos.
-- * A decided identity correction is announced by email and once in Mi perfil.
-- Each sentence is replaced only where the committed V086/V087 text is still present; edited articles are left alone.
UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'El eBook sale de Mi biblioteca. Mira cuándo puedes cancelar',
      'El eBook sale de Mi biblioteca. El pedido cancelado y su reembolso siguen en [Mis pedidos](/orders). Mira cuándo puedes cancelar')
WHERE slug = 'ebooks'
  AND cuerpo LIKE '%El eBook sale de Mi biblioteca. Mira cuándo puedes cancelar%';

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'El audiolibro sale de Mi biblioteca. Mira cuándo puedes cancelar',
      'El audiolibro sale de Mi biblioteca. El pedido cancelado y su reembolso siguen en [Mis pedidos](/orders). Mira cuándo puedes cancelar')
WHERE slug = 'audiolibros'
  AND cuerpo LIKE '%El audiolibro sale de Mi biblioteca. Mira cuándo puedes cancelar%';

UPDATE pliego.ayuda_articulo
SET cuerpo = replace(cuerpo,
      'Te respondemos en un plazo de 15 días. Mientras tanto, tu solicitud aparece como En revisión.',
      'Te respondemos en un plazo de 15 días. Mientras tanto, tu solicitud aparece como En revisión. Cuando la revisemos, te avisamos por correo y en Mi perfil.')
WHERE slug = 'cedula-o-ruc'
  AND cuerpo LIKE '%Te respondemos en un plazo de 15 días. Mientras tanto, tu solicitud aparece como En revisión.%';
