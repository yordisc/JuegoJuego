const KEY_ANDROID_MEMORY = "published_games_android";
const KEY_ANDROID_QUEUE = "android_queue";
const DEFAULT_FEED_URL = "https://www.reddit.com/r/googleplaydeals/new.rss";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRssParserInstance() {
  let Parser;
  try {
    // Carga perezosa para que tests de funciones puras no dependan del paquete instalado.
    Parser = require("rss-parser");
  } catch (error) {
    const wrapped = new Error(
      "No se encontro 'rss-parser'. Instala dependencias con npm install para usar el productor RSS."
    );
    wrapped.cause = error;
    throw wrapped;
  }

  return new Parser({
    timeout: 15000,
    headers: {
      "User-Agent":
        process.env.ANDROID_RSS_USER_AGENT ||
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      "Accept": "application/rss+xml, application/xml, application/atom+xml, */*",
      "Accept-Encoding": "gzip, deflate",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "DNT": "1",
    },
  });
}

function normalizeMemoryEntry(entry) {
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

function normalizeQueueEntry(entry) {
  const normalized = normalizeMemoryEntry(entry);
  if (!normalized) {
    return null;
  }

  if (!entry || typeof entry !== "object") {
    return {
      id: normalized.id,
      title: normalized.id,
      icon: null,
      url: `https://play.google.com/store/apps/details?id=${normalized.id}`,
      score: null,
      source: null,
      discoveredAt: null,
    };
  }

  const title = typeof entry.title === "string" && entry.title.trim()
    ? entry.title.trim()
    : normalized.id;

  const icon = typeof entry.icon === "string" && entry.icon.trim()
    ? entry.icon.trim()
    : null;

  const url = typeof entry.url === "string" && entry.url.trim()
    ? entry.url.trim()
    : `https://play.google.com/store/apps/details?id=${normalized.id}`;

  const score = Number.isFinite(entry.score) ? entry.score : null;
  const source = typeof entry.source === "string" && entry.source.trim()
    ? entry.source.trim()
    : null;

  const rawDiscoveredAt = entry.discoveredAt;
  const discoveredAt = Number.isInteger(rawDiscoveredAt)
    ? rawDiscoveredAt
    : typeof rawDiscoveredAt === "string" && /^\d+$/.test(rawDiscoveredAt)
      ? Number(rawDiscoveredAt)
      : null;

  return {
    id: normalized.id,
    title,
    icon,
    url,
    score,
    source,
    discoveredAt,
  };
}

function normalizeList(rawData, normalizer) {
  if (!Array.isArray(rawData)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const item of rawData) {
    const normalized = normalizer(item);
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
    console.warn(`[producer-android-rss] JSON invalido en ${key}, se reinicia a []`);
    return [];
  }
}

async function writeJsonArray(store, key, value) {
  await store.setJSON(key, Array.isArray(value) ? value : []);
}

function isValidAppId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._$]+$/.test(value) && value.includes(".");
}

function extractIdsFromPlayStoreUrl(urlValue) {
  if (typeof urlValue !== "string" || !urlValue) {
    return [];
  }

  const ids = new Set();
  const textVariants = [urlValue];
  let decoded = urlValue;

  for (let index = 0; index < 2; index += 1) {
    try {
      decoded = decodeURIComponent(decoded);
      if (!textVariants.includes(decoded)) {
        textVariants.push(decoded);
      }
    } catch (err) {
      break;
    }
  }

  const urlRegex = /(?:https?:\/\/)?play\.google\.com\/store\/apps\/details\?[^\s"'<>)]*/gi;

  for (const text of textVariants) {
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      const rawUrl = match[0].startsWith("http") ? match[0] : `https://${match[0]}`;

      try {
        const parsed = new URL(rawUrl);
        const appId = parsed.searchParams.get("id");
        if (isValidAppId(appId)) {
          ids.add(appId);
        }
      } catch (err) {
        // Ignorar URL invalida y continuar con el resto.
      }
    }
  }

  return Array.from(ids);
}

