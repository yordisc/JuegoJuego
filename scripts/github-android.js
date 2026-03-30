if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const { getStore } = require("@netlify/blobs");

const TITLE_KEYWORDS = [
  "deal",
  "sale",
  "discount",
  "humble",
  "bundle",
  "100% off",
  "limited time",
  "paid game free",
  "price drop",
  "normally paid",
  "gratis por tiempo",
  "oferta limitada",
  "free today",
  "free this week",
  "goes free",
  "premium",
  "vip",
];

const BLACKLIST = [
  "free fire",
  "roblox",
  "pubg",
  "candy crush",
  "clash",
  "brawl stars",
  "subway surfers",
  "among us",
];

const SEARCH_TERMS = [
  "free games limited time",
  "juegos gratis android",
  "android game sale",
  "paid game free",
];

const KEY_ANDROID_MEMORY = "published_games_android";
const KEY_ANDROID_QUEUE = "android_queue";
const KEY_ANDROID_EXPIRED = "android_expired";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function matchesTitle(title) {
  const lower = (title || "").toLowerCase();

  if (BLACKLIST.some((black) => lower.includes(black))) {
    return false;
  }

  return TITLE_KEYWORDS.some((kw) => lower.includes(kw));
}

function parseMoneyToNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/[^\d.,-]/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function isCurrentlyFree(details) {
  if (details && details.free === true) {
    return true;
  }

  const price = parseMoneyToNumber(details ? details.price : 0);
  if (price === 0) {
    return true;
  }

  const priceText = (details && details.priceText ? details.priceText : "")
    .toString()
    .toLowerCase();

  return priceText.includes("free") || priceText.includes("gratis");
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
    console.warn(`[producer-android] JSON invalido en ${key}, se reinicia a []`);
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

async function buildAndroidQueues() {
  const store = getStoreFromEnv();
  const legacyMemory = await readJsonArray(store, KEY_ANDROID_MEMORY);
  const publishedGames = normalizeList(legacyMemory);
  const publishedIds = new Set(publishedGames.map((entry) => entry.id));

  const moduleRef = await import("google-play-scraper");
  const gplay = moduleRef.default || moduleRef;

  const seenCandidates = new Set();
  const validDeals = [];

  for (const term of SEARCH_TERMS) {
    console.log(`[producer-android] Buscando term: ${term}`);

    let results = [];
    try {
      results = await gplay.search({
        term,
        num: 30,
        lang: "es",
        country: "us",
        throttle: 10,
      });
    } catch (err) {
      console.warn(
        `[producer-android] Fallo search term ${term}: ${err.message}`
      );
      continue;
    }

    for (const app of results) {
      if (!app || !app.appId || seenCandidates.has(app.appId)) {
        continue;
      }
      seenCandidates.add(app.appId);

      if (!matchesTitle(app.title)) {
        continue;
      }

      await sleep(1200);

      let details;
      try {
        details = await gplay.app({
          appId: app.appId,
          lang: "es",
          country: "us",
        });
      } catch (err) {
        console.warn(
          `[producer-android] Fallo app() para ${app.appId}: ${err.message}`
        );
        continue;
      }

      const originalPrice = parseMoneyToNumber(details ? details.originalPrice : 0);
      const qualifies = originalPrice > 0 && isCurrentlyFree(details);

      if (!qualifies) {
        continue;
      }

      validDeals.push({
        id: app.appId,
        title: app.title,
        icon: app.icon || null,
        url:
          app.url ||
          `https://play.google.com/store/apps/details?id=${app.appId}`,
        developer: app.developer || null,
        score: Number.isFinite(app.score) ? app.score : null,
        originalPrice,
      });
    }

    await sleep(1200);
  }

  const validDealIds = new Set(validDeals.map((deal) => deal.id));

  const queue = validDeals.filter((deal) => !publishedIds.has(deal.id));
  const expired = publishedGames.filter((entry) => !validDealIds.has(entry.id));

  await writeJsonArray(store, KEY_ANDROID_QUEUE, queue);
  await writeJsonArray(store, KEY_ANDROID_EXPIRED, expired);

  console.log(`[producer-android] publicados memoria: ${publishedGames.length}`);
  console.log(`[producer-android] candidatos validos: ${validDeals.length}`);
  console.log(`[producer-android] nuevos en queue: ${queue.length}`);
  console.log(`[producer-android] expirados detectados: ${expired.length}`);
  console.log(
    `[metrics] ${JSON.stringify({
      source: "producer-android",
      items_produced: queue.length,
      items_expired: expired.length,
      publish_errors: 0,
        delete_errors: 0,
    })}`
  );
}

buildAndroidQueues()
  .then(() => {
    console.log("[producer-android] OK");
  })
  .catch((err) => {
    console.error("[producer-android] ERROR", err);
    process.exitCode = 1;
  });
