# Investigación JVM y preparación del soak — 2026-11-05

**Clasificación: no resuelto; la inestabilidad del host/entorno sigue siendo una
hipótesis compatible con la evidencia.** No se reprodujo el SIGSEGV original y
no se identificó un defecto de PLIEGO ni un defecto concreto del JDK. No hay
calificación normal-JIT de un VPS aislado ni autorización para habilitar
monitorización en producción. `management.server.port: -1` permanece intacto.

En este documento `<ws2>` significa
`.release-evidence/2026-11-05-next/ws2/`. El informe de auditoría del 4 de noviembre,
ADR0059 y toda su evidencia se consultaron como fuentes de solo lectura. No se
contactó producción, VPS ni APIs de Cloudflare; no se usaron credenciales reales,
Docker ni nuevos flags de servicio. El árbol de trabajo previo ya tenía cambios
sin confirmar; se conservaron.

## Evidencia original e hipótesis

El original `performance/crash-20261104T225134Z/hs_err_pid112.log` de la auditoría
retiene un SIGSEGV de C2 en `PhaseChaitin::interfere_with_live`, compilando
`PrometheusMeterRegistry::lambda$addDistributionStatisticSamples$0` de 613 bytes,
Temurin 25.0.5+8, a los 823,257 segundos. La sesión `clean-parity-c2` conserva otro
fallo nativo de C1 nivel 3 en `CoyoteAdapter.parsePathParameters` (garantía de
relocación). La auditoría también describe los fallos anteriores de compilación
regex/Xerces del 3 de noviembre y el error MultiXact de PostgreSQL en
`parity-remaining`. Son componentes/puntos de fallo diferentes; no demuestran
una causa común. No se repitió ni se modificó el clúster inconsistente.

Hipótesis contrastada: un defecto determinista de la compilación C2 original
debería reaparecer al reproducir los datos de compilación con el mismo JDK y
clases. Una reproducción negativa debilita esa hipótesis concreta, pero no
excluye un defecto dependiente del estado/tiempo, corrupción anterior o cambios
en el contexto de carga. Un ensayo corto de memoria no certifica hardware.

## Reproducción ejecutada

Antes de reproducir, se copiaron a `<ws2>/inputs/` el JAR congelado de la auditoría,
el fatal y el replay. `<ws2>/input-hashes.json` conserva SHA-256. Se extrajeron
únicamente `BOOT-INF/classes` y `BOOT-INF/lib` del JAR copiado bajo
`<ws2>/classpath`; no se reconstruyó el backend ni se usó el JAR mutable de Maven.

Se ejecutó el binario Temurin de la evidencia del 3 de noviembre como herramienta
de solo lectura. Posteriormente se copió también el JDK a
`<ws2>/runtime/temurin-25.0.5+8`, verificando igualdad SHA-256 de `bin/java`,
`lib/server/libjvm.so`, `lib/modules` y `release`; se confirmó la reproducción
con esa copia. Los comandos completos y entornos controlados figuran en cada
`replays/**/command.json`; `commands.jsonl` contiene el registro agregado.

| Cohorte | Núcleos lógicos fijados | Intentos | Exit 0 / compilación objetivo observada | Fatal nuevo |
| --- | --- | ---: | ---: | ---: |
| Inicial | 0 | 1 | 1 | 0 |
| Principal, `temurin25-repeated` | 0, 2, 4, 16; diez por núcleo | 40 | 40 | 0 |
| Confirmación con copia JDK | 0 | 9 | 9 | 0 |

La cohorte principal consumió 195,837 segundos de tiempo de pared acumulado; la
confirmación, 34,143 segundos. `replay-summary.json`, `replay-driver.log` y los
50 archivos de salida conservan los resultados, sin nuevos hs_err. La
confirmación copiada se detuvo intencionalmente en el siguiente límite de
intento por indicación del coordinador para evitar repetir otros 40 ensayos.
`core0-10/operator-stop.txt` es un marcador, no un intento de JVM. El driver
terminó con exit 1 por ese directorio ya reservado; los nueve procesos Java
completados terminaron con exit 0. No se reclasificó ese stop como fallo nativo.

Comando principal reproducible desde la raíz (el `label` debe ser nuevo):

```bash
python3 perf/jvm/replay.py \
  --jdk .release-evidence/2026-11-03/temurin/jdk-25.0.5+8 \
  --evidence .release-evidence/2026-11-05-next/ws2 \
  --label temurin25-repeated --cores 0,2,4,16 --repeats 10
```