function collectItemAppIds(item) {
  const fields = [
    item && item.link,
    item && item.guid,
    item && item.title,
    item && item.content,
    item && item.contentSnippet,
    item && item.summary,
  ];

  const ids = new Set();
  for (const field of fields) {
    const extracted = extractIdsFromPlayStoreUrl(field);
    for (const id of extracted) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

function buildQueueItem(item, appId, discoveredAt, details = null) {
  const detailTitle =
    details && typeof details.title === "string" && details.title.trim()
      ? details.title.trim()
      : "";
  const feedTitle =
    typeof item.title === "string" && item.title.trim()
      ? item.title.trim()
      : "";
  const title = detailTitle || feedTitle || appId;

  const icon =
    details && typeof details.icon === "string" && details.icon.trim()
      ? details.icon.trim()
      : null;

  const url =
    details && typeof details.url === "string" && details.url.trim()
      ? details.url.trim()
      : `https://play.google.com/store/apps/details?id=${appId}`;

  const score = details && Number.isFinite(details.score)
    ? details.score
    : null;

  return {
    id: appId,
    title,
    icon,
    url,
    score,
    source: "reddit-rss",
    discoveredAt,
  };
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readRatio(value, fallback) {
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

function isGameCategory(details) {
  if (!details || typeof details !== "object") {
    return false;
  }

  const genreId = String(details.genreId || "").toUpperCase();
  if (genreId.startsWith("GAME")) {
    return true;
  }

  const genre = String(details.genre || "").toLowerCase();
  return genre.includes("game") || genre.includes("juego");
}

function isQualifiedFreeGame(details) {
  if (!isGameCategory(details)) {
    return false;
  }

  const originalPrice = parseMoneyToNumber(details ? details.originalPrice : 0);
  if (originalPrice <= 0) {
    return false;
  }

  return isCurrentlyFree(details);
}

let gplayModulePromise = null;

async function getGooglePlayClient() {
  if (!gplayModulePromise) {
    gplayModulePromise = import("google-play-scraper")
      .then((moduleRef) => moduleRef.default || moduleRef)
      .catch((error) => {
        gplayModulePromise = null;
        const wrapped = new Error(
          "No se encontro 'google-play-scraper'. Instala dependencias con npm install para validar juegos gratis del RSS."
        );
        wrapped.cause = error;
        throw wrapped;
      });
  }

  return gplayModulePromise;
}

async function resolveDetailsFetcher(options = {}) {
  if (typeof options.detailsFetcher === "function") {
    return options.detailsFetcher;
  }

  const gplay = await getGooglePlayClient();
  const country = options.country || process.env.ANDROID_RSS_COUNTRY || "us";
  const lang = options.lang || process.env.ANDROID_RSS_LANG || "es";

  return async function fetchDetails(appId) {
    return gplay.app({
      appId,
      country,
      lang,
    });
  };
}

function inferExpiredAndroidFromFeed(publishedGames = [], feedActiveIds = [], options = {}) {
  const minActiveIds = readPositiveInt(
    options.minActiveIds,
    readPositiveInt(process.env.ANDROID_RSS_MIN_ACTIVE_IDS, 10)
  );
  const graceHours = readPositiveInt(
    options.graceHours,
    readPositiveInt(process.env.ANDROID_RSS_EXPIRATION_GRACE_HOURS, 24)
  );
  const source = typeof options.source === "string" && options.source.trim()
    ? options.source.trim()
    : "rss";
  const maxExpireRatio = readRatio(
    options.maxExpireRatio,
    readRatio(process.env.ANDROID_RSS_MAX_EXPIRE_RATIO, 0.35)
  );
  const now = Number.isInteger(options.now) ? options.now : Date.now();
  const graceMs = graceHours * 60 * 60 * 1000;
  const withMeta = options.withMeta === true;

  function resultWithMeta(expired, extraMeta = {}) {
    const meta = {
      minActiveIds,
      graceHours,
      maxExpireRatio,
      activeCount: active.size,
      publishedCount: normalizedPublished.length,
      ...extraMeta,
    };

    return withMeta ? { expired, meta } : expired;
  }

  const active = new Set(feedActiveIds);
  const normalizedPublished = normalizeList(publishedGames, normalizeMemoryEntry);

  if (active.size < minActiveIds) {
    return resultWithMeta([], { reason: "low_active_ids" });
  }

  if (normalizedPublished.length === 0 || maxExpireRatio <= 0) {
    return resultWithMeta([], {
      reason: normalizedPublished.length === 0 ? "empty_published" : "ratio_disabled",
    });
  }

  const expired = [];
  for (const entry of normalizedPublished) {
    if (active.has(entry.id)) {
      continue;
    }

    const publishedAt = Number.isInteger(entry.publishedAt)
      ? entry.publishedAt
      : typeof entry.publishedAt === "string" && /^\d+$/.test(entry.publishedAt)
        ? Number(entry.publishedAt)
        : 0;

    if (publishedAt > 0 && now - publishedAt < graceMs) {
      continue;
    }

    expired.push({ id: entry.id, messageId: entry.messageId ?? null, source });
  }

  const normalizedExpired = normalizeList(expired, (entry) => {
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

    const source = typeof entry.source === "string" && entry.source.trim()
      ? entry.source.trim()
      : null;
    const normalized = { id, messageId };
    if (source) {
      normalized.source = source;
    }

    return normalized;
  });

  if (maxExpireRatio < 1) {
    const maxAllowed = Math.max(1, Math.floor(normalizedPublished.length * maxExpireRatio));
    if (normalizedExpired.length > maxAllowed) {
      return resultWithMeta([], {
        reason: "blocked_by_max_expire_ratio",
        blockedByRatio: true,
        candidateExpired: normalizedExpired.length,
        maxAllowed,
      });
    }
  }

  return resultWithMeta(normalizedExpired, {
    reason: "ok",
    candidateExpired: normalizedExpired.length,
    maxAllowed:
      maxExpireRatio < 1
        ? Math.max(1, Math.floor(normalizedPublished.length * maxExpireRatio))
        : normalizedPublished.length,
  });
}

async function buildAndroidRssQueue(store, options = {}) {
  const feedUrl = options.feedUrl || DEFAULT_FEED_URL;
  const maxItems = Number.isInteger(options.maxItems)
    ? Math.max(1, options.maxItems)
    : 50;

  const feed = options.feed
    || (await (options.parser || createRssParserInstance()).parseURL(feedUrl));
  const feedItems = Array.isArray(feed && feed.items) ? feed.items : [];
  const detailsFetcher = await resolveDetailsFetcher(options);
  const detailsDelayMs = readPositiveInt(
    options.detailsDelayMs,
    readPositiveInt(process.env.ANDROID_RSS_DETAILS_DELAY_MS, 250)
  );

  const legacyMemory = await readJsonArray(store, KEY_ANDROID_MEMORY);
  const publishedGames = normalizeList(legacyMemory, normalizeMemoryEntry);

  const existingQueueRaw = await readJsonArray(store, KEY_ANDROID_QUEUE);
  const existingQueue = normalizeList(existingQueueRaw, normalizeQueueEntry);

  const knownIds = new Set([
    ...publishedGames.map((entry) => entry.id),
    ...existingQueue.map((entry) => entry.id),
  ]);

  const discoveredAt = Date.now();
  const newItems = [];
  const feedActiveIds = new Set();
  const detailsCache = new Map();
  let detailsRequests = 0;
  let detailsFailures = 0;

  async function getCandidateData(appId) {
    if (detailsCache.has(appId)) {
      return detailsCache.get(appId);
    }

    detailsRequests += 1;
    try {
      const details = await detailsFetcher(appId);
      const candidateData = {
        details,
        qualifies: isQualifiedFreeGame(details),
      };

      detailsCache.set(appId, candidateData);

      if (detailsDelayMs > 0) {
        await sleep(detailsDelayMs);
      }

      return candidateData;
    } catch (err) {
      detailsFailures += 1;
      console.warn(
        `[producer-android-rss] No se pudo validar ${appId} en Play Store: ${err.message}`
      );

      const candidateData = {
        details: null,
        qualifies: false,
      };
      detailsCache.set(appId, candidateData);
      return candidateData;
    }
  }

  for (const item of feedItems) {
    const appIds = collectItemAppIds(item);
    for (const appId of appIds) {
      const candidate = await getCandidateData(appId);
      if (!candidate.qualifies) {
        continue;
      }

      feedActiveIds.add(appId);

      if (knownIds.has(appId)) {
        continue;
      }

      newItems.push(buildQueueItem(item, appId, discoveredAt, candidate.details));
      knownIds.add(appId);

      if (newItems.length >= maxItems) {
        break;
      }
    }

    if (newItems.length >= maxItems) {
      break;
    }
  }

  const nextQueue = normalizeList([...existingQueue, ...newItems], normalizeQueueEntry);
  await writeJsonArray(store, KEY_ANDROID_QUEUE, nextQueue);

  console.log(`[producer-android-rss] feed items leidos: ${feedItems.length}`);
  console.log(`[producer-android-rss] candidatos con detalles consultados: ${detailsRequests}`);
  console.log(`[producer-android-rss] validaciones fallidas: ${detailsFailures}`);
  console.log(`[producer-android-rss] juegos gratis validados: ${feedActiveIds.size}`);
  console.log(`[producer-android-rss] queue previo: ${existingQueue.length}`);
  console.log(`[producer-android-rss] nuevos agregados: ${newItems.length}`);
  console.log(`[producer-android-rss] queue final: ${nextQueue.length}`);
  console.log(
    `[metrics] ${JSON.stringify({
      source: "producer-android-rss",
      items_produced: newItems.length,
      items_expired: 0,
      publish_errors: 0,
      delete_errors: 0,
      details_requests: detailsRequests,
      details_failures: detailsFailures,
    })}`
  );

  return {
    feedItems: feedItems.length,
    feedActiveIds: feedActiveIds.size,
    feedActiveIdList: Array.from(feedActiveIds),
    queueBefore: existingQueue.length,
    queueAfter: nextQueue.length,
    added: newItems.length,
    detailsRequests,
    detailsFailures,
  };
}

module.exports = {
  extractIdsFromPlayStoreUrl,
  collectItemAppIds,
  inferExpiredAndroidFromFeed,
  buildAndroidRssQueue,
};
