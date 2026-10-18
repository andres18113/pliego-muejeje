# ADR 0032 — Estado explícito de verificación del correo actual en el perfil

Fecha: 2026-10-07. Estado: aceptado para las correcciones solicitadas en producción.

## Contexto

El perfil devolvía `state` (`ACTIVE`/`BLOCKED`), pero no la verificación del correo. Una cuenta `ACTIVE` puede tener un correo nuevo pendiente de verificación. El aviso incondicional de reenvío presentaba como pendiente un correo ya verificado.

## Decisión

V066 agrega `pliego.fn_customer_profile_verified(bigint)` como lectura pública de Database API. Reutiliza la autorización de `fn_customer_profile_versioned` y proyecta `email_verificado_en IS NOT NULL` del usuario para el correo actual en la misma consulta. Las rutinas y firmas anteriores permanecen disponibles. No altera tablas, invariantes, tokens ni escritura de correo.

Controller → Application Service → JDBC Gateway conserva su contrato de capas. `GET /api/v1/me` añade `emailVerified` booleano; la interfaz de cuenta muestra el reenvío solo para `false` explícito de una lectura exitosa. `true`, ausencia y `null` ocultan el aviso. La tolerancia a ausencia o `null` permite actualizar el cliente durante un despliegue gradual sin inferir un estado a partir de `ACTIVE` o del texto del correo.

## Consecuencias y validación

Flyway debe aplicar V066 antes de iniciar el backend que usa la nueva rutina. El cambio es aditivo para clientes y lectores SQL anteriores. El gate PostgreSQL verifica un correo nuevo no verificado, su verificación, el cambio a un correo actual no verificado aunque la cuenta siga `ACTIVE`, y la compatibilidad de la lectura anterior; todos los fixtures revierten sus cambios. Las pruebas REST y de interfaz comprueban la propagación de ambos booleanos y el comportamiento con datos desconocidos.
