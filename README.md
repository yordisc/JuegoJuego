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

## � Clave del Proyecto

- **Productor-Consumidor**: Separa scraping pesado (GitHub Actions) de publicación ligera (Netlify)
- **Deduplicación Multi-nivel**: Por ID, nombre normalizado y tiempo
- **Locks Distribuidos**: Sincronización entre componentes sin datos corruptos
- **Tests 100% Offline**: Validación sin dependencia de APIs externas

👉 **Detalles técnicos en**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## 📁 Estructura

Todo está organizado en carpetas lógicas:

- `scripts/` - Productores (GitHub Actions)
- `netlify/functions/` - Consumidores & limpiezas (Netlify)
- `services/` - Lógica compartida
- `utils/` - Helpers (storage, Telegram, locks)
- `test/` - Tests offline
- `docs/` - Documentación técnica

👉 **Exploración completa**: [docs/INDEX.md](docs/INDEX.md)

---

## ⚙️ Configuración

**Necesita 4 variables de entorno**:

- `NETLIFY_SITE_ID` - Tu site en Netlify
- `NETLIFY_API_TOKEN` - Token de acceso Netlify
- `TELEGRAM_TOKEN` - Token del bot de Telegram
- `CHANNEL_ID` - ID del canal donde publicar

👉 **Variables opcionales y tuning**: [docs/QUICK_START.md](docs/QUICK_START.md)

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

| Documento                                    | Propósito                 |
| -------------------------------------------- | ------------------------- |
| [docs/INDEX.md](docs/INDEX.md)               | Índice y navegación       |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura técnica      |
| [docs/QUICK_START.md](docs/QUICK_START.md)   | Setup y operación diaria  |
| [docs/ai-context/](docs/ai-context/)         | Info para trabajar con IA |

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

## � Stack

**Backend**: Node.js 20.x  
**Cloud**: Netlify Functions + Blobs  
**CI/CD**: GitHub Actions  
**Bot**: Telegram Bot API de Telegram en logs |
| Too Many Requests (429) | Reduce `ANDROID_MAX_PUBLISH_PER_RUN` a 12-15 |
| Memoria corrupta | `npm run blobs:normalize-memory` |

👉 **Más casos**: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)es e IAs\*\*: [docs/INDEX.md](docs/INDEX.md)

3. **Scanner de Expirados Android (GitHub Actions):**

- Ejecuta `scripts/github-android-expired.js` dos veces al dia.
- Recorre `published_games_android` uno por uno en Google Play para verificar si siguen gratis.
- Si un juego ya no esta gratis, se agrega a `android_expired`.
- Mantiene el RSS como segunda senal de expiracion: `android_expired` puede recibir entradas desde el feed y desde esta verificacion directa.
- Usa guardas operativas para evitar falsos positivos masivos y permite desactivar la limpieza inmediata si hace falta.

4. **Consumidor (Netlify Functions):**

- `check-android` y `check-pc` publican novedades desde sus colas.
- `clean-expired` es el unico proceso que elimina en Telegram los juegos expirados de Android y PC.
- Cada corrida limpia sus colas procesadas al finalizar.

5. **Reconciliador Diario Android (Netlify Functions):**

- `verify-android-publications` corre 1 vez al dia para reconciliar la memoria Android con el tracking de Telegram.
- Verifica existencia por `id` y por nombre normalizado (`titleMatch`) contra `telegram_sent_messages`.
- Incluye verificacion activa en Telegram para mensajes Android rastreados; si un mensaje fue borrado manualmente del canal, se marca como faltante y se republica automaticamente.
- Si detecta juegos en memoria sin envio confirmado, intenta publicarlos y actualizar estado.

Control de verificacion activa por corrida:

- `ANDROID_MAX_EXISTENCE_CHECK_PER_RUN` (default: `50`): limite de mensajes Android verificados en Telegram por ejecucion para evitar saturacion.

Estados de publicacion Android (`published_games_android`):

- `pending_send`: juego en memoria aun no enviado.
- `sent_unverified`: juego enviado, pendiente de verificacion en tracking.
- `sent_verified`: juego enviado y verificado en tracking.

6. **Reporte Diario + Alerta (Netlify Functions):**

