# ADR 0056: Protección del registro público y respuesta neutral

Fecha: 2026-11-03. Estado: implementado para revisión local; sin despliegue. Extiende ADR0050 y ADR0053; corrige el contrato de existencia del registro público anterior.

## Contexto

`POST /api/v1/auth/register` ejecutaba BCrypt sin cuota. La implementación de ADR0050 conservaba además una distinción observable: 201 con IDs para correo nuevo y 409/P1101 para duplicado. RQ-REG-01–04 exige limitar trabajo caro y evitar esa enumeración. Mantener sólo la respuesta 201 idéntica tampoco bastaba: una cookie aleatoria desconocida devolvería 204 en `/registration-session`, mientras un registro nuevo devuelve 202 pendiente.

## Decisión

V102 añade Database API del módulo identity sin modificar migraciones aprobadas. Se conservan Controller → Application Service → JDBC Gateway y transacciones Spring. Antes de BCrypt o cualquier lookup/escritura de cuenta, `RegistrationAttemptAdmissionService` carga `fn_registration_attempt_admit(email,hashIP)` en una transacción corta independiente `REQUIRES_NEW`, mediante el pool/gestor `loginAdmission…` de ADR0053. No se añade configuración, credencial, conexión máxima ni dependencia. Login y registro comparten esa conexión de admisión, pero usan tablas y presupuestos independientes.

| Ámbito | Ventana fija desde el primer intento | Admisiones máximas |
| --- | --- | --- |
| IP resuelta por Tomcat | Una hora | 120 |
| Correo normalizado, entre todas las IP | Una hora | 5 |

Son umbrales iniciales de ingeniería: una IP compartida admite muchas cuentas, mientras cinco intentos de un mismo correo toleran errores y reintentos. No provienen de telemetría productiva. La normalización pertenece a `fn_normalize_email`, idéntica al alta y lookup. Se guardan sólo `IP:`/`AC:` más SHA-256, expiración y contadores; no se guarda correo, IP, contraseña ni FK de usuario. Un hash de baja entropía no es anonimización frente a un operador con candidatos.

La admisión bloquea IP → correo en PostgreSQL. UPSERT y contadores bajo esos locks impiden superar el techo con peticiones simultáneas y observan el reloj después de esperar. Nunca bloquea usuario, token, continuidad ni sesión. La IP agotada retorna antes de crear buckets de correos arbitrarios. Una solicitud ya denegada por correo incrementa solicitudes pero no gasta admisiones de su NAT. Los contadores de solicitudes saturan en INTEGER máximo; las admisiones sólo crecen cuando ambos ámbitos permiten el trabajo. No hay ventanas deslizantes: tráfico denegado no extiende el vencimiento. El siguiente intento después de vencer reinicia su bucket. La cuota confirmada sobrevive a errores de infraestructura posteriores, mientras cuenta, correo y continuidad revierten juntos. La conexión corta se libera antes de BCrypt; ocho registros de cuentas distintas detrás de una IP pueden alcanzar el verificador con un pool principal de ocho.

La IP es exclusivamente `HttpServletRequest.getRemoteAddr()`. Se reutilizan sin cambios el resolver nativo de Tomcat y sus proxies internos loopback de ADR0050/0053. No se lee `X-Forwarded-For` en Controller/Service ni se confían rangos privados. Las pruebas HTTP comprueban la primera dirección no confiable desde la derecha, ignorar cabeceras desde `127.0.0.2` y la imposibilidad de eludir una IP agotada cambiando entradas falsas.

El rechazo produce 429 `application/problem+json`, código `AUTH_REGISTER_RATE_LIMITED`, título **Demasiados intentos**, detalle **Espera unos minutos antes de volver a intentarlo.**, `Retry-After` entero 1–3600 y traceId. No emite ni borra cookies ni consulta si existe la cuenta. El log contiene sólo evento, estado LIMITED, código, segundos y traceId. CORS ya expone Retry-After.

## Neutralidad y autorización

Todo registro válido admitido realiza una operación BCrypt de igual coste antes del alta. El Controller responde siempre 201 con **`{"state":"PENDING_VERIFICATION"}`**, sin IDs de cuenta ni credenciales JSON. El registro duplicado no retorna P1101 por HTTP. Ese SQLSTATE y las APIs internas históricas mantienen su significado; sólo `sp_customer_register_neutral` captura P1101 en una subtransacción PostgreSQL y devuelve IDs internos cero. Otras excepciones se propagan. No se captura un error JDBC dejando una transacción marcada rollback-only ni se buscan datos de la cuenta existente.

Ambos casos emiten una cookie `pliego_registration` aleatoria de 256 bits con exactamente los mismos atributos, formato y Max-Age=86400. PostgreSQL conserva el vencimiento autoritativo, por lo que la cookie no prolonga una credencial. Un alta real conserva registro + outbox + continuidad de ADR0050. Un duplicado no modifica contraseña, rol, estado, token, destinatario, outbox ni continuidad previa, incluso si pertenece a una cuenta verificada, bloqueada o ADMIN; recibe un recibo neutral nuevo en `registro_continuacion_neutral` con sólo hash y expiración de 24 horas desde el inicio de la transacción.

