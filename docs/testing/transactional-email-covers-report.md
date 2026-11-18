# Portadas de correos transaccionales

Verificación local del 1 de noviembre de 2026. La corrección agrega datos al correo; `MailLayout.java` conserva su presentación.

| Correo | Causa comprobada |
| --- | --- |
| `ORDER_CONFIRMED` | El snapshot de V061, delegado por V088, no incluía `items[].coverUrl`. |
| `ORDER_STATUS` | Mismo snapshot: entrega a domicilio, preparación/retiro en tienda y finalización digital carecían de portada. |
| `ORDER_CANCELLED` | Mismo snapshot sin portada, incluida la cancelación con reembolso. |
| `VERIFY_EMAIL`, `RESET_PASSWORD`, `INVOICE_ISSUED` | No presentan líneas de libros; no corresponde agregar portadas. |

El `coverUrl` de V083 pertenece a la consulta de guardados para después, no a un payload de correo. El filtro Java anterior aceptaba HTTPS arbitrario y rutas de tienda; rechazaba HTTP, URLs relativas sin `/`, esquemas distintos, comillas y espacios. Las URLs públicas reales del CDN pasaban ese filtro, pero no llegaban en los mensajes de pedido.

V092 reemplaza únicamente `fn_order_mail_snapshot_internal_v088`, conservando el wrapper de referencias públicas. Une cada ítem con su edición por `edicion_id` y captura su `portada_url` actual al crear el evento. SQL y Java aceptan exclusivamente assets HTTPS sin firma en `covers.pliegolibros.com/covers/editions/`, con segmentos simples y extensión WebP/JPEG/PNG. Rechazan otros orígenes, rutas privadas, HTTP, consultas, fragmentos y traversal. Sin portada válida se conserva el placeholder. Los mensajes ya encolados no se actualizan.

Archivos cambiados, además de este informe:

- `backend/src/main/resources/db/migration/V092__public_order_email_covers.sql`.
- `backend/src/main/java/com/pliego/modules/notifications/application/MailTemplates.java`: solamente mapeo de portada.
- `backend/src/test/java/com/pliego/modules/notifications/{EmailCoverMappingTest,TransactionalEmailPreviewsTest}.java`.
- `backend/src/test/java/com/pliego/modules/notifications/TransactionalMailTest.java`: fixtures de URL pública.
- `backend/src/test/postgres18/order_email_covers_gate.sql`.
- `backend/src/test/postgres18/{run_ci_gates,run_runtime_privileges_ci_gate}.sh`: V092 y registro del nuevo gate.

Se preservaron las migraciones V001–V091 y los cambios ajenos presentes en el workspace.

## Comprobación del CDN

Se ejecutaron `curl -sI` y GET anónimo contra estas tres portadas:

| Portada | HEAD / GET | Content-Type | Bytes del GET |
| --- | --- | --- | --- |
| [PLG-BK-000390](https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000390-d2c065f3dcad.webp) | 200 / 200 | `image/webp` | 20 474 |
| [PLG-BK-000394](https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000394-f213c275e813.webp) | 200 / 200 | `image/webp` | 74 812 |
| [PLG-BK-000057](https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000057-be83a24f55ad.webp) | 200 / 200 | `image/webp` | 22 146 |

En las tres: `Cache-Control: public, max-age=31536000, immutable`, ETag presente, `CF-Cache-Status: DYNAMIC`, sin redirección. Se repitieron HEAD y GET sin Referer, con UA `Mozilla/5.0 (compatible; GoogleImageProxy)`, con `Googlebot-Image/1.0` y con Referer `https://mail.google.com/`. Todos devolvieron 200 y WebP válido del mismo tamaño. No hubo sensibilidad observada a esos agentes/Referer; simular el UA no prueba una petición desde la infraestructura real de Google. Evidencia local completa: `/tmp/pliego-email-work/curl-results.json`.

## Compatibilidad WebP y siguiente opción