- `android-status-report` genera un resumen diario de estados Android.
- Si detecta `pending_send` o `sent_unverified` por encima de umbral, envia alerta por Telegram.
- Variables opcionales:
  - `ANDROID_STATUS_ALERT_ENABLED` (default: `true`)
  - `ANDROID_STATUS_ALERT_CHAT_ID` (si no existe, usa `CHANNEL_ID`)
  - `ANDROID_STATUS_ALERT_PENDING_THRESHOLD` (default: `1`)
  - `ANDROID_STATUS_ALERT_UNVERIFIED_THRESHOLD` (default: `1`)

7. **Reconciliador Diario PC (Netlify Functions):**

- `verify-pc-publications` corre 1 vez al dia para reconciliar `published_games_pc` con el tracking de Telegram.
- Si un mensaje PC rastreado fue borrado manualmente del canal, se detecta como faltante y se republica automaticamente.
- Limites operativos opcionales:
  - `PC_MAX_EXISTENCE_CHECK_PER_RUN` (default: `25`)
  - `PC_MAX_REPUBLISH_PER_RUN` (default: `25`)

8. **Reporte Diario + Alerta PC (Netlify Functions):**

- `pc-status-report` genera un resumen diario de estados PC.
- Si detecta `pending_send` o `sent_unverified` por encima de umbral, envia alerta por Telegram.
- Variables opcionales:
  - `PC_STATUS_ALERT_ENABLED` (default: `true`)
  - `PC_STATUS_ALERT_CHAT_ID` (si no existe, usa `CHANNEL_ID`)
  - `PC_STATUS_ALERT_PENDING_THRESHOLD` (default: `1`)
  - `PC_STATUS_ALERT_UNVERIFIED_THRESHOLD` (default: `1`)

Métricas mínimas en logs:

- `items_produced`
- `items_published`

---

**Documentación completa para desarrolladores e IAs**: [docs/INDEX.md](docs/INDEX.md)

Prerequisitos:

Pasos:

1. Ejecutar manualmente estos workflows:

2. Verificar colas en Blobs:
   - `npm run blobs:show`
3. Ejecutar funciones consumidoras en Netlify (scheduler o trigger manual).
4. Verificar en Telegram:
   - Publicaciones nuevas.

5. Revisar logs buscando líneas `[metrics]`.

## 🛠️ Runbook Rápido

### Reprocesar colas

`manual-status` incluye el último resultado del smoke en un bloque `deleteSmoke`, para que la corrida semanal te diga si el borrado real pasó o falló.

Si quieres reprocesar publicaciones/expirados, vuelve a disparar el productor:

```bash
npm run smoke:producer
```

`smoke:producer` incluye Android + Android RSS (sin cleanup de Telegram) + PC.

Luego ejecuta el consumidor (vía Netlify).

### Vaciar colas manualmente

```bash
npm run blobs:clear-queues
```

### Ver estado de memoria y colas

```bash
npm run blobs:show
```

### Funciones Manuales en Netlify

Estas funciones se pueden disparar manualmente cuando quieras.

Adicionalmente, se programaron dos ejecuciones semanales automaticas:

- `manual-run-all`: lunes 01:00 UTC (primer dia de la semana a primera hora).
- `manual-status`: lunes 01:20 UTC (snapshot posterior al mantenimiento).

Tambien se programo una limpieza diaria de mensajes huerfanos en Telegram:

- `clean-orphan-telegram`: todos los dias 03:30 UTC.

Adicionalmente, todas las funciones manuales de limpieza y status se ejecutan automaticamente 1 vez al mes (primer dia a las 00:00 UTC):

- `manual-android-status-report`: 1er día del mes 00:00 UTC.
- `manual-pc-status-report`: 1er día del mes 00:00 UTC.
- `manual-clean-memory`: 1er día del mes 00:00 UTC.
- `manual-clean-telegram`: 1er día del mes 00:00 UTC.
- `manual-delete-smoke`: 1er día del mes 00:00 UTC.

Estas funciones tambien pueden invocarse bajo demanda mediante HTTP (con o sin clave de autorización).

Funciones manuales bajo demanda:

- `manual-status`: consulta resumen de memoria/colas/expirados/backlog y tambien el ultimo resultado de `manual-delete-smoke`.
- `manual-android-status-report`: consulta bajo demanda el estado Android (`pending_send`, `sent_unverified`, `sent_verified`) y opcionalmente envia alerta Telegram.
- `manual-pc-status-report`: consulta bajo demanda el estado PC (`pending_send`, `sent_unverified`, `sent_verified`) y opcionalmente envia alerta Telegram.
- `manual-delete-smoke`: envia un mensaje temporal a Telegram y lo borra enseguida para validar permisos reales de borrado.
- `manual-clean-memory`: limpia toda la memoria operativa (publicados, colas y expirados).
- `manual-clean-telegram`: borra mensajes rastreados del bot en Telegram y sincroniza memoria.
- `manual-run-all`: ejecuta esta secuencia completa:
  1. `manual-clean-memory`
  2. `manual-clean-telegram`
  3. `check-android`
  4. `check-pc`
  5. `clean-expired`
  6. `clean-duplicates`
  7. `manual-delete-smoke`
  8. `manual-status`

### Smoke de Borrado Telegram

`manual-delete-smoke` sirve para comprobar de punta a punta que el bot puede crear y borrar mensajes en el chat objetivo.

`manual-status` mostrara el ultimo resultado guardado del smoke en el bloque `deleteSmoke` para que la corrida semanal deje evidencia del borrado real.

Variables que puede usar:

- `SMOKE_TELEGRAM_CHAT_ID`: chat objetivo para la prueba si no quieres usar `CHANNEL_ID`.
- `MANUAL_FUNCTION_KEY`: clave opcional para proteger la function manual.

Comportamiento:

- Si llamas sin `skipDelete`, crea un mensaje temporal y lo borra inmediatamente.
- Si llamas con `skipDelete=true`, solo crea el mensaje y te devuelve el `messageId` para una comprobacion parcial.
- Si pasas `chatId` en la query, ese valor tiene prioridad sobre `SMOKE_TELEGRAM_CHAT_ID` y `CHANNEL_ID`.
- Si llamas con `includeDiagnostic=true`, incluye diagnostico previo de permisos (`getMe` + `getChatMember`) y el payload exacto usado en el borrado.

Metodo de borrado usado:

- La function usa el metodo oficial de Telegram Bot API: `deleteMessage(chat_id, message_id)`.
- En la respuesta veras `methodReference.signature` y `deletePayloadRequest` para validar exactamente como se llamo.

Ejemplos utiles:

```bash
curl "https://<tu-sitio>.netlify.app/.netlify/functions/manual-delete-smoke" \
  -H "x-manual-key: <tu_clave>"

curl -s "https://<tu-sitio>.netlify.app/.netlify/functions/manual-delete-smoke?includeDiagnostic=true" \
  -H "x-manual-key: <tu_clave>" | jq

curl "https://<tu-sitio>.netlify.app/.netlify/functions/manual-delete-smoke?chatId=@tu_canal&skipDelete=true" \
  -H "x-manual-key: <tu_clave>"

curl -s "https://<tu-sitio>.netlify.app/.netlify/functions/manual-status" \
  -H "x-manual-key: <tu_clave>" | jq '.result.deleteSmoke'
```

Campos clave para troubleshooting de borrado:

- `methodReference.signature`: debe ser `deleteMessage(chat_id, message_id)`.
- `deletePayloadRequest.chat_id` y `deletePayloadRequest.message_id`: parametros exactos enviados a Telegram.
- `preDeleteDiagnostic.memberStatus` y `preDeleteDiagnostic.canDeleteMessages`: estado/permisos del bot en el chat.
- `deleteError`: descripcion devuelta por Telegram cuando no pudo borrar.

Importante sobre `manual-status` y `manual-clean-telegram`:

- Ambos operan sobre mensajes rastreados en Blobs (`published_games_android`, `published_games_pc`, `android_expired`, `pc_expired`, `manual_telegram_cleanup_queue`, `telegram_sent_messages`).
- No consultan historial completo del canal: la API del bot de Telegram no expone lectura retroactiva total del canal.
- Si `manual-status` muestra `trackedTelegramMessages: 0`, puede seguir habiendo mensajes antiguos en el canal no registrados en memoria.
- `manual-clean-telegram` borra los `messageId` rastreados (incluye backlog y `telegram_sent_messages`).
- `clean-orphan-telegram` borra mensajes del bot rastreados en `telegram_sent_messages` que ya no pertenecen a ofertas actuales en memoria (`published_games_android` y `published_games_pc`).
- Tanto `manual-clean-telegram` como `clean-orphan-telegram` incluyen `deletedNotFound`: cantidad de borrados resueltos por respuesta Telegram `message to delete not found`.

Opcional: proteger con clave manual.

- Define `MANUAL_FUNCTION_KEY` en variables de entorno de Netlify.
- En la llamada HTTP agrega header `x-manual-key: <tu_clave>`.

Control de verbosidad en logs de funciones manuales:

- `MANUAL_LOG_LEVEL=compact`: imprime solo resumen operativo por funcion (menos ruido en logs).
- `MANUAL_LOG_LEVEL=debug`: imprime resumen + detalles completos por funcion.

Valor por defecto:

- Produccion (`NODE_ENV=production`): `compact`.
- Desarrollo/local: `debug`.

Ejemplo:

```bash
curl "https://<tu-sitio>.netlify.app/.netlify/functions/manual-status" \
  -H "x-manual-key: <tu_clave>"

curl "https://<tu-sitio>.netlify.app/.netlify/functions/manual-status?includeSamples=true&sampleSize=5" \
  -H "x-manual-key: <tu_clave>"

curl "https://<tu-sitio>.netlify.app/.netlify/functions/manual-android-status-report" \
  -H "x-manual-key: <tu_clave>"

curl "https://<tu-sitio>.netlify.app/.netlify/functions/manual-android-status-report?forceAlert=true" \
  -H "x-manual-key: <tu_clave>"

curl "https://<tu-sitio>.netlify.app/.netlify/functions/manual-pc-status-report" \
  -H "x-manual-key: <tu_clave>"

curl "https://<tu-sitio>.netlify.app/.netlify/functions/manual-pc-status-report?forceAlert=true" \
  -H "x-manual-key: <tu_clave>"

curl "https://<tu-sitio>.netlify.app/.netlify/functions/manual-delete-smoke" \
  -H "x-manual-key: <tu_clave>"

curl "https://<tu-sitio>.netlify.app/.netlify/functions/manual-delete-smoke?chatId=@tu_canal&skipDelete=true" \
  -H "x-manual-key: <tu_clave>"

curl -X POST "https://<tu-sitio>.netlify.app/.netlify/functions/manual-run-all" \
  -H "x-manual-key: <tu_clave>" \
  -H "content-type: application/json" \
  -d '{"stopOnError":true}'

Ejecucion completa recomendada (con verificacion de smoke incluida en el cierre):

1. Ejecuta toda la cadena manual:

curl -X POST "https://<tu-sitio>.netlify.app/.netlify/functions/manual-run-all" \
  -H "x-manual-key: <tu_clave>" \
  -H "content-type: application/json" \
  -d '{"stopOnError":true}'

2. Consulta el snapshot final y valida deleteSmoke:

curl "https://<tu-sitio>.netlify.app/.netlify/functions/manual-status" \
  -H "x-manual-key: <tu_clave>"

Si tienes jq instalado, puedes extraer solo el bloque de verificacion de borrado:

curl -s "https://<tu-sitio>.netlify.app/.netlify/functions/manual-status" \
  -H "x-manual-key: <tu_clave>" | jq '.result.deleteSmoke'
```

### Recuperar memoria corrupta

Normaliza memoria heredada/mixta a formato estable `{ id, messageId }`:

```bash
npm run blobs:normalize-memory
```

Opcional por plataforma:

```bash
node scripts/blobs-admin.js normalize-memory android
node scripts/blobs-admin.js normalize-memory pc
```

---

## 📅 Operacion Diaria (5 minutos)

1. Ver estado general:

```bash
npm run ops:status
```

2. Ejecutar productor (si quieres forzar actualizacion):

```bash
npm run smoke:producer
```

3. Verificar rapido en Blobs:

```bash
npm run blobs:show
```

4. Verificar consumidor en logs Netlify:

- lineas con `[metrics]`.
- `publish_errors` y `delete_errors`.

---

## 🧯 Troubleshooting Rapido

- Problema: cola no se vacia.
  - Accion: revisar errores de Telegram en logs; los items fallidos se re-encolan para reintento.
- Problema: aparece `Too Many Requests (429)` en `check-android`.
  - Accion: ajustar `ANDROID_MAX_PUBLISH_PER_RUN` (por ejemplo `15` o `18`) para limitar publicaciones por corrida y diferir el resto sin saturar Telegram.
  - Accion: ajustar `ANDROID_MAX_DELETE_PER_RUN` (por ejemplo `12` o `15`) para limitar borrados de expirados por corrida.
- Problema: memoria mixta o corrupta.
  - Accion: `npm run blobs:normalize-memory`.
- Problema: quieres resetear ejecucion en pruebas.
  - Accion: `npm run blobs:clear-queues` y volver a correr productor.
- Problema: `smoke:verify:strict` falla con 401 en Blobs.
  - Accion: revisar `NETLIFY_SITE_ID` y `NETLIFY_API_TOKEN`.
  - Accion: verificar que el token tenga permisos para Blobs y pertenezca al mismo site.
  - Accion: confirmar que `NETLIFY_API_TOKEN` sea un Personal Access Token de Netlify (no clave SSH ni llave PEM).

---

## 🧹 Limpieza Automática de Duplicados

Para evitar accidentes durante las pruebas, existe una función schedulada que **elimina mensajes duplicados automaticamente**.

### ¿Cómo funciona?

- Corre **cada 12 horas** (configurable en `netlify.toml`).
- Detecta duplicados por **ID de juego** y tambien por **nombre normalizado**.
- La deteccion por nombre aplica solo si:
  - la plataforma coincide (`android` con `android`, `pc` con `pc`),
  - el nombre es suficientemente especifico,
  - el nombre no es generico (ej. `premium`, `game`, `free`).
- Compara por antigüedad (`publishedAt`)
- **Elimina los más antiguos, mantiene el más reciente**
- Registra detalles en los logs de Netlify

Variable opcional para ajustar nombres genericos en deduplicacion por nombre:

```bash
CLEAN_DUPLICATES_GENERIC_TOKENS="app,apps,game,games,premium,pro,vip,free,gratis,offer,deal"
```

- Formato: lista separada por comas.
- Si no se define, se usa la lista por defecto mostrada arriba.

Valor inicial recomendado para produccion (con bajo riesgo de falso positivo):

```bash
CLEAN_DUPLICATES_GENERIC_TOKENS="app,apps,game,games,premium,pro,vip,free,gratis,offer,deal,bundle,starter,edition,ultimate,deluxe"
```

Ajuste recomendado en 3 pasos:

1. Arranca con el valor recomendado y revisa logs de `clean-duplicates` por 3 a 5 dias.
2. Si ves falsos positivos por nombre, agrega terminos genericos al final de la lista.
3. Si ves falsos negativos (duplicados no detectados), elimina solo los terminos estrictamente necesarios.

### Métricas

Cada ejecución registra:

```
[METRICS] Resumen de Limpieza:
   - Duplicados encontrados: X
   - Mensajes eliminados: Y
   - Errores de limpieza: Z
```

### Almacenamiento de timestamp

Cada mensaje publicado ahora almacena su timestamp:

```json
{
  "id": "game-id",
  "messageId": 123456789,
  "publishedAt": 1711868400000 // timestamp en ms (Date.now())
}
```

### Cambiar el schedule

Cada 12 horas es la configuración por defecto.  
Para cambiar, edita `netlify.toml`:

```toml
[functions.clean-duplicates]
  schedule = "0 */12 * * *"  # Sintaxis cron
```

Algunos ejemplos:

- `"0 */6 * * *"` → cada 6 horas
- `"0 0 * * *"` → medianoche UTC
- `"0 10 * * 0"` → cada domingo a las 10 AM UTC

---

## 🔒 Mejoras de Concurrencia y Resiliencia

### Sistema de Locks Distribuido

Para evitar condiciones de carrera entre productores y consumidores simultáneos en Netlify Blobs, se implementó un sistema de locks distribuido basado en TTL.

