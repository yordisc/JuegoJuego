if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const fs = require("node:fs/promises");
const { getStore } = require("@netlify/blobs");
const { getPublishedGamesList, savePublishedGamesList } = require("../utils/memory");
const { checkAndroidDeals } = require("../services/android-deals");
const { withBlobLock } = require("../utils/blob-lock");
const {
  buildAndroidRssQueue,
  inferExpiredAndroidFromFeed,
} = require("../services/android-rss");

const KEY_ANDROID_QUEUE = "android_queue";
const KEY_ANDROID_EXPIRED = "android_expired";

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

function getStoreFromEnv() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;

  if (!siteID || !token) {
    throw new Error("Faltan NETLIFY_SITE_ID o NETLIFY_API_TOKEN para escribir en Blobs");
  }

  return getStore({
    name: "memory-store",
    siteID,
    token,
  });
}

function getEntryId(entry) {
  if (typeof entry === "string") {
    return entry.trim();
  }

  if (entry && typeof entry === "object" && entry.id != null) {
    return String(entry.id).trim();
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

function getEntrySource(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return typeof entry.source === "string" && entry.source.trim()
    ? entry.source.trim()
    : null;
}

function dedupeEntries(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const byId = new Map();

  for (const item of items) {
    const id = getEntryId(item);
    if (!id) {
      continue;
    }

    const candidate = {
      id,
      messageId: getEntryMessageId(item),
    };

    const source = getEntrySource(item);
    if (source) {
      candidate.source = source;
    }

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, candidate);
      continue;
    }

    if (existing.messageId == null && candidate.messageId != null) {
      existing.messageId = candidate.messageId;
    }

    if (!existing.source && candidate.source) {
      existing.source = candidate.source;
    }
  }

  return Array.from(byId.values());
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
    console.warn(`[producer-android-rss-action] JSON invalido en ${key}, se reinicia a []`);
    return [];
  }
}

async function writeStepSummary(summary) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  try {
    await fs.appendFile(summaryPath, summary, "utf8");
  } catch (err) {
    console.warn(`[producer-android-rss-action] No se pudo escribir GITHUB_STEP_SUMMARY: ${err.message}`);
  }
}

