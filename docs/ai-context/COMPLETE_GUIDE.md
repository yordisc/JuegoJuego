# 🤖 Guía Completa para IAs - Contexto Técnico del Proyecto

>  **Propósito**: Este documento contiene TODO lo que una IA necesita saber para trabajar efectivamente con este proyecto. Úsalo como contexto al trabajar con Claude, GPT, o cualquier otra IA.

---

## 📊 Visión General del Sistema

**Tipo**: Agregador de juegos gratis + Bot de Telegram  
**Arquitectura**: Productor-Consumidor Serverless  
**Stack**: Node.js + Netlify Functions + GitHub Actions  
**Costo**: $0/mes (free tier)  

### Objetivo de Negocio
Monitorear constantemente:
- Android: Google Play (juegos 100% gratis) + Reddit RSS
- PC: GamerPower API (juegos gratis)

Publicar en Telegram cuando se encuentren ofertas nuevas.
Expirar / eliminar cuando dejen de estar gratis.

---

## 🏗️ Arquitectura en Profundidad

### Componentes Principales

```
┌─────────────────────────────────────────────────────────────┐
│ PRODUCTORES (GitHub Actions - No tiene timeout limite)      │
├─────────────────────────────────────────────────────────────┤
│ • scripts/github-android.js                                 │
│   └─ Lee Google Play Scraper → android_queue               │
│ • scripts/github-android-rss.js                             │
│   └─ Lee Reddit RSS → android_queue + deduplica           │
│ • scripts/github-pc.js                                      │
│   └─ Lee GamerPower API → pc_queue                         │
│ • scripts/github-android-expired.js                         │
│   └─ Verifica si siguen gratis → android_expired          │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    Netlify Blobs (Almacenamiento)
                    - android_queue
                    - pc_queue
                    - android_expired
                    - published_games_android
                    - published_games_pc
                    - telegram_sent_messages
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ CONSUMIDORES (Netlify Functions - Máx 10s timeout)          │
├─────────────────────────────────────────────────────────────┤
│ • netlify/functions/check-android.js (cada 20 min)          │
│   └─ Publica max 18 items de queue → Telegram             │
│ • netlify/functions/check-pc.js (cada 12h)                 │
│   └─ Publica max 25 items de queue → Telegram             │
│ • netlify/functions/verify-[platform]-publications.js      │
│   └─ Verifica que existan en Telegram (diario)            │
│ • netlify/functions/clean-expired.js (cada 30 min)        │
│   └─ Borra expirados de Telegram (max 18/run)           │
│ • netlify/functions/clean-duplicates.js (cada 12h)         │
│   └─ Elimina duplicados (por ID y nombre)                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    Telegram Channel
```

### Flujo de Datos (Ejemplo: Juego Android)

