// utils/memory.js

// 1. DICCIONARIO DE CLAVES: 
// Esto hace que el código sea ultra escalable. Si mañana agregas "playstation", 
// solo añades una línea aquí y todo el resto del código sigue funcionando sin tocar un solo "if".
const MEMORY_KEYS = {
  android: "published_games_android",
  pc: "published_games_pc",
};

// Función auxiliar (privada) para no repetir código
function getKey(platform) {
  // Retorna la clave correcta, o la de android por defecto si envían algo extraño
  return MEMORY_KEYS[platform] || MEMORY_KEYS.android;
}

async function getPublishedGamesList(store, platform = "android") {
  const key = getKey(platform);

  try {
    const data = await store.get(key);
    // Si no hay datos (nube vacía), retornamos array vacío
    if (!data) return [];

    return JSON.parse(data);
  } catch (err) {
    // Este catch ahora atrapa tanto errores de red (store.get) como de parseo (JSON.parse)
    console.error(`[memory] ⚠️ Error leyendo datos (${platform}), reiniciando a vacío:`, err.message);
    return [];
  }
}

async function savePublishedGamesList(store, publishedGames, platform = "android") {
  const key = getKey(platform);

  // 2. VALIDACIÓN DEFENSIVA: 
  // Nos aseguramos de que a la base de datos NUNCA llegue algo que no sea un Array.
  const dataToSave = Array.isArray(publishedGames) ? publishedGames : [];

  try {
    // 3. PROTECCIÓN DE ESCRITURA:
    // Evitamos que una caída de red de Netlify tumbe todo el bot.
    await store.setJSON(key, dataToSave);
  } catch (err) {
    console.error(`[memory] ❌ Error crítico al guardar en la nube (${platform}):`, err.message);
  }
}

// Exportamos para que los servicios y los tests puedan usarlas
module.exports = {
  getPublishedGamesList,
  savePublishedGamesList
};