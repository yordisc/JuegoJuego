if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const { getStore } = require("@netlify/blobs");
const { normalizePublishedGames } = require("../utils/memory");

const MEMORY_KEYS = {
  android: "published_games_android",
  pc: "published_games_pc",
};

const QUEUE_KEYS = [
  "android_queue",
  "android_expired",
  "pc_queue",
  "pc_expired",
];

function getStoreFromEnv() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;

  if (!siteID || !token) {
    throw new Error(
      "Faltan NETLIFY_SITE_ID o NETLIFY_API_TOKEN para operar Netlify Blobs"
    );
  }

  return getStore({
    name: "memory-store",
    siteID,
    token,
  });
}

function printUnavailableState() {
  console.log("[blobs-admin] Estado actual de memoria/colas");
  for (const key of [...Object.values(MEMORY_KEYS), ...QUEUE_KEYS]) {
    console.log(`- ${key}: UNAVAILABLE (faltan secretos)`);
  }
}

async function readArray(store, key) {
  const raw = await store.get(key);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`[blobs-admin] JSON invalido en ${key}, se interpreta como []`);
    return [];
  }
}

async function show(store) {
  const rows = [];

  for (const key of [...Object.values(MEMORY_KEYS), ...QUEUE_KEYS]) {
    const items = await readArray(store, key);
    rows.push({ key, items: items.length });
  }

  console.log("[blobs-admin] Estado actual de memoria/colas");
  for (const row of rows) {
    console.log(`- ${row.key}: ${row.items}`);
  }
}

async function clearQueues(store) {
  for (const key of QUEUE_KEYS) {
    await store.setJSON(key, []);
  }

  console.log("[blobs-admin] Colas limpiadas: android_queue, android_expired, pc_queue, pc_expired");
}

async function normalizeMemory(store, platformArg) {
  const platforms = platformArg ? [platformArg] : ["android", "pc"];

  for (const platform of platforms) {
    const key = MEMORY_KEYS[platform];
    if (!key) {
      throw new Error(`Plataforma invalida para normalize-memory: ${platform}`);
    }

    const before = await readArray(store, key);
    const after = normalizePublishedGames(before);
    await store.setJSON(key, after);

    console.log(
      `[blobs-admin] ${platform}: ${before.length} -> ${after.length} (normalizado)`
    );
  }
}

async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];

  if (!command) {
    throw new Error("Uso: node scripts/blobs-admin.js <show|clear-queues|normalize-memory> [platform]");
  }

  if (command === "show") {
    let store;
    try {
      store = getStoreFromEnv();
    } catch (err) {
      console.warn(`[blobs-admin] WARN ${err.message}`);
      console.warn("[blobs-admin] WARN blobs:show continua en modo informativo.");
      printUnavailableState();
      return;
    }

    await show(store);
    return;
  }

  const store = getStoreFromEnv();

  if (command === "clear-queues") {
    await clearQueues(store);
    return;
  }

  if (command === "normalize-memory") {
    await normalizeMemory(store, arg);
    return;
  }

  throw new Error(`Comando no soportado: ${command}`);
}

main().catch((err) => {
  console.error("[blobs-admin] ERROR", err.message);
  process.exitCode = 1;
});
