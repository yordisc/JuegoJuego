# 🎯 DIAGRAMA DE FLUJO DETALLADO Y RECOMENDACIONES

## 📊 Diagrama Visual del Flujo Completo

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ANDROID FREE GAMES PIPELINE                          │
└─────────────────────────────────────────────────────────────────────────────┘

FASE 1: PRODUCCIÓN (RSS)
═════════════════════════════════════════════════════════════════════════════
                              Reddit RSS Feed
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │  Parse RSS Feed       │
                        │  (createRssParser)    │
                        └───────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────────┐
                    │ Extract Play Store URLs/IDs       │
                    │ (extractIdsFromPlayStoreUrl)      │
                    └───────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────────┐
                    │ Validate Qualified Free Games     │
                    │ - isGameCategory()                │
                    │ - isCurrentlyFree() (price=0)     │
                    │ - originalPrice > 0               │
                    └───────────────────────────────────┘
                                    │
                            ┌───────┴───────┐
                            │               │
                   ✅ Válido │               │ ❌ Inválido
                            │               │
                            ▼               ▼
                    ┌────────────────┐    (Rechazado)
                    │ Deduplicate    │
                    │ by ID          │
                    └────────────────┘
                            │
                            ▼
                    ┌────────────────┐
                    │ Add to Queue   │
                    │ (android_queue)│  ← Netlify Blobs
                    └────────────────┘
                            │
             ┌──────────────┴──────────────┐
             │ buildAndroidRssQueue()     │
             │ Resultado:                  │
             │ { id, title, icon, url,... } │
             └────────────────────────────┘


FASE 2: CONTROL Y ENVÍO (Telegram)
═════════════════════════════════════════════════════════════════════════════
             ┌──────────────────────────────────┐
             │ check-android.js (NETLIFY FUNC)  │
             │ Triggered: Each 30 minutes       │
             └──────────────────────────────────┘
                            │
                            ▼
                ┌───────────────────────────────┐
                │ Acquire Distributed Lock      │
                │ (withBlobLock)                │
                │ TTL: 90 seconds, Retries: 20  │
                └───────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
        ✅ Lock │                       │ ❌ Lock timeout
        Granted │                       │
                │                       ▼
                ▼                   (Skip - try next exec)
    ┌──────────────────────┐
    │ Read android_queue   │
    │ & published_games    │
    │ (from Blobs)         │
    └──────────────────────┘
            │
            ▼
    ┌──────────────────────┐
    │ Deduplicate Queue    │
    │ (dedupeById)         │
    └──────────────────────┘
            │
    ┌───────┴──────────────┐
    │                      │
    │ Max 18 Items/Run     │
    │ (ANDROID_MAX_        │
    │  PUBLISH_PER_RUN)    │
    │                      │
    ▼                      ▼
┌──────────────┐   ┌────────────────────┐
│ For Each     │   │ Remaining Items    │
│ Item         │   │ → Retry Queue      │
│ in Queue     │   │ (Next execution)   │
└──────┬───────┘   └────────────────────┘
       │
       ▼
    ┌─────────────────────────────────┐
    │ Check if Already Published      │
    │ (publishedIds.has(id))          │
    └─────────────────────────────────┘
       │
       ├─ Already exists → Skip
       │
       └─ New → Send to Telegram
            │
            ▼
    ┌─────────────────────────────────┐
    │ buildAndroidMessage()            │
    │ Format: Markdown + Emoji         │
    │ - Title                          │
    │ - Rating                         │
    │ - Google Play Link               │
    └─────────────────────────────────┘
            │
    ┌───────┴──────────────┐
    │                      │
  Icon?│                   │ No Icon
    │                      │
    ▼                      ▼
