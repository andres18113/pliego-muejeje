# PLIEGO — correcciones finales en producción, 2026-10-07

Las nueve correcciones están implementadas y verificadas. El frontend y backend corregidos están publicados en https://pliegolibros.com y https://api.pliegolibros.com. No quedan bloqueadores de este alcance.

## Hallazgos y reproducción

| Hallazgo | Cambio | Evidencia final |
| --- | --- | --- |
| ACCT-01 PASS | Refrescar carrito al activar/visibilizar la pestaña; checkout conserva lo revisado y exige confirmar cada cambio material antes de enviar. Conserva preflight, fingerprint e idempotencia. | Dos pestañas Chromium nativas contra producción: qty1→2, total114,93→209,18; checkout cache2→servidor3 avisa209,18→303,42 y requiere revisión; cambio posterior3→1 exige otra revisión. Test local bloquea doble clic y confirma cero POST. |
| PUB-01 PASS | Texto Libro/eBook/Audiolibro visible en cards mezcladas, consistente con nombre accesible y PDP. | Catálogo y búsqueda reales con tres formatos, cuatro anchos, portadas decodificadas. |
| ACCT-02 PASS | Precio unitario c/u para físicos con qty>1 y Subtotal explícito separado de cantidad. | Producción qty10:81,95c/u,819,50subtotal;320/390/768/1280. |
| ACCT-03 PASS | Restaurar foco después del cierre/transición del diálogo, cuando se libera el trap y existe el resumen seleccionado. | Primera dirección real de cuenta controlada en producción bajo CPU4: foco checkout-change-address; un role=status; Cancel/Escape conservados. Regresión local a los cuatro anchos. Dirección temporal eliminada. |
| MOB-01 PASS | Quitar min-width rígido320 de html/body; conservar navegación y controles. | Zoom nativo Chrome200%,640×756físico→320×378CSS,DPR2,scrollbar clásico:clientWidth312=scrollWidth312. Cuatro anchos y teclado, sin ocultar overflow ni controles. |
| MOB-02 PASS | Breadcrumb Catálogo siempre/catalog; regresos contextuales explícitos; auth conserva el destino validado y etiqueta correcta, incluyendo carrito/cuenta/pedidos/biblioteca. | Secuencia real edición250?from=/ofertas→sign-in→edición; Catálogo/catalog y Volver a Ofertas/ofertas. Regresiones de todos los destinos permitidos, whitelist intacta. |
| PUB-02 PASS | Mostrar Más sobre eBooks solo si existe otro recurso publicado relevante. | Categoría real solo contiene ebooks: control ausente; fixtures prueban otra publicación y destino funcional. |
| Orders white PASS | Cambiar únicamente background del empty state al token blanco existente --ol-card. | /orders real blanco RGB255,255,255 a cuatro anchos. Tests comparan geometría, radio, padding, tipografía y CTA con la declaración anterior. |
| Verified-email UI PASS | Mostrar resend únicamente para emailVerified=false explícito del perfil actual. | Cuenta verificada real: aviso ausente a cuatro anchos. PostgreSQL18→JDBC→/me→navegador: false muestra/true oculta, ambos ACTIVE. Tests también cubren ausencia/null sin inferir verificación. |

Los síntomas originales se reprodujeron con código anterior/estilos anteriores y regresiones RED antes de confirmar GREEN. El PDF suministrado se leyó desde /mnt/c/Users/Andres/Downloads/PLIEGO_Auditoria_Produccion_2026-10-07.pdf.

## Release y servicio

