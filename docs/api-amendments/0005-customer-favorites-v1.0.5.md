# Enmienda 0005 — Favoritos de CUSTOMER (v1.0.5)

## Alcance

Añade favoritos persistidos para clientes. La unidad guardada es `pliego.edicion`, igual que en el catálogo y el carrito; dos ediciones del mismo libro se guardan por separado. La tabla `pliego.cliente_favorito` conserva el vínculo entre cliente y edición, y no copia título, precio ni portada.

La migración `V029__customer_favorites.sql` crea una clave primaria `(cliente_id, edicion_id)` y un índice `(cliente_id, fecha_creacion DESC, edicion_id DESC)` para la consulta paginada. Las operaciones de escritura y consulta usan la Database API pública:

- `sp_customer_favorite_add(actor_user_id, edition_id)`, idempotente; solo admite ediciones publicables.
- `sp_customer_favorite_remove(actor_user_id, edition_id)`, idempotente.
- `fn_customer_favorites(actor_user_id, page, page_size)`, con datos actuales de catálogo y disponibilidad.
- `fn_customer_favorite_status(actor_user_id, edition_ids)`, estado por lote de hasta 50 ediciones.

Las rutinas validan el actor con `fn_assert_actor(..., 'CUSTOMER')`. Un favorito conserva su edición aunque quede inactiva o sin existencias; la respuesta muestra `available: false`. Los identificadores enviados por REST siguen siendo cadenas JSON para mantener la precisión de BIGINT.

## REST

Todos los recursos requieren bearer JWT con rol `CUSTOMER`; sin sesión se conserva `AUTH_REQUIRED` y los errores de token mantienen los códigos de autenticación existentes.

| Método y ruta | Contrato |
| --- | --- |
| `GET /api/v1/me/favorites?page=0&pageSize=20` | `PageResponse<CustomerFavorite>`; `pageSize` admite 1–50. Devuelve portada, título, autores, editorial, precio, disponibilidad y fecha guardada. |
| `GET /api/v1/me/favorites/status?editionIds=12&editionIds=13` | Lista `{ editionId, favorite }`; requiere 1–50 identificadores positivos. |
| `PUT /api/v1/me/favorites/{editionId}` | Guarda la edición; responde `204`. Repetir la petición no duplica filas. |
| `DELETE /api/v1/me/favorites/{editionId}` | Quita la edición; responde `204`, también si ya estaba ausente. |

Agregar una edición inexistente o que dejó de ser publicable conserva el error de catálogo `P2041 / EDITION_NOT_FOUND` (`404`). Errores de actor, rol, entrada y autenticación conservan sus SQLSTATE y códigos existentes; los fallos internos mantienen `500 / INTERNAL_SERVER_ERROR`.

## Experiencia

El catálogo consulta el estado de las ediciones visibles en una petición por lote. Los controles de portada ofrecen guardar/quitar favorito y agregar al carrito; también se habilitan con foco de teclado y permanecen visibles bajo cada portada en dispositivos táctiles. El destino `/favorites` muestra páginas de guardados y forma parte de la navegación de cuenta CUSTOMER.

Al solicitar guardar desde una sesión anónima, el cliente conserva la edición y el destino de regreso en el estado de navegación, abre login y completa el guardado después de autenticar. No usa almacenamiento local para representar favoritos.
