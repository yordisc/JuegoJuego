// netlify/functions/check-android.js

if (process.env.NODE_ENV !== "production") require("dotenv").config();
const { getStore } = require("@netlify/blobs");
const {
  getPublishedGamesList,
  savePublishedGamesList,
} = require("../../utils/memory");
const { checkAndroidDeals } = require("../../services/android-deals");

exports.handler = async (event, context) => {
  try {
    console.log("📱 Iniciando búsqueda programada de Android (Cada 20 min)...");

    // 1. Configuración dinámica de Blobs (Dentro del handler)
    const blobOptions = { name: "memory-store" };
    if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
      blobOptions.siteID = process.env.NETLIFY_SITE_ID;
      blobOptions.token = process.env.NETLIFY_API_TOKEN;
    }

    // 2. Inicializamos la base de datos de forma segura
    const store = getStore(blobOptions);

    // 3. Ejecutamos la lógica de negocio
    const publishedGames = await getPublishedGamesList(store);
    await checkAndroidDeals(publishedGames);
    await savePublishedGamesList(store, publishedGames);

    return { statusCode: 200, body: "Búsqueda Android completada." };
  } catch (error) {
    console.error("Error crítico en Android:", error);
    return { statusCode: 500, body: error.toString() };
  }
};