```
1. GENERACIÓN (Productor en GitHub)
   ├─ scripts/github-android-rss.js
   ├─ Lee: r/googleplaydeals/new.rss
   ├─ Extrae: IDs de Google Play + valida categoría (GAME_*) + precio=0 + originalPrice>0
   ├─ Deduplica: vs published_games_android + android_queue
   └─ Escribe: android_queue con {id, title, icon, url, score, source, discoveredAt}

2. ENCOLADO (Productor escribe en memoria)
   ├─ Netlify Blobs: android_queue (array)
   ├─ Límite: No hay límite en queue, pero consumidor procesa max 18/run
   └─ Retention: Indefinido (hasta que se publique o se elimine manualmente)

3. CONSUMO (Consumidor en Netlify)
   ├─ netlify/functions/check-android.js (cada 20 min)
   ├─ Lee: android_queue + published_games_android + telegram_sent_messages
   ├─ Adquiere: Distributed lock (TTL 5s, retries 5, delays 500ms)
   ├─ Procesa: Max 18 items (configurable: ANDROID_MAX_PUBLISH_PER_RUN)
   ├─ Deduplica: vs publishedIds (items ya publicados)
   ├─ Envía: A Telegram (sendMessage o sendPhoto si hay icon)
   ├─ Rastrea: En telegram_sent_messages {id, messageId, platform, chatId, ...}
   ├─ Actualiza: published_games_android con status=sent_unverified
   └─ Limpia: android_queue (removiendo items procesados)

4. VERIFICACIÓN (Verificador en Netlify)
   ├─ netlify/functions/verify-android-publications.js (diario @4am)
   ├─ Lee: published_games_android + telegram_sent_messages
   ├─ Verifica: Max 50 items (configurable: ANDROID_MAX_EXISTENCE_CHECK_PER_RUN)
   ├─ Consulta: Telegram API para confirmar que mensaje existe (editMessage mock)
   ├─ Si existe: Marca status=sent_verified ✅
   ├─ Si no existe: Marca messageId=null, status=pending_send → se reenvía
   └─ Si error: Intenta republish (max 25 por run)

5. EXPIRACIÓN (Expirador en Netlify)
   ├─ nethify/functions/clean-expired.js (cada 30 min)
   ├─ Lee: android_expired
   ├─ Borra: De Telegram usando deleteMessage API (max 18/run)
   ├─ Actualiza: published_games_android (removiendo expirados)
   └─ Limpia: android_expired (removiendo procesados)

6. LIMPIEZA DE DUPLICADOS (Cada 12h)
   ├─ netlify/functions/clean-duplicates.js
   ├─ Detecta: Por ID + por nombre normalizado (con protección de genéricos)
   ├─ Elimina: El duplicado más antiguo (publishedAt)
   └─ Mantiene: El más reciente

7. RASTREO DE MENSAJES Enviados
   ├─ Almacenado en: telegram_sent_messages (array de objetos)
   ├─ Contenido: {id, messageId, platform, chatId, messageKind, messageText, publishedAt, title, titleMatch}
   ├─ Propósito: Verificar existencia, recuperar ante fallos, sincronizar con Telegram
   └─ Cleanup: clean-orphan-telegram elimina los que ya no están en published_games
```

---

## 📚 Referencias de Servicios

### `services/android-deals.js`
**Funciones clave**:
- `checkAndroidDeals(store, publishedGames, options)` - Procesa cola y expirados
- `reconcileAndroidPublications(store, publishedGames, options)` - Verifica y republica
- `buildAndroidMessage(item)` - Formatea mensaje Markdown para Telegram
- `sendAndroidPublication(item)` - Envía a Telegram con reintentos
- `probeAndroidMessageExists(trackedEntry)` - Verifica existencia en Telegram

**Estados de publicación**:
```javascript
PUBLICATION_STATUS = {
  PENDING_SEND: "pending_send",        // Aún no enviado
  SENT_UNVERIFIED: "sent_unverified",  // Enviado, sin confirmar en Telegram
  SENT_VERIFIED: "sent_verified"       // Confirmado en Telegram
}
```

### `services/android-rss.js`
**Funciones clave**:
- `buildAndroidRssQueue(store)` - Produce cola desde Reddit RSS
- `inferExpiredAndroidFromFeed(publishedGames, feedActiveIds)` - Detecta expirados

**Protecciones**:
- `minActiveIds >= 10` - No expira si RSS tiene pocos items (protección contra fallos)
- `graceHours = 24` - Espera 24h antes de marcar expirado (cambios transitorios)
- `maxExpireRatio = 0.35` - No expira > 35% en una corrida (previene purgas masivas)

### `services/android-expiration.js`
**Verifica directamente en Google Play si siguen gratis**
- Compara con published_games_android
- Si no está gratis → agrega a android_expired
- Alternativa a RSS para detección de expiración

### `utils/memory.js`
**Abstracción de Netlify Blobs**:
- `getPublishedGamesList(store, platform)` - Lee desde Blobs
- `savePublishedGamesList(store, games, platform)` - Guarda en Blobs con normalización
- Límite: 300 items max para Android (FIFO)

### `utils/telegram.js`
**Wrapper de Telegram Bot API**:
- `requestWithRetry(url, payload, options)` - Reintentos exponenciales
- Detecta 429 (rate limit) y detiene
- Reintentos en 5xx y fallos de red

