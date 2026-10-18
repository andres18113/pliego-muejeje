# ADR-0039: Retorno interno seguro en los shells de PLIEGO

Fecha: 2026-10-17. Estado: aceptado por aprobación del plan de implementación.

Una política compartida sirve la cabecera global, la cabecera de compra y la recuperación de errores. El historial propio vive en memoria, registra keys de React Router y se reinicia al cambiar autoridad. Solo admite destinos internos conocidos; no considera `history.length` o un `from` arbitrario pruebas suficientes de seguridad. Agrupa cambios de filtros de una misma pantalla y utiliza respaldo jerárquico cuando falta una visita anterior verificable.

Autenticación consumida, acciones con tokens y checkout confirmado no son destinos reutilizables. La navegación conserva las defensas existentes de autoridad y vida de vista: abandonar un formulario no cancela una operación enviada a PostgreSQL. Regresar nunca repite un comando de compra, carrito, pago o factura. Ante respuesta perdida se reconcilia el intento existente.

Los mecanismos de retorno contextual reutilizan la política segura; los shells evitan flechas duplicadas. Foco y scroll siguen las políticas de navegación existentes. El botón global solo garantiza permanencia dentro de PLIEGO para su propia acción: no puede reescribir el historial externo del navegador.

Evidencia requerida: PUSH/REPLACE/POP, acceso directo, recarga, historial externo, filtros, autenticación y cambio de usuario, checkout incierto/confirmado, carrito sin comandos duplicados, teclado y shells público/compra/error.
