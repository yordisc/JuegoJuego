if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const { getStore } = require("@netlify/blobs");

const KEY_PC_MEMORY = "published_games_pc";
const KEY_PC_QUEUE = "pc_queue";
const KEY_PC_EXPIRED = "pc_expired";

function normalizeEntry(entry) {
  if (typeof entry === "string" && entry.trim()) {
    return { id: entry.trim(), messageId: null };
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

  return { id, messageId };
}

function normalizeList(rawData) {
  if (!Array.isArray(rawData)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const item of rawData) {
    const normalized = normalizeEntry(item);
    if (!normalized || seen.has(normalized.id)) {
      continue;
    }

    seen.add(normalized.id);
    result.push(normalized);
  }

  return result;
}

async function readJsonArray(store, key) {
  const raw = await store.get(key);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`[producer-pc] JSON invalido en ${key}, se reinicia a []`);
    return [];
  }
}

async function writeJsonArray(store, key, value) {
  const data = Array.isArray(value) ? value : [];
  await store.setJSON(key, data);
}

function getStoreFromEnv() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;

  if (!siteID || !token) {
    throw new Error(
      "Faltan NETLIFY_SITE_ID o NETLIFY_API_TOKEN para escribir en Blobs"
    );
  }

  return getStore({
    name: "memory-store",
    siteID,
    token,
  });
}

async function fetchPcGiveaways() {
  const response = await fetch(
    "https://www.gamerpower.com/api/giveaways?platform=pc"
  );

  if (!response.ok) {
    throw new Error(`GamerPower devolvio HTTP ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function buildPcQueues() {
  const store = getStoreFromEnv();

  const rawMemory = await readJsonArray(store, KEY_PC_MEMORY);
  const publishedGames = normalizeList(rawMemory);
  const publishedIds = new Set(publishedGames.map((entry) => entry.id));

  const currentGames = await fetchPcGiveaways();
  const activeIds = new Set(currentGames.map((game) => String(game.id)));

  const queue = currentGames
    .filter((game) => !publishedIds.has(String(game.id)))
    .slice(0, 25)
    .map((game) => ({
      id: String(game.id),
      title: game.title || "Untitled",
      platforms: game.platforms || "PC",
      worth: game.worth || "N/A",
      description: game.description || "",
      openGiveawayUrl: game.open_giveaway_url || "",
      image: game.image || null,
    }));

  const expired = publishedGames.filter((entry) => !activeIds.has(entry.id));

  await writeJsonArray(store, KEY_PC_QUEUE, queue);
  await writeJsonArray(store, KEY_PC_EXPIRED, expired);

  console.log(`[producer-pc] publicados memoria: ${publishedGames.length}`);
  console.log(`[producer-pc] activos API: ${currentGames.length}`);
  console.log(`[producer-pc] nuevos en queue: ${queue.length}`);
  console.log(`[producer-pc] expirados detectados: ${expired.length}`);
  console.log(
    `[metrics] ${JSON.stringify({
      source: "producer-pc",
      items_produced: queue.length,
      items_expired: expired.length,
      publish_errors: 0,
      delete_errors: 0,
    })}`
  );
}

buildPcQueues()
  .then(() => {
    console.log("[producer-pc] OK");
  })
  .catch((err) => {
    console.error("[producer-pc] ERROR", err);
    process.exitCode = 1;
  });
