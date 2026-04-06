# 📖 Referencia de API - Funciones Clave

> **Para IAs**: Aquí están las funciones principales con sus firmas exactas, parámetros, retornos y ejemplos de uso.

---

## 🎯 Servicios Android

### `services/android-deals.js`

#### `checkAndroidDeals(store, publishedGames, options?)`

**Propósito**: Procesa items de `android_queue` y los publica en Telegram

**Parámetros:**

```javascript
{
  store: BlobStore,           // Interfaz de Netlify Blobs
  publishedGames: Array,      // Lista actual de published_games_android
  options: {
    maxPublishPerRun: 18,     // Máx items a publicar
    maxDeletePerRun: 18,      // Máx items a expirar
    retryDelay: 4000,         // ms de espera entre reintentos
    rateLimit: 30000,         // ms entre Telegram requests
    // ... más opciones
  }
}
```

**Retorna:**

```javascript
{
  status: "success" | "error" | "partial",
  publishedCount: 15,
  expiredCount: 2,
  publishErrors: [],          // Array de {id, error}
  deleteErrors: [],           // Array de {id, error}
  processedQueue: Array,      // Items que se procesaron
  updatedPublished: Array,    // published_games actualizado
  executionTimeMs: 3240
}
```

**Ejemplo**:

```javascript
const { checkAndroidDeals } = require("./services/android-deals");
const result = await checkAndroidDeals(store, myPublishedGames, {
  maxPublishPerRun: 18,
  maxDeletePerRun: 18,
});
console.log(
  `Publicados: ${result.publishedCount}, Expirados: ${result.expiredCount}`,
);
if (result.status === "error") throw new Error(result.error);
```

**Llamado desde**: `netlify/functions/check-android.js`

---

#### `reconcileAndroidPublications(store, publishedGames, options?)`

**Propósito**: Verifica que mensajes publicados sigan existiendo en Telegram, republica fallidas

**Parámetros:**

```javascript
{
  store: BlobStore,
  publishedGames: Array,
  options: {
    maxCheckPerRun: 50,       // Máx items a verificar (crítico: fue 25, ahora 50)
    maxRepublishPerRun: 25,   // Máx items a republicar
    retryDelay: 1000,         // ms entre reintentos
    // ...
  }
}
```

**Retorna:**

```javascript
{
  status: "success" | "error",
  verifiedCount: 48,          // Items verificados ✅
  verificationErrors: 2,      // Items con error al verificar
  republishedCount: 5,        // Items republicados
  verifiedGames: Array,       // Actualizado con estado verified/reintento
  executionTimeMs: 2100
}
```

**Estados después**:

- `sent_verified` → Se confirma que Telegram tiene el mensaje
- `pending_send` → Se marcó para reintento (generalmente porque falta messageId)

**Ejemplo**:

```javascript
const result = await reconcileAndroidPublications(store, myPublished);
console.log(`Verificados: ${result.verifiedCount}`);
if (result.republishedCount > 0) {
  console.log(`Republicados: ${result.republishedCount}`);
}
```

**Llamado desde**: `netlify/functions/verify-android-publications.js`

---

#### `sendAndroidPublication(item, options?)`

**Propósito**: Envía UN item a Telegram, con reintentos exponenciales

**Parámetros:**

```javascript
{
  id: "com.example.game",
  title: "Game Name",
  icon: "https://...",        // Opcional, si hay icono
  url: "https://play.google.com/...",
  //... otros campos
  options: {
    retries: 3,
    retryDelayMs: 500,
    timeout: 4000,
    // ...
  }
}
```

**Retorna:**

```javascript
{
  success: true | false,
  messageId: 123456789,       // ID del mensaje en Telegram (si éxito)
  responseTime: 1200,         // ms de latencia
  error: null | "Error message"
}
```

**Ejemplo**:

```javascript
const gameItem = {
  id: "com.game.example",
  title: "Game",
  url: "https://play.google.com/store/apps/details?id=com.game.example",
};

const result = await sendAndroidPublication(gameItem);
if (result.success) {
  console.log(`Enviado con messageId: ${result.messageId}`);
} else {
  console.error(`Fallo: ${result.error}`);
}
```

---

#### `probeAndroidMessageExists(trackedMessage, options?)`

