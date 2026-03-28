// utils/memory.js
// Módulo para gestionar la persistencia de datos (evitar duplicados).

const { getStore } = require("@netlify/blobs");

// Lee el "cajón" de la nube y devuelve la lista de IDs guardados
async function getPublishedGamesList(store) {
  const data = await store.get("published_games");
  return data ? JSON.parse(data) : [];
}

// Guarda la nueva lista directamente en la nube
// (La limpieza y el límite de datos ahora se gestionan en la capa de servicios)
async function savePublishedGamesList(store, publishedGames) {
  await store.setJSON("published_games", publishedGames);
}

module.exports = { getPublishedGamesList, savePublishedGamesList };
