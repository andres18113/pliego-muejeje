# Correo transaccional — Implementation Plan

> Ejecución nativa mediante superpowers:executing-plans; autonomía autorizada por el usuario.

Goal: implementar verificación, confirmación de pedido y recuperación mediante outbox PostgreSQL y Mailtrap.
Architecture: conservar Controller → Service → JDBC Gateway → API PostgreSQL. Worker serial fuera de la transacción de negocio y adaptador HTTP detrás de abstracción.
Tech Stack: Java 25, Spring Boot 4.1.1, PostgreSQL 18, Flyway, JDK HttpClient.
Spec: docs/adr/0020-transactional-email-and-account-verification.md

## Global Constraints

No modificar baselines ni migraciones V001–V038. No frontend, secretos, JPA, Docker ni broker. Errores humanos en español. Conservar cambios locales existentes; trabajar en el workspace actual que contiene el código autorizado, sin commits globales.

## Review Focus

- Cuenta existente y bloqueo administrativo no deben cambiar por el rollout.
- Token anterior o destinado a otro propósito/email nunca se consume.
- Mailtrap incierto no se reenvía automáticamente ni afecta checkout.
- Claims simultáneos no obtienen el mismo evento; receipts de checkout no duplican correos.
- Cambiar email/reset no deja refresh activo ni tokens antiguos utilizables.

## Task 1: PostgreSQL

Files: V039__transactional_email.sql; src/test/postgres18/transactional_email_gate.sql.
Interfaces: sp_customer_register_with_verification; fn_email_action_request/consume; fn_mail_outbox_claim/complete; wrapper sp_checkout; fn_user_auth_data.

- [x] Escribir gate con assertions de registro/outbox, tokens, expiración/reuso, resend/cooldown, reset/revocación, claim/complete/backoff y snapshots/idempotencia.
- [x] Ejecutar contra PostgreSQL existente para probar que falta el contrato.
- [x] Crear V039 con tablas, índices y rutinas del ADR; el límite de intento es cinco y el lease es 60 segundos.
- [x] Ejecutar gate contra BD aislada migrada; PASS sin errores SQL.

## Task 2: Identidad y transporte

Files: identity application/gateway/api; notifications application/gateway/provider; application.yml; security matcher; tests notifications e identity.
Interfaces: EmailActionTokens.issue/derive/hash; IdentityGateway con credenciales de verificación; TransactionalMailSender.send; MailOutboxGateway.claim/complete.

- [x] Escribir tests de tokens, HTML/texto, requests/consumo, proveedor HTTP local y worker; ejecutar para comprobar ausencia de implementación.
- [x] Implementar token HMAC separado por propósito, gateways de rutinas, endpoints públicos POST verify-email/resend-verification/forgot-password/reset-password y verificación dentro del registro.
- [x] Integrar cambio de email, bloquear login no verificado, actualizar documentación OpenAPI y stubs existentes.
- [x] Implementar adaptador Mailtrap/worker, configuración externa validada y errores sanitizados.
- [x] Ejecutar pruebas afectadas; PASS, ningún envío real.

## Task 3: Verificación y operación

Files: backend/README.md; run_ci_gates.sh y fixtures HTTP afectadas; docs/adr/README.md.

- [x] Actualizar fixtures a verificar explícitamente cuentas nuevas, V039 y rutas nuevas en OpenAPI coverage.
- [x] Ejecutar Maven clean verify completo y gates PostgreSQL/HTTP apropiados, guardando logs completos en /tmp.
- [x] Revisión independiente del cambio completo, corregir hallazgos relevantes y repetir solo verificación afectada por cambios.
- [x] Documentar configuración, pruebas con stub/sandbox, recuperación manual de delivery incierto y contratos frontend; reportar resultados y limitaciones.
