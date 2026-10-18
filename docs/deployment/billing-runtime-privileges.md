# Privilegios de ejecución de facturación

La arquitectura aprobada usa `SECURITY INVOKER`: el backend es un intermediario de confianza que obtiene actor del JWT. El rol de conexión necesita permisos sobre los objetos que ejecutan las rutinas; llamar una rutina con un ID no demuestra identidad a quien ya posee las credenciales SQL.

En despliegue, usar un login dedicado sin SUPERUSER/CREATEDB/CREATEROLE/REPLICATION ni CREATE sobre el esquema. El propietario/migrador debe ser otra cuenta administrativa. Aprovisionar USAGE del esquema/secuencias y los permisos de tablas y ejecución requeridos por las rutinas mediante administración del entorno, no mediante contraseñas o nombres de usuario incrustados en Flyway. Mantener el acceso de red a PostgreSQL limitado al backend y operaciones; no entregar estas credenciales a usuarios web.

Ejecutar el probe con una cuenta administrativa en un clúster desechable, no con el login runtime: necesita crear el rol temporal y revierte esa operación. CI lo ejecuta como administrador en un paso separado.

El test `billing_runtime_privileges_gate.sql` verifica un rol NOLOGIN sin privilegios elevados dentro de una transacción que revierte sus grants. Prueba ejecución de la validación y rechazo de actor inexistente. Los gates HTTP verifican aislamiento entre clientes y rutas ADMIN; los gates de BD verifican restricciones e inmutabilidad con las escrituras reales.

Límite explícito: el modelo INVOKER no aísla los datos frente a un poseedor de credenciales runtime con los permisos DML necesarios. Evitar ese acceso directo requeriría una decisión arquitectónica posterior, por ejemplo una API de funciones con propietarios/permisos distintos y una identidad SQL verificable. Este cambio no introduce `SECURITY DEFINER` ni afirma esa garantía. Los logs de prueba no acreditan permisos de una instalación externa.

Los artefactos privados se almacenan en PostgreSQL y participan en su política de backups/cifrado y acceso. La retención académica debe fijarse para el entorno; no tratar estos documentos simulados como motivo automático de conservación fiscal indefinida.
