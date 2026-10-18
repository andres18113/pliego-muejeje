# ADR-0037: Cédula como atributo privado de facturación

Fecha: 2026-10-17. Estado: aceptado por aprobación del plan de implementación.

Se conservan `usuario_id` y `cliente_id` internos. La cédula no es identificador técnico ni credencial y no se exige para crear cuenta o explorar. La primera versión nominativa admite `EC_CEDULA`: diez dígitos ASCII, módulo 10, ceros iniciales y rechazo de valores repetidos. Se recortan únicamente espacios ASCII externos en todas las capas. No se afirma existencia ni titularidad y no se imponen prefijos territoriales sin evidencia primaria suficiente.

PostgreSQL valida las escrituras y mantiene el atributo opcional del perfil. Un recurso propio permite leer, reemplazar y eliminar ese atributo sin interferir con las actualizaciones existentes de `/me`. Spring delimita la transacción y el gateway solo llama rutinas públicas parametrizadas. React y Java comparten casos sintéticos con la BD. No se impone unicidad entre cuentas: conocer una cédula no acredita su propiedad.

Los snapshots de comprador son independientes del destinatario de entrega y no cambian cuando cambia el perfil. Listados y logs no deben contener identificación completa; edición propia y documento requieren autorización. La LOPDP exige finalidad, minimización, legitimación y protección por diseño; no se atribuye a la ley una prohibición literal de claves primarias que no se ha identificado.

Evidencia requerida: fixtures entre capas, pruebas de acceso propio/ajeno, rechazo de cuerpo con actor inyectado y preservación de `/me` y documentos históricos. Fuente normativa y límites en el plan aprobado.