async function main() {
  const startedAt = Date.now();
  const store = getStoreFromEnv();
  return withBlobLock(
    store,
    {
      lockKey: process.env.ANDROID_STATE_LOCK_KEY || "android_state_lock",
      owner: "producer-android-rss",
      ttlMs: parsePositiveInt(process.env.ANDROID_STATE_LOCK_TTL_MS, 5 * 1000),
      retries: parsePositiveInt(process.env.ANDROID_STATE_LOCK_RETRIES, 5),
      retryDelayMs: parsePositiveInt(
        process.env.ANDROID_STATE_LOCK_RETRY_DELAY_MS,
        500
      ),
    },
    async () => {
      const publishedGames = await getPublishedGamesList(store, "android");

      const rssMaxItems = parsePositiveInt(process.env.ANDROID_RSS_MAX_ITEMS, 50);
      const rssResult = await buildAndroidRssQueue(store, {
        feedUrl: process.env.ANDROID_RSS_FEED_URL,
        maxItems: rssMaxItems,
      });

      const expirationEnabled = parseBoolEnv(
        process.env.ANDROID_RSS_EXPIRATION_ENABLED,
        true
      );
      const allowEmptySource = parseBoolEnv(
        process.env.ANDROID_RSS_ALLOW_EMPTY_SOURCE,
        false
      );
      const skipCleanup = parseBoolEnv(
        process.env.ANDROID_RSS_SKIP_CLEANUP,
        false
      );

      const shouldAbortByKillSwitch =
        expirationEnabled
        && !allowEmptySource
        && rssResult.feedActiveIds === 0
        && (rssResult.feedItems === 0 || rssResult.detailsRequests === 0);

      if (shouldAbortByKillSwitch) {
        throw new Error(
          "[producer-android-rss-action] Kill switch activado: feedActiveIds=0 sin evidencia suficiente de fuente valida (feedItems=0 o detailsRequests=0). Se aborta para evitar expiraciones en cascada."
        );
      }

      const queue = dedupeEntries(await readJsonArray(store, KEY_ANDROID_QUEUE));
      const queueIds = new Set(queue.map((entry) => entry.id));

      const existingExpired = dedupeEntries(
        await readJsonArray(store, KEY_ANDROID_EXPIRED)
      );

      let inferredExpired = [];
      let expirationMeta = null;
      if (expirationEnabled) {
        const expirationResult = inferExpiredAndroidFromFeed(
          publishedGames,
          rssResult.feedActiveIdList,
          {
            minActiveIds: parsePositiveInt(process.env.ANDROID_RSS_MIN_ACTIVE_IDS, 10),
            graceHours: parsePositiveInt(process.env.ANDROID_RSS_EXPIRATION_GRACE_HOURS, 24),
            maxExpireRatio: Number.parseFloat(process.env.ANDROID_RSS_MAX_EXPIRE_RATIO),
            source: "rss",
            withMeta: true,
          }
        );

        inferredExpired = Array.isArray(expirationResult)
          ? expirationResult
          : expirationResult.expired;
        expirationMeta = expirationResult && typeof expirationResult === "object"
          ? expirationResult.meta
          : null;

        if (expirationMeta && expirationMeta.blockedByRatio) {
          console.warn(
            "[producer-android-rss-action] Failsafe de expiracion activado por ratio",
            JSON.stringify({
              candidateExpired: expirationMeta.candidateExpired,
              maxAllowed: expirationMeta.maxAllowed,
              publishedCount: expirationMeta.publishedCount,
              maxExpireRatio: expirationMeta.maxExpireRatio,
            })
          );
        }
      }

      const mergedExpired = dedupeEntries([...existingExpired, ...inferredExpired]).filter(
        (entry) => !queueIds.has(entry.id)
      );

      await store.setJSON(KEY_ANDROID_EXPIRED, mergedExpired);

      let cleanupResult = { expiredCount: 0 };
      if (!skipCleanup) {
        cleanupResult = await checkAndroidDeals(store, publishedGames, {
          processQueue: false,
          processExpired: true,
        });
      }

      await savePublishedGamesList(store, publishedGames, "android");

      const elapsedMs = Date.now() - startedAt;
      console.log("[producer-android-rss-action] Resultado RSS", rssResult);
      console.log(
        "[producer-android-rss-action] Expirados",
        JSON.stringify({
          expirationEnabled,
          inferredExpired: inferredExpired.length,
          mergedExpired: mergedExpired.length,
          deleted: cleanupResult.expiredCount,
        })
      );
      console.log(
        `[metrics] ${JSON.stringify({
          source: "producer-android-rss-action",
          items_produced: rssResult.added,
          items_expired: cleanupResult.expiredCount,
          publish_errors: 0,
          delete_errors: 0,
        })}`
      );

      const summaryLines = [
        "### Android RSS Producer (Actions)",
        "",
        `- Feed items: ${rssResult.feedItems}`,
        `- IDs activos feed: ${rssResult.feedActiveIds}`,
        `- Nuevos en cola: ${rssResult.added}`,
        `- Expirados inferidos: ${inferredExpired.length}`,
        `- Razon expiracion: ${expirationMeta && expirationMeta.reason ? expirationMeta.reason : "n/a"}`,
        `- Expirados eliminados: ${cleanupResult.expiredCount}`,
        `- Cleanup ejecutado: ${skipCleanup ? "no" : "si"}`,
        `- Duracion: ${(elapsedMs / 1000).toFixed(2)}s`,
      ];

      if (expirationMeta && expirationMeta.blockedByRatio) {
        summaryLines.push(
          `- Failsafe ratio activado: si`,
          `- Failsafe detalle: candidatos=${expirationMeta.candidateExpired}, maximo=${expirationMeta.maxAllowed}, ratio=${expirationMeta.maxExpireRatio}, publicados=${expirationMeta.publishedCount}`
        );
      }

      summaryLines.push("");

      await writeStepSummary(summaryLines.join("\n"));
    }
  );
}

module.exports = {
  main,
};

if (require.main === module) {
  main().catch((err) => {
    console.error("[producer-android-rss-action] ERROR", err);
    process.exitCode = 1;
  });
}
