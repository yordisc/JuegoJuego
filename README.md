# 🤖 JuegosJuegos Bot | Ultra-Efficient Serverless Aggregator

[![Node.js](https://img.shields.io/badge/Node.js-20.x-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Netlify Status](https://api.netlify.com/api/v1/badges/73ae4611-e40d-4cf1-bb2f-cab3fa825286/deploy-status)](https://app.netlify.com/projects/gratisjuego-bot/deploys)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-GitHub_Actions-2088FF?style=flat-square&logo=github-actions)](https://github.com/features/actions)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-2CA5E0?style=flat-square&logo=telegram)](https://t.me/JuegosJuegosGratis)

## 📖 Resumen del Proyecto
JuegosJuegos es un motor de búsqueda asíncrono y sistema de notificaciones en tiempo real que rastrea ofertas del 100% de descuento en aplicaciones de Android y juegos de PC. 

Más allá de su función principal, este proyecto fue concebido como un **estudio práctico de optimización en la nube y arquitectura Serverless**. Está diseñado bajo los principios de *The Twelve-Factor App* para operar de manera autónoma 24/7 con un **costo de infraestructura de $0.00**, maximizando el Free Tier a través de un consumo milimétrico de cómputo y memoria.

---

## 📊 Métricas de Rendimiento y Costos (Cloud Profiling)
El diseño arquitectónico prioriza la eficiencia extrema, logrando los siguientes márgenes operativos mensuales en Netlify AWS Lambda:

* **Tiempo de Cómputo (Compute Time):** ~0.6 horas / mes *(Utilizando < 1% de la cuota gratuita de 100 horas)*. Las funciones se inicializan, ejecutan y destruyen en promedios de 250ms a 350ms.
* **Peticiones (Invocations):** ~2,220 / mes *(Utilizando apenas el 1.7% del límite de 125,000 peticiones)*.
* **Huella de Memoria (Storage Footprint):** < 1 MB constantes en base de datos.

---

## 🧠 Decisiones de Ingeniería y Arquitectura

* **Microservicios Desacoplados:** En lugar de un orquestador monolítico, el sistema divide las cargas de trabajo según la volatilidad de la fuente. Esto **redujo el consumo de peticiones de red en un 74%** y evita bloqueos por *Rate Limiting* (HTTP 429).
    * *Google Play Scraper (Android):* Ejecución cada 20 minutos con camuflaje de `User-Agent`.
    * *GamerPower API (PC):* Ejecución programada 2 veces al día filtrando parámetros directamente desde el origen.
* **Garbage Collection y Gestión de Memoria Dual:** Para evitar *Memory Leaks* en el almacén de datos (Netlify Blobs), se implementaron dos estrategias de limpieza automatizada en memoria RAM:
    * *Sincronización de Estado (PC):* Purga automática de IDs que ya no están activos en el *endpoint* origen.
    * *Cola Circular FIFO (Android):* Límite estricto de retención a los últimos 300 registros, garantizando lecturas/escrituras de latencia ultrabaja (O(1) footprint).
* **Paridad de Entornos (Dev/Prod):** Integración de variables de entorno dinámicas. El código es 100% agnóstico a la infraestructura, ejecutándose de manera idéntica en local y en producción sin alterar la lógica de conexión.
* **TDD y Testing 100% Offline (CI/CD):** Implementación de pruebas unitarias usando el *test runner* nativo (`node:test`) con *Mocking* avanzado de APIs externas (Fetch/Telegram/Scrapers). Esto garantiza que el *pipeline* de GitHub Actions se ejecute en milisegundos sin dependencia de red.

## ⚙️ Flujo de Operación de los Microservicios

1.  **El Disparador (Cron):** El motor de Netlify orquesta los tiempos de ejecución (*Scheduled Functions*) de manera independiente.
2.  **Extracción:** Los servicios consultan las tiendas. El sistema es tolerante a fallos (`try/catch`) ante posibles caídas de estos servicios externos.
3.  **Filtro de Negocio:** Se aplican reglas estrictas de validación (ej. buscar metadatos que confirmen descuentos totales o etiquetas de popularidad).
4.  **Validación de Caché:** Se contrasta el ID de la oferta contra la memoria ultraligera en Netlify Blobs para evitar publicaciones duplicadas.
5.  **Publicación y Limpieza:** Se formatea y transmite el mensaje a Telegram vía webhook, y se invoca el *Garbage Collector* antes de guardar el nuevo estado.

## 🏗️ Stack Tecnológico
* **Infraestructura Cloud:** Netlify (Scheduled Functions / AWS Lambda por debajo), Netlify Blobs.
* **Backend:** Node.js, `google-play-scraper` (Importación dinámica ES Modules).
* **Integración Continua:** GitHub Actions.
* **Frontend / Notificaciones:** Telegram Bot API (Markdown).

## 🚀 Despliegue Local y Testing

Para clonar y probar este proyecto (optimizado para funcionar fluidamente en equipos de bajos recursos):

1. Clonar el repositorio y configurar Node.js (v18+).
2. Ejecutar `npm install` (Instala únicamente dependencias de desarrollo y utilidades de *testing*).
3. Crear un archivo `.env` en la raíz con las credenciales completas para lograr la paridad de entorno:
   ```env
   TELEGRAM_TOKEN=tu_token_aqui
   CHANNEL_ID=@TuCanal
   NETLIFY_SITE_ID=id_local_de_netlify
   NETLIFY_API_TOKEN=token_local_de_netlify
   ```
4. **Ejecutar Pruebas Automatizadas (Aisladas y Offline):**
   ```bash
   npm test
   ```
5. **Simular el entorno Cloud localmente:**
   ```bash
   npx netlify dev
   ```
```