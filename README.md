# 🤖 JuegosJuegos Bot | Ultra-Efficient Serverless Aggregator

[![Node.js](https://img.shields.io/badge/Node.js-20.x-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Netlify Status](https://api.netlify.com/api/v1/badges/73ae4611-e40d-4cf1-bb2f-cab3fa825286/deploy-status)](https://app.netlify.com/projects/gratisjuego-bot/deploys)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-GitHub_Actions-2088FF?style=flat-square&logo=github-actions)](https://github.com/features/actions)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-2CA5E0?style=flat-square&logo=telegram)](https://t.me/JuegosJuegosGratis)

## 📖 Resumen del Proyecto

JuegosJuegos es un motor de búsqueda asíncrono y sistema de notificaciones en tiempo real que rastrea ofertas del 100% de descuento en aplicaciones de Android y juegos de PC.

Más allá de su función principal, este proyecto fue concebido como un **estudio práctico de optimización en la nube y arquitectura Serverless**. Está diseñado bajo los principios de _The Twelve-Factor App_ para operar de manera autónoma 24/7 con un **costo de infraestructura de $0.00**, maximizando el Free Tier a través de un consumo milimétrico de cómputo y memoria.

---

## 📊 Métricas de Rendimiento y Costos (Cloud Profiling)

El diseño arquitectónico prioriza la eficiencia extrema, logrando los siguientes márgenes operativos mensuales en Netlify AWS Lambda:

- **Tiempo de Cómputo (Compute Time):** ~0.6 horas / mes _(Utilizando < 1% de la cuota gratuita de 100 horas)_. Las funciones se inicializan, ejecutan y destruyen en promedios de 250ms a 350ms.
- **Peticiones (Invocations):** ~2,220 / mes _(Utilizando apenas el 1.7% del límite de 125,000 peticiones)_.
- **Huella de Memoria (Storage Footprint):** < 1 MB constantes en base de datos.

---

## 🧠 Decisiones de Ingeniería y Arquitectura

- **Microservicios Desacoplados:** En lugar de un orquestador monolítico, el sistema divide las cargas de trabajo según la volatilidad de la fuente. Esto **redujo el consumo de peticiones de red en un 74%** y evita bloqueos por _Rate Limiting_ (HTTP 429).
  - _Google Play Scraper (Android):_ Ejecución cada 20 minutos con camuflaje de `User-Agent`.
  - _Reddit RSS (Android):_ Ejecución cada 4 horas desde GitHub Actions consumiendo `r/googleplaydeals/new.rss`.
  - _GamerPower API (PC):_ Ejecución programada 2 veces al día filtrando parámetros directamente desde el origen.
- **Garbage Collection y Gestión de Memoria Dual:** Para evitar _Memory Leaks_ en el almacén de datos (Netlify Blobs), se implementaron dos estrategias de limpieza automatizada en memoria RAM:
  - _Sincronización de Estado (PC):_ Purga automática de IDs que ya no están activos en el _endpoint_ origen.
  - _Cola Circular FIFO (Android):_ Límite estricto de retención a los últimos 300 registros, garantizando lecturas/escrituras de latencia ultrabaja (O(1) footprint).
- **Paridad de Entornos (Dev/Prod):** Integración de variables de entorno dinámicas. El código es 100% agnóstico a la infraestructura, ejecutándose de manera idéntica en local y en producción sin alterar la lógica de conexión.
- **TDD y Testing 100% Offline (CI/CD):** Implementación de pruebas unitarias usando el _test runner_ nativo (`node:test`) con _Mocking_ avanzado de APIs externas (Fetch/Telegram/Scrapers). Esto garantiza que el _pipeline_ de GitHub Actions se ejecute en milisegundos sin dependencia de red.

## ⚙️ Flujo de Operación de los Microservicios

1.  **El Disparador (Cron):** GitHub Actions ejecuta los productores y Netlify ejecuta consumidores y limpiezas ligeras.
2.  **Extracción:** Los servicios consultan las tiendas. El sistema es tolerante a fallos (`try/catch`) ante posibles caídas de estos servicios externos.
3.  **Filtro de Negocio:** Se aplican reglas estrictas de validación (ej. buscar metadatos que confirmen descuentos totales o etiquetas de popularidad).
4.  **Validación de Caché:** Se contrasta el ID de la oferta contra la memoria ultraligera en Netlify Blobs para evitar publicaciones duplicadas.
5.  **Publicación y Limpieza:** Se formatea y transmite el mensaje a Telegram vía webhook, y se invoca el _Garbage Collector_ antes de guardar el nuevo estado.

## 🏗️ Stack Tecnológico

- **Infraestructura Cloud:** Netlify (Scheduled Functions / AWS Lambda por debajo), Netlify Blobs.
- **Backend:** Node.js, `google-play-scraper` (Importación dinámica ES Modules).
- **Integración Continua:** GitHub Actions.
- **Frontend / Notificaciones:** Telegram Bot API (Markdown).

---

## 🔄 Arquitectura Híbrida 2.0 (Productor-Consumidor)

El scraping pesado ya no corre dentro de Netlify Functions.

1. **Productor (GitHub Actions):**
   - Ejecuta `scripts/github-android.js` y `scripts/github-pc.js`.
   - Escribe colas en Blobs: `android_queue`, `android_expired`, `pc_queue`, `pc_expired`.
2. **Productor RSS (GitHub Actions):**

- Ejecuta `scripts/github-android-rss.js` cada 4 horas.
- Lee `https://www.reddit.com/r/googleplaydeals/new.rss` y agrega solo juegos gratis nuevos a `android_queue`.
- Cada ID del feed se valida en Google Play (`google-play-scraper`): categoria de juego (`GAME_*`) + precio actual gratis + precio original mayor a 0.
- Deduplica contra `published_games_android` y contra la cola ya existente.
- En la misma corrida infiere expirados desde el feed, llena `android_expired` y elimina mensajes expirados en Telegram.
- Incluye guardas anti-falsos positivos: `ANDROID_RSS_MIN_ACTIVE_IDS`, `ANDROID_RSS_EXPIRATION_GRACE_HOURS` y `ANDROID_RSS_MAX_EXPIRE_RATIO`.
- Incluye control de ritmo para validacion de detalles: `ANDROID_RSS_DETAILS_DELAY_MS`.

3. **Consumidor (Netlify Functions):**

- `check-android` y `check-pc` publican novedades desde sus colas.
- `clean-expired` elimina en Telegram los juegos expirados de Android y PC.
- Cada corrida limpia sus colas procesadas al finalizar.

Métricas mínimas en logs:

- `items_produced`
- `items_published`
- `items_expired`
- `publish_errors`
- `delete_errors`

---

## 🧪 Smoke Test Operativo

Prerequisitos:

- Secrets en GitHub: `NETLIFY_SITE_ID`, `NETLIFY_API_TOKEN`.
- Variables en Netlify para el consumidor: `TELEGRAM_TOKEN`, `CHANNEL_ID`.

Pasos:

1. Ejecutar manualmente estos workflows:

- `Producer Android Queue`
- `Producer Android RSS Queue`
- `Producer PC Queue`

2. Verificar colas en Blobs:
   - `npm run blobs:show`
3. Ejecutar funciones consumidoras en Netlify (scheduler o trigger manual).
4. Verificar en Telegram:
   - Publicaciones nuevas.

- Mensajes expirados eliminados del canal.

5. Revisar logs buscando líneas `[metrics]`.

---

## 🛠️ Runbook Rápido

### Reprocesar colas

Si quieres reprocesar publicaciones/expirados, vuelve a disparar el productor:

```bash
npm run smoke:producer
```

`smoke:producer` incluye Android + Android RSS (sin cleanup de Telegram) + PC.

Luego ejecuta el consumidor (vía Netlify).

### Vaciar colas manualmente

```bash
npm run blobs:clear-queues
```

### Ver estado de memoria y colas

```bash
npm run blobs:show
```

### Funciones Manuales en Netlify

Estas funciones se pueden disparar manualmente cuando quieras.

Adicionalmente, se programaron dos ejecuciones semanales automaticas:

- `manual-run-all`: lunes 01:00 UTC (primer dia de la semana a primera hora).
- `manual-status`: lunes 01:20 UTC (snapshot posterior al mantenimiento).

- `manual-status`: consulta resumen de memoria/colas/expirados/backlog antes de ejecutar limpieza.
- `manual-clean-memory`: limpia toda la memoria operativa (publicados, colas y expirados).
- `manual-clean-telegram`: borra mensajes rastreados del bot en Telegram y sincroniza memoria.
- `manual-run-all`: ejecuta esta secuencia completa:
  1. `manual-clean-memory`
  2. `manual-clean-telegram`
  3. `check-android`
  4. `check-pc`
  5. `clean-expired`
  6. `clean-duplicates`

Importante sobre `manual-status` y `manual-clean-telegram`:

- Ambos operan sobre mensajes rastreados en Blobs (`published_games_android`, `published_games_pc`, `android_expired`, `pc_expired`, `manual_telegram_cleanup_queue`).
- No consultan historial completo del canal: la API del bot de Telegram no expone lectura retroactiva total del canal.
- Si `manual-status` muestra `trackedTelegramMessages: 0`, puede seguir habiendo mensajes antiguos en el canal no registrados en memoria.
- `manual-clean-telegram` solo borra los `messageId` que existen en memoria rastreada/backlog.

Opcional: proteger con clave manual.

- Define `MANUAL_FUNCTION_KEY` en variables de entorno de Netlify.
- En la llamada HTTP agrega header `x-manual-key: <tu_clave>`.

Control de verbosidad en logs de funciones manuales:

- `MANUAL_LOG_LEVEL=compact`: imprime solo resumen operativo por funcion (menos ruido en logs).
- `MANUAL_LOG_LEVEL=debug`: imprime resumen + detalles completos por funcion.

Valor por defecto:

- Produccion (`NODE_ENV=production`): `compact`.
- Desarrollo/local: `debug`.

Ejemplo:

```bash
curl "https://<tu-sitio>.netlify.app/.netlify/functions/manual-status" \
  -H "x-manual-key: <tu_clave>"

curl "https://<tu-sitio>.netlify.app/.netlify/functions/manual-status?includeSamples=true&sampleSize=5" \
  -H "x-manual-key: <tu_clave>"

curl -X POST "https://<tu-sitio>.netlify.app/.netlify/functions/manual-run-all" \
  -H "x-manual-key: <tu_clave>" \
  -H "content-type: application/json" \
  -d '{"stopOnError":true}'
```

### Recuperar memoria corrupta

Normaliza memoria heredada/mixta a formato estable `{ id, messageId }`:

```bash
npm run blobs:normalize-memory
```

Opcional por plataforma:

```bash
node scripts/blobs-admin.js normalize-memory android
node scripts/blobs-admin.js normalize-memory pc
```

---

## 📅 Operacion Diaria (5 minutos)

1. Ver estado general:

```bash
npm run ops:status
```

2. Ejecutar productor (si quieres forzar actualizacion):

```bash
npm run smoke:producer
```

3. Verificar rapido en Blobs:

```bash
npm run blobs:show
```

4. Verificar consumidor en logs Netlify:

- lineas con `[metrics]`.
- `publish_errors` y `delete_errors`.

---

## 🧯 Troubleshooting Rapido

- Problema: cola no se vacia.
  - Accion: revisar errores de Telegram en logs; los items fallidos se re-encolan para reintento.
- Problema: aparece `Too Many Requests (429)` en `check-android`.
  - Accion: ajustar `ANDROID_MAX_PUBLISH_PER_RUN` (por ejemplo `15` o `18`) para limitar publicaciones por corrida y diferir el resto sin saturar Telegram.
  - Accion: ajustar `ANDROID_MAX_DELETE_PER_RUN` (por ejemplo `12` o `15`) para limitar borrados de expirados por corrida.
- Problema: memoria mixta o corrupta.
  - Accion: `npm run blobs:normalize-memory`.
- Problema: quieres resetear ejecucion en pruebas.
  - Accion: `npm run blobs:clear-queues` y volver a correr productor.
- Problema: `smoke:verify:strict` falla con 401 en Blobs.
  - Accion: revisar `NETLIFY_SITE_ID` y `NETLIFY_API_TOKEN`.
  - Accion: verificar que el token tenga permisos para Blobs y pertenezca al mismo site.
  - Accion: confirmar que `NETLIFY_API_TOKEN` sea un Personal Access Token de Netlify (no clave SSH ni llave PEM).

---

## 🧹 Limpieza Automática de Duplicados

Para evitar accidentes durante las pruebas, existe una función schedulada que **elimina mensajes duplicados automaticamente**.

### ¿Cómo funciona?

- Corre **1 vez al día a las 3:00 AM UTC** (configurable en `netlify.toml`).
- Agrupa mensajes por ID de juego
- Detecta duplicados (más de 1 copia del mismo juego)
- Compara por antigüedad (`publishedAt`)
- **Elimina los más antiguos, mantiene el más reciente**
- Registra detalles en los logs de Netlify

### Métricas

Cada ejecución registra:

```
[METRICS] Resumen de Limpieza:
   - Duplicados encontrados: X
   - Mensajes eliminados: Y
   - Errores de limpieza: Z
```

### Almacenamiento de timestamp

Cada mensaje publicado ahora almacena su timestamp:

```json
{
  "id": "game-id",
  "messageId": 123456789,
  "publishedAt": 1711868400000 // timestamp en ms (Date.now())
}
```

### Cambiar el schedule

Una vez por día a las 3 AM UTC es la configuración por defecto.  
Para cambiar, edita `netlify.toml`:

```toml
[functions.clean-duplicates]
  schedule = "0 3 * * *"  # Sintaxis cron
```

Algunos ejemplos:

- `"0 */6 * * *"` → cada 6 horas
- `"0 0 * * *"` → medianoche UTC
- `"0 10 * * 0"` → cada domingo a las 10 AM UTC

---