El recibo neutral devuelve el mismo 202/PENDING_VERIFICATION y usa las cuotas de IP y credencial existentes (1200/h y 600/h), con el mismo RETRY_LATER y Retry-After al agotarse. Al vencer o después de logout devuelve 204. **Nunca contiene una referencia de usuario, concede sesión ni se convierte en continuidad real**, aunque el dueño verifique el correo, use recuperación o un atacante presente un token ajeno. Verificar correo sin una continuidad real que pertenezca al mismo usuario conserva el 204 existente. Así el atacante no obtiene acceso ni invalida la continuidad legítima al volver a registrar el correo de otra persona. El frontend debe validar el estado neutral, sin depender de los antiguos IDs; OpenAPI y cliente compartido se actualizan con el mismo cambio.

Igualar trabajo BCrypt y forma observable reduce la señal temporal evidente, pero no promete tiempo idéntico de extremo a extremo: contención de locks, latencia de base y diferencias pequeñas de escrituras siguen sujetas a ruido y observación estadística. No se introducen sleeps artificiales ni consultas tempranas de existencia.

## Recuperación, reenvío y mantenimiento

`forgot-password` y `resend-verification` ya usan `fn_email_action_request`: 20 solicitudes/IP/hora y 5/correo normalizado/hora, antes del lookup; también cobran desconocidos, mantienen 202 genérico y un intervalo mínimo de un minuto entre emisiones de un mismo tipo. Son independientes del registro y del login. No se añade un segundo bloqueo que impida al propietario recuperar acceso durante una ráfaga de registro. Las pruebas comprueban 202 conocido/desconocido, reset real de un solo uso, login con la contraseña recuperada y persistencia de la cuota de registro.

Riesgos residuales del mecanismo anterior de correo: el techo IP20/h es menos tolerante a NAT; la limpieza histórica de `correo_limite` ocurre dentro del comando y no se cambia aquí; `reset-password` aún calcula BCrypt antes de validar un token arbitrario y no recibe esta cuota de registro. Cambiar esas transacciones y esa superficie requiere un ajuste específico para no alterar la recuperación autorizada. Reenvío y solicitud de recuperación sí tienen protección existente y no se ampliaron de forma innecesaria.

Un scheduler identity ejecuta cada minuto dos servicios transaccionales separados. Cada función de limpieza toma por índice hasta 1000 filas vencidas con `FOR UPDATE SKIP LOCKED`: cuotas y recibos neutrales se limpian en transacciones distintas, sin adquirir locks de cuenta o sesión después. Omite filas ocupadas y varias instancias pueden drenar en paralelo. Las cuotas no limitan duramente cardinalidad entre múltiples IP; más de 1000 expiraciones/minuto/instancia puede acumular atraso y requiere observación operativa. No reemplaza límites volumétricos del borde, ni agrupa subredes IPv6.

PUBLIC carece de DML/EXECUTE nuevos. `pliego_app` recibe sólo los accesos explícitos necesarios bajo SECURITY INVOKER; las sustituciones de funciones existentes conservan sus ACL. No hay JPA, Docker, frontend visual, cambio productivo ni acceso a correo externo en las pruebas.

## Evidencia y trazabilidad

- RQ-REG-01: cuotas IP/correo canónico, antes de BCrypt y sin lookup cuando se limita; `fiveAttemptsThenSpanish429SkipsBcryptAndAccountLookupAndLogsNoIdentifiers`, `exhaustedScopesAreNeutralForKnownUnknownAndRecoverAfterExpiry`, gate SQL `ceilings_and_fixed_expiry`/`ip_ceiling_and_cardinality`.
- RQ-REG-02: 201/JSON/cookie idénticos, coste BCrypt de ambos caminos y continuidad pendiente neutral sin acceso; `newDuplicateAndTheirPendingContinuationsHaveSameShapeWithoutAccountMutation`, `existingVerifiedBlockedAndAdminAccountsRemainNeutralAndNeverGetAContinuation`, `neutralAndRealReceiptsExpireAndLogoutTogetherWithoutGrantingAccess`, gates SQL `neutral_duplicate_no_mutation`/`decoy_is_pending_and_never_authenticates`. Los gates HTTP de registro/correo consultan sus propios fixtures por email en vez de extraer IDs de la respuesta pública.
- RQ-REG-03: concurrencia entre IP y dentro de NAT, commits independientes, recuperación de ventanas y limpieza; `concurrentSameEmailAcrossIpsAdmitsFiveAndCreatesOnlyOneAccountAndMessage`, `eightAccountsBehindNatReachBcryptBeforeAnyVerifierIsReleased`, `infrastructureFailureRollsBackAccountButKeepsAdmissionCommitted`, `maintenanceUsesSeparateSpringTransactionsToCleanExpiredBucketsAndNeutralReceipts`; gates SQL `concurrent_email_ceiling`/`concurrent_nat_ceiling`/`cleanup_bounded_and_skip_locked`.
- RQ-REG-04: error español/Retry-After sin cookie, resolución de proxy y recuperación/reenvío independiente; pruebas HTTP `tomcatUsesRightmostUntrustedHopAndIgnoresSpoofedHeadersFromUntrustedPeer`, `recoveryAndResendKeepExistingNeutral202AndIndependentQuotas`, prueba MVC `registrationQuotaHasSpanishProblemAndRetryAfterWithoutCookie` y gates históricos de correo/continuidad.

Las ejecuciones locales conservan logs `/tmp/pliego-registration-*`. PostgreSQL18 usa bases vacías desechables en loopback con `PLIEGO_TEST_DISPOSABLE_DB=1`. El primer rojo SQL constató la ausencia de la función de admisión; el primer rojo HTTP constató los tres campos antiguos en la respuesta. El gate de planes incluye las SELECTs reales de cuotas y continuidad con EXPLAIN sin ANALYZE, sin ejecutar comandos de identidad. La verificación final conjunta la coordina el agente principal.
