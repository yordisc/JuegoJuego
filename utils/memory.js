// utils/memory.js
// Módulo para gestionar la persistencia de datos (evitar duplicados).

const { getStore } = require("@netlify/blobs");

// Lee el "cajón" de la nube y devuelve la lista de IDs guardados
async function getPublishedGamesList(store) {
    const data = await store.get("published_games");
    return data ? JSON.parse(data) : [];
}

// Guarda la nueva lista asegurándose de no superar los 100 registros
async function savePublishedGamesList(store, publishedGames) {
    if (publishedGames.length > 100) {
        publishedGames = publishedGames.slice(-100);
    }
    await store.setJSON("published_games", publishedGames);
}

module.exports = { getPublishedGamesList, savePublishedGamesList };