┌──────────────────┐  ┌────────────────┐
│ sendPhoto()      │  │ sendMessage()  │
│ API: /sendPhoto  │  │ API: /sendMsg  │
└──────────────────┘  └────────────────┘
    │                      │
    └──────────┬───────────┘
               │
               ▼
    ┌─────────────────────────────────┐
    │ requestWithRetry()              │
    │ - Attempt 1: Now                │
    │ - Attempt 2: Wait 500ms         │
    │ - Attempt 3: Wait 1000ms        │
    │ - Exponential backoff           │
    │ - Retry on 429, 5xx             │
    │ - Max 3 attempts                │
    └─────────────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
    ✅ OK│             │ ❌ FAIL
        │             │
        ▼             ▼
    ┌────────┐   ┌──────────────┐
    │ Extract │   │ Log Error    │
    │ message │   │ Add to Retry │
    │ _id     │   │ Queue        │
    └────┬───┘   └──────────────┘
         │
     HTTP │
     429? │
         │
    ┌────┴────┐
    │          │
   Yes│        │ No
    │          │
    ▼          ▼
  STOP    Continue
  Retry   to next
  Queue   item

    ✅ Success Path:
         │
         ▼
    ┌──────────────────────────────────┐
    │ trackTelegramMessage()           │
    │ - Save messageId                 │
    │ - Save platform: "android"       │
    │ - Save publishedAt               │
    │ - Save messageKind: text|photo   │
    │ - Save messageText               │
    │ → KEY_TELEGRAM_SENT_MESSAGES    │
    └──────────────────────────────────┘
         │
         ▼
    ┌──────────────────────────────────┐
    │ Add to published_games           │
    │ - status: "sent_unverified"      │
    │ - messageId: 12345               │
    │ - publishedAt: now()             │
    │ - title, titleMatch              │
    └──────────────────────────────────┘
         │
         ▼
    ┌──────────────────────────────────┐
    │ Remove from android_queue        │
    │ (Queue processing complete)      │
    └──────────────────────────────────┘
         │
         ▼
    ┌──────────────────────────────────┐
    │ SAVE UPDATED STATE               │
    │ - published_games_android        │
    │ - android_queue (remainder)      │
    │ - android_expired (old)          │
    │ → To Netlify Blobs               │
    └──────────────────────────────────┘

FASE 3: VERIFICACIÓN (Reconciliation)
═════════════════════════════════════════════════════════════════════════════
     ┌──────────────────────────────────────┐
     │ verify-android.js (NETLIFY FUNC)     │
     │ Triggered: Each 1 hour               │
     └──────────────────────────────────────┘
                │
                ▼
    ┌──────────────────────────────┐
    │ Load published_games         │
    │ Load telegram_sent_messages  │
    │ (tracking)                   │
    └──────────────────────────────┘
                │
                ▼
    ┌──────────────────────────────┐
    │ For Each Published Game      │
    │ Max 25 checks/run            │
    │ (ANDROID_MAX_EXISTENCE_      │
    │  CHECK_PER_RUN)              │
    └──────────────────────────────┘
            │
    ┌───────┴───────┐
    │               │
    ▼               ▼
┌──────────────┐  ┌──────────────────┐
│ Find Tracked │  │ Not Tracked      │
│ Entry (by ID │  │ or Invalid       │
│ or Title)    │  │ → Skip           │
└──────┬───────┘  └──────────────────┘
       │
       ▼
    ┌───────────────────────────────┐
    │ probeAndroidMessageExists()   │
    │ Edit message WITHOUT changes  │
    │ (Used as existence probe)     │
    └───────────────────────────────┘
       │
    ┌──┴──────┬──────────┐
    │          │          │
 200│      400  │ Others   │
    │          │          │
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌──────────┐
│ Exists │ │Missing │ │ Error    │
│ Status:│ │ Status:│ │ Retry    │
│ SENT_  │ │PENDING_│ │ Later    │
│VERIFIED│ │ SEND   │ │          │
└────────┘ └────────┘ └──────────┘
    │         │
    ▼         ▼
 UPDATE   REPUBLISH
    │    (Next phase)
    │
    ▼
┌────────────────────────────────────┐
│ Save Updated published_games       │
│ With new status/messageId          │
│ → published_games_android          │
└────────────────────────────────────┘

FASE 4: EXPIRACIÓN (Cleanup)
═════════════════════════════════════════════════════════════════════════════
             ┌──────────────────────────┐
             │ github-android.js (GHA)  │
             │ Triggered: Each 6 hours  │
             └──────────────────────────┘
                      │
                      ▼
         ┌──────────────────────────┐
         │ Fetch Latest RSS Feed    │
         │ Extract Active IDs       │
         │ (feedActiveIds)          │
         └──────────────────────────┘
                      │
                      ▼
         ┌────────────────────────────────┐
         │ Compare RSS vs Published       │
         │ inferExpiredAndroidFromFeed()  │
         └────────────────────────────────┘
                      │
            ┌─────────┴─────────┐
            │                   │
      Logic │                   │Checks
        ─────────────────────────
    1. Is feedActiveIds.size >= 10?
       NO → Don't expire (protection)
    
    2. For each published game:
       - Is it in activeIds? 
         If YES → Skip (still active)
         If NO → Check grace period
    
    3. Grace period check (default: 24h)
       - publishedAt > 24h ago?
         If YES → Add to expired list
         If NO → Keep (too new)
    
    4. Expiration ratio check:
       - expired.length > 35% of total?
         If YES → Block (protection)
         If NO → Apply expirations
    
    Protections:
    ✅ Min 10 active IDs (RSS must be healthy)
    ✅ 24h grace period (avoid transient changes)
    ✅ 35% max expiry ratio (avoid mass purges)
            │
            ▼
     ┌──────────────────┐
     │ Send to Telegram │
     │ deleteMessage()  │
     │ Max 18/run       │
     └──────────────────┘
            │
     ┌──────┴──────┐
     │             │
  ✅ OK│             │ ❌ FAIL
     │             │
     ▼             ▼
  ┌────────┐   ┌──────────┐
  │ Remove │   │ Log Error│
  │ from   │   │ Retry    │
  │Published│   │ Next Run │
  └────────┘   └──────────┘
     │
     ▼
 ┌─────────────────────┐
 │ Update Memory State │
 │ Remove from:        │
 │ - published_games   │
 │ - android_queue     │
 │ - android_expired   │
 └─────────────────────┘


