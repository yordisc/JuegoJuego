// netlify/functions/check-deals.js
// Punto de entrada de la Netlify Function. Orquesta toda la operación.

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config(); // Carga las variables solo en local
}

const { getStore } = require("@netlify/blobs");
const { getPublishedGamesList, savePublishedGamesList } = require('../../utils/memory');
const { checkPCGames } = require('../../services/pc-games');
const { checkAndroidDeals } = require('../../services/android-deals');

exports.handler = async (event, context) => {
    try {
        console.log("Iniciando tarea programada...");
        
        // 1. Conectar con el almacén de datos
        const store = getStore("memory-store"); 
        
        // 2. Cargar la memoria actual de juegos publicados
        const publishedGames = await getPublishedGamesList(store);

        // 3. Ejecutar las búsquedas pasándoles la memoria en tiempo real
        await checkPCGames(publishedGames);
        await checkAndroidDeals(publishedGames);
        
        // 4. Guardar la memoria actualizada en la nube
        await savePublishedGamesList(store, publishedGames);
        
        return { statusCode: 200, body: "Ejecución completada con éxito." };
    } catch (error) {
        console.error("Error crítico durante la ejecución:", error);
        return { statusCode: 500, body: error.toString() };
    }
};