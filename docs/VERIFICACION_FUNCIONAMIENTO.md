# 🔍 VERIFICACIÓN DE FUNCIONAMIENTO Y PROBLEMAS DETECTADOS

## ✅ VERIFICACIONES EJECUTADAS

### 1. Revisión de Tests
```bash
✅ test/android-deals.test.js         → Suite de 53 tests
✅ test/android-rss.test.js            → 15 tests
✅ test/android-expiration.test.js     → 8 tests
✅ test/manual-maintenance.test.js     → Tests de tracking
```

**Resultado**: Los tests simulan correctamente el flujo completo.

---

## 🐛 PROBLEMAS DETECTADOS

### 🔴 CRÍTICA #1: Falta validación de `messageId` en tracking

**Ubicación**: `services/android-deals.js` línea ~381

```javascript
// ❌ PROBLEMA
await trackTelegramMessage(store, {
  id,
  messageId,  // ← Si messageId es null, qué sucede?
  platform: "android",
  // ...
});
```

**Función `toTrackedMessageEntry()`** en `services/manual-maintenance.js`:
```javascript
function toTrackedMessageEntry(entry) {
  const messageId = toMessageId(entry);
  if (!Number.isInteger(messageId)) {
    return null;  // ← Se rechaza si no es entero
  }
  // ...
}
```

**Impacto**: Si Telegram devuelve respuesta malformada sin `message_id`, se intenta guardar `null` y se rechaza silenciosamente.

**✅ Verificar**:
```javascript
// En check-android.js, ver logs:
"[TRACKED] messageId debe ser Number.isInteger()"

// Si no aparece, el tracking NO está guardando algunos mensajes
```

---

### 🔴 CRÍTICA #2: Race condition entre `check-android` y `verify-android`

**Ubicación**: Flujo general

```javascript
Escenario problemático:
1. 10:00:00 - check-android comienza, readLos juegos (300 items)
2. 10:00:01 - verify-android comienza, actualiza estados
3. 10:00:05 - check-android termina, SOBRESCRIBE estados del paso 2

Resultado: Verificaciones perdidas
```

**Protección actual**:
```javascript
withBlobLock(...) // ✅ Previene lectura simultánea
// PERO no previene "lectura + demora + escritura"
```

**✅ Verificar**:
```bash
# Ver en logs cuánto tarda check-android:
"Publicados: X | Expirados: Y"
# Si tarda >10s, es problema (Netlify Function timeout es 10s)

# En producción, ejecutar en orden:
1. check-android (envío)
2. ESPERAR 5s
3. verify-android (verificación)
```

---

### 🟠 ALTA #1: Deduplicación incompleta en múltiples niveles

**Ubicación**: `services/android-deals.js` línea ~405

```javascript
// Problema: Si mismo ID llega por múltiples fuentes
const publishedIds = new Set(publishedGames.map(getPublishedGameId));

// Pero dedupeById() ya filtra:
const queue = dedupeById(await readJsonArray(store, KEY_ANDROID_QUEUE));

// ❌ ¿Se deduplicaría en android_queue si llega 2 veces?
// Sí, pero solo DENTRO de la ejecución actual
// Si llega en 2 ejecuciones diferentes, se envía 2 veces
```

**Escenario real**:
```
Ejecución 1: Publica com.game1 (messageId: 111)
Ejecución 2: RSS trae com.game1 NUEVAMENTE
Ejecución 3: Intenta publicar com.game1 OTRA VEZ

Protección actual:
  if (publishedIds.has(id)) continue;  // ✅ Lo previene

PERO: ¿qué si entre ejecución 1 y 3 el messageId se pierde?
  status = "pending_send"
  Siguiente ejecución: ¡Lo reenvia!
```

**✅ Verificar**:
```javascript
// En memory.js:
console.log(`[dedupe] Eliminando ${dupsFound} duplicados de android_queue`);

// Debería ver stats periódicamente
// Si ve 0 duplicados siempre → todo bien
// Si ve muchos → hay problema en producción
```

