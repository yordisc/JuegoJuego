if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const fs = require("node:fs/promises");
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
const DEBUG_ENABLED =
  process.env.ANDROID_PRODUCER_DEBUG === "1" ||
  process.env.ANDROID_PRODUCER_DEBUG === "true";
const DEBUG_SAMPLE_SIZE = Number.isInteger(Number(process.env.ANDROID_PRODUCER_DEBUG_SAMPLES))
  ? Math.max(1, Number(process.env.ANDROID_PRODUCER_DEBUG_SAMPLES))
  : 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function debugLog(message, payload) {
  if (!DEBUG_ENABLED) {
    return;
  }

  if (payload === undefined) {
    console.log(`[producer-android][debug] ${message}`);
    return;
  }

  console.log(`[producer-android][debug] ${message}`, payload);
}

function maskValue(value, visible = 4) {
  if (!value || typeof value !== "string") {
    return "missing";
  }

  if (value.length <= visible) {
    return `${"*".repeat(value.length)}`;
  }

  return `${value.slice(0, visible)}${"*".repeat(4)}`;
}

function formatMs(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

async function writeStepSummary(summary) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  try {
    await fs.appendFile(summaryPath, summary, "utf8");
  } catch (err) {
    console.warn(`[producer-android] No se pudo escribir GITHUB_STEP_SUMMARY: ${err.message}`);
  }
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
  const startedAt = Date.now();
  debugLog("Inicio productor Android", {
    runAtUtc: new Date(startedAt).toISOString(),
    node: process.version,
    terms: SEARCH_TERMS.length,
    siteId: maskValue(process.env.NETLIFY_SITE_ID),
    token: process.env.NETLIFY_API_TOKEN ? "present" : "missing",
  });

  const store = getStoreFromEnv();
  const legacyMemory = await readJsonArray(store, KEY_ANDROID_MEMORY);
  const publishedGames = normalizeList(legacyMemory);
  const publishedIds = new Set(publishedGames.map((entry) => entry.id));

  const moduleRef = await import("google-play-scraper");
  const gplay = moduleRef.default || moduleRef;

  const seenCandidates = new Set();
  const validDeals = [];
  const perTermStats = [];
  let detailsRequests = 0;
  let detailsFailures = 0;

  for (const term of SEARCH_TERMS) {
    console.log(`[producer-android] Buscando term: ${term}`);

    const termStat = {
      term,
      rawResults: 0,
      uniqueCandidates: 0,
      titleMatches: 0,
      detailsOk: 0,
      dealsQualified: 0,
    };

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
      perTermStats.push({
        ...termStat,
        searchError: err.message,
      });
      continue;
    }

    termStat.rawResults = results.length;

    for (const app of results) {
      if (!app || !app.appId || seenCandidates.has(app.appId)) {
        continue;
      }
      seenCandidates.add(app.appId);
      termStat.uniqueCandidates += 1;

      if (!matchesTitle(app.title)) {
        continue;
      }
      termStat.titleMatches += 1;

      await sleep(1200);

      let details;
      try {
        detailsRequests += 1;
        details = await gplay.app({
          appId: app.appId,
          lang: "es",
          country: "us",
        });
        termStat.detailsOk += 1;
      } catch (err) {
        detailsFailures += 1;
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

      termStat.dealsQualified += 1;

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

    perTermStats.push(termStat);
    debugLog(`Termino term: ${term}`, termStat);
    await sleep(1200);
  }

  const validDealIds = new Set(validDeals.map((deal) => deal.id));

  const queue = validDeals.filter((deal) => !publishedIds.has(deal.id));
  const expired = publishedGames.filter((entry) => !validDealIds.has(entry.id));

  await writeJsonArray(store, KEY_ANDROID_QUEUE, queue);
  await writeJsonArray(store, KEY_ANDROID_EXPIRED, expired);

  const elapsedMs = Date.now() - startedAt;
  const debugPayload = {
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
    memoryCount: publishedGames.length,
    uniqueCandidates: seenCandidates.size,
    detailsRequests,
    detailsFailures,
    validDeals: validDeals.length,
    queueCount: queue.length,
    expiredCount: expired.length,
    queueSamples: queue.slice(0, DEBUG_SAMPLE_SIZE).map((item) => ({
      id: item.id,
      title: item.title,
      originalPrice: item.originalPrice,
    })),
    expiredSamples: expired.slice(0, DEBUG_SAMPLE_SIZE).map((item) => ({
      id: item.id,
      messageId: item.messageId ?? null,
    })),
    perTermStats,
  };

  console.log(`[producer-android] publicados memoria: ${publishedGames.length}`);
  console.log(`[producer-android] candidatos validos: ${validDeals.length}`);
  console.log(`[producer-android] nuevos en queue: ${queue.length}`);
  console.log(`[producer-android] expirados detectados: ${expired.length}`);
  console.log(`[producer-android] duracion total: ${formatMs(elapsedMs)}`);
  debugLog("Resumen detallado", debugPayload);
  console.log(
    `[metrics] ${JSON.stringify({
      source: "producer-android",
      items_produced: queue.length,
      items_expired: expired.length,
      publish_errors: 0,
        delete_errors: 0,
    })}`
  );

  await writeStepSummary(
    [
      "### Android Producer Debug",
      "",
      `- Inicio UTC: ${new Date(startedAt).toISOString()}`,
      `- Duracion: ${formatMs(elapsedMs)}`,
      `- Candidatos unicos: ${seenCandidates.size}`,
      `- Solicitudes de detalle: ${detailsRequests}`,
      `- Fallos de detalle: ${detailsFailures}`,
      `- Deals validos: ${validDeals.length}`,
      `- Nuevos en cola: ${queue.length}`,
      `- Expirados: ${expired.length}`,
      "",
      "| Termino | Raw | Unicos | Titulo OK | Detalle OK | Deals |",
      "|---|---:|---:|---:|---:|---:|",
      ...perTermStats.map(
        (stat) =>
          `| ${stat.term} | ${stat.rawResults} | ${stat.uniqueCandidates} | ${stat.titleMatches} | ${stat.detailsOk} | ${stat.dealsQualified} |`
      ),
      "",
    ].join("\n")
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
