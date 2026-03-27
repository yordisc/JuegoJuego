//netlify/functions/check-pc.js

if (process.env.NODE_ENV !== "production") require("dotenv").config();
const { getStore } = require("@netlify/blobs");
const {
  getPublishedGamesList,
  savePublishedGamesList,
} = require("../../utils/memory");
const { checkPCGames } = require("../../services/pc-games");

exports.handler = async (event, context) => {
  try {
    console.log("💻 Iniciando búsqueda programada de PC (2 veces al día)...");

    // 1. Configuración dinámica de Blobs
    const blobOptions = { name: "memory-store" };
    if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
      blobOptions.siteID = process.env.NETLIFY_SITE_ID;
      blobOptions.token = process.env.NETLIFY_API_TOKEN;
    }

    // 2. Inicializamos la base de datos
    const store = getStore(blobOptions);

    const publishedGames = await getPublishedGamesList(store);
    await checkPCGames(publishedGames);
    await savePublishedGamesList(store, publishedGames);

    return { statusCode: 200, body: "Búsqueda PC completada." };
  } catch (error) {
    console.error("Error crítico en PC:", error);
    return { statusCode: 500, body: error.toString() };
  }
};