### `utils/blob-lock.js`
**Sistema de locks distribuido**:
- `withBlobLock(store, options, handler)` - Adquiere lock, ejecuta handler, libera
- TTL: 5 segundos (respeta timeout de Netlify 10s)
- Retries: 5 intentos con 500ms entre intentos
- Owner: identifica quién tiene el lock

### `services/manual-maintenance.js`
**Funciones administrativas**:
- `readTrackedMessages(store)` - Lee historial de mensajes enviados
- `trackTelegramMessage(store, entry)` - Registra nuevo envío
- `deleteTrackedTelegramMessages(store)` - Borra mensajes y sincroniza
- `clearAllMemory(store)` - Limpia todo (cuidado!)

---

## 🔑 Variables de Entorno Críticas

### Netlify Blobs (almacenamiento)
```bash
NETLIFY_SITE_ID=<your-site-id>         # ID único del site Netlify
NETLIFY_API_TOKEN=<your-api-token>     # Token de acceso (PAT de Netlify)
```

### Telegram
```bash
TELEGRAM_TOKEN=<your-bot-token>        # Token del bot (@BotFather)
CHANNEL_ID=@your_channel_id            # Canal de destino (@nombre)
```

### Tuning de Rendimiento
```bash
ANDROID_MAX_PUBLISH_PER_RUN=18              # Max items a publicar por run
ANDROID_MAX_DELETE_PER_RUN=18               # Max items a expirar por run
ANDROID_MAX_REPUBLISH_PER_RUN=25            # Max a republicar si falan
ANDROID_MAX_EXISTENCE_CHECK_PER_RUN=50      # Max a verificar por run (diario)
ANDROID_STATE_LOCK_TTL_MS=5000              # TTL del lock en ms
ANDROID_STATE_LOCK_RETRIES=5                # Reintentos para adquirir lock
ANDROID_STATE_LOCK_RETRY_DELAY_MS=500       # Espera entre reintentos
```

### RSS Específicas (Android)
```bash
ANDROID_RSS_MIN_ACTIVE_IDS=10               # Min IDs en feed para permitir expiración
ANDROID_RSS_EXPIRATION_GRACE_HOURS=24       # Espera antes de marcar expirado
ANDROID_RSS_MAX_EXPIRE_RATIO=0.35           # Max % de expiración por corrida
ANDROID_RSS_COUNTRY=us                      # País para Google Play
ANDROID_RSS_LANG=es                         # Idioma para Google Play
```

---

## 🧪 Estructura de Datos

### `published_games_android` (Netlify Blobs)
```json
[
  {
    "id": "com.example.game",           // ID único del juego
    "messageId": 123456789,              // ID del mensaje en Telegram (null si no enviado)
    "publishedAt": 1710000000000,        // Timestamp de publicación
    "status": "sent_verified",           // pending_send | sent_unverified | sent_verified
    "title": "Game Name",                // Título del juego
    "titleMatch": "game name",           // Título normalizado (para búsqueda)
    "chatId": "@channel_id"              // Canal donde se publicó (para recuperación)
  }
]
// Límite: 300 items (FIFO)
// Almacenador: Netlify Blobs
```

### `android_queue` (Netlify Blobs)
```json
[
  {
    "id": "com.new.game",
    "title": "New Game",
    "icon": "https://...",               // URL de icono (opcional)
    "url": "https://play.google.com/...", // Link a Play Store
    "score": 4.5,                        // Rating
    "source": "reddit-rss",               // Fuente (reddit-rss, google-play, etc.)
    "discoveredAt": 1710000000000        // Cuándo se descubrió
  }
]
// Límite: Ninguno en queue, pero check-android procesa max 18/run
// Almacenamiento: Netlify Blobs
```

### `telegram_sent_messages` (Netlify Blobs)
```json
[
  {
    "id": "com.game1",
    "messageId": 12345,
    "platform": "android",
    "chatId": "@channel_id",
    "messageKind": "text" | "photo",
    "messageText": "📱 **NEW ANDROID DEAL**...",
    "publishedAt": 1710000000000,
    "title": "Game Title",
    "titleMatch": "game title"
  }
]
// Propósito: Rastrear y recuperar ante fallos
// Limpieza: clean-orphan-telegram
```

