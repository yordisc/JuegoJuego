// utils/memory.js

// 1. DICCIONARIO DE CLAVES: 
// Esto hace que el código sea ultra escalable. Si mañana agregas "playstation", 
// solo añades una línea aquí y todo el resto del código sigue funcionando sin tocar un solo "if".
const MEMORY_KEYS = {
  android: "published_games_android",
  pc: "published_games_pc",
};

const MEMORY_LIMITS = {
  android: 300,
};

const PUBLICATION_STATUS = {
  PENDING_SEND: "pending_send",
  SENT_UNVERIFIED: "sent_unverified",
  SENT_VERIFIED: "sent_verified",
};

function normalizeTitleForMatch(value) {
  const base = String(value ?? "").trim().toLowerCase();
  if (!base) {
    return "";
  }

  return base
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePublicationStatus(status, messageId) {
  const raw = String(status ?? "").trim().toLowerCase();
  if (raw === PUBLICATION_STATUS.SENT_VERIFIED) {
    return PUBLICATION_STATUS.SENT_VERIFIED;
  }

  if (raw === PUBLICATION_STATUS.SENT_UNVERIFIED) {
    return PUBLICATION_STATUS.SENT_UNVERIFIED;
  }

  if (raw === PUBLICATION_STATUS.PENDING_SEND) {
    return PUBLICATION_STATUS.PENDING_SEND;
  }

  return Number.isInteger(messageId)
    ? PUBLICATION_STATUS.SENT_UNVERIFIED
    : PUBLICATION_STATUS.PENDING_SEND;
}

function normalizeMemoryEntry(entry) {
  if (typeof entry === "string" && entry.trim()) {
    const id = entry.trim();
    return {
      id,
      messageId: null,
      publishedAt: null,
      status: PUBLICATION_STATUS.PENDING_SEND,
      title: null,
      titleMatch: normalizeTitleForMatch(id),
      chatId: null
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id =
    typeof entry.id === "string"
      ? entry.id.trim()
      : entry.id != null
        ? String(entry.id).trim()
        : "";

  if (!id) {
    return null;
  }

  const rawMessageId = entry.messageId;
  const messageId = Number.isInteger(rawMessageId)
    ? rawMessageId
    : typeof rawMessageId === "string" && /^\d+$/.test(rawMessageId)
      ? Number(rawMessageId)
      : null;

  const rawPublishedAt = entry.publishedAt;
  const publishedAt = Number.isInteger(rawPublishedAt)
    ? rawPublishedAt
    : typeof rawPublishedAt === "string" && /^\d+$/.test(rawPublishedAt)
      ? Number(rawPublishedAt)
      : null;

  const title =
    typeof entry.title === "string" && entry.title.trim()
      ? entry.title.trim()
      : null;

  const status = normalizePublicationStatus(entry.status, messageId);

  const titleMatch = normalizeTitleForMatch(title || id);

  const chatId = 
    entry.chatId != null && String(entry.chatId).trim()
      ? String(entry.chatId).trim()
      : null;

  return {
    id,
    messageId,
    publishedAt,
    status,
    title,
    titleMatch,
    chatId,
  };
}

function normalizePublishedGames(rawData) {
  if (!Array.isArray(rawData)) {
    return [];
  }

  const normalized = [];

  for (const item of rawData) {
    const parsed = normalizeMemoryEntry(item);
    if (!parsed) {
      continue;
    }
    normalized.push(parsed);
  }

  return normalized;
}

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

    return normalizePublishedGames(JSON.parse(data));
  } catch (err) {
    // Este catch ahora atrapa tanto errores de red (store.get) como de parseo (JSON.parse)
    console.error(`[memory] ⚠️ Error leyendo datos (${platform}), reiniciando a vacío:`, err.message);
    return [];
  }
}

async function savePublishedGamesList(store, publishedGames, platform = "android") {
  const key = getKey(platform);
  const limit = MEMORY_LIMITS[platform] || null;

  // 2. VALIDACIÓN DEFENSIVA: 
  // Nos aseguramos de que a la base de datos NUNCA llegue algo que no sea un Array.
  const normalized = normalizePublishedGames(publishedGames);
  const dataToSave = Number.isInteger(limit) && limit > 0
    ? normalized.slice(-limit)
    : normalized;

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
  PUBLICATION_STATUS,
  normalizePublicationStatus,
  normalizeTitleForMatch,
  normalizePublishedGames,
  getPublishedGamesList,
  savePublishedGamesList
};