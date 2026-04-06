# 📱 Análisis Completo del Flujo de Juegos Android Gratis

## 🎯 Visión General del Sistema

Tu sistema obtiene juegos Android gratis de Reddit RSS, los almacena en memoria persistente (Netlify Blobs), los publica en Telegram y verifica que existan en el canal. Este es el flujo completo:

```
RSS (Reddit) → Cola (memory) → Telegram → Tracking → Verificación
```

---

## 🔄 FASE 1: OBTENCIÓN Y ENCOLADO (Producción de RSS)

### 📍 Archivo: `scripts/github-android-rss.js` y `services/android-rss.js`

**¿Qué hace?**
- Consume el feed RSS de Reddit (`https://www.reddit.com/r/googleplaydeals/new.rss`)
- Extrae IDs de aplicaciones del feed usando expresiones regulares
- Valida que sean juegos gratis (no solo aplicaciones)
- Agrega a una cola de Telegram

**Flujo:**
```javascript
1. createRssParserInstance() → Pausa la lectura del RSS
   ↓
2. collectItemAppIds(item) → Extrae IDs de URLs Google Play del post
   ↓
3. isQualifiedFreeGame(details) → Valida: ES JUEGO + ACTUALMENTE GRATIS
   ↓
4. buildQueueItem() → Crea objeto con: id, title, icon, url, score, source, discoveredAt
   ↓
5. buildAndroidRssQueue() → Agrupa y deduplica en "android_queue"
```

**Validaciones Importantes:**
```javascript
// El juego debe cumplir AMBAS condiciones:
1. isGameCategory(details)      // genreId contiene "GAME" O genre contiene "juego"
2. isCurrentlyFree(details)      // price = 0
3. originalPrice > 0            // Debe tener precio regular para considerar "descuento"
```

**Datos almacenados en `android_queue` (Netlify Blobs):**
```json
{
  "id": "com.example.game",
  "title": "Game Name",
  "icon": "https://...",
  "url": "https://play.google.com/store/apps/details?id=...",
  "score": 4.5,
  "source": "reddit-rss",
  "discoveredAt": 1710000000000
}
```

### ⚠️ Posibles Mejoras en esta Fase:

1. **Duplicados en el RSS**: Es posible que el mismo ID se agregue múltiples veces
   - ✅ Ya está manejado con `dedupeById()` pero podría optimizarse

2. **Validación de juegos gratis**:
   - El precio se obtiene de `google-play-scraper` pero con DELAY
   - Estrategia actual: Convocar 10+ IDs por ejecución para dar oportunidad

3. **Cambios de idioma**: Se obtiene en español (`lang: "es"`) pero algunos juegos pueden tener info diferente

---

## ⏳ FASE 2: ALMACENAMIENTO EN MEMORIA

### 📍 Archivos: `utils/memory.js` y `netlify/functions/check-android.js`

**¿Qué hace?**
- Lee la cola de Telegram
- Procesa hasta 18 juegos por ejecución (variable: `ANDROID_MAX_PUBLISH_PER_RUN`)
- Coordina acceso con locks para evitar race conditions

**Estructura en memoria:**
```javascript
// Cola pendiente (android_queue)
[
  { id: "com.game1", title: "Game 1", ... },
  { id: "com.game2", title: "Game 2", ... }
]

// Juegos publicados (published_games_android)
[
  {
    id: "com.game1",
    messageId: 12345,           // ID del mensaje en Telegram
    publishedAt: 1710000000000, // Timestamp
    status: "sent_verified",    // Posibles: pending_send, sent_unverified, sent_verified
    title: "Game 1",
    titleMatch: "game 1",       // Título normalizado para búsqueda
    chatId: "@channel_id"
  }
]
```

**IMPORTANTE - Límite de almacenamiento:**
```javascript
MEMORY_LIMITS = {
  android: 300  // Máximo 300 juegos en memoria
}
```

Cuando se alcanza el límite, se mantienen los últimos 300 (`.slice(-300)`).

### ⚙️ Sistema de Locks:

