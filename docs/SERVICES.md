# Servicios

## Descripción General

Los "servicios" son módulos reutilizables que contienen la lógica de negocio. Se dividen en:

1. **Productores**: Extraen datos de fuentes externas
2. **Consumidor**: Distribuye datos a usuarios
3. **Utilidades**: Funciones auxiliares

---

## Productores

### `services/android-deals.js`

**Propósito**: Scraping de juegos gratis en Google Play Store

**Función Principal**:

```javascript
async function checkAndroidDeals(store, options = {})
```

**Flujo**:

1. Lee lista de juegos publicados en memoria
2. Scrapeea Google Play Store usando `google-play-scraper`
3. Filtra solo juegos gratis
4. Deduplica contra memoria
5. Crea cola de nuevos juegos
6. Ejecuta consumidor
7. Retorna métricas

**Opciones**:

```javascript
{
  maxItems: number,           // Límite de juegos a procesar (default: 50)
  skipCleanup: boolean,       // Omitir consumidor (default: false)
  detailsFetcher: function,   // Custom fetcher (testing)
}
```

**Retorna**:

```javascript
{
  new: number,           // Juegos nuevos agregados
  queue: number,         // Total en queue
  published: number,     // Total publicados
  expirationStats: {...}
}
```

---

### `services/android-rss.js`

**Propósito**: Scraping basado en feed RSS de Reddit

**Funciones Principales**:

#### `buildAndroidRssQueue(store, options = {})`

Lee feed RSS, valida detalles en Play Store, y construye queue.

**Flujo**:

1. Descarga feed RSS (default: `/r/googleplaydeals`)
2. Parseea items del feed
3. Extrae package IDs
4. Valida cada uno en Google Play Store
5. Filtra juegos gratis
6. Deduplica contra existentes
7. Retorna resultado con estadísticas

**Opciones**:

```javascript
{
  feedUrl: string,          // URL del RSS (default: Reddit)
  maxItems: number,         // Límite de items (default: 50)
  feed: object,             // Feed pre-parseado (testing)
  parser: object,           // Custom parser (testing)
  detailsFetcher: function, // Custom fetcher (testing)
  detailsDelayMs: number,   // Delay entre requests (default: 250ms)
}
```

**Retorna**:

```javascript
{
  feedItems: number,
  feedActiveIds: number,
  feedActiveIdList: string[],
  queueBefore: number,
  queueAfter: number,
  added: number,
  detailsRequests: number,
  detailsFailures: number,
}
```

#### `inferExpiredAndroidFromFeed(publishedGames, feedActiveIds, options = {})`

Deduce qué juegos han expirado (ya no están en el feed).

**Lógica**:

- Compara lista de juegos publicados con activos en feed
- Si un juego no está en el feed desde hace X horas → expirado
- Aplica failsafe: no expira más del Y% de juegos
- Valida cantidad mínima de juegos activos en feed

**Opciones**:

```javascript
{
  minActiveIds: number,      // Mínimo de IDs en feed (failsafe)
  graceHours: number,        // Horas antes de expirar
  maxExpireRatio: number,    // Ratio máximo a expirar
  withMeta: boolean,         // Retornar metadata
}
```

---

### `services/pc-games.js`

**Propósito**: Scraping de juegos gratis en Steam (PC)

**Función Principal**:

```javascript
async function checkPcGames(store, options = {})
```

**Similitud con `android-deals.js`** pero adaptado para Steam.

---

## Consumidor

### `services/consumer-android.js` (integrado en scripts)

**Propósito**: Publica juegos de cola en Telegram y actualiza memoria

**Flujo Interno**:

1. Lee cola de `android_queue`
2. Para cada juego:
   - Prepara mensaje Telegram
   - Envía a canal
   - Registra messageId
   - Agrega a memoria publicada
3. Limpia cola procesada
4. Retorna métricas

**Métricas Retornadas**:

```javascript
{
  itemsPublished: number,
  publishErrors: number,
  deleteErrors: number,
}
```

---

## Utilidades

### `utils/memory.js`

**Propósito**: Interfaz de lectura/escritura a Netlify Blobs para memoria persistente

**Funciones**:

#### `getPublishedGamesList(store, platform)`

Obtiene lista de juegos ya publicados

```javascript
const published = await getPublishedGamesList(store, "android");
// Retorna array de { id, messageId, publishedAt }
```

#### `savePublishedGamesList(store, platform, games)`

Guarda lista actualizada de juegos publicados

```javascript
await savePublishedGamesList(store, "android", updatedGames);
```

---

### `utils/netlify-blobs.js`

**Propósito**: Validación y diagnóstico de credenciales Netlify

**Funciones**:

#### `getBlobCredentialReport(env = process.env)`

Genera reporte de estado de credenciales

```javascript
const report = getBlobCredentialReport();
console.log(report);
// {
//   NETLIFY_SITE_ID: "✅ Presente",
//   NETLIFY_API_TOKEN: "✅ Presente (formato válido)"
// }
```

---

### `utils/telegram.js`

**Propósito**: Wrapper resiliente para llamadas POST a Telegram Bot API

**Funciones**:

#### `requestWithRetry(url, payload, options = {})`

Ejecuta requests con reintento automatico ante `429` y `5xx`, respetando `retry_after` desde header o body cuando existe.

```javascript
const response = await requestWithRetry(`${telegramBase}/sendMessage`, payload);
```

---

### `utils/status-alert.js`

**Propósito**: Flujo común para alertas de status con envío + borrado inmediato.

#### `sendStatusAlertAndDelete(text, { chatId, telegramToken })`

1. Envía `sendMessage`.
2. Extrae `message_id`.
3. Ejecuta `deleteMessage` sobre el mismo chat.
4. Retorna resultado estructurado (`sent`, `deleted`, `deleteReason`, etc).

Se usa en:

- `android-status-report`
- `pc-status-report`
- `manual-android-status-report`
- `manual-pc-status-report`

---

## Estructura de Datos

### Queue Entry (android_queue)

```javascript
{
  id: "com.example.app",           // Package ID
  title: "Game Name",              // Nombre del juego
  icon: "https://...",             // URL del ícono
  url: "https://play.google.com/store/apps/details?id=...",
  score: 4.5,                      // Rating en Play Store
  source: "reddit-rss",            // Fuente del descubrimiento
  discoveredAt: 1704067200000,     // Timestamp
}
```

### Published Memory Entry

```javascript
{
  id: "com.example.app",           // Package ID
  messageId: 12345,                // Message ID en Telegram
  publishedAt: 1704067200000,      // Timestamp de publicación
}
```

---

## Manejo de Errores

Cada servicio:

1. **Registra errores detallados** con contexto
2. **No falla completamente** - continúa con siguientes items
3. **Retorna métricas de error** en respuesta
4. **Usa try-catch** para request externos
5. **Valida entrada/salida** antes de procesar

Ejemplo:

```javascript
try {
  const details = await detailsFetcher(appId);
} catch (err) {
  detailsFailures++;
  console.warn(`[service] Error fetching ${appId}: ${err.message}`);
  // continúa con siguiente item
}
```

---

## Testing

Todos los servicios tienen funciones puras sin side effects:

- Aceptan `store` y `options` como parámetros
- Permiten inyectar mocks en `options`
- Retornan resultados determinísticos

Ver `test/` para ejemplos de testing.

---

## Notas de Optimización Recientes

- `check-pc` ahora opera bajo `pc_state_lock` para evitar carreras de estado.
- `clean-expired` coordina Android+PC con locks de ambas plataformas.
- `getMaintenanceSnapshot` (manual-maintenance) paraleliza lecturas de Blobs con `Promise.all` para reducir latencia.
