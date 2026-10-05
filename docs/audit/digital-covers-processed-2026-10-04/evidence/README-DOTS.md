# PLIEGO — portadas digitales para Dots

Paquete local para preparar EBOOK/AUDIOBOOK: WebP 720×1080, staging, SKU y manifiesto global; conserva el baseline físico.
Requiere **Python 3.12+ en Linux o WSL** (`fcntl`); no funciona con Python nativo de Windows. No requiere el repositorio original.

Desde esta carpeta extraída:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r scripts/requirements-covers.txt
```

Coloca los lotes así, sin reemplazar el baseline:

```text
covers/Ebook/inventario.csv
covers/Ebook/Filosofia/originales/archivo.jpg
covers/Audiolibros/inventario.csv
covers/Audiolibros/Literatura/originales/archivo.png
```

CSV UTF-8 con encabezados `Categoria,Titulo,Autor,Archivo,Fuente`. Archivo es relativo al directorio del inventario (ejemplo: `Filosofia/originales/archivo.jpg`).
Añade `editorial,idioma`; ISBN, fecha, páginas y sinopsis pueden faltar. EBOOK admite `ebookFileFormat` EPUB/PDF o vacío. AUDIOBOOK requiere `audioDurationSeconds` entero positivo y `narrators` como array JSON de 1–32 nombres, correctamente citado dentro del CSV. No inventes estos datos: los incompletos quedan pendientes.
Opcionales: `isbn13,subtitulo,sinopsis,paginas,anioPublicacion,fechaPublicacion,autores,coverLicense,coverSourceUrl,coverAttribution,protectedRegions,editorialBorders`. `autores` es JSON con objetos `{nombre,orden}`. Las categorías siguen siendo temáticas; no son formatos.


Revisión visual excepcional por archivo: `reviewedCropBox` es un array JSON `[left,top,right,bottom]` en píxeles del original tras aplicar la orientación EXIF (admite fracciones), con límite derecho/inferior exclusivo. Requiere `reviewedCropReason` no vacío y `reviewedSourceSha256` igual al SHA-256 hexadecimal del archivo exacto revisado. Solo se deben introducir tras inspeccionar visualmente ese archivo y aprobar ese encuadre; nunca se generan automáticamente. La caja debe estar dentro del área opaca y ser 2:3, sin redondearla. Se mantienen las protecciones explícitas, el rechazo de perspectiva, el límite 4× y la conversión oficial. Esta ruta sustituye únicamente las heurísticas automáticas de bandas, contraste y límites conservadores de trim/crop. Los reportes JSON/CSV incluyen `reviewed_crop` con caja original, espacio de coordenadas, hash y justificación. `crop.box` sigue siendo relativo a la imagen limpia tras retirar transparencia exterior. Sin estos campos se mantiene el comportamiento original.

```bash
python scripts/process-digital-covers.py --covers-dir covers \
  --inventory covers/Ebook/inventario.csv \
  --inventory covers/Audiolibros/inventario.csv
```

Exit code **0**: todo aceptado; **1**: error estructural/identidad/escritura; **2**: ejecución terminada con pendientes.
Reportes: `covers/generated/digital-batch/reports/normalization-report.json` y `.csv`; imágenes pendientes: `covers/generated/digital-batch/pending-images/`.
Salidas aceptadas: staging bajo cada formato, `covers/sku-registry.json`, `covers/generated/manifest-normalized.json`, copias informativas `generated/json` y objetos en `covers/generated/r2-normalized/covers/editions/v2/`.
No renombres staging después de asignar SKU. No borres el baseline ni reasignes SKUs. La exclusión histórica `PLG-BK-000042` se conserva.
Referencia visual incluida: `covers/generated/r2-normalized/covers/editions/v2/PLG-BK-000053-700e1f21cf58.webp`.

**Prohibido subir a R2 o ejecutar el seed durante esta fase.** El comando de procesamiento no hace ninguna de esas acciones. Los auxiliares normalize/seed/upload están incluidos únicamente porque las pruebas de compatibilidad los importan; no ejecutes sus CLI. No se incluyen credenciales ni configuración R2.

Validación opcional, sin servicios externos (69 pruebas; 49 originales y 20 de recortes revisados, con clientes falsos):

```bash
python -m unittest discover -s scripts -p 'test_*.py'
```

La lista exacta está en `PACKAGE-MANIFEST.txt`; los resultados de validación independiente están en `VALIDATION-RESULTS.json`.