```javascript
// Evita race conditions con lock distribuido
withBlobLock(
  store,
  {
    lockKey: "android_state_lock",
    owner: "consumer-android",
    ttlMs: 90000,           // Lock se libera en 90 segundos
    retries: 20,            // Reintenta 20 veces
    retryDelayMs: 1000      // Espera 1 segundo entre intentos
  }
)
```

### ⚠️ Posibles Mejoras en esta Fase:

1. **Límite de 300 juegos podría ser bajo**:
   - Si publicas 18 por corrida, son solo 16-17 corridas de datos
   - Considera aumentar si quieres histórico más largo

2. **Lock TTL de 90 segundos**:
   - Si el proceso tarda más de 90s, otra ejecución puede interferir
   - En producción, Netlify Functions tienen límite de 10 segundos

3. **No hay versionado de memoria**:
   - Si algo falla, se sobreescribe todo
   - Considera mantener backup o journaling

---

## 📤 FASE 3: ENVÍO A TELEGRAM

### 📍 Archivos: `services/android-deals.js` y `utils/telegram.js`

**¿Qué hace?**
- Lee cada item de la cola
- Construye un mensaje formateado
- Envía a Telegram como texto o foto

**Proceso de envío:**
```javascript
1. buildAndroidMessage(item)
   ↓
   Construye Markdown con:
   - Título del juego
   - Rating
   - Enlace a Google Play

2. sendAndroidPublication(item)
   ↓
   Si hay icon → sendPhoto (Telegram Bot API)
   Si no       → sendMessage (Telegram Bot API)

3. requestWithRetry(url, payload, options)
   ↓
   Reintentos con backoff exponencial:
   - Intento 1: Sin espera
   - Intento 2: 500ms * 1 = 500ms
   - Intento 3: 500ms * 2 = 1000ms
   
   Si respuesta 429 (rate limit) → Se detiene y difiere el resto
   Si respuesta 5xx → Reintenta
   Si respuesta 2xx → ✅ Éxito
```

**Ejemplo de mensaje Telegram:**
```
📱 **NEW ANDROID DEAL** 📱

🎮 *Game Title*
⭐ Rating: 4.5

👉 [Get it on Google Play](https://play.google.com/store/apps/details?id=com.example.game)
```

**Respuesta de Telegram:**
```json
{
  "ok": true,
  "result": {
    "message_id": 12345,      // ← ID del mensaje en el canal
    "chat": { "id": "@channel" },
    "date": 1710000000
  }
}
```

**Flujo después de envío exitoso:**
```javascript
1. Extrae messageId de respuesta
2. Guarda en published_games_android:
   {
     id: "com.game1",
     messageId: 12345,
     publishedAt: Date.now(),
     status: "sent_unverified",  // Aún no verificado
     title: "Game 1"
   }
3. Registra en tracking (manual-maintenance):
   {
     id: "com.game1",
     messageId: 12345,
     platform: "android",
     chatId: "@channel_id",
     messageKind: "text" | "photo",
     messageText: "...mensaje...",
     publishedAt: Date.now(),
     title: "Game 1"
   }
4. Elimina de android_queue
```

### ⚠️ Posibles Mejoras en esta Fase:

1. **Rate limiting de Telegram**:
   - ✅ Ya está manejado: Detecta 429 y detiene
   - Pero si hay muchos errores, se espera siempre 90s

2. **No hay confirmación visual en Telegram**:
   - El bot no confirma si el mensaje llegó bien
   - Solo verifica en la siguiente fase (reconciliación)

3. **Iconos pueden causar delays**:
   - `sendPhoto` requiere descargar y procesar imagen
   - Podría causar timeouts con muchos juegos

4. **Markup escape incompleto**:
   - Se escapa Markdown pero URLs podrían tener caracteres problemáticos
   - Considera usar `disable_web_page_preview` o inline links

---

## ✅ FASE 4: VERIFICACIÓN DE EXISTENCIA EN TELEGRAM

### 📍 Archivos: `netlify/functions/verify-android-publications.js` y `services/android-deals.js`

