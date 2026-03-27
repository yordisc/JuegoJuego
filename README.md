# 🤖 JuegosJuegos Bot | Serverless Deal Aggregator

[![Node.js](https://img.shields.io/badge/Node.js-20.x-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Netlify Status](https://api.netlify.com/api/v1/badges/73ae4611-e40d-4cf1-bb2f-cab3fa825286/deploy-status)](https://app.netlify.com/projects/gratisjuego-bot/deploys)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-GitHub_Actions-2088FF?style=flat-square&logo=github-actions)](https://github.com/features/actions)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-2CA5E0?style=flat-square&logo=telegram)](https://t.me/JuegosJuegosGratis)


## 📖 Resumen del Proyecto
Juego es un sistema backend automatizado basado en microservicios que rastrea aplicaciones móviles y juegos de PC temporalmente gratuitos. Actúa como un motor de búsqueda asíncrono que extrae, filtra y publica ofertas en un canal de Telegram en tiempo real.

Construido con una arquitectura **100% Serverless** y enfocado en la eficiencia, el sistema opera de manera autónoma 24/7 con un **costo de infraestructura de $0**, diseñado para consumir el mínimo absoluto de memoria y red.

## 🧠 Decisiones de Ingeniería y Arquitectura

Como proyecto de portafolio, este sistema fue diseñado resolviendo problemas reales de infraestructura y escalabilidad:

* **Arquitectura de Microservicios Desacoplados:** En lugar de un orquestador monolítico, el sistema divide las cargas de trabajo según la volatilidad de la fuente. 
    * *Reddit (Android)* se consulta cada 20 minutos.
    * *GamerPower (PC)* se consulta 2 veces al día.
    * *Impacto:* Esta separación **redujo el consumo de peticiones de red en un 74%**, evitando bloqueos por *Rate Limiting* (HTTP 429) y optimizando el tiempo de cómputo en la nube.
* **Test-Driven Development (TDD) y CI/CD:** Implementación de pruebas unitarias y de integración usando el *test runner* nativo de Node.js (`node:test`) para mantener el entorno ligero. Un pipeline en GitHub Actions automatiza las pruebas en cada *push* antes del despliegue continuo en Netlify.
* **Gestión de Estado Ligera:** Uso de **Netlify Blobs** como un almacén de objetos (K/V) para la persistencia de datos, evitando que el bot publique ofertas duplicadas sin la sobrecarga de provisionar una base de datos relacional tradicional.

## 🏗️ Stack Tecnológico
* **Cloud & Deploy:** Netlify (Scheduled Functions / Cron Jobs), Netlify Blobs.
* **Backend:** Node.js (JavaScript nativo, Fetch API).
* **CI/CD:** GitHub Actions.
* **Frontend / Notificaciones:** Telegram Bot API (Markdown).

## ⚙️ Flujo de Operación de los Microservicios

1.  **El Disparador (Cron):** El archivo `netlify.toml` orquesta los tiempos de ejecución de las funciones *serverless* de manera independiente.
2.  **Extracción y Mocking:** El código consulta las APIs de Reddit (`/r/googleplaydeals`) y GamerPower. El sistema es tolerante a fallos (`try/catch`) ante posibles caídas de estos servicios externos.
3.  **Filtro de Negocio:** Se aplican reglas estrictas de validación (ej. buscar el *flair* "Popular app" o la palabra "Free" en los títulos de Reddit).
4.  **Validación de Memoria:** Se contrasta el ID de la oferta contra la memoria en caché de Netlify Blobs (limitada a los últimos 100 registros para evitar latencia de lectura).
5.  **Publicación:** Se formatea y transmite el mensaje a Telegram vía webhook.

## 🚀 Despliegue Local y Testing

Para clonar y probar este proyecto en un entorno local:

1. Clonar el repositorio y configurar Node.js (v18+).
2. Ejecutar `npm install` (solo instala dependencias de desarrollo y utilidades de Netlify).
3. Crear un archivo `.env` en la raíz con las variables:
   ```env
   TELEGRAM_TOKEN=tu_token_aqui
   CHANNEL_ID=@TuCanal
   ```
4. **Ejecutar Pruebas Automatizadas:**
   ```bash
   npm test
   ```
5. **Simular el entorno Cloud localmente:**
   ```bash
   npx netlify dev
   ```
```

---
