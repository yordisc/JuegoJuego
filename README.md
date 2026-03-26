# 🤖 Proyecto: JuegosJuegos - Agregador Automático de Juegos y Apps Gratis

## 📖 Resumen del Proyecto
JuegosJuegos es un sistema automatizado que rastrea aplicaciones móviles y juegos de PC que temporalmente se encuentran 100% gratuitos. Actúa como un motor de búsqueda en segundo plano que extrae información de múltiples APIs en tiempo real y publica automáticamente las mejores ofertas en un **Canal de Telegram** dedicado. 

El proyecto cuenta con una arquitectura de software limpia y modularizada, diseñada para consumir el mínimo de recursos y operar bajo un modelo de costos de $0. Los mensajes públicos se generan en **inglés** para alcanzar una audiencia global, mientras que el código mantiene la documentación en español.

## 🎯 Objetivos y Beneficios
* **Cero Spam:** Al usar un Canal de Telegram, los usuarios reciben notificaciones limpias de ofertas sin conversaciones cruzadas.
* **Automatización Total:** No requiere interacción del usuario. El sistema trabaja de forma autónoma 24/7.
* **Costo Operativo $0:** Utiliza la capa gratuita de Netlify (Scheduled Functions y Blobs) sin necesidad de mantener un servidor dedicado encendido.
* **Arquitectura Ligera:** Desarrollo *Serverless* optimizado con Node.js nativo, sin dependencias pesadas, ideal para desarrollo y ejecución en entornos con recursos limitados.

## 🏗️ Arquitectura y Tecnologías (Stack)
* **Destino (Frontend):** Canal Público de Telegram (`@JuegosJuegosGratis`).
* **Backend / Lógica:** Node.js (JavaScript).
* **Infraestructura Serverless:** **Netlify Scheduled Functions (Cron Jobs)**. El código se ejecuta automáticamente mediante el archivo de configuración `netlify.toml`.
* **Persistencia de Datos:** **Netlify Blobs**. Actúa como una base de datos de objetos ultraligera para mantener la "memoria" del bot y evitar duplicados.
* **Testing Automatizado (TDD):** Módulo nativo `node:test` para pruebas unitarias y de integración sin sobrecargar el entorno.
* **Control de Versiones y CI/CD:** GitHub.

## 📡 Fuentes de Datos y Lógica de Negocio
1. **Juegos de PC (Steam, Epic Games, GOG, etc.):** * **Fuente:** GamerPower API (`https://www.gamerpower.com/api/giveaways`).
   * **Filtro:** Solo juegos 100% gratuitos y nuevos en la memoria del bot.
2. **Apps y Juegos de Android (Google Play Store):**
   * **Fuente:** Subreddit de ofertas (`https://www.reddit.com/r/googleplaydeals/new.json`).
   * **Filtro:** Publicaciones categorizadas explícitamente con la etiqueta (*flair*) "Popular app" o que contengan la palabra "Free" / "$0.00" en el título.

## ⚙️ Flujo de Operación (El Cron Job)
1. **El Disparador:** Cada hora (`@hourly`), Netlify despierta la función automáticamente.
2. **La Memoria:** El sistema lee el almacén de Netlify Blobs para cargar el historial de los últimos 100 enlaces publicados.
3. **La Extracción:** El orquestador ejecuta módulos asíncronos (`fetch`) hacia Reddit y GamerPower.
4. **La Validación:** Se verifica que las ofertas cumplan las reglas de negocio y no existan en el historial.
5. **La Publicación:** Se formatea un mensaje en Markdown (en inglés) y se envía vía la API de Telegram.
6. **El Cierre:** El nuevo enlace se guarda en Netlify Blobs y la función se apaga.

## 🚀 Estado del Desarrollo
* [x] **Fase 1 (Prueba Local):** Creación de los módulos de extracción y conexión con Telegram.
* [x] **Fase 2 (Gestión de Estado):** Implementación de Netlify Blobs para evitar publicaciones duplicadas.
* [x] **Fase 3 (Testing y Refactorización):** Estructura modular implementada y pruebas automatizadas (unitarias y simulaciones de API) superadas con éxito usando el *test runner* nativo.
* [ ] **Fase 4 (Despliegue CI/CD):** Subir el código a GitHub y conectar el repositorio a Netlify para su ejecución programada en la nube.

---

### 🔐 Notas de Configuración (Para Desarrollo Local)
Para ejecutar este proyecto en local, se requiere un archivo `.env` en la raíz (ignorado en Git por seguridad) con las siguientes variables:
* `TELEGRAM_TOKEN`: (8789099458:AAFOCi9uoGfENDrpu3sqAVx_pMR8qKvS3Pw)
* `CHANNEL_ID`: @JuegosJuegosGratis

## Enlace del bot
https://t.me/gratisjuego_bot
