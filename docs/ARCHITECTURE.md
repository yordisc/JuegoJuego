# Arquitectura del Proyecto

## Visión General

```
┌─────────────────────────────────────────────────────────────────┐
│                       FUENTES EXTERNAS                          │
├─────────────────────────────────────────────────────────────────┤
│   Reddit RSS    │   Google Play Store   │   Steam API           │
└────────────────┬──────────────────────┬────────────────────────┘
                 │                      │
                 ▼                      ▼
        ┌─────────────────────────────────────────┐
        │      PRODUCTORES (Scraping)             │
        ├──────────────────────────────────────────┤
        │  • android-deals.js (Play Store)        │
        │  • android-rss.js (Reddit)              │
        │  • pc-games.js (Steam)                  │
        └────────────┬──────────────────────────┘
                     │
                     ▼
        ┌─────────────────────────────────────────┐
        │   NETLIFY BLOBS (Almacenamiento)        │
        ├──────────────────────────────────────────┤
        │  • android_queue (Última generación)    │
        │  • pc_queue (Última generación)         │
        │  • published_games_android (Memoria)    │
        │  • published_games_pc (Memoria)         │
        └────────────┬──────────────────────────┘
                     │
                     ▼
        ┌─────────────────────────────────────────┐
        │   CONSUMIDOR (Distribución)             │
        ├──────────────────────────────────────────┤
        │  Publica en Telegram                    │
        │  Actualiza memoria                      │
        └────────────┬──────────────────────────┘
                     │
                     ▼
              ┌─────────────┐
              │  TELEGRAM   │
              │   USERS     │
              └─────────────┘
```

## Componentes Principales

### 1. PRODUCTORES (Scripts)

**Ubicación**: `scripts/github-*.js`  
**Ejecución**: Manual o CI/CD (cron jobs)  
**Responsabilidad**: Extraer datos de fuentes, validar, deduplicar

#### Flujo General de Productor:

```
1. Obtener credenciales de env
   ↓
2. Conectar a Netlify Blobs
   ↓
3. Leer cola actual + memoria
   ↓
4. Scrapeear fuente externa
   ↓
5. Validar y filtrar
   ↓
6. Deduplicar contra memoria
   ↓
7. Escribir nueva cola en Blobs
   ↓
8. Ejecutar Consumidor
   ↓
9. Registrar métricas
```

#### Ejemplo: `github-android-rss.js`

```javascript
const { buildAndroidRssQueue } = require("../services/android-rss");

async function main() {
  const store = getStoreFromEnv(); // Netlify Blobs
  const rssResult = await buildAndroidRssQueue(store, {
    feedUrl: process.env.ANDROID_RSS_FEED_URL,
    maxItems: 50,
  });
  // rssResult contiene { added, queueAfter, etc }
}
```

### 2. SERVICIOS (Lógica de Negocio)

**Ubicación**: `services/*.js`  
**Responsabilidad**: Funciones puras, inyección de dependencias

**Separación de Concerns**:

- Productores: Scraping de Reddit, Play Store, Steam
- Consumidor: Envío a Telegram
- Utilidades: Memory, Blobs, Telegram API

**Patrón de Inyección**:

```javascript
// En en script
const result = await buildAndroidRssQueue(store, {
  feedUrl: URL,
  maxItems: 50,
  parser: mockParser, // inyectable (testing)
  detailsFetcher: mockFetch, // inyectable (testing)
});
```

### 3. ALMACENAMIENTO (Netlify Blobs)

**Ubicación**: Netlify Blobs (en la nube)  
**Responsabilidad**: Persistir estado entre ejecuciones

**Estructura de Datos**:

```
Netlify Blobs
├── android_queue              (Array de 0-50 juegos)
├── android_expired            (Array de juegos expirados)
├── published_games_android    (Array de juegos ya publicados)
├── pc_queue                   (Array de juegos PC)
├── pc_expired
└── published_games_pc
```

**Acceso**:

```javascript
const store = getStore({
  name: "memory-store",
  siteID: process.env.NETLIFY_SITE_ID,
  token: process.env.NETLIFY_API_TOKEN,
});

// Lectura
const queue = JSON.parse((await store.get("android_queue")) || "[]");

// Escritura
await store.setJSON("android_queue", newQueue);
```

### 4. CONSUMIDOR (Distribución)

**Ubicación**: Integrado en scripts  
**Responsabilidad**: Publicar cola en Telegram

**Flujo**:

```
1. Obtener cola de Blobs
   ↓
2. Conectar a Telegram API
   ↓
3. Para cada juego en cola:
   - Formatear mensaje
   - Enviar a canal
   - Registrar messageId
   - Agregar a memoria publicada
   ↓
4. Limpiar cola
   ↓
5. Retornar métricas
```

## Ciclo de Vida

### Ejecución Con Cleanup (RSS)