**Componentes:**

- `utils/blob-lock.js`: Utilidad de locking con `tryAcquireBlobLock()`, `releaseBlobLock()` y patrón handler `withBlobLock()`.
- **Integración:** Los tres puntos de acceso a estado Android (`scripts/github-android.js`, `scripts/github-android-rss.js`, `netlify/functions/check-android.js`) utilizan `withBlobLock()` con llave compartida `android_state_lock`.

**Configuración (variables de entorno):**

```bash
ANDROID_STATE_LOCK_TTL_MS=5000               # Duración TTL del lock (ms, default: 5s)
ANDROID_STATE_LOCK_RETRIES=20                # Reintentos de adquisición (default: 20)
ANDROID_STATE_LOCK_RETRY_DELAY_MS=1000       # Delay entre reintentos (ms, default: 1s)
```

**Comportamiento:**

- Cada productor/consumidor intenta adquirir lock antes de leer/escribir colas.
- Si lock está ocupado, reintenta hasta `ANDROID_STATE_LOCK_RETRIES` veces con exponencial backoff.
- Lock expira automáticamente tras `ANDROID_STATE_LOCK_TTL_MS` para evitar deadlocks permanentes.
- `ANDROID_STATE_LOCK_TIMEOUT` se lanza si se agotan reintentos.

**Ventajas:**

- Serializa acceso a `android_queue`, `android_expired`, `published_games_android`.
- Previene race conditions entre GitHub Actions (productores cada 20 min) y Netlify Functions (consumidor cada 20 min).
- TTL garantiza recuperación ante fallos (token verificado al release).

### Preservación de Cola (Queue Preservation)

Los productores Android ahora **preservan items en reintento** en lugar de sobrescribir la cola completa.

**Implementación:**

- `mergeProducerQueue()` en `scripts/github-android.js` mezcla:
  1. Juegos ya publicados (evita duplicados)
  2. Juegos en retintento (de scrape anterior)
  3. Juegos nuevos descobertos en este scrape
- Mantiene estructura original con campos: `id`, `title`, `url`, `reintentos`, `lastPublishError`.

**Impacto:**

- Items que fallan en publish (ej. 429 de Telegram) no se pierden tras siguiente scrape.
- Mejora throughput al reintentar sin reinventar el juego.

### Escaping de Markdown (Telegram Injection Prevention)

Títulos y URLs de juegos ahora se escapan según especificación Telegram Bot API MarkdownV2.

**Implementación:**

- `escapeTelegramMarkdownText()` en `services/android-deals.js`: Escapa caracteres especiales `_*[]()``\` en títulos.
- `escapeTelegramMarkdownUrl()`: Escapa caracteres especiales en URLs dentro de sintaxis MarkdownV2.
- Se aplica automáticamente en `buildAndroidMessage()` antes de enviar a Telegram.

**Caracteres escapados:**

```
texto: _*[]()~`\
url:   ()\
```

**Impacto:**

- Previene errores 400 de Telegram por sintaxis inválida.
- Permite títulos con caracteres especiales sin fallos de publicación.
- Reduce carga de reintentos causados por caracteres incompatibles.

### Retry-After Dinámico (Rate Limit Respect)

La lógica de reintentos en Telegram ahora respeta el header `Retry-After` y el campo `retry_after` en respuestas de error.

**Implementación:**

- `getRetryDelayMs()` en `utils/telegram.js`:
  1. Lee header `Retry-After` (formato segundos o HTTP-date).
  2. Lee campo `retry_after` en respuesta JSON de error.
  3. Usa exponential backoff como fallback si ambos ausentes.
- `requestWithRetry()` ahora llama `getRetryDelayMs()` para calcular delay dinámico.

**Comportamiento:**

```javascript
// Ejemplo: Telegram responde 429 con:
// Retry-After: 30 (segundos)
// o
// { ok: false, parameters: { retry_after: 30 } }

// Delay calculado: 30000 ms (respeta Telegram)
// vs. exponential backoff que hubiera usado: 1000 * 2^attempt
```

**Impacto:**

- Respeta rate limits de Telegram de forma adaptativa.
- Reduce 429s al esperar el tiempo sugerido por Telegram.
- Mejora throughput general del sistema.