**¿Qué hace?**
- Verifica que cada mensaje enviado sigue existiendo en el canal
- Si msg fue eliminado o no existe → Reintentar envío
- Marca estados: `pending_send`, `sent_unverified`, `sent_verified`

**Proceso de verificación:**
```javascript
1. Lee published_games_android
2. Para cada juego:
   ├─ Busca en tracked_messages (historial interno)
   ├─ Si encontrado → Verifica existencia
   └─ Si no encontrado → Marca como "pending_send"

3. probeAndroidMessageExists(trackedEntry)
   ↓
   Usa editMessageCaption/editMessageText SIN cambios
   (Telegram rechaza edición si no cambia)
   ↓
   - Si respuesta OK → "exists" ✅
   - Si error "message not found" → "missing" ❌
   - Si error "message not modified" → "exists" ✅ (cambio rechazado)
   - Otros errores → "error"

4. Máximo 25 verificaciones por ejecución
   (Variable: ANDROID_MAX_EXISTENCE_CHECK_PER_RUN)
```

**Comportamiento según resultado:**
```javascript
Si status == "exists":
  └─ Actualiza a "sent_verified" ✅

Si status == "missing":
  ├─ Marca messageId como null
  ├─ Cambia status a "pending_send"
  └─ En siguiente check-android: Reenvía ⬆️

Si status == "error":
  ├─ Incrementa contador de errores
  ├─ Continúa sin cambiar estado
  └─ Será reintentar en siguiente ejecución
```

**Estados de publicación:**
```
pending_send    → Aún no se ha enviado o necesita reenvío
     ↓
sent_unverified → Enviado, pero SIN verificar en Telegram
     ↓
sent_verified   → ✅ Confirmado que existe en Telegram
```

### ⚠️ Posibles Mejoras en esta Fase:

1. **La verificación es "optimista"**:
   - Solo comprueba si el mensaje EXISTE, no su contenido
   - Un mensaje editado externamente pasaría verificación

2. **Máximo 25 verificaciones puede ser insuficiente**:
   - Si acumulas 300 mensajes y 25/ejecución = 12 ejecuciones
   - Un fallo en una ejecución y todo se retrasa

3. **No hay "ping periodic"**:
   - Un mensaje podría existir ahora pero estar marcado como "verified" años atrás
   - No se recomprueba periódicamente

4. **Race condition posible**:
   - Entre verify-android y check-android podrían interferirse
   - Aunque locks lo previene, el timing puede ser ajustado

---

## 🗑️ FASE 5: EXPIRACIÓN Y LIMPIEZA

### 📍 Archivos: `services/android-expiration.js` y `services/android-rss.js`

**¿Qué hace?**
Detecta juegos que ya NO están en el RSS y los elimina del Telegram.

**Proceso:**
```javascript
1. Obtiene lista ACTIVA del RSS (feedActiveIds)
2. Obtiene lista PUBLICADA en memoria (publishedGames)

3. inferExpiredAndroidFromFeed():
   ├─ Compara: ¿qué publicamos que ya no está en RSS?
   ├─ Valida: del>minActiveIds (mín 10 IDs en RSS)
   ├─ Aplica graceHours: espera 24h antes de marcar expirado
   ├─ Aplica maxExpireRatio: max 35% de eliminaciones por corrida
   └─ Devuelve lista de IDs a expirar

4. checkAndroidDeals(processExpired=true):
   ├─ Toma lista de expirados
   ├─ Para cada uno:
   │  ├─ Llama a markAndroidExpired(messageId)
   │  └─ Envía DELETE a Telegram
   ├─ Si éxito → Remueve de published_games_android
   └─ Máximo 18 borrados por ejecución
```

**Protecciones de expiración:**

```javascript
// 1. Mínimo de IDs activos en RSS
if (feedActiveIds.size < 10) {
  // No expira nada (protección contra RSS vacío)
}

// 2. Grace period (espera 24h)
if (now - publishedAt < 24_hours) {
  // No expira aún (protección contra cambios transitorios)
}

// 3. Máximo de expiración (35% por corrida)
const maxAllowed = Math.floor(publishedCount * 0.35)
if (expiredCount > maxAllowed) {
  // Bloquea expiración (protección contra purgas masivas)
}
```

