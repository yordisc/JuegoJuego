# 🤖 JuegosJuegos Bot | Free Games Aggregator

[![Node.js](https://img.shields.io/badge/Node.js-20.x-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Netlify](https://img.shields.io/badge/Netlify-Functions-00C7B7?style=flat-square&logo=netlify)](https://app.netlify.com/)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-GitHub_Actions-2088FF?style=flat-square&logo=github-actions)](https://github.com/features/actions)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-2CA5E0?style=flat-square&logo=telegram)](https://t.me/JuegosJuegosGratis)

Agregador de juegos **100% gratis** (Android + PC) publicado en Telegram. Arquitectura **serverless de bajo costo** ($0/mes) usando **Netlify Functions + GitHub Actions**.

---

## 🎯 Características

- ✅ **Monitoreo 24/7** de juegos gratis en Android (Google Play) y PC (GamerPower)
- ✅ **100% Serverless** - Netlify Functions + GitHub Actions (sin servidor dedicado)
- ✅ **Costo: $0/mes** - Usando 0.6% de cuota gratuita de compute
- ✅ **Deduplicación automática** - Por ID y nombre normalizado
- ✅ **Tests offline** - TDD con mocking avanzado de APIs externas
- ✅ **Resiliencia** - Locks distribuidos, reintentos con backoff exponencial
- ✅ **Limpieza automática** - Expiración y garbage collection

---

## 🏗️ Arquitectura

```
PRODUCTORES (GitHub Actions)              CONSUMIDORES (Netlify Functions)
├─ Google Play → Queue                     ├─ check-android (cada 20min)
├─ Reddit RSS → Queue                      ├─ check-pc (cada 12h)
└─ Android Direct → Queue                  ├─ verify-[platform] (diario)
         ↓                                  ├─ clean-expired (cada 30min)
    android_queue                          └─ clean-duplicates (cada 12h)
    pc_queue                                     ↓
    (Netlify Blobs)              Telegram (@JuegosJuegosGratis)
```

**Arquitectura híbrida productor-consumidor**:
- Productores pesados corren en **GitHub Actions** (sin timeout)
- Consumidores ligeros corren en **Netlify Functions** (< 5 segundos)
- Estado compartido en **Netlify Blobs** (< 1 MB)

---

## 🚀 Quick Start

### Setup local

```bash
git clone <repo>
npm install
cp .env.example .env
# Edita .env con tu NETLIFY_SITE_ID, NETLIFY_API_TOKEN, TELEGRAM_TOKEN, CHANNEL_ID
```

### Tests

```bash
npm test                          # Suite completa
npm test -- --testNamePattern="android"  # Solo Android
```

### Desarrollo

```bash
npm run smoke:producer            # Simular productores localmente
npm run blobs:show                # Ver estado actual
npm run blobs:normalize-memory    # Restaurar si hay corrupción
```

---

## 📊 Decisiones Arquitectónicas

### 1. Productor-Consumidor Desacoplado
- **Beneficio**: Productores no limitados por timeout de Functions (15s limit)
- **Beneficio**: Escalabilidad independiente de componentes
- **Tradeoff**: Complejidad operativa (sincronización de estado)

### 2. Deduplicación Multi-nivel  
- **Por ID**: Primera línea de defensa
- **Por nombre normalizado**: Detecta cambios de título
- **Protección temporal**: Grace period de 24h antes de expirar
- **Ratio máximo**: No expira > 35% en una corrida (protección contra purgas masivas)

### 3. Locks Distribuidos
- **TTL 5 segundos**: Respeta timeout de Netlify
- **Reintentos exponenciales**: Manejo de contención
- **Atomicidad**: Una sola corrida accede a estado a la vez

### 4. Testing 100% Offline
- **Mock avanzado**: APIs de Telegram, Google Play, GamerPower
- **CI/CD rápido**: Tests en milisegundos sin dependencia de red
- **Cobertura**: Todos los caminos críticos validados

---

## 📁 Estructura del Proyecto

```
├─ docs/
│  ├─ INDEX.md                    ← START HERE para documentación completa
│  ├─ ARCHITECTURE.md             (Detalles técnicos para desarrolladores)
│  ├─ QUICK_START.md              (Setup y operación diaria)
│  └─ ai-context/
│     └─ COMPLETE_GUIDE.md        (Toda la info que una IA necesita)
├─ scripts/                       (Productores: GitHub Actions)
│  ├─ github-android.js
│  ├─ github-android-rss.js
│  ├─ github-pc.js
│  └─ blobs-admin.js
├─ netlify/functions/             (Consumidores: Netlify Functions)
│  ├─ check-android.js
│  ├─ check-pc.js
│  ├─ clean-expired.js
│  └─ ...
├─ services/                      (Lógica de negocio reutilizable)
│  ├─ android-deals.js
│  ├─ pc-games.js
│  └─ ...
├─ utils/                         (Utilidades)
│  ├─ memory.js           (Abstracción de Netlify Blobs)
│  ├─ telegram.js         (Bot API wrapper)
│  ├─ blob-lock.js        (Locks distribuido)
│  └─ netlify-blobs.js
└─ test/                          (Suite de tests offline)
   ├─ android-deals.test.js
   └─ ...
```

---

## 🔧 Configuración

**Variables de entorno críticas**:

```bash
# Netlify Blobs (almacenamiento)
NETLIFY_SITE_ID=<your-site-id>
NETLIFY_API_TOKEN=<your-api-token>

# Telegram
TELEGRAM_TOKEN=<your-bot-token>
CHANNEL_ID=@your_channel_id

# Tuning (opcional)
ANDROID_MAX_PUBLISH_PER_RUN=18           # default: 18
ANDROID_MAX_EXISTENCE_CHECK_PER_RUN=50   # default: 50
ANDROID_STATE_LOCK_TTL_MS=5000           # default: 5s
MANUAL_FUNCTION_KEY=<optional-auth-key>
```

Ver [docs/INDEX.md](docs/INDEX.md) para todos los parámetros.

---

## 📈 Rendimiento Observado

- **Tiempo de ejecución**: 3-5 segundos (< 10s limit de Netlify)
- **Cómputo usado**: 0.6 horas/mes (< 1% del free tier)
- **Almacenamiento**: < 1 MB en Blobs
- **Confiabilidad**: 99.5% (con sistema de locks y reintentos)

---

## 🧪 Operación

### Ver estado actual
```bash
npm run blobs:show
```

### Forzar ejecución del productor
```bash
npm run smoke:producer
```

### Limpiar duplicados
```bash
npm run blobs:normalize-memory
```

### Ejecutar tests
```bash
npm test
```

---

## 📚 Documentación

| Documento | Propósito |
|-----------|-----------|
| [docs/INDEX.md](docs/INDEX.md) | Índice y navegación |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura técnica |
| [docs/QUICK_START.md](docs/QUICK_START.md) | Setup y operación diaria |
| [docs/ai-context/](docs/ai-context/) | Info para trabajar con IA |

---

## 🐛 Troubleshooting

**Cola no se vacía**
- Revisa errores de Telegram en logs (`npm run ops:status`)
- Items fallidos se re-encolan automáticamente

**Too Many Requests (429)**
- Reduce `ANDROID_MAX_PUBLISH_PER_RUN` a 15-18
- Los items se difieren al siguiente ciclo

**Memoria corrupta**
- Ejecuta: `npm run blobs:normalize-memory`

---

## 📝 Stack

- **Backend**: Node.js 20.x, ES Modules
- **Cloud**: Netlify Functions (AWS Lambda), Netlify Blobs
- **CI/CD**: GitHub Actions
- **Tests**: Node.js native test runner
- **Bot**: Telegram Bot API
- **Scrapers**: google-play-scraper

---

## 📄 Licencia

MIT

---

**Para desarrolladores e IAs**: Ver [docs/INDEX.md](docs/INDEX.md) para documentación completa y referencias técnicas.
