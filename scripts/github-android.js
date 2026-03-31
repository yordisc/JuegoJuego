if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const fs = require("node:fs/promises");
const { getStore } = require("@netlify/blobs");
const { inferExpiredAndroidFromFeed } = require("../services/android-rss");

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
    return { id: entry.trim(), messageId: null, publishedAt: null };
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

  return { id, messageId, publishedAt };
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

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRatio(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed <= 0) {
    return 0;
  }

  if (parsed >= 1) {
    return 1;
  }

  return parsed;
}

function parseBoolEnv(value, fallback = true) {
  if (value == null) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function toExpiredEntry(entry) {
  const normalized = normalizeEntry(entry);
  if (!normalized) {
    return null;
  }

  return {
    id: normalized.id,
    messageId: normalized.messageId,
  };
}

function dedupeExpiredEntries(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const item of items) {
    const normalized = toExpiredEntry(item);
    if (!normalized || seen.has(normalized.id)) {
      continue;
    }

    seen.add(normalized.id);
    result.push(normalized);
  }

  return result;
}

function inferSafeExpiredForProducer(
  publishedGames,
  activeDealIds,
  existingExpired,
  queue,
  options = {}
) {
  const expirationEnabled = options.expirationEnabled !== false;
  const queueIds = new Set(
    normalizeList(queue).map((entry) => entry.id)
  );
  const normalizedPublished = normalizeList(publishedGames);
  const normalizedExistingExpired = dedupeExpiredEntries(existingExpired);

  if (!expirationEnabled) {
    return {
      inferredExpired: [],
      expirationMeta: { reason: "expiration_disabled" },
      mergedExpired: normalizedExistingExpired.filter(
        (entry) => !queueIds.has(entry.id)
      ),
    };
  }

  const expirationResult = inferExpiredAndroidFromFeed(
    normalizedPublished,
    Array.isArray(activeDealIds) ? activeDealIds : [],
    {
      minActiveIds: parsePositiveInt(
        options.minActiveIds,
        parsePositiveInt(process.env.ANDROID_PRODUCER_MIN_ACTIVE_IDS, 10)
      ),
      graceHours: parsePositiveInt(
        options.graceHours,
        parsePositiveInt(process.env.ANDROID_PRODUCER_EXPIRATION_GRACE_HOURS, 24)
      ),
      maxExpireRatio: parseRatio(
        options.maxExpireRatio,
        parseRatio(process.env.ANDROID_PRODUCER_MAX_EXPIRE_RATIO, 0.35)
      ),
      withMeta: true,
    }
  );

  const inferredExpiredRaw = Array.isArray(expirationResult)
    ? expirationResult
    : expirationResult.expired;
  const inferredExpired = dedupeExpiredEntries(inferredExpiredRaw);
  const expirationMeta = expirationResult && typeof expirationResult === "object"
    ? expirationResult.meta
    : null;

  const mergedExpired = dedupeExpiredEntries([
    ...normalizedExistingExpired,
    ...inferredExpired,
  ]).filter((entry) => !queueIds.has(entry.id));

  return {
    inferredExpired,
    expirationMeta,
    mergedExpired,
  };
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
  const existingExpired = dedupeExpiredEntries(
    await readJsonArray(store, KEY_ANDROID_EXPIRED)
  );
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
  const expirationEnabled = parseBoolEnv(
    process.env.ANDROID_PRODUCER_EXPIRATION_ENABLED,
    true
  );

  const queue = validDeals.filter((deal) => !publishedIds.has(deal.id));
  const expirationResolution = inferSafeExpiredForProducer(
    publishedGames,
    Array.from(validDealIds),
    existingExpired,
    queue,
    {
      expirationEnabled,
    }
  );
  const expired = expirationResolution.mergedExpired;
  const inferredExpired = expirationResolution.inferredExpired;
  const expirationMeta = expirationResolution.expirationMeta;

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
    expirationEnabled,
    inferredExpiredCount: inferredExpired.length,
    expirationReason:
      expirationMeta && expirationMeta.reason ? expirationMeta.reason : "n/a",
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
  console.log(`[producer-android] expirados inferidos: ${inferredExpired.length}`);
  console.log(
    `[producer-android] razon expiracion: ${
      expirationMeta && expirationMeta.reason ? expirationMeta.reason : "n/a"
    }`
  );
  console.log(`[producer-android] expirados detectados: ${expired.length}`);
  console.log(`[producer-android] duracion total: ${formatMs(elapsedMs)}`);
  debugLog("Resumen detallado", debugPayload);
  console.log(
    `[metrics] ${JSON.stringify({
      source: "producer-android",
      items_produced: queue.length,
      items_expired: inferredExpired.length,
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
      `- Expirados inferidos: ${inferredExpired.length}`,
      `- Expirados en store: ${expired.length}`,
      `- Razon expiracion: ${expirationMeta && expirationMeta.reason ? expirationMeta.reason : "n/a"}`,
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

module.exports = {
  buildAndroidQueues,
  inferSafeExpiredForProducer,
};

if (require.main === module) {
  buildAndroidQueues()
    .then(() => {
      console.log("[producer-android] OK");
    })
    .catch((err) => {
      console.error("[producer-android] ERROR", err);
      process.exitCode = 1;
    });
}
