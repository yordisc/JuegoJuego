# 🔧 GUÍA DE MEJORAS INMEDIATAS (1-2 semanas)

## ⚠️ PRIORIDADES

| Prioridad | Descripción | Impacto | Esfuerzo |
|-----------|------------|--------|---------|
| 🔴 CRÍTICA | Fix timeout en Netlify ‣ TTL lock | Sistema cae cada 10s | 5 min |
| 🟠 ALTA | Aumentar verificaciones | Falta cobertura | 2 min |
| 🟠 ALTA | Logging de deduplicación | Detectar duplicados | 10 min |
| 🟡 MEDIA | Validar messageId tracking | Pérdida de mensajes | 15 min |
| 🟡 MEDIA | Metrics JSON mejoradas | Monitoreo mejor | 20 min |
| 🟢 BAJA | Versionado de memoria | Rollback en emergencias | 1 hora |

---

## 🔴 CRÍTICA #1: Fix timeout lock en Netlify

**Problema**: TTL de 90 segundos pero Netlify limit es 10 segundos

**Archivo**: `netlify.toml` o `.env`

### ❌ ACTUAL (INCORRECTO)
```toml
[env]
ANDROID_STATE_LOCK_TTL_MS = "90000"    # 90 segundos ❌
```

### ✅ CORREGIDO (CORRECTO)
```toml
[env]
# Netlify free tier: 10s timeout máximo
# Usar TTL menor que timeout para garantizar liberación
ANDROID_STATE_LOCK_TTL_MS = "5000"     # 5 segundos ✅
ANDROID_STATE_LOCK_RETRIES = "5"       # Menos reintentos, más rápido
ANDROID_STATE_LOCK_RETRY_DELAY_MS = "500"  # 500ms entre intentos
```

**Cambios recomendados**:
```javascript
// En netlify/functions/check-android.js

parsePositiveInt(
  process.env.ANDROID_STATE_LOCK_TTL_MS,
  5 * 1000  // ← 5 segundos en lugar de 90
)

parsePositiveInt(
  process.env.ANDROID_STATE_LOCK_RETRIES,
  5  // ← 5 intentos en lugar de 20
)
```

**Validar después**:
```bash
# En logs de check-android.js:
"🔌 [DEBUG 2/4] Conectando a Netlify Blobs..."
"   - [Éxito en lock after X ms]"

# Debe ser < 1000ms
# Si ves "lock timeout" → aumentar retries o reducir retry_delay
```

---

## 🟠 ALTA #1: Aumentar verificaciones por ejecución

**Problema**: Solo verifica 25 mensajes/ejecución. Con 300 items = 12 horas

**Archivo**: `netlify.toml`

### ❌ ACTUAL
```toml
ANDROID_MAX_EXISTENCE_CHECK_PER_RUN = "25"
```

### ✅ MEJORADO
```toml
ANDROID_MAX_EXISTENCE_CHECK_PER_RUN = "50"  # Doble
```

**Justificación**: Cada verificación es solo 1 llamada GET (muy rápido)
- 25 verificaciones ≈ 1-2 segundos de Telegram
- 50 verificaciones ≈ 2-4 segundos de Telegram
- Dentro del límite de 10 segundos

**Validar**:
```bash
# Ver en logs:
"[metrics] {"...verified_count: 50..."}"

# Debe crecer el número de verificaciones
```

---

## 🟠 ALTA #2: Logging de deduplicación

**Problema**: No sabes si hay duplicados siendo rechazados

**Archivo**: `services/android-deals.js`

### 📍 Ubicación: Función `checkAndroidDeals()`

#### ❌ CÓDIGO ACTUAL (línea ~310)
```javascript
const queue = dedupeById(await readJsonArray(store, KEY_ANDROID_QUEUE));
// ...
const publishedIds = new Set(
  publishedGames.map(getPublishedGameId).filter(Boolean)
);
```

#### ✅ CÓDIGO MEJORADO
```javascript
const rawQueue = await readJsonArray(store, KEY_ANDROID_QUEUE);
const originalLength = rawQueue.length;
const queue = dedupeById(rawQueue);

// ← AGREGAR LOGGING
if (queue.length < originalLength) {
  const deduped = originalLength - queue.length;
  console.log(`[android-consumer] Deduplicados: ${deduped} items removidos en android_queue`);
  console.log(`[metrics] ${JSON.stringify({
    source: "consumer-android",
    deduplicated_count: deduped,
    queue_size_before: originalLength,
    queue_size_after: queue.length
  })}`);
}

const publishedIds = new Set(
  publishedGames.map(getPublishedGameId).filter(Boolean)
);

let publishedSkipped = 0;  // ← AGREGAR

for (let index = 0; index < queue.length; index += 1) {
  if (publishedCount >= maxPublishPerRun) {
    // ...
  }

  const item = queue[index];
  const id = getPublishedGameId(item);
  if (!id || publishedIds.has(id)) {
    publishedSkipped++;  // ← REGISTRAR
    continue;
  }
  // ...
}

// Al final, agregar:
if (publishedSkipped > 0) {
  console.log(`[android-consumer] Saltados por ya publicados: ${publishedSkipped}`);
}
```

