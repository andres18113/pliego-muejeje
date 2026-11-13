# Prevención local de correos no entregables

Alcance autorizado: backend, nueva V093, scripts de lectura y documentación.
Sin frontend, commits, producción, escrituras Mailtrap ni reenvíos.
Diseño: [ADR 0048](../../adr/0048-mailtrap-delivery-outcomes.md).

1. Auditar registro/cambio, receptores, recibo y worker; conservar V001–V092.
2. Añadir pruebas fallidas de firma cruda, configuración desactivada, parser,
   retención del worker y campo de perfil. Implementar adaptador webhook,
   servicio transaccional y gateway JDBC con los patrones existentes.
3. Gate SQL fallido: inbox idempotente/conflicto/rollback, proyección fuera de
   orden y previa a recibo, bloqueo de destinatarios actuales e históricos,
   liberación del indicador al corregir, entrega posterior y HELD terminal.
   Implementar V093 con API pública SECURITY INVOKER y privilegios explícitos.
4. Script GET-only con UA explícito y salida por lista permitida/hash; pruebas
   con transporte falso (sin llamadas reales). Actualizar API y runbook.
5. Ejecutar mvn -q test con log íntegro en /tmp, gates SQL/concurrencia/HTTP
   relevantes en PostgreSQL 18 descartable y revisión de diferencias.

Riesgos cubiertos: webhook antes de recibo, replay/conflicto, eventos viejos
tras cambio de dirección, reject por dominio sin suppression, fallo permanente
empatado con entrega, fallo DB antes del ACK. Sin reenvíos implícitos.
