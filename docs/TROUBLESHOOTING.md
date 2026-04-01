# Troubleshooting y Configuración

## Problemas Comunes

### 1. Error: "NETLIFY_SITE_ID o NETLIFY_API_TOKEN no definidos"

**Síntoma**:

```
Error: Faltan NETLIFY_SITE_ID o NETLIFY_API_TOKEN para escribir en Blobs
```

**Causa**: Variables de entorno no configuradas

**Solución**:

1. Crear `.env` en raíz:

```env
NETLIFY_SITE_ID=tu-site-id-aqui
NETLIFY_API_TOKEN=tu-api-token-aqui
TELEGRAM_TOKEN=tu-token-aqui
CHANNEL_ID=tu-canal-id-aqui
```

2. Obtener credenciales:
   - **NETLIFY_SITE_ID**: Dashboard Netlify → Team overview → Site ID
   - **NETLIFY_API_TOKEN**: Netlify → User settings → Applications → Tokens → New token (scopes: "blobs:read", "blobs:write")

3. Validar formato:

```bash
npm run blobs:show
```

---

### 2. Error: Status code 403 (RSS Parser)

**Síntoma**:

```
Error: Status code 403
at ClientRequest (rss-parser/lib/parser.js:88:25)
```

**Causa**: Reddit o API externa bloqueando bot

**Solución**: ✅ Ya corregido en este proyecto

- User-Agent cambiado a navegador legítimo
- Headers HTTP añadidos (Accept, Encoding, Language)

Ver [RSS_PARSER_403_FIX.md](./RSS_PARSER_403_FIX.md)

**Si persiste**:

1. Validar conectividad:

```bash
curl -I "https://www.reddit.com/r/googleplaydeals/new.rss"
```

2. Verificar headers:

```bash
curl -v "https://www.reddit.com/r/googleplaydeals/new.rss" 2>&1 | grep "User-Agent"
```

---

### 3. Error: "Cannot find module 'rss-parser'"

**Síntoma**:

```
Error: Cannot find module 'rss-parser'
```

**Causa**: Dependencias no instaladas

**Solución**:

```bash
npm install
```

---

### 4. Error: "No se pudo validar {appId} en Play Store"

**Síntoma**:

```
[producer-android-rss] No se pudo validar com.example.app: Error...
```

**Causa**:

- App fue removida de Play Store
- Temporalmente no disponible
- Problema de conectividad

**Acción**: El sistema continúa normalmente. Este error se registra pero no detiene:

- Otros apps se validan correctamente
- se retorna métrica `details_failures`

**Verificar**:

```bash
npm run smoke:verify
```

---

### 5. Error: "Credenciales Netlify formato inválido"

**Síntoma**:

```
Blob write failed: 401 Unauthorized
```

**Causa**:

- NETLIFY_API_TOKEN es una SSH key o PEM (no es token de Blobs)
- Token expirado
- Espacios en blanco en variables

**Solución**:

1. Validar que sea token (no clave SSH):

```bash
# ❌ INCORRECTO (SSH key)
NETLIFY_API_TOKEN="ssh-rsa AAAAB3NzaC1y..."

# ✅ CORRECTO (token)
NETLIFY_API_TOKEN="nfp_AbCdEfGhIjKlMnOpQrStUvWxYz..."
```

2. Generar nuevo token:
   - Netlify Dashboard → User settings → Applications → Tokens
   - Create token → Seleccionar scopes "blobs:read" y "blobs:write"

3. Verificar sin espacios:

```bash
# Mostrar primeros/últimos 5 caracteres
echo "${NETLIFY_API_TOKEN:0:5}...${NETLIFY_API_TOKEN: -5}"
```

---

### 6. Queue vacía después de ejecutar productor

**Síntoma**:

```
queue final: 0
```

**Posibles Causas**:

1. **Feed vacío** (Reddit sin ofertas)
   - Esto es normal en ciertos períodos
2. **Todos duplicados** (ya en memory)
   - Verificar: `npm run blobs:show`
3. **Validación muy estricta**
   - Ver umbrales en env vars ANDROID_RSS_MIN_ACTIVE_IDS

**Verificación**:

```bash
# Ver estado actual
npm run blobs:show

# Ver detalles de RSS
npm run produce:android:rss -- --verbose
```

---

### 7. Telegram no recibe mensajes

**Síntoma**:

- Queue tiene items pero no se publican en Telegram
- Logs: "Consumer: 0 published"

**Causas Posibles**:

1. **TELEGRAM_TOKEN inválido**

```bash
curl "https://api.telegram.org/bot{TOKEN}/getMe"
# Si error 401 → token inválido
```

2. **CHANNEL_ID incorrecto**
   - Canal: `-100{NUMERIC_ID}` (incluir -100)
   - Verificar que bot sea admin del canal

3. **Bot no es admin del canal**
   - Telegram Desktop → Add administrator
   - Permisos: "Send Messages", "Edit Messages"

**Solución**:

```bash
# Obtener info del bot
curl "https://api.telegram.org/bot$TELEGRAM_TOKEN/getMe" | jq

# Verificar canal
curl "https://api.telegram.org/bot$TELEGRAM_TOKEN/getChat?chat_id=$CHANNEL_ID" | jq
```

---

### 8. Duplicados en cola

**Síntoma**:

```
Queue tiene mismo juego 2+ veces
```

**Causa**: Deduplicación falló (bug raro)

**Solución**:

```bash
# Limpiar duplicados
npm run blobs:normalize-memory

# Verificar
npm run blobs:show
```

---

### 9. Script lento o timeout

**Síntoma**:

- Tarda >30 min
- Timeout en CI/CD

**Optimizaciones**:

1. **Reducir MaxItems**:

```env
ANDROID_RSS_MAX_ITEMS=25  # default 50
```

2. **Aumentar Delay entre requests** pero reducir timeout global:

```env
ANDROID_RSS_DETAILS_DELAY_MS=500  # default 250ms
ANDROID_RSS_FEED_TIMEOUT_MS=10000 # timeout individual
```

3. **Usar productor simple** (no RSS):

```bash
npm run produce:android  # Sin validación Play Store
```

---

## Configuración Avanzada

### Variables de Entorno

#### Productor RSS

```env
# Fuente del feed
ANDROID_RSS_FEED_URL=https://www.reddit.com/r/googleplaydeals/new.rss

# Límites
ANDROID_RSS_MAX_ITEMS=50
ANDROID_RSS_MIN_ACTIVE_IDS=10
ANDROID_RSS_MAX_EXPIRE_RATIO=0.35

# Timing
ANDROID_RSS_DETAILS_DELAY_MS=250
ANDROID_RSS_EXPIRATION_GRACE_HOURS=24

# Control
ANDROID_RSS_EXPIRATION_ENABLED=true
ANDROID_RSS_SKIP_CLEANUP=false

# Headers (opcional)
ANDROID_RSS_USER_AGENT=Mozilla/5.0 (X11; Linux x86_64) ...
```

#### Telegram

```env
TELEGRAM_TOKEN=123456789:ABCdEfGhIjKlMnOpQrStUvWxYz123456789
CHANNEL_ID=-100123456789  # Incluir -100 para grupos/canales
```

#### Netlify

```env
NETLIFY_SITE_ID=abc123def456
NETLIFY_API_TOKEN=nfp_AbCdEfGhIj...
```

### Activación de Modo Debug

Añadir logging verbose en desarrollo:

```javascript
// En tu script
process.env.DEBUG = "producer-*";
console.log("DEBUG MODE ON");
```

Luego ejecutar:

```bash
DEBUG=producer-* npm run produce:android:rss
```

---

## Performance

### Benchmarks Típicos

| Operación           | Tiempo                          |
| ------------------- | ------------------------------- |
| Read RSS feed       | 2-3 seg                         |
| Validate 24 apps    | 6-10 seg (250ms delay cada uno) |
| Publish to Telegram | 2-5 seg                         |
| **Total ejecución** | **10-18 seg**                   |

### Optimizaciones

1. **Paralelizar requests** (actualmente secuencial)
   - Riesgo: rate limits
2. **Caché de detalles** (guardar metadata localmente)
   - Después que sea más "stale" con tiempo
3. **Usa productor rápido** (sin validar detalles)

```bash
npm run produce:android  # 5-8 seg
```

---

## Monitoreo Continuo

### Health Check

```bash
# Verificar todo functiona
npm run smoke:verify

# Salida esperada:
# ✅ Producer outputs OK
# ✅ Blobs readable
# ✅ Telegram connected
```

### Ver Metrics

```bash
npm run ops:status

# Muestra:
# - Queue sizes
# - Published counts
# - Last execution time
# - Error counts
```

### Ver Últimas Ejecuciones

```bash
# GitHub Actions (si CI/CD)
gh run list --repo yordisc/JuegoJuego --limit 10

# Logs locales en .env
cat .env | grep NETLIFY  # ver si credenciales están ok
```

---

## Resetear Estado

⚠️ **Cuidado**: Estas operaciones NO son reversibles

### Limpiar Colas

```bash
npm run blobs:clear-queues
# Vaciá: android_queue, pc_queue, etc.
```

### Resetear Memory

```bash
# Debe hacerse manualmente en Netlify Dashboard
# O escribir script custom
```

### Forzar Revalidación

```bash
ANDROID_RSS_SKIP_CLEANUP=1 npm run produce:android:rss
# Publica mismo juego otra vez si está en queue
```

---

## Recursos Útiles

- [Netlify Blobs Docs](https://docs.netlify.com/blobs/overview/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [rss-parser npm](https://www.npmjs.com/package/rss-parser)
- [Google Play Scraper](https://www.npmjs.com/package/google-play-scraper)

---

## Contacto y Soporte

Para issues:

1. Revisar [ARCHITECTURE.md](./ARCHITECTURE.md)
2. Verificar logs en GitHub Actions
3. Testear localmente con `npm run smoke:verify`
4. Abrir issue en GitHub con:
   - Error exacto (no token/credenciales)
   - Pasos para reproducir
   - Versión de Node: `node --version`
