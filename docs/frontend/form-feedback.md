# Mensajes de formularios

La ayuda explica cómo completar un campo; el error indica qué corregir; el estado informa si hay cambios pendientes. No deben competir en la misma línea.

- Mostrar una sola salida por campo. En teléfono: rechazo de entrada → número guardado incompatible → error de validación → ayuda breve. Un error sustituye la ayuda, no se añade debajo de ella.
- Rechazar inmediatamente caracteres no admitidos sin modificar el valor aceptado. Validar campos incompletos al salir o enviar; no señalar como error cada paso de una entrada en curso. Mantener la validación definitiva del envío y del servidor.
- Usar ejemplos breves y mensajes accionables: «Ejemplo: 991234567.», «Usa solo números.», «Completa los 9 dígitos del celular.» Los mensajes desconocidos del servidor conservan su significado.
- Mostrar «Cambios sin guardar» junto a Guardar/Cancelar. Ocultarlo al recuperar el valor inicial. Reservar «Borrador recuperado» para restauración y «Cambios nuevos sin guardar» para edición posterior a un envío. Conservar almacenamiento, versión original, exclusión de envíos concurrentes y contraseñas solo en memoria.
- El botón muestra «Guardando…». El estado accesible anuncia «Guardando cambios.» sin otro párrafo visible. Mantener `aria-invalid`, una descripción vinculada al mensaje activo y anuncios de rechazo sin acumular errores.
- Antes de cambiar correo: «Te enviaremos un enlace para verificar el nuevo correo.» Después: «Correo actualizado. Revisa … para verificarlo.» Los detalles de seguridad van en `details/summary`; no prometer cierre inmediato de todas las sesiones.
- Al restablecer contraseña: «Inicia sesión con tu nueva contraseña.» Mantener la respuesta genérica de recuperación, el uso único del enlace, los resultados inciertos y los controles de autoridad.
- Al abrir el enlace de verificación: comprobarlo automáticamente, mostrar «Verificando tu correo» durante la espera y «Correo verificado» al confirmar el servidor. Volver automáticamente al destino interno validado o al inicio, conservando los controles de acceso de las páginas privadas. No pedir otro clic ni repetir solicitudes con resultado incierto.

Aplicado en perfil, registro, direcciones, identificación de facturación y recuperación de cuenta. El nombre de facturación también explica los caracteres rechazados en su único mensaje.

Validación de este ajuste: suite completa frontend, pruebas de borradores y concurrencia, navegador a 320/768/1280 px en ambos temas y regresiones de navegación/facturación. Logs y capturas sintéticas: `/tmp/pliego-ihc-*.log`, `/tmp/pliego-ihc-email-*.png`, `/tmp/pliego-ihc-phone-*.png`. No se cambiaron reglas de negocio, SQL ni códigos de error del backend.