| Cliente | Soporte conocido en la matriz de pruebas |
| --- | --- |
| Gmail web, Android e iOS | Estático compatible mediante conversión a JPEG; sin animación. iOS antiguo tenía una brecha. |
| Apple Mail | Mail 14 e iOS 14 compatibles; las versiones 13 probadas no. |
| Outlook.com | Compatible según soporte del navegador. |
| Outlook clásico para Windows | Sin soporte en las versiones 2007–2019 probadas. La matriz no certifica el nuevo Outlook. |
| Yahoo | Web depende del navegador; Android e iOS compatibles en las versiones recientes de esa matriz. |

Fuente primaria: [pruebas de Can I email y sus versiones](https://github.com/hteumeuleu/caniemail/blob/main/_features/image-webp.md), con prueba base de febrero de 2021 y algunas entradas posteriores. Es soporte conocido, no una certificación de todas las versiones actuales. Google documenta que [Gmail sirve las imágenes por su proxy](https://gmail.googleblog.com/2013/12/images-now-showing.html); por ello deben funcionar sin sesión, cookies o Referer.

La opción recomendada para cubrir Outlook clásico es una rendición JPEG estática, preparada junto al pipeline existente y publicada separadamente como `covers/editions/email-v1/<SKU>-<hash>.jpg`. Requiere generación optativa desde el master local, conversión RGB, manifiesto que relacione edición y rendición, soporte JPEG explícito en el uploader actual (hoy solo admite WebP), `Content-Type: image/jpeg` y comprobación pública antes de usar esa URL. Conservar el WebP y su URL actuales; nunca sustituir solamente la extensión. La publicación requiere una tarea posterior autorizada en el bucket público de portadas, separado de facturas.

Alternativa: [transformación de Cloudflare](https://developers.cloudflare.com/images/optimization/features/) con `format=baseline-jpeg`, que requiere habilitar transformaciones en la zona, restringir orígenes y revisar disponibilidad/coste/caché. Evitar `format=auto` para fijar el formato del correo. No se implementaron rendiciones ni cambios de R2/CDN/Cloudflare.

## Previews y validación

Desde la raíz:

```sh
mvn -f backend/pom.xml -Dtest=TransactionalEmailPreviewsTest test
mvn -f backend/pom.xml -Dtest=TransactionalEmailPreviewsTest -Dpliego.email.preview-dir=/tmp/mis-correos test
```

También admite `PLIEGO_EMAIL_PREVIEW_DIR`; la propiedad tiene precedencia. Default: `/tmp/pliego-email-previews`. Produce 20 HTML y 20 TXT: seis tipos, todos los estados aceptados por el renderer, tres libros impresos y un eBook con URLs públicas reales, domicilio, retiro, cancelación y payload antiguo sin portada. Instancia solamente el renderer: sin Spring, base de datos ni sender. Los tokens son sintéticos y no existen en una base de datos.

Resultados reales:

- `mvn -B verify`: 476 pruebas, 0 fallos, 0 errores, 1 omitida (`R2LiveSmokeTest`, requiere acceso real y no fue habilitada).
- PostgreSQL 18.6 aislado en `127.0.0.1:55439`: Flyway limpio, 92 migraciones hasta V092.
- Upgrade Flyway V091 → V092: el JSON de un correo histórico sin portada permaneció idéntico.
- Gates SQL: `order_email_covers`, `transactional_email`, `store_pickup`, `order_reference`, `mail_completion`, `order_offer_snapshot`: todos pasaron.
- `run_runtime_privileges_ci_gate.sh`: pasó con `pliego_app`/`pliego_owner`, limpieza aplicada dos veces y reinicio restringido.
- Previews predeterminados, propiedad personalizada y variable de entorno: 20 HTML + 20 TXT; revisión independiente sin hallazgos en el alcance de portadas.

No se enviaron correos reales, no hubo escrituras externas, commits, push o despliegues. El stack `/tmp/pliego-review` no se utilizó.
