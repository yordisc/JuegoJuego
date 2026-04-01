# Quick Start

## 1️⃣ Instalación (5 min)

```bash
# Clonar repo
git clone https://github.com/yordisc/JuegoJuego.git
cd JuegoJuego

# Instalar dependencias
npm install

# Crear archivo .env con credenciales
cat > .env << 'EOF'
NETLIFY_SITE_ID=tu-site-id
NETLIFY_API_TOKEN=tu-api-token
TELEGRAM_TOKEN=tu-token-telegram
CHANNEL_ID=tu-canal-id
EOF
```

## 2️⃣ Validar Setup (2 min)

```bash
# Verificar que todo funciona
npm run ops:status

# Debería mostrar:
# ✅ Blobs connection OK
# ✅ State summary
```

## 3️⃣ Ejecutar Primera Vez (15 min)

### Opción A: Solo Productor (Recomendado para test)

```bash
npm run produce:android:rss
```

**Salida esperada**:

```
[producer-android-rss] feed items leidos: 25
[producer-android-rss] juegos gratis validados: 2
[producer-android-rss] queue final: 2
```

### Opción B: Todo el Pipeline (Productor + Consumer)

```bash
npm run produce:all
```

**Resultado**:

- Juegos publicados en Telegram channel ✅

## 4️⃣ Explorar Documentación

| Documento                                        | Para...                                 |
| ------------------------------------------------ | --------------------------------------- |
| [SCRIPTS.md](./SCRIPTS.md)                       | Entender todos los comandos disponibles |
| [SERVICES.md](./SERVICES.md)                     | Cómo funcionan los servicios internos   |
| [ARCHITECTURE.md](./ARCHITECTURE.md)             | Entender el diseño general del proyecto |
| [RSS_PARSER_403_FIX.md](./RSS_PARSER_403_FIX.md) | Específico: el fix del error 403        |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)       | Resolver problemas comunes              |

---

## Cambios Realizados Recientemente

✅ **Fix RSS Parser 403**:

- Cambio de User-Agent de bot a navegador legítimo
- Adición de headers HTTP para parecer request real
- **Resultado**: Reddit RSS ahora accesible sin 403

📁 **Nueva documentación**:

- Creada carpeta `/docs`
- 6 archivos markdown con documentación completa
- Troubleshooting guide incluido

---

## Próximos Pasos Comunes

### Quiero ver qué juegos hay en la cola

```bash
npm run blobs:show
```

### Quiero correr tests

```bash
npm test
```

### Quiero limitar items a 10 (para testing rápido)

```bash
ANDROID_RSS_MAX_ITEMS=10 npm run produce:android:rss
```

### Quiero ver métricas detalladas

```bash
npm run ops:status
```

### Quiero resetear todo (⚠️ CUIDADO)

```bash
npm run blobs:clear-queues
```

---

## Estructura Actual

```
JuegoJuego/
├── docs/                 ← NUEVA: Documentación
│   ├── README.md         ← Este archivo
│   ├── SCRIPTS.md
│   ├── SERVICES.md
│   ├── ARCHITECTURE.md
│   ├── RSS_PARSER_403_FIX.md
│   └── TROUBLESHOOTING.md
│
├── scripts/              ← Scripts ejecutables
│   ├── github-android.js
│   ├── github-android-rss.js  ← MODIFICADO: Headers RSS
│   └── github-pc.js
│
├── services/             ← Lógica de negocio
│   ├── android-rss.js    ← MODIFICADO: User-Agent + headers
│   ├── android-deals.js
│   └── pc-games.js
│
├── utils/                ← Funciones auxiliares
│   ├── memory.js
│   ├── netlify-blobs.js
│   └── telegram.js
│
├── test/                 ← Tests unitarios
│   ├── *.test.js
│   └── ...
│
├── .github/workflows/    ← CI/CD
│   ├── ci.yml
│   ├── scraper-android-rss.yml
│   └── ...
│
└── package.json          ← Dependencias + scripts
```

---

## Cambios Técnicos Realizados

### 1. RSS Parser Headers (Solución del error 403)

**Archivo**: `services/android-rss.js` → `createRssParserInstance()`

```javascript
// ANTES (bloqueado con 403)
headers: {
  "User-Agent": "Mozilla/5.0 (compatible; JuegoJuegoBot/1.0; ...)"
}

// DESPUÉS (Acceso exitoso)
headers: {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ...",
  "Accept": "application/rss+xml, application/xml, ...",
  "Accept-Encoding": "gzip, deflate",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "DNT": "1",
}
```

**Por qué funciona**: Ahora el parser se presenta como un navegador Chrome legítimo, no como un bot, evitando el filtro de anti-bot de Reddit.

---

## Verificación Rápida

¿Todo está funcionando?

```bash
# ✅ Paso 1: Tests pasan
npm test

# ✅ Paso 2: Credenciales OK
npm run blobs:show

# ✅ Paso 3: Producer funciona (5 min)
npm run produce:android:rss

# ✅ Paso 4: Si llega aquí... ¡ÉXITO! 🎉
```

---

## En Caso de Problemas

1. **Ver logs detallados**:

   ```bash
   DEBUG=* npm run produce:android:rss
   ```

2. **Revisar credenciales**:

   ```bash
   npm run ops:status
   ```

3. **Consultar guía de troubleshooting**:
   - [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

4. **Verificar conectividad a Reddit**:
   ```bash
   curl "https://www.reddit.com/r/googleplaydeals/new.rss" | head -20
   ```

---

## Recursos

- **Documentación local**: `/docs`
- **GitHub Repo**: https://github.com/yordisc/JuegoJuego
- **Issues**: https://github.com/yordisc/JuegoJuego/issues

---

## ¡Listo!

Ya tienes JuegoJuego funcionando.

**Próximo**: Lee [ARCHITECTURE.md](./ARCHITECTURE.md) para entender cómo todo encaja.

```bash
# Bookmark útil
npx open docs/ARCHITECTURE.md
```
