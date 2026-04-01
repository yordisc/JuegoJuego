# Documentación - JuegoJuego

## 🚀 Empezar Rápido

**Nuevo en el proyecto?** → [Quick Start](./QUICK_START.md) (5 min de setup)

---

## 📚 Índice Completo

### Para Principiantes

1. **[Quick Start](./QUICK_START.md)** - Instalación y primeros pasos (5-15 min)
2. **[SCRIPTS.md](./SCRIPTS.md)** - Todos los comandos disponibles

### Para Entender el Proyecto

3. **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Estructura general y flujos
4. **[SERVICES.md](./SERVICES.md)** - Servicios y componentes internos

### Para Resolver Problemas

5. **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Solucionar errores comunes
6. **[RSS_PARSER_403_FIX.md](./RSS_PARSER_403_FIX.md)** - Específico: Error 403 de Reddit RSS

---

## Resumen Rápido

**JuegoJuego** es un sistema de scraping y distribución de ofertas de juegos:

- 🤖 **Productores**: Extraen información de diferentes fuentes (Reddit RSS, Play Store, etc.)
- 📦 **Cola**: Almacena los juegos procesados en Netlify Blobs
- 📱 **Consumidor**: Publica los juegos en Telegram
- 🧹 **Limpieza**: Mantiene la base de datos actualizada eliminando duplicados y expirados

## Requisitos

- Node.js 24+
- npm 10+
- Dependencias: `npm install`

## Configuración de Ambiente

Se requieren las siguientes variables en `.env`:

```env
NETLIFY_SITE_ID=<tu-site-id>
NETLIFY_API_TOKEN=<tu-api-token>
TELEGRAM_TOKEN=<tu-token-telegram>
CHANNEL_ID=<tu-canal-id>
```

Para el productor RSS (opcional):

```env
ANDROID_RSS_FEED_URL=https://www.reddit.com/r/googleplaydeals/new.rss
ANDROID_RSS_MAX_ITEMS=50
ANDROID_RSS_EXPIRATION_ENABLED=true
ANDROID_RSS_EXPIRATION_GRACE_HOURS=24
ANDROID_RSS_MIN_ACTIVE_IDS=10
ANDROID_RSS_MAX_EXPIRE_RATIO=0.35
ANDROID_RSS_DETAILS_DELAY_MS=250
```