---

## 🔄 Flujos Críticos

### 1. Duplicación y Deduplicación

**Puntos donde ocurre deduplicación**:

1. **En RSS producer** (`github-android-rss.js`):
   ```javascript
   // Elimina duplicados en la ACTUAL ejecución
   const queue = dedupeById(readJsonArray(store, KEY_ANDROID_QUEUE));
   ```

2. **En consumidor** (`check-android.js`):
   ```javascript
   if (publishedIds.has(id)) continue; // Ya publicado anteriormente
   ```

3. **En limpieza** (`clean-duplicates.js`):
   ```javascript
   // Detecta: por ID EXACTO + por nombre normalizado
   // Elimina: el más antiguo, mantiene el más reciente
   ```

**Protección de deduplicación por nombre**:
- Si `com.game` se publica como "Game Title"
- Y después llega como "GAME TITLE" (mayúsculas)
- Se normaliza: `normalizeTitleForMatch()` → "game title"
- Se detecta como duplicado ✅

**Genéricos evitados**: `app, game, free, deal` (no deduplicar solo por estos)

---

### 2. Reintentos y Recuperación

**Escenario: Falla envío a Telegram**
```
1. check-android intenta enviar 18 items
2. Item 5 falla (HTTP 500 de Telegram)
3. Se agrega a retryQueue (no a processed)
4. Se guarda en android_queue nuevamente
5. Siguiente check-android (20 min) lo reintenta
6. Máximo: indefinido hasta éxito (o error permanente como 401)
```

**Escenario: Falla verificación**
```
1. verify-android intenta verificar 50 items
2. Item 25 no existe en Telegram (falla)
3. Se marca: messageId=null, status=pending_send
4. Siguiente check-android: se reenvía
5. verify-android: máximo 25 verificaciones por day
   → Con 300 items: cobertura completa cada 6 días
```

---

## 🔒 Seguridad y Concurrencia

### Locks Distribuidos
**Problema**: GitHub Actions puede llamar `github-android-rss.js` MIENTRAS Netlify Functions llama `check-android.js`

**Solución**: Lock distribuido en Netlify Blobs
```javascript
withBlobLock(store, {
  lockKey: "android_state_lock",      // Llave compartida
  owner: "consumer-android",           // Identidad del dueño
  ttlMs: 5000,                         // Auto-libera en 5 segundos
  retries: 5,                          // 5 intentos
  retryDelayMs: 500                    // 500ms entre intentos
}, async () => {
  // Solo una corrida accede aquí a la vez
})
```

**Garantías**:
- Máximo 2.5 segundos esperando (5 retries × 500ms)
- Total: < 10 segundos (respeta timeout de Netlify)
- TTL asegura que nunca un lock queda atrapado

---

## 📉 Métricas Clave

Cada ejecución registra:
```json
{
  "source": "consumer-android",
  "items_published": 15,           // éxitos
  "items_expired": 2,              // borrados
  "publish_errors": 1,             // fallos en publish
  "delete_errors": 0,              // fallos en delete
  "verified_count": 48,            // verificados (diario)
  "republished_count": 2,          // republicados
  "existence_errors": 0            // errores en verificación
}
```

**Salud del sistema**:
- `publish_errors` < `items_published / 10` → ✅ Saludable
- `publish_errors` > `items_published` → ❌ Crítico
- `verified_count` ~50 → ✅ Cubriendo bien
- `verified_count` = 0 → ⚠️ Sin items para verificar

---

## 🚀 Cómo Agregar una Feature

**Ejemplo: Agregar fuente nueva "Steam Free"**

1. **Crear productor** (`scripts/github-steam.js`):
   ```javascript
   const { withBlobLock } = require('../utils/blob-lock');
   
   async function produceSteamDeals() {
     const store = getStoreFromEnv();
     return withBlobLock(store, {...}, async () => {
       const items = await scrapeSteamFree(); // Tu scraper
       const deduped = dedupeById(items);
       const queue = await store.get('steam_queue') || [];
       queue.push(...deduped);
       await store.setJSON('steam_queue', queue);
     });
   }
   ```