**Resultado esperado**:
```
[android-consumer] Deduplicados: 2 items removidos en android_queue
[android-consumer] Saltados por ya publicados: 1
[metrics] {"source": "consumer-android", "deduplicated_count": 2, ..}
```

---

## 🟡 MEDIA #1: Validar messageId en tracking

**Problema**: Si `messageId` es null, no se rastrea pero no hay error

**Archivo**: `services/android-deals.js`

### 📍 Línea: ~405

#### ❌ CÓDIGO ACTUAL
```javascript
if (Number.isInteger(messageId)) {
  await trackTelegramMessage(store, {
    id,
    messageId,
    platform: "android",
    // ...
  });
}
// ← Silenciosamente se rechaza si messageId no es int
```

#### ✅ CÓDIGO MEJORADO
```javascript
if (Number.isInteger(messageId)) {
  const trackResult = await trackTelegramMessage(store, {
    id,
    messageId,
    platform: "android",
    chatId: process.env.CHANNEL_ID || null,
    messageKind: sendResult.publication.messageKind,
    messageText: sendResult.publication.messageText,
    publishedAt,
    title:
      item && typeof item === "object" && typeof item.title === "string"
        ? item.title
        : null,
  });
  
  // ← AGREGAR VALIDACIÓN
  if (!trackResult.tracked) {
    console.warn(
      `[android-consumer] Failed to track ${id} (messageId=${messageId}): ${trackResult.reason}`
    );
  } else {
    console.info(`[android-consumer] Tracked ${id} → messageId:${messageId}`);
  }
} else {
  // ← AGREGAR ALERTA
  console.warn(
    `[android-consumer] Mensaje enviado pero messageId no válido: ${JSON.stringify({
      id,
      messageId,
      type: typeof messageId,
      response: sendResult.response.ok
    })}`
  );
}
```

---

## 🟡 MEDIA #2: Métricas JSON mejoradas

**Problema**: Métricas son genéricas, difícil debuggear

**Archivo**: `services/android-deals.js` y `services/android-rss.js`

### ✅ AGREGAR CONSTANTES

```javascript
// Al inicio de android-deals.js
const METRICS_SOURCE = "consumer-android";
const METRICS_VERSION = "2.0";

// Al final de checkAndroidDeals()
const detailedMetrics = {
  source: METRICS_SOURCE,
  version: METRICS_VERSION,
  timestamp: new Date().toISOString(),
  execution: {
    duration_ms: Date.now() - startTime,  // ← Medir tiempo
    processed_count: queue.length,
    rate_limited: publishErrors > 0 && publishedCount === 0
  },
  results: {
    items_published: publishedCount,
    items_expired: expiredCount,
    publish_errors: publishErrors,
    delete_errors: deleteErrors,
    retried_next_run: retryQueue.length + retryExpiredQueue.length
  },
  rates: {
    publish_success_rate: publishedCount / queue.length,
    error_rate: publishErrors / queue.length
  },
  state: {
    queue_remaining: retryQueue.length,
    expired_remaining: retryExpiredQueue.length
  }
};

console.log(`[metrics] ${JSON.stringify(detailedMetrics)}`);
```

**Resultado**:
```json
[metrics] {
  "source": "consumer-android",
  "version": "2.0", 
  "timestamp": "2025-04-06T10:30:45.123Z",
  "execution": {
    "duration_ms": 3245,
    "processed_count": 18,
    "rate_limited": false
  },
  "results": {
    "items_published": 15,
    "items_expired": 2,
    "publish_errors": 1,
    "delete_errors": 0,
    "retried_next_run": 2
  },
  "rates": {
    "publish_success_rate": 0.833,
    "error_rate": 0.056
  },
  "state": {
    "queue_remaining": 2,
    "expired_remaining": 0
  }
}
```

---

## 🟢 BAJA: Agregar reason a expiración

**Problema**: No se sabe por qué cada juego fue expirado

**Archivo**: `services/android-rss.js`

### 📍 Función: `inferExpiredAndroidFromFeed()`

#### ✅ MEJORADO

```javascript
// Línea ~450 (al detectar expirado)

const expired = [];
for (const entry of normalizedPublished) {
  if (active.has(entry.id)) {
    continue;
  }

  const publishedAt = Number.isInteger(entry.publishedAt)
    ? entry.publishedAt
    : 0;

  if (publishedAt > 0 && now - publishedAt < graceMs) {
    continue;  // Demasiado nuevo
  }

  // ← AGREGAR REASON
  let reason = "not_in_rss";  // Default
  
  if (publishedAt > 0 && now - publishedAt < graceMs) {
    reason = "within_grace_period";
  } else if (publishedAt === 0) {
    reason = "no_publish_timestamp";
  }

  expired.push({
    id: entry.id,
    messageId: entry.messageId ?? null,
    source,
    reason,  // ← Agregar
    expiredAt: now,
    expiredAfterHours: publishedAt > 0 ? (now - publishedAt) / (60*60*1000) : null
  });
}
```

