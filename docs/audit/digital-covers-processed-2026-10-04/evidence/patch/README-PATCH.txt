PLIEGO — extensión mínima de recortes revisados (2026-10-04)

El parche ya está aplicado a los scripts incluidos; no lo vuelvas a aplicar.
reviewed-crop.patch documenta el cambio respecto al paquete original.

Cambios: scripts/cover_images.py, scripts/process-digital-covers.py,
scripts/test_reviewed_crop.py (20 pruebas nuevas) y README-DOTS.md.
La detección automática por defecto y el codificador oficial se conservan.
La ruta excepcional solo admite una caja 2:3 explícita, su justificación visual
y el SHA-256 del original exacto. Conserva las protecciones explícitas,
el rechazo de perspectiva, el límite 4× y la conversión oficial.

Se aplicaron exactamente 19 decisiones revisadas: 11 EBOOK y 8 AUDIOBOOK.
No se aplicó override a los 190 casos sin solución segura ni al caso retenido
por precaución (ID 140). Las 19 imágenes siguen pendientes de metadatos.

VALIDATION-RESULTS.json es la validación HISTÓRICA del paquete inicial
(49 pruebas). La suite actual tiene 69 pruebas (49 originales + 20 nuevas).
Prueba local opcional desde la raíz extraída, tras instalar requirements-covers:
  python -m unittest discover -s scripts -p 'test_*.py'

El comando oficial de procesamiento ya se ejecutó y terminó con código 2
(pendientes). No es necesario ejecutarlo para consultar estos resultados:
  python scripts/process-digital-covers.py --covers-dir covers --inventory covers/Ebook/inventario.csv --inventory covers/Audiolibros/inventario.csv

No ejecutar los CLI de upload-r2-covers.py, seed-development-catalog.py ni
normalize-covers.py durante esta fase. Se incluyen como auxiliares del paquete
y para las pruebas de compatibilidad. No se incluyen credenciales.