2. **Crear consumidor** (`netlify/functions/check-steam.js`):
   ```javascript
   const { checkSteamDeals } = require('../../services/steam-deals.js');
   
   exports.handler = async () => {
     const store = createBlobStoreFromEnv();
     const publishedGames = await getPublishedGamesList(store, 'steam');
     await checkSteamDeals(store, publishedGames);
     await savePublishedGamesList(store, publishedGames, 'steam');
   };
   ```

3. **Crear servicio** (`services/steam-deals.js`):
   ***Sigue patrón de `android-deals.js` pero para Steam***

4. **Crear tests** (`test/steam-deals.test.js`):
   ***Mock de scraper de Steam, valida lógica***

5. **Agregar al schedule** (`netlify.toml`):
   ```toml
   [functions.check-steam]
     schedule = "*/30 * * * *"  # Cada 30 min
   ```

---

## 🧪 Testing

**Filosofía**: 100% offline, con mocks avanzados

**Ejemplo de test**:
```javascript
test("Publica nuevos items de android_queue", async (t) => {
  const store = createStore({
    android_queue: [{ id: "com.new", title: "New" }],
  });
  
  global.fetch = async (url) => {
    if (url.includes("sendMessage")) {
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 111 } })
      };
    }
  };
  
  const publishedGames = [];
  const result = await checkAndroidDeals(store, publishedGames);
  
  assert.strictEqual(result.publishedCount, 1);
  assert.strictEqual(publishedGames[0].id, "com.new");
});
```

**Ejecutar tests**:
```bash
npm test                          # Todos
npm test -- --testNamePattern="android"  # Solo Android
npm test -- --testNamePattern="lock"     # Solo locks
```

---

## 🐛 Debugging Común

### "¿Por qué no se publica?"
1. Revisa `android_queue` en Blobs: `npm run blobs:show`
2. Revisa logs de `check-android`: busca `[metrics]`
3. Si `publish_errors > 0`: revisá error de Telegram
4. Si `items_published = 0`: puede ser duplicado o error de lock

### "¿Por qué aparecen duplicados?"
1. Ejecuta: `npm run blobs:clear-queues` y reintenta
2. Si persiste: ejecuta `npm run blobs:normalize-memory`
3. Si sigue: hay item que se está re-produci (gap en deduplicación)

### "¿Por qué lock timeout?"
1. Una ejecución anterior sigue corriendo
2. Revisa: `ANDROID_STATE_LOCK_TTL_MS` (debe ser `5000`)
3. Revisa logs de Netlify para ver cuánto tarda cada función

---

## 📞 PatrÓnes y Convenciones

### Nombres de Variables
- `KEY_*`: Constante de clave en Blobs (ej: `KEY_ANDROID_QUEUE`)
- `store`: Interfaz de Netlify Blobs
- `published*`: Datos ya publicados
- `*Queue`: Cola pendiente de procesar

### Funciones Principales
- `check*Deals()`: Procesa cola y publica
- `reconcile*Publications()`: Verifica y republica
- `*FromFeed()`: Extrae de fuente externa
- `build*Message()`: Formatea para Telegram

### Estados
```javascript
PUBLICATION_STATUS = {
  PENDING_SEND,      // Prioritario para envío
  SENT_UNVERIFIED,   // Espera confirmación
  SENT_VERIFIED      // Confirmado ✅
}
```

---

## 📋 Checklist para IA antes de Code Gen

Antes de generar código, verifica que tienes:

- [ ] Documentación de entrada/salida (qué recibe, qué devuelve)
- [ ] Casos de error (qué pasa si Telegram cae, si hay duplicado, si Blobs falla)
- [ ] Logging (patrones `[consumer-...]`, `[metrics]` JSON)
- [ ] Tests (al menos 3: happy path, error, edge case)
- [ ] Variables de entorno (si necesita tuning)
- [ ] Lock distributido (si comparte estado con otra ejecución)

---

> **Última actualización**: Apr 6, 2026  
> Este documento es tu "sistema nervioso central". Cada IA debería leerlo completo antes de tocar código.
