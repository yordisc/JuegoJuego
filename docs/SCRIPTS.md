# Scripts Disponibles

## Productores (Scraping)

### Android - RSS Feed

```bash
npm run produce:android:rss
```

**Descripción**: Lee feed RSS de `/r/googleplaydeals` en Reddit, valida cada juego en Google Play Store y crea cola de nuevos juegos gratis.

**Entrada**: Feed RSS de Reddit  
**Salida**: Cola de juegos en `android_queue` (Netlify Blobs)

**Archivos**:

- Script: `scripts/github-android-rss.js`
- Servicio: `services/android-rss.js`

**Variables de Entorno**:

```env
ANDROID_RSS_FEED_URL=https://www.reddit.com/r/googleplaydeals/new.rss
ANDROID_RSS_MAX_ITEMS=50
ANDROID_RSS_EXPIRATION_ENABLED=true
ANDROID_RSS_EXPIRATION_GRACE_HOURS=24
ANDROID_RSS_MIN_ACTIVE_IDS=10
ANDROID_RSS_MAX_EXPIRE_RATIO=0.35
ANDROID_RSS_DETAILS_DELAY_MS=250
ANDROID_RSS_SKIP_CLEANUP=true
ANDROID_RSS_USER_AGENT=(opcional)
```

Nota: en GitHub Actions se recomienda `ANDROID_RSS_SKIP_CLEANUP=true` para centralizar borrados en `clean-expired`.

**Salida Ejemplo**:

```
[producer-android-rss] feed items leidos: 25
[producer-android-rss] juegos gratis validados: 2
[producer-android-rss] queue final: 2
```

---

### Android - Scanner de Expirados

```bash
npm run produce:android:expired
```

**Descripción**: Revisa la memoria publicada de Android uno por uno en Google Play para detectar si un juego ya no sigue gratis. Si deja de ser gratuito, lo agrega a `android_expired`.

**Entrada**: `published_games_android` (Netlify Blobs)
**Salida**: `android_expired`

**Archivos**:

- Script: `scripts/github-android-expired.js`
- Servicio: `services/android-expiration.js`

**Variables de Entorno**:

```env
ANDROID_EXPIRATION_SCAN_MAX_EXPIRE_RATIO=0.35
ANDROID_EXPIRATION_SCAN_DETAILS_DELAY_MS=750
ANDROID_EXPIRATION_SCAN_SKIP_CLEANUP=true
```

Nota: en GitHub Actions se recomienda mantener `ANDROID_EXPIRATION_SCAN_SKIP_CLEANUP=true` para centralizar borrados en `clean-expired`.

**Cadencia Recomendada**: 2 veces al dia desde GitHub Actions.

---

### Android - Scraping Directo

```bash
npm run produce:android
```

**Descripción**: Scraping automático de juegos gratis en Google Play Store sin depender de feeds externos.

**Entrada**: Google Play Store API  
**Salida**: Cola de juegos en `android_queue`

**Archivos**:

- Script: `scripts/github-android.js`
- Servicio: `services/android-deals.js`

---

### PC - Steam Deals

```bash
npm run produce:pc
```

**Descripción**: Scraping de ofertas de juegos en Steam para PC.

**Entrada**: Steam API/Website  
**Salida**: Cola de juegos en `pc_queue`

**Archivos**:

- Script: `scripts/github-pc.js`
- Servicio: `services/pc-games.js`

---

## Consumidor (Distribución)

### Procesar Colas

El consumidor se ejecuta automáticamente dentro de los productores:

```javascript
// Dentro de android-deals.js, android-rss.js, etc.
const androidConsumer = require("../services/android-consumer");
await androidConsumer(store, {
  /* opciones */
});
```

**Función**: Toma juegos de las colas (`android_queue`, `pc_queue`) y:

1. Publica en Telegram
2. Mueve a memoria publicada
3. Registra métricas

---

## Limpieza y Mantenimiento

### Limpiar Duplicados

```bash
npm run blobs:normalize-memory
```

**Descripción**: Deduplica memoria publicada (en caso de corrupción).

**Archivo**: `scripts/blobs-admin.js`

---

### Ver Estado

```bash
npm run blobs:show
```

**Descripción**: Muestra estadísticas generales de Blobs:

- Tamaño de colas
- Cantidad en memoria
- Últimas métricas

---

### Limpiar Colas

```bash
npm run blobs:clear-queues
```

**Descripción**: Vacía todas las colas (cuidado: datos no recuperables).

---

## Pruebas

### Test Unitarios

```bash
npm test
```

**Descripción**: Ejecuta suite de tests con `node --test`

**Archivos de test**:

- `test/android-deals.test.js`
- `test/android-rss.test.js`
- `test/pc-games.test.js`
- `test/clean-duplicates.test.js`
- `test/memory.test.js`

---

### Smoke Tests

```bash
npm run smoke:producer
```

**Descripción**: Ejecuta todos los productores una vez (`npm run produce:all`)

---

```bash
npm run smoke:verify
```

**Descripción**: Verifica que los productores funcionan y datos están disponibles

---

```bash
npm run smoke:verify:strict
```

**Descripción**: Verificación estricta con más validaciones

---

## Monitoreo

### Status General

```bash
npm run ops:status
```

**Descripción**: Combinación de:

1. `npm run blobs:show` - Estado de almacenamiento
2. `npm run smoke:verify` - Verificación de productores

---

## Ejecución Combinada

### Ejecutar Todos los Productores

```bash
npm run produce:all
```

**Equivalente a**:

```bash
npm run produce:android && npm run produce:android:rss:no-cleanup && npm run produce:pc
```

**Nota**: RSS sin cleanup evita expiraciones múltiples

---

### RSS sin Limpieza

```bash
npm run produce:android:rss:no-cleanup
```

**Descripción**: Produce RSS pero omite la lógica de expiración

---

## Referencia Rápida

| Comando                       | Propósito                   | Duración  |
| ----------------------------- | --------------------------- | --------- |
| `npm run produce:android`     | Scraping directo Play Store | 5-10 min  |
| `npm run produce:android:rss` | Feed RSS Reddit             | 3-5 min   |
| `npm run produce:pc`          | Steam deals                 | 5-10 min  |
| `npm test`                    | Pruebas unitarias           | 1-2 min   |
| `npm run smoke:producer`      | Smoke test productores      | 20-30 min |
| `npm run ops:status`          | Estado general              | 2-3 min   |

---

## CI/CD

Los scripts se ejecutan automáticamente en GitHub Actions:

- **CI**: Tests corridos en cada push/PR
- **Producer Android RSS**: Cada 4 horas (cron job)
- **Producer Android**: Diariamente
- **Producer PC**: Diariamente

Ver `.github/workflows/` para configuración.