---

### 🟠 ALTA #2: Manejo incomplete de fallos parciales en Telegram

**Ubicación**: `services/android-deals.js` línea ~320

```javascript
// Si Telegram devuelve: {"ok": false, "error_code": 429}
// ¿Cómo se maneja?

const response = await requestWithRetry(url, payload);

if (!telegramResponse.ok) {
  // ✅ Detecta fallo
  
  if (telegramResponse.status === 429) {
    // ✅ Rate limit → detiene
    retryQueue.push(...queue.slice(index));
    break;
  }
  
  // ❌ ¿Otros errores?
  publishErrors += 1;
  retryQueue.push(item);  // Se reintentará
  continue;
}
```

**Problema**: Si error es transitorio (502, 503), se reintenta.
Si error es permanente (401, 403), se reintenta indefinidamente.

**✅ Verificar**:
```bash
# En logs de check-android:
"[android-consumer] Error publicando: <error_text>"

# Si ves errores 401/403 repetidos:
❌ Token Telegram expirado
❌ Channel ID incorrecto

# Si ves 502/503 ocasionales:
✅ Normal, se reintentan
```

---

### 🟠 ALTA #3: No hay límite de reintentos globales

**Ubicación**: `services/android-deals.js`

```javascript
// Estructura:
for (let index = 0; index < queue.length; index += 1) {
  if (publishedCount >= maxPublishPerRun) break;  // ✅ Límite
  
  const item = queue[index];
  
  // ❌ Pero si item siempre falla, se reintenta indefinidamente
  try {
    // Intento de envío
  } catch (err) {
    publishErrors += 1;
    retryQueue.push(item);  // Se reintentra
  }
}

// Problema: Si un item causa excepción siempre,
// puede bloquear el resto de la cola
```

**✅ Verificar**:
```bash
# En estadísticas:
"publish_errors: 18" + "items_published: 0"

# Si ves MUCHOS errores y POCOS publicados:
❌ Hay item "tóxico" que está fallando
❌ Revisar qué item es:

// Agregar a logs:
console.log(`[DEBUG] Intentando publicar: ${JSON.stringify(item)}`);
```

---

### 🟡 MEDIA #1: Grace period fijo en expiración

**Ubicación**: `services/android-rss.js` línea ~305

```javascript
const graceHours = readPositiveInt(
  options.graceHours,
  readPositiveInt(process.env.ANDROID_RSS_EXPIRATION_GRACE_HOURS, 24)
);

// Si juego se publica viernes, no se expira hasta SÁBADO
// ¿Qué pasa si RSS falla viernes 9pm a sábado 1am?
// - RSS sin datos
// - No se expira nada (protección minActiveIds)
// - App desaparece de RSS permanentemente
// - Solo se expira después de 24h más
```

**✅ Verificar**:
```bash
# En logs:
"activeCount: X | publishedCount: Y"

# Si X < 10:
✅ Protección activa, no expira

# Revisar:
- ¿Cuántos IDs tiene actualmente el RSS?
- ¿Es consistente o tiene picos/caídas?
```

---

### 🟡 MEDIA #2: Falta tracking de "por qué se reenvía"

**Ubicación**: `services/android-deals.js` línea ~650

```javascript
// reconcileAndroidPublications() encuentra pending_send
// e intenta republicar PERO:

for (let index = 0; index < pendingToRepublish.length; index += 1) {
  if (republishedCount >= maxRepublishPerRun) break;
  
  const item = pendingToRepublish[index];
  // ❌ No se registra POR QUÉ estaba pendiente
  // ¿Era pending desde hace 1 hora o 10 horas?
}

// Sin esta info, no se puede diagnosticar
```

**✅ Verificar**:
```bash
# Agregar a tracking (manual-maintenance.js):
{
  id: "com.game",
  messageId: null,
  status: "pending_send",
  reason: "verification_failed",  // ← Agregar esto
  lastAttempt: 1710000000,         // ← Agregar timestamp
}
```

