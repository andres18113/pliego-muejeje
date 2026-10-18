# ADR 0034 — Validación de contactos y entregas para Ecuador

Fecha: 2026-10-10. Estado: aceptado para el alcance solicitado.

## Contexto

La validación internacional anterior permitía países y longitudes fuera del alcance de PLIEGO. El usuario requiere Ecuador exclusivamente, entrada limitada y retroalimentación síncrona que distinga prefijo, longitud y número. Los destinatarios deben seguir el repertorio de nombres humanos, sin dígitos, conservando la capacidad de 241 puntos de código de V037.

## Decisión

El contrato compartido `shared/validation/person-rules.json` versión 2 fija Ecuador, +593, un máximo nacional de nueve dígitos, móviles de nueve y fijos de ocho. Conserva el repertorio Unicode 17, normalización NFC, espacios, apóstrofes y guiones. UI y Bean Validation utilizan mensajes específicos y metadatos libphonenumber existentes; la Database API usa el patrón canónico equivalente fijado en el contrato, sin dependencia ni inferencia de otro país.

La referencia de países para nuevas direcciones devuelve únicamente Ecuador. Las solicitudes de creación/actualización normalizan `EC` antes de validarlo; se rechazan otros países y destinatarios con números. V068 valida teléfonos nuevos o cambiados en `cliente` y `direccion`, y país/destinatario nuevos o cambiados en `direccion`. También valida la inserción de nuevos snapshots de entrega en `pedido_direccion`, de modo que una dirección histórica extranjera no puede generar una nueva entrega fuera del alcance.

No se estrecha el helper ISO general, que sigue atendiendo valores históricos y documentos existentes. No se modifica ni limpia ningún registro anterior. Los triggers comparan el campo antes de validarlo: una escritura idéntica o una edición de otro campo conserva datos antiguos sin interpretarlos. El PATCH de nombres conserva un teléfono legado; una solicitud explícita para guardar ese teléfono extranjero sigue siendo inválida. Se conserva el borrado del teléfono opcional.

## Consecuencias y validación

La aplicación presenta únicamente Ecuador y limita los contactos a móviles/fijos admitidos. Otros países y tipos telefónicos necesitan una decisión de alcance nueva.

Las pruebas de Java/REST cubren mensajes separados, longitudes, normalización, repertorio de destinatario y referencia de países. Los gates PostgreSQL cubren la Database API y escrituras directas. La prueba de actualización normal Flyway V067→V068 crea previamente datos extranjeros y snapshots válidos bajo la política anterior; verifica que no cambian, que el replay histórico sigue funcionando y que una nueva entrega rechazada no consume inventario ni crea pedidos. Las migraciones históricas permanecen intactas.