Cada Java recibió exactamente `-Xms256m -Xmx1280m`,
`-XX:+UnlockDiagnosticVMOptions -XX:+ReplayCompiles`,
`-XX:ReplayDataFile=<copia> -XX:+ReplayIgnoreInitErrors`, salida fatal en su
propio directorio, `-XX:+PrintCompilation` y el classpath extraído. Se deshabilitó
el core dump exclusivamente para estos procesos diagnósticos. No hubo DB ni
tráfico HTTP. Los intentos fueron secuenciales, con como máximo un núcleo ocupado.

**Límite importante:** las clases y dependencias son los mismos bytes del JAR,
pero el classpath está aplanado: no reproduce el classloader de Spring Boot, los
objetos/perfiles MethodHandle completos ni la historia de heap/JIT del servicio.
La JVM emite advertencias de métodos MethodHandle sin datos; se retienen sin
ocultarlas. PrintCompilation prueba la selección de la compilación objetivo y
la JVM sale limpiamente; sin traza de todas las fases/nmethod no se afirma que
cada decisión de optimización sea idéntica ni se excluye un bailout silencioso.
La prueba aporta evidencia negativa frente a una reproducción determinista,
no certificación normal-JIT sostenida.

## Consulta de trackers y actualización disponible

Las consultas públicas se hicieron el 5 de noviembre; las respuestas JSON
primarias se guardan bajo `<ws2>/`, con URLs/estados en
`research-requests.jsonl`. La búsqueda exacta con comillas escapadas de
`interfere_with_live` en JBS devuelve dos entradas: `JDK-8367315` (Valhalla,
límite de memoria de compilación) y `JDK-4489478` (fallo de build de 2001).
Ninguna identifica este SIGSEGV Temurin 25.0.5+8. La primera consulta sin frase
exacta devolvió 38 coincidencias amplias y se conserva separadamente; no se
confunde ese resultado con una coincidencia de firma.

La búsqueda exacta en `adoptium/adoptium-support` devuelve cero incidencias;
las búsquedas amplias de C2 y 25 contienen coincidencias no equivalentes. La
búsqueda limitada y los resultados públicos no prueban ausencia de un bug.

Fuentes relacionadas revisadas:

- [JDK-8383420](https://bugs.openjdk.org/browse/JDK-8383420) y su
  [cambio oficial](https://github.com/openjdk/jdk/commit/0c07aaa7aeef2f7e3e31817e73d7d5f82bf7afd6)
  corrigen otra firma de PhaseChaitin, `gather_lrg_masks`, en pruebas AOT de JDK 27.
  La descripción/versión no coincide con este JDK 25 y lambda; no se atribuye
  este fallo a esa incidencia.
- [JDK-8379129](https://bugs.openjdk.org/browse/JDK-8379129) describe un fallo C2
  de JDK 25.0.1 en Escape Analysis/`LoadNode::can_split_through_phi_base`.
  Es una firma distinta; confirma la existencia de defectos C2, no su causalidad
  aquí. Las versiones y estados exactos están en el JSON primario retenido.
- La [lista oficial de Temurin 25](https://github.com/adoptium/temurin25-binaries/releases)
  y su [API de releases](https://api.github.com/repos/adoptium/temurin25-binaries/releases?per_page=5)
  muestran **25.0.5+8 como última release GA**, publicada el 22 de octubre.
  No se encontró una actualización GA posterior disponible para el diagnóstico;
  no se sustituyó por otra línea de Java. La API Adoptium `assets/latest/25`
  devolvió HTTP 403, retenido en `adoptium-query.json`; se usó la fuente oficial
  alternativa de releases. No se presenta como ejecutado un ensayo con JDK nuevo.

## Verificación acotada del host

El host registrado es WSL2, kernel `6.6.87.2-microsoft-standard-WSL2`, Ubuntu
26.04, Intel i9-14900HX visible con 32 CPUs lógicas y aproximadamente 15,5 GiB de
RAM. `host.log` conserva `lscpu -e`, afinidad, memoria y versión; no es una VM de
Ubuntu 24.04 equivalente al VPS. La topología visible agrupa 0/1 y 2/3 como
hermanos SMT; se fijaron los verificadores a 0 y 2, los núcleos del ensayo original.

No estaban instalados stress-ng, memtester ni compilador C. En vez de instalar
software se ejecutó `host-verify.py`: dos procesos de 128 MiB, concurrentes durante
60 segundos (256 MiB de región objetivo total), escritura de patrón byte 0–255,
comparación SHA-256 del bloque completo, known-answer SHA-256 de `abc` y una
operación modular con resultado conocido. No toca dispositivos ni datos del host.

| Núcleo | Duración s | Vueltas completas | Bytes verificados | Exit |
| --- | ---: | ---: | ---: | ---: |
| 0 | 60,029 | 541 | 72.611.790.848 | 0 |
| 2 | 60,017 | 603 | 80.933.289.984 | 0 |

Logs `host-verify-core{0,2}.log`, argumentos/exits en `commands.jsonl`. No hubo
mismatch ni proceso fallido. La región objetivo es una fracción pequeña de la
RAM; librerías/SO/virtualización pueden ocultar modos de fallo. No es memtest
fuera del SO, ECC, diagnóstico térmico/microcódigo, prueba de todo el CPU ni
justificación para declarar estable el host. Se coordinó la ventana de carga
con el coordinador y WS1 antes de medir.

## Harness preparado y validación local

`perf/jvm/README.md` contiene el procedimiento completo; `soak.py` observa el
servicio existente en el target y `load.py` ejecuta el mismo `journeys.js` desde
un generador separado, con 15 VUs y hold mínimo de 7200 segundos. Las variables
opt-in/allowlist se alinean con WS3; no se cambian journeys ni thresholds. El
observador usa 7500 segundos por defecto, scrape loopback cada 2 segundos,
comprobación de PID/reutilización, JIT efectivo, cgroup 1700 MiB/2 GiB, PSI,
/proc, eventos OOM, fatal/replay y C2 de la lambda al final. NMT solo si ya estaba
habilitado; en el servicio sin flag NMT se registra como **no disponible**.
No se agrega ese flag para obtener una métrica ausente.

`fatal-collector.py` usa inotify y conserva descriptores abiertos para copiar
fatal/replay aunque systemd quite su nombre de `PrivateTmp`. El runbook exige
resolver antes del ensayo el directorio host privado real de la unidad; la ruta
`/proc/PID/root/tmp` no sirve tras morir el PID. La prueba local crea un fatal
**sintético**, espera captura, elimina el origen y comprueba bytes exactos:
`collector-probe.log` muestra exit 0 y `unlinked_source_captured=true`.
La captura sigue siendo best effort ante borrado anterior a abrir, overflow,
permisos/caída del host. El monitor hace una pasada final aun después de detectar
PID muerto; cualquier salida/reinicio invalida el soak aunque no quede hs_err.
No se afirma haber probado el ciclo PrivateTmp de systemd aquí.

Validación final en `<ws2>/tests-final.log`: **12 tests**, exit 0 (URL externa/
ambigua, dominio de producción incluso allowlisted, allowlist exacta, IP pública,
workarounds JIT, métricas ausentes y nuevos OOM). `python-syntax.log`: exit 0
para todos los scripts Python. Los rechazos CLI son intencionales:
`soak-reject-short.log`, duración 1 s, exit 2; `load-reject-production.log`, dominio
producción, exit 2 antes de resolver/conectar/leer fixtures. No se crea directorio
de ejecución para esos rechazos. El log rojo previo se conserva como historial
de desarrollo; las afirmaciones finales usan la última verificación.

No se ejecutó un soak de dos horas ni un VPS remoto: WS2 pide **prepararlo** y
WS3 es preparación únicamente. Los tests locales no prueban los límites cgroup,
la captura real de fatal ni la estabilidad de un servicio normal-JIT durante
carga sostenida. La suite backend la verifica el coordinador/WS4; WS2 no cambió
código/configuración backend.

## Gate exacto y decisión operativa

El entorno solo se acepta cuando el VPS aislado WS3 conserva versiones/flags/
límites/hardening revisados, pasa su matriz completa y un soak normal-JIT con al
menos dos horas **continuas de 15 VUs sostenidos**, observación que cubra todo
ese intervalo y scrapes cada 1–5 s, sin huecos >5,5 s, sin restart/cambio de PID,
fatal/replay nuevo, ERROR/PANIC de integridad PostgreSQL/MultiXact ni OOM/kill.
Todos los grupos k6 deben tener muestras positivas y mantener los thresholds
originales: p95 catálogo/búsqueda/detalle <800 ms, auth/carrito <1500 ms,
checkout <3000 ms y errores inesperados <1 %, junto con checks >99 %.
Se revisan tendencias de memoria/reclaim, journal/NRestarts, logs PG y evidencia
normal-C2; un exit 0 del observador por sí solo nunca da aceptación completa.

Solo después, una aprobación operativa separada cubre perfil/puerto y overrides,
ventana de reinicio, mecanismo de colección y proveedor, credenciales si aplica,
intervalo, alertas/propietario y presupuesto de recursos de ADR0059. Después de
activación aprobada se verifica binding loopback y aislamiento del puerto de
aplicación; rollback: desactivar perfil y reiniciar. **Producción sigue deshabilitada.**

Una reproducción determinista en hosts independientes justificaría abrir/revisar
un bug JDK con replay sanitizado y hashes. Un fallo exclusivo del host WSL con
controles independientes fallidos reforzaría la atribución ambiental. La evidencia
actual no alcanza ninguno de esos umbrales: mantener «no resuelto» y no aplicar
workarounds JVM/Tomcat/Hikari ni cambios de negocio.
