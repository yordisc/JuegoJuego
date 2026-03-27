if (process.env.NODE_ENV !== 'production') require('dotenv').config();
const { getStore } = require("@netlify/blobs");
const { getPublishedGamesList, savePublishedGamesList } = require('../../utils/memory');
const { checkAndroidDeals } = require('../../services/android-deals');

exports.handler = async (event, context) => {
    try {
        console.log("📱 Iniciando búsqueda programada de Android (Cada 20 min)...");
        const store = getStore("memory-store"); 
        const publishedGames = await getPublishedGamesList(store);
        
        await checkAndroidDeals(publishedGames);
        await savePublishedGamesList(store, publishedGames);
        
        return { statusCode: 200, body: "Búsqueda Android completada." };
    } catch (error) {
        console.error("Error crítico en Android:", error);
        return { statusCode: 500, body: error.toString() };
    }
};