```
1. [Producer] Lee feed Reddit
   ↓
2. [Producer] Valida detalles en Play Store
   ↓
3. [Producer] Deduplica contra memoria
   ↓
4. [Producer] Escribe android_queue en Blobs
   ↓
5. [Producer] Lee android_expired de Blobs
   ↓
6. [Producer] Infiere expirados (juegos que no están en feed)
   ↓
7. [Producer] Aplica failsafe (no expira >35% en una ejecución)
   ↓
8. [Producer] Escribe android_expired actualizado
   ↓
9. [Consumer] Lee android_queue  ✅ AQUI EMPIEZA CONSUMIDOR
   ↓
10. [Consumer] Publica en Telegram
   ↓
11. [Consumer] Actualiza published_games_android
   ↓
12. [Consumer] Limpia android_queue
```

### Ejecución Sin Cleanup

```
Pasos 1-8 iguales, pero OMITE EXPIRATION:
- No lee android_expired
- No infiere expirados
- Continúa a paso 9 (Consumer)
```

## Dependencias Externas

### APIs Utilizadas

| API                   | Propósito                  | Rate Limit           |
| --------------------- | -------------------------- | -------------------- |
| Google Play Store API | Consultar detalles de apps | 250ms entre requests |
| Reddit RSS            | Feed de ofertas            | Estándar HTTP        |
| Steam Web API         | Juegos gratis PC           | Limitada             |
| Telegram Bot API      | Enviar mensajes            | 30 msg/segundo       |
| Netlify Blobs         | Persistencia               | Unlimited            |

### Manejo de Rate Limits

**Play Store**:

```javascript
// Delay entre requests
await sleep(detailsDelayMs); // default 250ms
```

**Reddit RSS**:

```javascript
// User-Agent + Headers como navegador legítimo
headers: {
  "User-Agent": "Mozilla/5.0 ...",
  "Accept": "application/rss+xml, */*",
  // ... headers adicionales
}
```

**Telegram**:

- Generalmente no hay throttling para canales privados
- Implementar reintentos en caso de error 429

## Manejo de Errores

### Estrategia

1. **No fallar completamente**: Continuar con siguiente item
2. **Registrar contexto**: `console.warn` con identificador
3. **Retornar métricas**: Contar errores en respuesta
4. **Log estructurado**: JSON con `[componente] mensaje`

### Niveles de Log

```
[producer-android-rss]         → Productor RSS
[producer-android-rss-action]  → Script principal
[android-consumer]             → Consumidor
[metrics]                      → Métricas en JSON
```

### Ejemplo: Error en Validación

```javascript
try {
  const details = await detailsFetcher(appId);
  if (!isQualifiedFreeGame(details)) return null;
} catch (err) {
  detailsFailures++;
  console.warn(
    `[producer-android-rss] No se pudo validar ${appId}: ${err.message}`,
  );
  return null; // Continuar con siguiente
}
```

## Deduplicación

### Niveles de Deduplicación

1. **Memory (Publicados)**
   - Evita publicar lo mismo 2 veces
2. **Queue (Actual)**
   - Evita duplicados en misma queue
3. **Ambos**
   - Al construir nueva queue, excluye en memory + queue

```javascript
const knownIds = new Set([
  ...publishedGames.map((e) => e.id),
  ...existingQueue.map((e) => e.id),
]);

// Filtrar nuevos
const newItems = feedItems.filter((item) => !knownIds.has(item.id));
```

## Métricas y Monitoreo

### Métricas Capturadas

```javascript
{
  "source": "producer-android-rss",
  "items_produced": 2,
  "items_expired": 0,
  "publish_errors": 0,
  "delete_errors": 0,
  "details_requests": 24,
  "details_failures": 0
}
```

### Visualización

```bash
npm run ops:status
# Muestra métricas + estado de colas
```

## Escalabilidad

### Limitaciones Actuales

- **Queue max**: 50 items/ejecución (configurable)
- **Details requests**: 250ms delay (evita rate limit)
- **Blobs storage**: Es SaaS de Netlify (ilimitado teóricamente)

### Puntos de Mejora Futuros

1. **Caché local**: Guardar detalles de apps (no revalidar)
2. **Batch consumer**: Publicar múltiples mensajes juntos
3. **Queue prioritization**: Publicar por score (rating)
4. **Múltiples canales**: Telegram + Discord + Email
5. **Métricas persistentes**: BD para histórico

## Configuración por Entorno

### Desarrollo

```env
NODE_ENV=development
NETLIFY_SITE_ID=test-site
NETLIFY_API_TOKEN=test-token
```

### Producción (GitHub Actions)

```yaml
env:
  NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
  NETLIFY_API_TOKEN: ${{ secrets.NETLIFY_API_TOKEN }}
  ANDROID_RSS_MAX_ITEMS: 50
```

## Flujo CI/CD

```
GitHub Actions
├─ test:              npm test (en cada PR)
├─ producer-android-rss: Cada 4 horas (cron)
├─ producer-android:  Diariamente
└─ producer-pc:       Diariamente

Cada ejecución:
1. Checkout
2. Setup Node 24
3. npm ci (install)
4. npm run produce:*
5. Logs → GitHub Blobs
```

Ver `.github/workflows/` para configuración detallada.