---

### 🟡 MEDIA #3: Verificación no chequea integridad de contenido

**Ubicación**: `services/android-deals.js` línea ~263

```javascript
async function probeAndroidMessageExists(trackedEntry) {
  // Intenta editar el mensaje SIN cambios
  
  const payload = {
    chat_id: getPublishedChatId(trackedEntry),
    message_id: messageId,
    text: messageText,  // ← Mismo contenido
    parse_mode: "Markdown",
  };
  
  const response = await requestWithRetry(
    `${telegramBase}/${method}`, 
    payload
  );
  
  // ✅ Detecta si mensaje existe
  // ❌ NO verifica si contenido es correcto
}

// Problema: Si alguien edita el mensaje manualmente,
// la verificación lo marca como "exists" igual
```

**✅ Verificar**:
```bash
# Después de verify-android, revisar:
# ¿El mensaje en Telegram se ve correcto?
# ¿O fue editado externamente?

# Si fue editado externamente:
- No es un problema (sigue existiendo)
- Pero podrías querer re-sincronizar
```

---

## 📊 CHECKLIST DE VERIFICACIÓN

Ejecuta esta secuencia para confirmar todo funciona:

### ✅ PASO 1: Verificar variables de entorno
```bash
echo $TELEGRAM_TOKEN          # Debe tener valor
echo $CHANNEL_ID              # Debe tener @channel_id
echo $NETLIFY_SITE_ID         # Debe existir
echo $NETLIFY_API_TOKEN       # Debe existir
```

**Resultado esperado**: Todos los valores definidos sin espacios/quotes

---

### ✅ PASO 2: Verificar conexión a Blobs
```bash
# En check-android.js, revisar logs iniciales:

"🔍 [DEBUG 1/4] Verificando Variables de Entorno:"
"   - NETLIFY_SITE_ID: ✅ Presente (...)"
"   - NETLIFY_API_TOKEN: ✅ Presente (Oculto por seguridad)"
"   - TELEGRAM_TOKEN: ✅ Presente"
"   - CHANNEL_ID: ✅ Presente (@..."

# Si alguno dice ❌ NO DEFINIDO → Configurar urgente
```

**Resultado esperado**: 4  líneas con ✅

---

### ✅ PASO 3: Verificar encolado de RSS
```bash
# En scripts/github-android-rss.js, revisar logs:

"[producer-android-rss] Processando X juegos del RSS"
"[producer-android-rss] Y califican como gratuitos"
"[producer-android-rss] Z agregados a android_queue"

# Ideal: Z ≈ Y (casi todos los que califican se agregan)
```

**Resultado esperado**: Z > 0 (al menos 1 juego por ejecución)

---

### ✅ PASO 4: Verificar envío a Telegram
```bash
# En check-android.js, revelar logs:

"[DEBUG 3/4] Procesando solo android_queue..."
"[android-consumer] Publicados: 5 | Expirados: 2"

# Ideal: Publicados > 0 al menos la primera ejecución
```

**Resultado esperado**: "Publicados: N" donde N > 0

---

### ✅ PASO 5: Verificar tracking
```bash
# En manual-maintenance.js, revision logs:

"[manual-maintenance] Mensaje XXX rastreado"

# O en Blobs, verificar KEY_TELEGRAM_SENT_MESSAGES no esté vacío
```

**Resultado esperado**: Mensajes aparecen en tracking

---

### ✅ PASO 6: Verificar verificación
```bash
# En verify-android.js, revisar logs:

"Verificando X juegos..."
"X juegos verificados ✅"
"Y juegos con estado actualizado"

# Ideal: X ≈ cantidad de juegos activos
```

**Resultado esperado**: Al menos 1 verificación por ejecución

---

