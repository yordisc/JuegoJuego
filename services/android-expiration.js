const KEY_ANDROID_QUEUE = "android_queue";

function normalizeId(value) {
  if (value == null) {
    return "";
  }

  const normalized = String(value).trim();
  if (!normalized || normalized === "undefined" || normalized === "null") {
    return "";
  }

  return normalized;
}

function getEntryId(entry) {
  if (typeof entry === "string") {
    return normalizeId(entry);
  }

  if (entry && typeof entry === "object" && entry.id != null) {
    return normalizeId(entry.id);
  }

  return "";
}

function getEntryMessageId(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const raw = entry.messageId;
  if (Number.isInteger(raw)) {
    return raw;
  }

  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    return Number(raw);
  }

  return null;
}

function getEntryPublishedAt(entry) {
  if (!entry || typeof entry !== "object") {
    return 0;
  }

  const raw = entry.publishedAt;
  if (Number.isInteger(raw) && raw > 0) {
    return raw;
  }

  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  return 0;
}

function normalizePublishedEntry(entry) {
  const id = getEntryId(entry);
  if (!id) {
    return null;
  }

  return {
    id,
    messageId: getEntryMessageId(entry),
    publishedAt: getEntryPublishedAt(entry),
  };
}

function normalizeExpiredEntry(entry) {
  const id = getEntryId(entry);
  if (!id) {
    return null;
  }

  const source = typeof entry.source === "string" && entry.source.trim()
    ? entry.source.trim()
    : null;
  const normalized = {
    id,
    messageId: getEntryMessageId(entry),
  };

  if (source) {
    normalized.source = source;
  }

  return normalized;
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

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

let gplayModulePromise = null;

async function getGooglePlayClient() {
  if (!gplayModulePromise) {
    gplayModulePromise = import("google-play-scraper")
      .then((moduleRef) => moduleRef.default || moduleRef)
      .catch((error) => {
        gplayModulePromise = null;
        const wrapped = new Error(
          "No se encontro 'google-play-scraper'. Instala dependencias con npm install para validar expirados de Android."
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
  const country = options.country || process.env.ANDROID_EXPIRATION_SCAN_COUNTRY || "us";
  const lang = options.lang || process.env.ANDROID_EXPIRATION_SCAN_LANG || "es";

  return async function fetchDetails(appId) {
    return gplay.app({
      appId,
      country,
      lang,
    });
  };
}

function buildResult(expired, withMeta, meta = {}) {
  return withMeta ? { expired, meta } : expired;
}

async function scanAndroidPublishedGamesForExpiration(publishedGames = [], options = {}) {
  const maxExpireRatio = readRatio(
    options.maxExpireRatio,
    readRatio(process.env.ANDROID_EXPIRATION_SCAN_MAX_EXPIRE_RATIO, 0.35)
  );
  const detailsDelayMs = readPositiveInt(
    options.detailsDelayMs,
    readNonNegativeInt(process.env.ANDROID_EXPIRATION_SCAN_DETAILS_DELAY_MS, 500)
  );
  const now = Number.isInteger(options.now) ? options.now : Date.now();
  const withMeta = options.withMeta === true;
  const source = typeof options.source === "string" && options.source.trim()
    ? options.source.trim()
    : "playstore";
  const queueIds = new Set(
    normalizeList(Array.isArray(options.queue) ? options.queue : [], normalizeExpiredEntry).map(
      (entry) => entry.id
    )
  );

  const normalizedPublished = normalizeList(publishedGames, normalizePublishedEntry).sort(
    (left, right) => {
      if (left.publishedAt === right.publishedAt) {
        return left.id.localeCompare(right.id);
      }

      return left.publishedAt - right.publishedAt;
    }
  );

  if (normalizedPublished.length === 0 || maxExpireRatio <= 0) {
    return buildResult([], withMeta, {
      reason: normalizedPublished.length === 0 ? "empty_published" : "ratio_disabled",
      publishedCount: normalizedPublished.length,
      candidateExpired: 0,
      maxAllowed: 0,
      maxExpireRatio,
      detailsRequests: 0,
      detailsFailures: 0,
      checkedAt: now,
    });
  }

  const detailsFetcher = await resolveDetailsFetcher(options);
  const expired = [];
  let detailsRequests = 0;
  let detailsFailures = 0;

  for (const entry of normalizedPublished) {
    try {
      detailsRequests += 1;
      const details = await detailsFetcher(entry.id);

      if (!details || typeof details !== "object") {
        detailsFailures += 1;
        console.warn(
          `[android-expiration] ${entry.id} no devolvio detalles validos, se omite para evitar falso positivo.`
        );
        continue;
      }

      if (!isCurrentlyFree(details)) {
        expired.push({ id: entry.id, messageId: entry.messageId, source });
      }
    } catch (err) {
      detailsFailures += 1;
      console.warn(
        `[android-expiration] No se pudo validar ${entry.id} en Play Store: ${err.message}`
      );
    }

    if (detailsDelayMs > 0) {
      await sleep(detailsDelayMs);
    }
  }

  const normalizedExpired = normalizeList(expired, normalizeExpiredEntry).filter(
    (entry) => !queueIds.has(entry.id)
  );

  if (maxExpireRatio < 1) {
    const maxAllowed = Math.max(1, Math.floor(normalizedPublished.length * maxExpireRatio));
    if (normalizedExpired.length > maxAllowed) {
      return buildResult([], withMeta, {
        reason: "blocked_by_max_expire_ratio",
        blockedByRatio: true,
        candidateExpired: normalizedExpired.length,
        maxAllowed,
        publishedCount: normalizedPublished.length,
        maxExpireRatio,
        detailsRequests,
        detailsFailures,
        checkedAt: now,
      });
    }

    return buildResult(normalizedExpired, withMeta, {
      reason: "ok",
      candidateExpired: normalizedExpired.length,
      maxAllowed,
      publishedCount: normalizedPublished.length,
      maxExpireRatio,
      detailsRequests,
      detailsFailures,
      checkedAt: now,
    });
  }

  return buildResult(normalizedExpired, withMeta, {
    reason: "ok",
    candidateExpired: normalizedExpired.length,
    maxAllowed: normalizedPublished.length,
    publishedCount: normalizedPublished.length,
    maxExpireRatio,
    detailsRequests,
    detailsFailures,
    checkedAt: now,
  });
}

module.exports = {
  KEY_ANDROID_QUEUE,
  isCurrentlyFree,
  normalizeList,
  scanAndroidPublishedGamesForExpiration,
};