**Propósito**: Verifica que un mensaje aún existe en Telegram (sin modificarlo)

**Parámetros:**

```javascript
{
  id: "com.game1",
  messageId: 123456789,
  chatId: "@channel_id",
  messageText: "📱 **Original text**",
  options: {
    timeout: 2000,
    // ...
  }
}
```

**Retorna:**

```javascript
{
  exists: true | false,
  responseTime: 450,
  error: null | "Not found" | "API error"
}
```

**Cómo funciona**: Intenta editMessage con el MISMO texto (no cambia nada) → Si Telegram retorna OK, el mensaje existe → Si retorna 400, el mensaje no existe.

**Ejemplo**:

```javascript
const tracked = {
  messageId: 123456,
  chatId: "@channel_id",
  messageText: "Original",
};

const probe = await probeAndroidMessageExists(tracked);
if (!probe.exists) {
  console.log("Mensaje ya no existe en Telegram");
}
```

---

### `services/android-rss.js`

#### `buildAndroidRssQueue(store, options?)`

**Propósito**: Lee Reddit RSS, valida que sean juegos gratis, actualiza `android_queue`

**Parámetros:**

```javascript
{
  store: BlobStore,
  options: {
    feedUrl: "https://reddit.com/r/googleplaydeals/new.rss",
    country: "us",
    lang: "es",
    minFreePriceThreshold: 0.01,
    maxItemsPerProducer: null,  // Sin límite, pero recomendado para testing: 50
    // ...
  }
}
```

**Retorna:**

```javascript
{
  status: "success" | "error",
  itemsFound: 12,             // Items en RSS
  itemsValidated: 10,         // Pasaron validación (es juego + gratis + originalPrice>0)
  itemsAdded: 8,              // Nuevos (no duplicados)
  duplicatesSkipped: 2,       // Ya estaban en queue
  queueSize: 35,              // Tamaño total después
  errors: []                  // Errores de parsing
}
```

**Validaciones aplicadas**:

1. ✅ `isGameCategory()` - Categoría es GAME\_\* (no APP)
2. ✅ `isCurrentlyFree()` - Precio = 0
3. ✅ `originalPrice > 0` - Tenía precio normalmente (para mostrar descuento)
4. ✅ `!isDuplicate()` - No está en queue ni publicado
5. ✅ `!isBlacklisted()` - No está en lista negra manual

**Ejemplo**:

```javascript
const result = await buildAndroidRssQueue(store);
console.log(
  `Items validados: ${result.itemsValidated}, nuevos: ${result.itemsAdded}`,
);
return result;
```

**Llamado desde**: GitHub Actions `scripts/github-android-rss.js`

---

#### `inferExpiredAndroidFromFeed(publishedGames, feedActiveIds, options?)`

**Propósito**: Compara juegos publicados con IDs activos en RSS, marca expirados

**Parámetros:**

```javascript
{
  publishedGames: Array,      // Lista de juegos ya publicados
  feedActiveIds: Set,         // IDs que vimos en el RSS hoy
  options: {
    minActiveIds: 10,         // Protección: no expira si RSS tiene < 10 IDs
    graceHours: 24,           // Espera 24h antes de marcar expirado
    maxExpireRatio: 0.35,     // No expira > 35% en una corrida
    // ...
  }
}
```

**Retorna:**

```javascript
{
  expiredIds: ["com.game1", "com.game2"],
  skippedDueToGrace: 3,       // Aún en grace period
  skippedDueToRatio: 1,       // Alcanzó 35% límite
  skippedDueToMinActive: 0,   // RSS tiene pocos items
  expiredCount: 2             // Total a expirar
}
```

**Protecciones**:

- Si RSS tiene < 10 IDs → no expira nada (puede que RSS esté down)
- Si > 35% items a expirar → limita a 35% (protección contra purgas)
- Si < 24h desde publicación → no expira (cambios transitorios)

**Ejemplo**:

```javascript
const feedIds = new Set(rssItems.map((i) => i.id));
const expired = inferExpiredAndroidFromFeed(published, feedIds, {
  minActiveIds: 20, // Más estricto
  maxExpireRatio: 0.2, // Solo 20% máx
});
console.log(`A expirar: ${expired.expiredCount}`);
```

---

### `services/android-expiration.js`