- Base: `4d3e666e86afdfbe9934c3769b70815a416649cc`; cambios locales revisables, sin commit ni push.
- Release: `20261007-corrections-ecca2421`.
- Manifest del parche SHA-256: `ecca2421d75005efe157febab72e1ebba2b7e10ebdba5f27f06368c474cde3e3`; hashes de los46 archivos en `/tmp/pliego-production-fixes-20261007/source-manifest.json`. Este handoff se agrega después del empaquetado y no cambia los artefactos.
- Backend: `/opt/pliego/current` → `/opt/pliego/releases/20261007-corrections-ecca2421`; `pliego-backend-0.1.0-SNAPSHOT.jar`, SHA-256 `350ea7c129184fcbf476f7b30151db6bc3f5b54e0e27a2714375c774dc756f84`.
- Frontend: `/var/www/pliego/current` → `/var/www/pliego/releases/20261007-corrections-ecca2421`; únicamente dist. Archivo transferido SHA-256 `02e036057e21f69602e0ab3690939ea95927981b9f33de35e3905e459a1d6969`.
- SHA local/remoto iguales; ambos artefactos construidos localmente.
- `pliego.service` activo/habilitado, usuario/grupo pliego; JVM Xms256m/Xmx1280m; Hikari máximo8/mínimo2;127.0.0.1:8080. PostgreSQL127.0.0.1:5432.
- Flyway66/66 exitosas. V066 agrega una lectura autorizada del timestamp de verificación del correo actual; firmas anteriores disponibles. Las65 anteriores no cambiaron; las19 originales coinciden byte por byte con el ZIP aprobado. ADR0032 documenta el contrato.
- Nginx activo y `nginx -t` válido; vhosts y unidad conservan sus hashes previos. SPA/HTTPS/certificados/AOP intactos. Sin modificaciones a credenciales, SSH/UFW/Cloudflare/DNS/tuningPG.
- Public API200: catálogo425/ofertas23; CORS del origen real permitido y origen ajeno403; error404 sin stack/SQL. Portadas reales720×1080 decodificadas. AOP rechaza los tres hostnames sin certificado cliente con400. Cookies reales Secure/HttpOnly/SameSiteStrict.
- Recursos tras arranque:~961 MiB RAM del sistema usada, ~2954 MiB disponible,swap0,~33GiB disco libre; load 0,00/0,02/0,00. Sin errores críticos de startup ni reinicios automáticos.
- Correo existente conservado; no se enviaron mensajes de prueba ni se crearon compras. Outbox3SENT, sin pendientes. Cuenta controlada restaurada a carrito0/direcciones0/pedidos0 y sesión cerrada.

## Validación

- Frontend:691 tests/69 archivos PASS; typecheck y build Vite de producción PASS, VITE_API_BASE_URL=https://api.pliegolibros.com. No hay script lint separado en este proyecto.
- Backend:`mvn -B verify` PASS,195 tests,0fallos.
- PostgreSQL18.6:59 programas de gates PASS (28SQL+12concurrencia+19HTTP/auth).57 pasaron en el runner; los2 finales de auth se ejecutaron después de corregir Secure en el entorno de fixture. Los logs originales de fallo de configuración se conservan; no se debilitó código ni tests. El scheduler se habilitó en el fixture de gates, conforme a producción.
- E2E Chromium:34 regressiones locales PASS en los cuatro archivos production-*.spec.ts;8 escenarios de catálogo/navegación repetidos después de la última corrección de auth PASS.
- Producción:18 checks públicos PASS; suite autenticada PASS;320/390/768/1280,200% nativo, dos pestañas nativas, primera direcciónCPU4, carrito/Orders/account. Cero compras y cero checkoutPOST.
- Revisión independiente encontró un retorno de auth mal etiquetado; corregido con24 casosRED y95 tests de regresiónGREEN.
- `git diff --check` y manifest de source/artifacts PASS.

## Evidencia y operación

Logs completos y screenshots: `/tmp/pliego-production-fixes-20261007/`.

- `logs/frontend-final.log`, `logs/frontend-final-build.log`, `logs/backend-verify.log`.
- `logs/final-local-browser.log`, `logs/catalog-nav-final-browser.log` y `evidence/final-local-browser/`.
- `logs/native-full-gates.log`, `logs/native-final-auth-gates.log`, `evidence/native-full-gates-summary.json`.
- `logs/profile-native-ui.log`, `profile-native-browser/current-email-{false,true}.png`.
- `logs/production-public-browser.log`, `production-public-browser/results.json` y screenshots.
- `logs/production-account-browser.log`, `evidence/production-account/results.json` y screenshots.
- `logs/artifact-transfer.log`, `logs/production-deploy.log`, `logs/production-final-infrastructure.log`.
- En VPS: `/opt/pliego/deployment/20261007-corrections-ecca2421/release.json`, `backend-startup.log`, `rollback.py`.