### ⚠️ Posibles Mejoras en esta Fase:

1. **Grace period fijo de 24 horas**:
   - Podría ser demasiado corto si RSS tiene lag
   - Considera hacerlo configurable

2. **Máximo 35% de expiración es muy restrictivo**:
   - Si 100 juegos, solo puede expirar 35
   - Si hay cambio de fuente o error, tarda mucho en limpiar

3. **No hay re-publicación en otro canal**:
   - Juego expirado se ELIMINA del Telegram
   - Podría guardarse en historial antes de eliminar

---

## 📊 MONITOREO Y REPORTING

### 📍 Archivos: `services/android-status-report.js` y `netlify/functions/android-status-report.js`

**¿Qué hace?**
- Resume estado del sistema: cuántos pending, unverified, verified
- Envía alertas si hay anomalías

**Métricas reportadas:**
```json
{
  "pendingSend": 5,          // Pendientes de enviar
  "sentUnverified": 12,      // Enviados pero no verificados
  "sentVerified": 280,       // Verificados ✅
  "total": 297,
  "health": "healthy"        // healthy | warning | critical
}
```

**Alertas se lanzan si:**
```javascript
1. Total > limit (300)
2. pendingSend > X
3. Tasa de error en verificación > umbral
```

---

## 🎯 RESUMEN FUNCIONAL

| Fase | Función | Entrada | Salida | Duración |
|------|---------|---------|--------|----------|
| 1️⃣ RSS | `buildAndroidRssQueue()` | Feed Reddit | `android_queue` | ~10-30s |
| 2️⃣ Encolado | `checkAndroidDeals()` | `android_queue` | `published_games_android` | ~5-20s |
| 3️⃣ Envío Telegram | `sendAndroidPublication()` | Item cola | Mensaje en canal | ~1-3s por msg |
| 4️⃣ Verificación | `reconcileAndroidPublications()` | `published_games_android` | Estados actualizados | ~25 comparaciones |
| 5️⃣ Expiración | `inferExpiredAndroidFromFeed()` | RSS + Published | `android_expired` | ~5-10s |

---

## 🚨 CRITICIDADES DETECTADAS

### 🔴 CRÍTICA: Falta de comprobación de estatus antes de re-publicar

Cuando un mensaje es deletreado en Telegram, el sistema lo reenvía. PERO:
```javascript
// ❌ RIESGO: Podrías estar reportando el mismo juego múltiples veces
Si messageId se pierde → status = "pending_send"
Siguiente ejecución → Se reenvia
Pero NO se verifica si el juego ACTUAL es el mismo

// ✅ MEJORA: Validar antes de republicar
if (item.id existe en memory YA) {
  // No reenviamos, es viejo
}
```

### 🟠 ALTA: Rate limiting no completamente robusto

```javascript
// HTTP 429 detiene la cola PERO...
if (response.status === 429) {
  // Se difiere automáticamente
  // Pero si pasa de nuevo, se queda atorada
  // sin reintentarse hasta siguiente trigger
}
```

### 🟠 ALTA: No hay invalidación de alias/títulos en Telegram

```javascript
// Si título de juego cambia en Google Play
// Ya no coincidiría en búsqueda titleMatch
// Pero mensaje viejo mantiene título antiguo
```

### 🟡 MEDIA: Eficiencia de verificación baja

```javascript
// Máximo 25 verificaciones/ejecución
// Con 300 juegos = 12 ejecuciones para verificar todos
// En desarrollo es OK, pero en producción podría atrasar
```

---

## ✅ VERIFICACIÓN DE FUNCIONAMIENTO

### 1️⃣ Ver la cola actual:
```bash
# En logs del check-android
"Elementos en memoria actual: 15"
```