#### `checkAndroidExpirationDirectly(store, options?)`

**Propósito**: Consulta Google Play directamente para verificar si siguen gratis (alternativa a RSS)

**Parámetros:**

```javascript
{
  store: BlobStore,
  options: {
    maxChecksPerRun: 30,
    timeout: 5000,
    retries: 3
  }
}
```

**Retorna:**

```javascript
{
  checkedCount: 25,
  stillFreeCount: 24,
  expiredCount: 1,           // Ya no son gratis
  errorCount: 0,
  expiredIds: ["com.expired.game"]
}
```

---

## 🔐 Utilidades

### `utils/blob-lock.js`

#### `withBlobLock(store, options, handler)`

**Propósito**: Adquiere un lock distribuido, ejecuta handler, libera el lock

**CRÍTICO**: Esta es la función más importante para prevenir race conditions

**Parámetros:**

```javascript
{
  store: BlobStore,
  options: {
    lockKey: "android_state_lock",    // Identificador único del lock
    owner: "consumer-android",        // Quién lo está pidiendo (para debugging)
    ttlMs: 5000,                      // ⚠️ CRÍTICO: 5 segundos (fue 90s)
    retries: 5,                       // Intentos de adquisición
    retryDelayMs: 500,                // ms de espera entre intentos
    // ...
  },
  handler: async () => {
    // Tu código aquí - SOLO UNA corrida ejecuta esto a la vez
    return result;
  }
}
```

**Retorna**: Lo que devuelva `handler`

**Garantías**:

- ✅ Atomicity: Solo una corrida ejecuta handler a la vez
- ✅ No deadlock: TTL de 5s previene locks atrapados
- ✅ Rápido: Máximo 2.5s esperando (5 retries × 500ms)

**Ejemplo**:

```javascript
const result = await withBlobLock(store, {
  lockKey: "android_state_lock",
  owner: "check-android-consumer",
  ttlMs: 5000,
  retries: 5,
  retryDelayMs: 500
}, async () => {
  // Leer + modificar + guardar (todo atómico)
  const queue = await store.getJSON('android_queue');
  queue.push({id: "new.game", ...});
  await store.setJSON('android_queue', queue);
  return {saved: true};
});
```

**⚠️ CAMBIO CRÍTICO (v1.1.0)**:

- Antes: ttlMs=90000, retries=20, retryDelayMs=1000
- Ahora: ttlMs=5000, retries=5, retryDelayMs=500
- Razón: Netlify timeout es 10s, el anterior era muy conservador

---

### `utils/memory.js`

#### `getPublishedGamesList(store, platform, options?)`

**Propósito**: Lee lista de juegos publicados desde Blobs

**Parámetros:**

```javascript
{
  store: BlobStore,
  platform: "android" | "pc",
  options: {
    defaultIfEmpty: [],
    // ...
  }
}
```

**Retorna**:

```javascript
[
  {
    id: "com.game1",
    messageId: 123456,
    publishedAt: 1710000000000,
    status: "sent_verified",
    title: "Game",
    titleMatch: "game",
    chatId: "@channel",
  },
  // ... más items
];
```

**Ejemplo**:

```javascript
const published = await getPublishedGamesList(store, "android");
console.log(`Total publicados: ${published.length}`);
```

---

#### `savePublishedGamesList(store, games, platform, options?)`

**Propósito**: Guarda lista en Blobs, con limit FIFO a 300 items

**Parámetros:**

```javascript
{
  store: BlobStore,
  games: Array,           // Nueva lista (se trunca si > 300)
  platform: "android" | "pc",
  options: {
    maxItems: 300,        // Para Android
    // PC usa 200
  }
}
```

**Comportamiento**:

- Si `games.length > maxItems` → Elimina los más antiguos (FIFO)
- Si `games.length <= maxItems` → Guarda tal cual
- Valida que cada item tenga `status` válido

**Ejemplo**:

```javascript
const updated = published.filter((g) => g.id !== deletedId);
await savePublishedGamesList(store, updated, "android");
```

---

### `utils/telegram.js`

#### `requestWithRetry(url, payload, options?)`

**Propósito**: Realiza request a Telegram Bot API con reintentos exponenciales

**Parámetros:**