═════════════════════════════════════════════════════════════════════════════
ESTADO EN MEMORIA (Netlify Blobs)
═════════════════════════════════════════════════════════════════════════════

┌─ published_games_android: Array ──────────────────────────────────────────┐
│ [                                                                          │
│   {                                                                        │
│     id: "com.game1",                                                      │
│     messageId: 12345,           // Telegram message ID                    │
│     publishedAt: 1710000000000, // Unix timestamp                         │
│     status: "sent_verified",    // pending_send|sent_unverified|verified  │
│     title: "Game Title",                                                  │
│     titleMatch: "game title",   // Normalized for searching              │
│     chatId: "@channel_id"                                                 │
│   },                                                                       │
│   ...                                                                      │
│ ]                                                                          │
│ Limit: 300 items (oldest removed when exceeded)                          │
└──────────────────────────────────────────────────────────────────────────┘

┌─ android_queue: Array ───────────────────────────────────────────────────┐
│ [                                                                          │
│   {                                                                        │
│     id: "com.newgame",                                                    │
│     title: "New Game",          // From RSS or manual                     │
│     icon: "https://...",        // Optional icon URL                      │
│     url: "https://play.google.com/store/...",                            │
│     score: 4.5,                 // Rating                                 │
│     source: "reddit-rss",       // Source identifier                      │
│     discoveredAt: 1710000000000 // Unix timestamp                         │
│   },                                                                       │
│   ...                                                                      │
│ ]                                                                          │
│ Processing: Max 18 items per check-android execution                      │
└──────────────────────────────────────────────────────────────────────────┘

┌─ telegram_sent_messages: Array ──────────────────────────────────────────┐
│ [                                                                          │
│   {                                                                        │
│     id: "com.game1",                                                      │
│     messageId: 12345,           // Unique Telegram message ID             │
│     platform: "android",        // android|pc                             │
│     chatId: "@channel_id",      // Channel identifier                     │
│     messageKind: "text",        // text|photo                             │
│     messageText: "📱 **NEW...", // Saved message content                 │
│     publishedAt: 1710000000000,                                           │
│     title: "Game Title",                                                  │
│     titleMatch: "game title"                                              │
│   },                                                                       │
│   ...                                                                      │
│ ]                                                                          │
│ Purpose: Track all messages ever sent (for recovery/debugging)           │
└──────────────────────────────────────────────────────────────────────────┘

┌─ android_expired: Array ─────────────────────────────────────────────────┐
│ [                                                                          │
│   {                                                                        │
│     id: "com.oldgame",                                                    │
│     messageId: 54321,           // Telegram message to delete             │
│     source: "rss"               // Why was marked expired                 │
│   },                                                                       │
│   ...                                                                      │
│ ]                                                                          │
│ Processing: Max 18 deletions per check-android execution                  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 ESTADOSMÁQUINA DE PUBLICACIÓN

```
                PENDING_SEND
                     │
          (enviado o republicar)
                     │
                     ▼
            SENT_UNVERIFIED  ◄─────┐
                     │              │
            (verificando)           │
                     │              │  (fallo en verificación)
              ┌──────┴──────┐       │
              │             │       │
         ✅ OK│             │ ❌ NO │
              │             │       │
              ▼             ▼       │
        SENT_VERIFIED  PENDING_SEND ┘
              │
         (existe en      
          Telegram)      
              │
              ▼
    (eliminado del RSS)
          ↓
    DELETED (removed from 
    published_games)


Estados:
●PENDING_SEND      = Esperando ser enviado a Telegram
● SENT_UNVERIFIED  = Enviado pero no confirmado en canal
● SENT_VERIFIED    = ✅ Confirmado en canal
● (deleted)        = Removido por expiración
```

