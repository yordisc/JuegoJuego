# 🤖 JuegosJuegos Bot | Free Games Aggregator

[![Node.js](https://img.shields.io/badge/Node.js-20.x-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Netlify](https://img.shields.io/badge/Netlify-Functions-00C7B7?style=flat-square&logo=netlify)](https://app.netlify.com/)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-GitHub_Actions-2088FF?style=flat-square&logo=github-actions)](https://github.com/features/actions)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-2CA5E0?style=flat-square&logo=telegram)](https://t.me/JuegosJuegosGratis)

Agregador de juegos **100% gratis** (Android + PC) publicado en Telegram. Arquitectura **serverless de bajo costo** ($0/mes) usando **Netlify Functions + GitHub Actions**.

---

## 🎯 Features

- ✅ **Monitoreo 24/7** de juegos gratis (Android + PC)
- ✅ **100% Serverless** - Sin servidor dedicado
- ✅ **Costo: $0/mes** - Usando < 1% del free tier
- ✅ **Deduplicación automática** - Por ID y nombre
- ✅ **Tests offline** - TDD con mocking avanzado
- ✅ **Resiliencia** - Locks distribuidos, reintentos exponenciales
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

**Resumen**: Productores buscan juegos (GitHub, sin timeout) → Consumidores publican (Netlify, <5s) → Storage en Blobs (<1 MB).

---

## 🚀 Quick Start

```bash
git clone <repo>
npm install
cp .env.example .env

npm test                      # Ejecutar tests
npm run smoke:producer        # Simular productores
npm run blobs:show            # Ver estado
```

---

## 🔑 Cómo Funciona

- **Separación de tareas**: Producción pesada en GitHub Actions, publicación ligera en Netlify
- **Deduplicación**: Por ID, nombre normalizado, y tiempo (24h grace period)
- **Concurrencia segura**: Locks distribuidos previenen corrupción
- **Código confiable**: Tests 100% offline sin dependencias de red

👉 **Detalles técnicos completos**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## ⚙️ Configuración (4 variables)

```bash
NETLIFY_SITE_ID=<your-site>
NETLIFY_API_TOKEN=<your-token>
TELEGRAM_TOKEN=<your-bot>
CHANNEL_ID=@your_channel
```

👉 **Más variables (opcionales y tuning)**: [docs/QUICK_START.md](docs/QUICK_START.md)

### Watchlist Android por JSON (alertas Telegram)

Si quieres alertas especiales cuando aparezcan juegos concretos en el scraper Android, edita [config/android-discount-watchlist.json](config/android-discount-watchlist.json):

```json
{
  "games": [
    "Balatro",
    {
      "name": "Minecraft",
      "aliases": ["Minecraft PE", "Minecraft Pocket Edition"],
      "match": "word"
    }
  ]
}
```

Cuando un juego nuevo de `android_queue` tenga un titulo que coincida con la watchlist, el bot enviara un mensaje adicional al mismo `CHANNEL_ID`, con el mismo estilo de formato de los mensajes Android normales.

Reglas de matching:

- `"Balatro"` usa `includes` por defecto.
- Objeto con `match` permite `includes`, `exact` o `word`.
- `aliases` agrega variantes del nombre para detectar posts del scraper.

Anti-duplicado de alertas:

- Se guarda historial por `app id` y no se reenvia alerta del mismo juego hasta que pase el cooldown.

Variables opcionales:

- `ANDROID_WATCHLIST_ENABLED=true|false` (default: `true`)
- `ANDROID_WATCHLIST_PATH=/ruta/al/watchlist.json` (default: `config/android-discount-watchlist.json`)
- `ANDROID_WATCHLIST_ALERT_COOLDOWN_HOURS=24` (default: `24`)

---

## 📊 Números Reales

- **Ejecución**: 3-5 segundos (< 10s limit de Netlify)
- **Costo**: 0.6 horas/mes (< 1 % del free tier)
- **Storage**: < 1 MB en Blobs
- **Confiabilidad**: 99.5%

---

## 📚 Documentación

| Doc                                          | Propósito                 |
| -------------------------------------------- | ------------------------- |
| [docs/INDEX.md](docs/INDEX.md)               | Índice y navegación       |
| [docs/QUICK_START.md](docs/QUICK_START.md)   | Setup y operación diaria  |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Detalles técnicos         |
| [docs/ai-context/](docs/ai-context/)         | Para IAs y devs avanzados |

---

## 🐛 Troubleshooting

| Problema              | Solución                                  |
| --------------------- | ----------------------------------------- |
| Cola no se vacía      | Revisa errores de Telegram en logs        |
| 429 Too Many Requests | Reduce `ANDROID_MAX_PUBLISH_PER_RUN` a 12 |
| Memoria corrupta      | `npm run blobs:normalize-memory`          |

👉 **Más casos**: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

---

## 💻 Stack

**Node.js 20.x** · **Netlify Functions + Blobs** · **GitHub Actions** · **Telegram Bot API**

---

## 📄 Licencia

MIT

---

**Comienza aquí**: [docs/INDEX.md](docs/INDEX.md) | **Para IAs**: [docs/ai-context/COMPLETE_GUIDE.md](docs/ai-context/COMPLETE_GUIDE.md)