```javascript
{
  url: "https://api.telegram.org/bot<TOKEN>/sendMessage",
  payload: {
    chat_id: "@channel_id",
    text: "Message",
    parse_mode: "Markdown",
    // ...
  },
  options: {
    retries: 3,                     // Intentos totales
    initialDelayMs: 500,            // Primer reintento después de 500ms
    maxDelayMs: 4000,               // Máx espera entre reintentos
    timeout: 5000,                  // ms hasta abortar request
    shouldRetry: (error, attempt) => {...}  // Lógica custom
  }
}
```

**Retorna**:

```javascript
{
  ok: true | false,
  statusCode: 200,
  data: {
    ok: true,
    result: {
      message_id: 123456,
      chat: {...},
      // ... respuesta de Telegram
    }
  },
  error: null | "Error message",
  retriesUsed: 1
}
```

**Reintentos automáticos en**:

- 5xx (server error)
- 429 (rate limit) - espera extra
- Errores de red

**NO reintenta en**:

- 401 (invalid token)
- 400 (parámetro inválido)
- 403 (permiso denegado)

**Ejemplo**:

```javascript
const response = await requestWithRetry(
  "https://api.telegram.org/bot<TOKEN>/sendMessage",
  {
    chat_id: "@channel",
    text: "New game available!",
    parse_mode: "Markdown",
  },
  { retries: 3 },
);

if (response.ok) {
  console.log(`Enviado: ${response.data.result.message_id}`);
} else {
  console.error(`Fallo: ${response.error}`);
}
```

---

#### `editMessageText(chatId, messageId, text, options?)`

**Propósito**: Edita un mensaje en Telegram (usado para verificar existencia)

**Parámetros**:

```javascript
{
  chatId: -1001234567,              // ID del chat/canal
  messageId: 123456,                // ID del mensaje a editar
  text: "New text",
  options: {
    parse_mode: "Markdown",
    // ...
  }
}
```

**Retorna**: Similar a `requestWithRetry()`

**Uso especial para verificación**:

```javascript
// Para verificar sin modificar, enviamos el MISMO texto
const probe = await editMessageText(
  chatId,
  messageId,
  originalText, // Mismo texto = no hay cambio
  { timeout: 1000 },
);
// Si ok: mensaje existe ✅
// Si error 400: mensaje no existe ❌
```

---

#### `deleteMessage(chatId, messageId, options?)`

**Propósito**: Borra un mensaje de Telegram

**Parámetros**:

```javascript
{
  chatId: "@channel",
  messageId: 123456,
  options: {retries: 3}
}
```

**Retorna**: `{ok: true|false, error: null|string}`

**Ejemplo**:

```javascript
const result = await deleteMessage("@my_channel", 123456);
if (result.ok) {
  console.log("Mensaje borrado");
} else {
  console.error(`Fallo: ${result.error}`);
}
```

---

## 🔄 Flujo de Uso Típico

### Publicar un juego nuevo (check-android)

```javascript
const { checkAndroidDeals } = require("./services/android-deals");
const {
  getPublishedGamesList,
  savePublishedGamesList,
} = require("./utils/memory");
const store = createBlobStore();

// Lee estado actual
const published = await getPublishedGamesList(store, "android");

// Procesa y publica
const result = await checkAndroidDeals(store, published);

// Guarda estado actualizado
await savePublishedGamesList(store, result.updatedPublished, "android");

console.log(`[metrics] published_count=${result.publishedCount}`);
```

### Verificar publicados (verify-android)

```javascript
const { reconcileAndroidPublications } = require("./services/android-deals");
const published = await getPublishedGamesList(store, "android");

const verifyResult = await reconcileAndroidPublications(store, published, {
  maxCheckPerRun: 50, // Crítico: fue 25
});

await savePublishedGamesList(store, verifyResult.verifiedGames, "android");
console.log(`[metrics] verified_count=${verifyResult.verifiedCount}`);
```

### Producir de RSS (script en GitHub)

```javascript
const { buildAndroidRssQueue } = require("./services/android-rss");
const store = createBlobStore();

const result = await buildAndroidRssQueue(store);
console.log(`Queue: ${result.itemsAdded} nuevos en queue`);
```

---

> **Última actualización**: Apr 6, 2026  
> Úsate como referencia rápida antes de generar código.