**Utilidad**: Permite diagnosticar por qué se expiran

```json
{
  "id": "com.game",
  "reason": "not_in_rss",
  "expiredAfterHours": 48
}
```

---

## 🔄 TESTING DE CAMBIOS

### Test 1: Verificar deduplicación

```javascript
// Agregar a test/android-deals.test.js

test("Registra deduplicados en logs", async (t) => {
  const store = createStore({
    android_queue: [
      { id: "com.game1", title: "Game 1" },
      { id: "com.game1", title: "Game 1" }, // Duplicado
      { id: "com.game2", title: "Game 2" }
    ],
    android_expired: []
  });
  
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);
  
  try {
    const result = await checkAndroidDeals(store, []);
    
    // Debe detectar y loguear 1 deduplicado
    const dedupeLog = logs.find(l => l.includes("Deduplicados"));
    assert.ok(dedupeLog, "Debe loguear deduplicados");
  } finally {
    console.log = originalLog;
  }
});
```

### Test 2: Verificar tracking válido

```javascript
test("Solo trackea con messageId válido", async (t) => {
  // Mock que devuelve messageId inválido
  global.fetch = async () => ({
    ok: true, 
    json: async () => ({ ok: true, result: { /* Sin message_id */ } })
  });
  
  const store = createStore({
    android_queue: [{ id: "com.game", title: "Game" }],
    android_expired: []
  });
  
  const logs = [];
  const originalWarn = console.warn;
  console.warn = (msg) => logs.push(msg);
  
  try {
    await checkAndroidDeals(store, []);
    
    // Debe advertir sobre messageId inválido
    const warnLog = logs.find(l => l.includes("messageId no válido"));
    assert.ok(warnLog, "Debe advertir sobre messageId inválido");
  } finally {
    console.warn = originalWarn;
  }
});
```

### Test 3: Aumentar verificaciones

```javascript
test("Realiza 50 verificaciones máximo", async (t) => {
  process.env.ANDROID_MAX_EXISTENCE_CHECK_PER_RUN = "50";
  
  const store = createStore({
    // Crear 60 juegos publicados
    published_games_android: Array.from({length: 60}, (_, i) => ({
      id: `com.game${i}`,
      messageId: 1000 + i,
      status: "sent_unverified"
    }))
  });
  
  let checkCount = 0;
  global.fetch = async () => {
    checkCount++;
    return { ok: true, json: async () => ({ok: true}) };
  };
  
  await reconcileAndroidPublications(store);
  
  // Debe intentar checkear ~50 (no todos 60)
  assert.ok(checkCount <= 50, `Máximo 50 checks, pero hizo ${checkCount}`);
});
```

---

## 📋 CHECKLIST DE APLICACIÓN

```
□ 1. Reducir ANDROID_STATE_LOCK_TTL_MS a 5 segundos
□ 2. Aumentar ANDROID_MAX_EXISTENCE_CHECK_PER_RUN a 50
□ 3. Agregar logging de deduplicación en checkAndroidDeals()
□ 4. Agregar validación de tracking en sendAndroidPublication()
□ 5. Mejorar métricas JSON en logs
□ 6. Agregar reason a expiración
□ 7. Ejecutar tests nuevos
□ 8. Desplegar a producción
□ 9. Monitorear logs por 24 horas
□ 10. Revisar métricas en Netlify Dashboard
```

---

## ✅ VALIDACIÓN POST-DEPLOY

### HORA 0-1: Verificar Lock
```bash
# Buscar en logs:
"🔌 [DEBUG 2/4] Conectando a Netlify Blobs..."

# Debe ver:
"✅ Presente"  # Para todos los valores
```

### HORA 1-6: Verificar Publicaciones
```bash
# Buscar en logs:
"[metrics] {..."publisher_success_rate": 0.8...""

# Ratio debe ser alto (>70%)
```

### HORA 6-24: Verificar Expiración
```bash
# Buscar en logs:
"[android-consumer] (...) "reason": "not_in_rss""

# Debe ver algunos expirados pero no muchos (< 20% de total)
```

### DÍA 1-7: Revisar Tendencias
```bash
# En Netlify Dashboard:
# - Tiempo de ejecución debe ser < 5 segundos
# - Errores debe ser 0 o muy bajo
# - publish_success_rate debe ser > 80%
```

---

## 🚀 PRÓXIMOS PASOS (DESPUÉS DE 1 SEMANA)

1. **Implementar versionado de memoria** (rollback en caso de falla)
2. **Aumentar límite de almacenamiento** (300 → 500)
3. **Agregar alertas automáticas** (si errores > 10%)
4. **Implementar revalidación periódica** (verificar cada 7 días todos)
5. **Base de datos transaccional** (PostgreSQL en lugar de Blobs)

