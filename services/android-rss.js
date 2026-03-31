const KEY_ANDROID_MEMORY = "published_games_android";
const KEY_ANDROID_QUEUE = "android_queue";
const DEFAULT_FEED_URL = "https://www.reddit.com/r/googleplaydeals/new.rss";

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
        "Mozilla/5.0 (compatible; JuegoJuegoBot/1.0; +https://github.com/yordisc/JuegoJuego)",
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

function buildQueueItem(item, appId, discoveredAt) {
  const title =
    typeof item.title === "string" && item.title.trim()
      ? item.title.trim()
      : appId;

  return {
    id: appId,
    title,
    icon: null,
    url: `https://play.google.com/store/apps/details?id=${appId}`,
    score: null,
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

function inferExpiredAndroidFromFeed(publishedGames = [], feedActiveIds = [], options = {}) {
  const minActiveIds = readPositiveInt(
    options.minActiveIds,
    readPositiveInt(process.env.ANDROID_RSS_MIN_ACTIVE_IDS, 10)
  );
  const graceHours = readPositiveInt(
    options.graceHours,
    readPositiveInt(process.env.ANDROID_RSS_EXPIRATION_GRACE_HOURS, 24)
  );
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

    expired.push({ id: entry.id, messageId: entry.messageId ?? null });
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

    return { id, messageId };
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

  for (const item of feedItems) {
    const appIds = collectItemAppIds(item);
    for (const appId of appIds) {
      feedActiveIds.add(appId);

      if (knownIds.has(appId)) {
        continue;
      }

      newItems.push(buildQueueItem(item, appId, discoveredAt));
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
    })}`
  );

  return {
    feedItems: feedItems.length,
    feedActiveIds: feedActiveIds.size,
    feedActiveIdList: Array.from(feedActiveIds),
    queueBefore: existingQueue.length,
    queueAfter: nextQueue.length,
    added: newItems.length,
  };
}

module.exports = {
  extractIdsFromPlayStoreUrl,
  collectItemAppIds,
  inferExpiredAndroidFromFeed,
  buildAndroidRssQueue,
};
