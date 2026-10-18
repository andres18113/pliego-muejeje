# ADR 0036: conservar el destino después de verificar el correo

Estado: aceptado. Fecha: 2026-10-10.

El registro crea una cuenta pendiente y un correo transaccional. No concede sesión: el cliente debe probar la propiedad del correo y después autenticarse. Los enlaces de reenvío y el enlace del correo perdían el destino de una visita iniciada en `/cart`, aunque el acceso inmediato bloqueado era correcto.

Los comandos públicos de registro y solicitud de correo aceptan el campo opcional `returnTo`. El servicio admite únicamente rutas relativas de catálogo y de la cuenta cliente. Dentro de la misma transacción que registra o solicita el correo, el gateway invoca una nueva función pública, `fn_email_action_set_return_path`, que valida nuevamente la ruta y añade metadatos solo al evento pendiente con el nonce recién emitido. No cambia las firmas históricas de los comandos PostgreSQL, las cuotas, los destinatarios ni las reglas de verificación.

La plantilla incorpora el destino codificado en `?from=` y conserva la credencial exclusivamente en el fragmento `#token=`. El frontend valida ese destino otra vez, lo mantiene durante reenvío, verificación, recuperación e inicio de sesión y navega al destino solamente después de autenticar. Un destino externo, no permitido o inválido se descarta; no autoriza acceso. Los clientes anteriores y los correos ya emitidos siguen funcionando sin destino contextual.

La regresión cubre unicidad de correo, registro con y sin teléfono, login bloqueado antes de verificar, entrega local mediante outbox/worker/proveedor simulado, consumo explícito y único del token, rutas peligrosas y retorno tras el login. Ninguna prueba crea cuentas ni envía correos en producción.