---

## ⏱️ TIMELINE TÍPICO

```
T+0:00   RSS actualiza (30-60s)
         └─ Produce android_queue
         
T+0:30   check-android ejecuta
         ├─ Procesa android_queue (envía Max 18)
         ├─ Procesa android_expired (borra Max 18)
         └─ Guarda estado
         
T+1:00   verify-android ejecuta
         ├─ Verifica Max 25 mensajes
         └─ Actualiza estados
         
T+1:30   check-android ejecuta (2nd time)
         ├─ Procesa siguientes items de queue
         ├─ Reenvía los que fallaron
         └─ Continúa con expirados
         
... (repite cada 30 min)

T+6:00   github-android.js ejecuta
         ├─ Calcula juegos expirados
         └─ Agrega a android_expired
         
... (cada 6 horas)
```

---

## 🔄 BUCLES DE REINTENTOS

```
Item falla en send
    │
    ▼
Agregado a retryQueue
    │
    ▼
Guardado en android_queue
    │
    ├─ Siguiente check-android
    │  ├─ Lee android_queue
    │  ├─ Reintenta envío
    │  │
    │  ├─ ✅ OK → publishedGames
    │  │
    │  └─ ❌ FAIL → retryQueue → android_queue
    │            (esperará siguiente check)
    │
    └─ Si falla SIEMPRE:
       ├─ Se acumula en android_queue
       ├─ Se reintentra cada 30 min → check-android
       └─ Máximo 3 attempts por check-android
          (si no es rate limit o error permanente)
```

---

## 🚨 PUNTOS CRÍTICOS

```
1. LOCK (withBlobLock)
   └─ Si falla: Siguiente ejecución se salta
   └─ TTL: 90 segundos
   └─ CRÍTICO: Netlify timeout es 10s
      → Lock debe liberarse ANTES de 10s

2. DEDUPLICACIÓN
   └─ En android_queue (mismo item múltiples veces)
   └─ En publishedIds (no enviar 2 veces mismo ID)
   └─ CRÍTICO: Si falla, envío duplicado a Telegram

3. VERIFICACIÓN DE EXISTENCIA
   └─ Solo Max 25 por ejecución
   └─ Con 300 items = 12 horas para verificar todos
   └─ CRÍTICO: Items sin verificar pueden estar deletreados

4. EXPIRACIÓN MASIVA
   └─ Protección: Max 35% por ejecución
   └─ Si sucede: Demostra > 2 horas para limpiar todo
   └─ CRÍTICO: Si RSS falla, toma mucho limpiar

5. RATE LIMITING
   └─ Detección: HTTP 429
   └─ Acción: Para todo, reintenta siguiente ejecución
   └─ CRÍTICO: Si Telegram está saturado, queue crece
```

---

## 📊 CONFIGURACIÓN RECOMENDADA

```javascript
// En .env o netlify.toml

// Limits
ANDROID_MAX_PUBLISH_PER_RUN=18              // Default: 18
ANDROID_MAX_DELETE_PER_RUN=18               // Default: 18
ANDROID_MAX_REPUBLISH_PER_RUN=25            // Default: 25
ANDROID_MAX_EXISTENCE_CHECK_PER_RUN=50      // ✅ Aumentado a 50

// Memory
MEMORY_LIMITS__ANDROID=300                  // Default: 300 (considerar 500)

// Retry
ANDROID_STATE_LOCK_TTL_MS=5000              // ✅ Reducido a 5s para Netlify
ANDROID_STATE_LOCK_RETRIES=20               // Default: 20
ANDROID_STATE_LOCK_RETRY_DELAY_MS=1000      // Default: 1s

// Expiration
ANDROID_RSS_EXPIRATION_GRACE_HOURS=24       // Default: 24h
ANDROID_RSS_MAX_EXPIRE_RATIO=0.35           // Default: 35%

// RSS
ANDROID_RSS_MIN_ACTIVE_IDS=10               // Default: 10 (min IDs to allow expiry)
ANDROID_RSS_COUNTRY=us                      // Default: us
ANDROID_RSS_LANG=es                         // Default: es
```

> **NOTA**: Netlify Functions tienen timeout de 10 segundos en la versión gratuita.
TTL del lock de 90 segundos causará problemas si ejecución tarda > 10 segundos.
Ajustar en producción.

