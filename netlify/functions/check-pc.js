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
    const store = getStore("memory-store");
    const publishedGames = await getPublishedGamesList(store);

    await checkPCGames(publishedGames);
    await savePublishedGamesList(store, publishedGames);

    return { statusCode: 200, body: "Búsqueda PC completada." };
  } catch (error) {
    console.error("Error crítico en PC:", error);
    return { statusCode: 500, body: error.toString() };
  }
};