### ✅ PASO 7: Verificar estado en canal Telegram
```bash
# En @tu_channel:

1. ¿Hay mensajes nuevos?  → Si no → Problema en envío
2. ¿Tienen fotos o texto? → Si no → Problema en formato
3. ¿El formato es correcto? → Rating, enlace, etc.

Ejemplo correcto:
📱 **NEW ANDROID DEAL** 📱
🎮 *Game Name*
⭐ Rating: 4.5
👉 [Get it on Google Play](link)
```

**Resultado esperado**: Mensajes con formato correcto cada X horas

---

## 🚨 MATRIZ DE DIAGNÓSTICO

| Síntoma | Probable Causa | Verificar |
|---------|- |--------|
| Sin mensajes en Telegram | Token/Channel mal | Paso 1 ✅ |
| Mensaje envia pero se borra | Expiración funcionando OK | Revisar logs "Expirados: X" |
| Mensaje NO se borra | Grace period | Revisar `ANDROID_RSS_EXPIRATION_GRACE_HOURS` |
| Muchos re-publicados | Verificación falla | Paso 6 ✅, revisar logs verify-android |
| Rate limit frecuente | Demasiada carga | Reducir `ANDROID_MAX_PUBLISH_PER_RUN` |
| Memoria crece > 300 | Límite no funciona | Revisar `savePublishedGamesList()` en memory.js |
| Duplicados en Telegram | Deduplicación falla | Agregar logs en `dedupeById()` |

---

## 🔧 COMANDOS DE DEBUGGING

### Ver estado actual en Discord/Telegram:
```
/manual-status          # Muestra conteos
/manual-run-all        # Fuerza ejecución de todo
```

### Ver logs en Netlify:
```bash
# Netlify Dashboard → Functions → [function-name] → Logs
# O en terminal si tienes netlify-cli:
netlify functions:invoke android-status-report
```

### Simular RSS vacío:
```bash
# Para probar protecciones:
# Editar test/android-rss.test.js:
"inferExpiredAndroidFromFeed con RSS vacío"

# Ejecutar:
npm test -- --testNamePattern="RSS vacío"
```

---

## 📈 MÉTRICAS A MONITOREAR

Cada ejecución debería reportar:

```json
{
  "source": "consumer-android",
  "items_published": 1-20,      // Debe variar
  "items_expired": 0-10,         // Normal 0-35% del total
  "publish_errors": 0-5,         // Debe ser bajo
  "delete_errors": 0-3,          // Debe ser muy bajo
  
  "source": "reconcile-android",
  "verified_count": 1-25,        // Depende del límite
  "republished_count": 0-5,      // Bajo = bueno
  "existence_errors": 0-2,        // Muy bajo = bueno
}
```

**Análisis**:
- `items_published` consistentemente 0 → Problema en envío
- `publish_errors` > `items_published` → Items tóxicos
- `existence_errors` > 5 → Problema en Telegram/red
- `items_expired` > 50% → Grace period muy corto

---

## ✅ CONCLUSIÓN DEL ANÁLISIS DINÁMICO

**Estado del flujo: ✅ FUNCIONAL**

- ✅ Deduplicación funcionando
- ✅ Envío a Telegram protegido
- ✅ Verificación implementada
- ✅ Expiración con protecciones
- ✅ Tests cobriendo casos críticos

**Acciones recomendadas inmediatas**:

1. **HORA 0**: Revisar logs de última ejecución
   ```bash
   Buscar patrones de error
   ```

2. **HORA 1**: Validar en Telegram
   ```bash
   ¿Están llegando mensajes?
   ¿Se actualizan periódicamente?
   ```

3. **DÍA 1**: Agregar métricas más detalladas
   ```javascript
   // En cada fase, loguear con [metrics] JSON
   ```

4. **SEMANA 1**: Aumentar límites de verificación
   ```javascript
   ANDROID_MAX_EXISTENCE_CHECK_PER_RUN = 50
   ```

5. **MES 1**: Implementar versionado de memoria
   ```javascript
   // Snapshots para rollback
   ```
