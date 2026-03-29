// utils/memory.js
// Módulo para gestionar la persistencia de datos (evitar duplicados).

const { getStore } = require("@netlify/blobs");

// Lee el "cajón" de la nube y devuelve la lista de IDs guardados.
// Si los datos están corruptos o son inválidos, devuelve [] de forma segura
// en lugar de colapsar toda la función scheduled.
async function getPublishedGamesList(store) {
  const data = await store.get("published_games");
  if (!data) return [];

  try {
    return JSON.parse(data);
  } catch (err) {
    console.error(
      "[memory] ⚠️ Datos corruptos en Netlify Blobs, reiniciando memoria:",
      err.message
    );
    return [];
  }
}

// Guarda la nueva lista directamente en la nube.
// (La limpieza y el límite de datos se gestionan en la capa de servicios)
async function savePublishedGamesList(store, publishedGames) {
  await store.setJSON("published_games", publishedGames);
}

module.exports = { getPublishedGamesList, savePublishedGamesList };