### 2️⃣ Verificar mensajes en Telegram:
```bash
# Acciona botones de admin:
/manual-status          # Muestra conteos
/manual-run-all        # Ejecuta un ciclo completo
```

### 3️⃣ Revisar memoria en Netlify Blobs:
```bash
# En Netlify Dashboard → Integrations → Blobs
memory-store:
  ├─ published_games_android
  ├─ published_games_pc
  ├─ android_queue
  ├─ android_expired
  ├─ telegram_sent_messages
  └─ ...
```

### 4️⃣ Monitorear ejecuciones:
```bash
# Ver logs en Netlify Dashboard
# Buscar patrones:
✅ "Publicados: 5 | Expirados: 2"  # Natural
❌ "Rate limit detectado (429)"     # Telegram saturado
❌ "Error de red"                   # Red inestable
```

---

## 📈 RECOMENDACIONES DE MEJORA

### Corto Plazo (1-2 semanas):

1. **Aumentar límite de verificaciones**:
   ```javascript
   ANDROID_MAX_EXISTENCE_CHECK_PER_RUN = 50  // en lugar de 25
   ```

2. **Mejorar logging de expiración**:
   ```javascript
   // Registrar POR QUÉ se expira cada juego
   console.log(`Expirado ${id}: no en RSS, age=${ageHours}h`)
   ```

3. **Validar duplicados antes de enviar**:
   ```javascript
   if (publishedIds.has(id) && status !== "pending_send") {
     continue; // Ya fue enviado, no reenvíes
   }
   ```

### Mediano Plazo (1-2 meses):

1. **Implementar versionado de memoria**:
   ```javascript
   // Guardar snapshots cada hora
   published_games_android_v1, v2, v3...
   // Facilita rollback si algo falla
   ```

2. **Aumentar límite de almacenamiento**:
   ```javascript
   MEMORY_LIMITS.android = 500  // en lugar de 300
   ```

3. **Estadísticas por fuente**:
   ```javascript
   // Saber: ¿cuántos de Reddit vs otros?
   // ¿cuál es el RPM (juegos por minuto)?
   ```

4. **Verificación periódica**:
   ```javascript
   // Re-verificar juegos cada 7 días
   // (no solo cuando se republicación)
   ```

### Largo Plazo (2-3 meses):

1. **Base de datos transaccional**:
   ```javascript
   // Reemplazar Blobs por PostgreSQL
   // Transacciones ACID, rollback automático
   ```

2. **Caché de detalles de juegos**:
   ```javascript
   // No rescrapear cada vez
   // TTL de 24h para título, rating, icon
   ```

3. **Notificaciones en errores**:
   ```javascript
   // Si 5+ re-publicaciones fallan
   // Enviar aviso a admin Telegram
   ```

---

## 🧪 PRUEBAS RECOMENDADAS

### Test de Carga (Fase 2):
```javascript
// Simular 50 juegos en cola → ¿cuántos se envían?
// Esperar: 18 (ANDROID_MAX_PUBLISH_PER_RUN)
```

### Test de Expiración (Fase 5):
```javascript
// RSS vacío → ¿expira todo o aplica protecciones?
// Esperar: NO expira (RSS vacío = minActiveIds no cumple)
```

### Test de Recuperación (Fase 4):
```javascript
// Eliminar mensaje de Telegram manualmente
// Ejecutar verify-android
// Esperar: Se reenvíe automáticamente en siguiente check-android
```

---

## 📝 Conclusión

Tu sistema es **robusto y bien estructurado** con:
- ✅ Deduplicación en múltiples niveles
- ✅ Reintentos y manejo de errores
- ✅ Locks para evitar race conditions
- ✅ Protecciones contra expiración masiva
- ✅ Rastreo granular de mensajes

**PERO** tiene oportunidades de mejora en:
- 🔧 Límites de verificación (25 es bajo para 300 juegos)
- 🔧 Persistencia (Blobs no tiene ACID, no hay rollback)
- 🔧 Visibilidad (Logs podrían ser más granulares)

**Estado General: 8/10 - Producción lista con monitores**