Status, restart y logs usan exclusivamente la configuración SSH personal:

```bash
ssh -F /home/andres18123/.ssh/config pliego-vps 'systemctl status pliego nginx --no-pager'
ssh -F /home/andres18123/.ssh/config -t pliego-vps 'sudo systemctl restart pliego'
ssh -F /home/andres18123/.ssh/config -t pliego-vps 'sudo journalctl -u pliego -f'
```

Rollback preparado y preflightPASS: releases anteriores existentes, `nginx -t` válido. No se ejecutó un rollback disruptivo. Conserva V066 y todos los datos:

```bash
ssh -F /home/andres18123/.ssh/config -t pliego-vps 'sudo python3 /opt/pliego/deployment/20261007-corrections-ecca2421/rollback.py --dry-run'
ssh -F /home/andres18123/.ssh/config -t pliego-vps 'sudo python3 /opt/pliego/deployment/20261007-corrections-ecca2421/rollback.py'
```

## Archivos cambiados en la release

- `backend/src/main/java/com/pliego/modules/customer/api/CustomerController.java`
- `backend/src/main/java/com/pliego/modules/customer/api/CustomerProfileResponse.java`
- `backend/src/main/java/com/pliego/modules/customer/application/CustomerProfile.java`
- `backend/src/main/java/com/pliego/modules/customer/application/CustomerService.java`
- `backend/src/main/java/com/pliego/modules/customer/gateway/CustomerGateway.java`
- `backend/src/main/java/com/pliego/modules/customer/gateway/JdbcCustomerGateway.java`
- `backend/src/main/resources/db/migration/V066__expose_current_email_verification_in_profile.sql`
- `backend/src/test/java/com/pliego/modules/customer/api/AdminCustomerApiIntegrationTest.java`
- `backend/src/test/java/com/pliego/modules/customer/api/CustomerApiIntegrationTest.java`
- `backend/src/test/postgres18/customer_profile_verification_gate.sql`
- `backend/src/test/postgres18/run_ci_gates.sh`
- `docs/adr/0032-current-email-verification-profile-read.md`
- `docs/adr/README.md`
- `docs/superpowers/plans/2026-10-07-production-corrections.md`
- `frontend/openapi/openapi.json`
- `frontend/src/features/account/AccountPage.test.tsx`
- `frontend/src/features/account/AccountPage.tsx`
- `frontend/src/features/account/AddressEditorDialog.tsx`
- `frontend/src/features/auth/AuthPages.test.tsx`
- `frontend/src/features/auth/AuthPages.tsx`
- `frontend/src/features/catalog/BookCard.test.tsx`
- `frontend/src/features/catalog/BookCard.tsx`
- `frontend/src/features/catalog/CatalogPage.test.tsx`
- `frontend/src/features/catalog/EditionDetailPage.test.tsx`
- `frontend/src/features/catalog/EditionDetailPage.tsx`
- `frontend/src/features/catalog/bookCardModel.ts`
- `frontend/src/features/help/HelpRoutes.test.tsx`
- `frontend/src/features/help/HelpRoutes.tsx`
- `frontend/src/features/help/helpQuery.ts`
- `frontend/src/features/purchase/CartPage.test.tsx`
- `frontend/src/features/purchase/CartPage.tsx`
- `frontend/src/features/purchase/CheckoutPage.tsx`
- `frontend/src/features/purchase/ProductionPurchaseCorrections.test.tsx`
- `frontend/src/features/purchase/cart.module.css`
- `frontend/src/features/purchase/cartQuery.ts`
- `frontend/src/features/purchase/orders.module.css`
- `frontend/src/shared/api/customer.ts`
- `frontend/src/shared/api/generated.ts`
- `frontend/src/shared/ui/BackToCatalogLink.test.tsx`
- `frontend/src/shared/ui/BackToCatalogLink.tsx`
- `frontend/src/styles.css`
- `frontend/tests/e2e/bookcard-diagnostic.spec.ts`
- `frontend/tests/e2e/production-catalog-nav.spec.ts`
- `frontend/tests/e2e/production-purchase.spec.ts`
- `frontend/tests/e2e/production-responsive.spec.ts`
- `frontend/tests/e2e/production-state-help.spec.ts`
