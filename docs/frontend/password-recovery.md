# Restablecer contraseña desde el perfil

El perfil ofrece **Contraseña → Enviar enlace para restablecer**. Usa el correo vigente de `GET /api/v1/me`, no el borrador de edición ni el correo antiguo de la sesión. Mientras se actualiza el perfil, la acción permanece deshabilitada. Un correo pendiente de verificación ofrece primero el enlace existente para reenviar esa verificación.

Se reutiliza el flujo de recuperación de identidad, sin otra API ni otra regla de contraseñas:

1. El clic explícito llama a `POST /api/v1/auth/forgot-password` con el correo del perfil y `returnTo: "/account"`.
2. El servicio transaccional existente solicita la acción mediante JDBC y la Database API. El trabajador de correo entrega el enlace.
3. El enlace abre `/restablecer-contrasena?from=%2Faccount#token=…`. La página retira el token de la dirección y lo conserva solo en memoria. Abrir el enlace no lo consume.
4. La persona escribe y confirma su nueva contraseña. `POST /api/v1/auth/reset-password` consume el token una sola vez y revoca las sesiones renovables anteriores.
5. El acceso continúa mediante el inicio de sesión habitual; su acción principal conserva el regreso al perfil. No se inicia sesión automáticamente.

Los controles existentes del servidor mantienen el hash del token, vencimiento de 15 minutos, límites de solicitudes y respuesta pública genérica. La solicitud por sí sola no cambia la contraseña ni cierra la sesión. Los tokens de acceso emitidos antes del cambio conservan su vencimiento acotado; la interfaz no promete un cierre instantáneo en otros dispositivos.

La acción del perfil bloquea clics simultáneos y espera un minuto antes de permitir otro envío explícito tras una aceptación, resultado incierto o límite de solicitudes. No realiza reintentos automáticos. «Solicitud recibida» confirma la aceptación, no la entrega del correo. Una respuesta perdida pide revisar el buzón antes de reintentar. Los resultados tardíos se descartan si cambia la cuenta, la vista o el correo mostrado. La espera visual complementa los límites del servidor.

Decisión alineada con la [guía de recuperación de contraseña de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): recuperación por un canal separado, enlace de uso único con caducidad y acceso posterior mediante el inicio de sesión normal. Se conserva la arquitectura Spring → JDBC → Database API y no se modifica el esquema.

## Verificación

- `PasswordRecovery.test.tsx`: integración con el perfil, correo vigente, clic simultáneo, reenvío manual, fallos inciertos, rechazo definitivo, límite de solicitudes, verificación pendiente y cambios de cuenta/correo durante la respuesta.
- `backend/src/test/postgres18/password_profile_http_gate.py`: REST, PostgreSQL y entrega a un proveedor HTTP local; uso único concurrente, vencimiento, cuotas, rechazo de la contraseña anterior, acceso con la nueva y revocación de sesiones renovables. Requiere una base **desechable y migrada**, el JAR construido y las variables locales `PG*`, `PLIEGO_DB_*`, `PLIEGO_JWT_SECRET`. Ejecutar con `python3 backend/src/test/postgres18/password_profile_http_gate.py`; `--serve` ofrece una fixture de backend y buzón local para navegador. Nunca entrega correo externo.
- Regresiones: suite completa frontend, compilación y navegador para perfil, navegación y facturación. Prueba real adicional desde el perfil hasta el correo local, restablecimiento e inicio de sesión; revisión visual en 320/768/1280 px y ambos temas.

Evidencias locales de esta implementación: `/tmp/pliego-password-*.log` y `/tmp/pliego-password-profile-*.png`. Las fixtures usan cuentas sintéticas y no se incluyen credenciales ni tokens en el repositorio.

Resultado del 17 de octubre de 2026: **898/898 pruebas frontend**, **20/20 pruebas de navegador**, compilación aprobada y prueba real completa con correo local aprobada. La revisión independiente no dejó hallazgos pendientes. El recorrido real confirmó un único envío y consumo, rechazo de la contraseña anterior, acceso con la nueva y regreso al perfil. Capturas en seis combinaciones de tamaño y tema.
