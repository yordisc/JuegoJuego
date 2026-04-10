// services/android-deals.js

const fs = require("node:fs/promises");
const path = require("node:path");

const KEY_ANDROID_QUEUE = "android_queue";
const KEY_ANDROID_EXPIRED = "android_expired";
const KEY_ANDROID_WATCHLIST_ALERTS = "android_watchlist_alerts";
const {
  PUBLICATION_STATUS,
  normalizePublicationStatus,
  normalizeTitleForMatch,
} = require("../utils/memory");
const { requestWithRetry } = require("../utils/telegram");
const {
  readTrackedMessages,
  saveTrackedMessages,
  trackTelegramMessage,
} = require("./manual-maintenance");

const DEFAULT_ANDROID_WATCHLIST_PATH = path.resolve(
  __dirname,
  "..",
  "config",
  "android-discount-watchlist.json"
);

function getPublishedGameId(entry) {
  if (typeof entry === "string") {
    return entry;
  }

  if (entry && typeof entry === "object" && entry.id != null) {
    return String(entry.id);
  }

  return "";
}

function getPublishedMessageId(entry) {
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

function getPublishedChatId(entry, fallback = process.env.CHANNEL_ID) {
  const raw = entry && typeof entry === "object" && entry.chatId != null ? String(entry.chatId).trim() : "";
  if (raw) {
    return raw;
  }

  return fallback != null ? String(fallback).trim() : "";
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
    console.warn(`[android-consumer] JSON invalido en ${key}, se reinicia a []`);
    return [];
  }
}

async function writeQueue(store, key, data) {
  await store.setJSON(key, Array.isArray(data) ? data : []);
}

async function readTelegramError(response) {
  const fallback = {
    text: `HTTP ${response.status}`,
    retryAfterSeconds: null,
  };

  try {
    const text = await response.text();
    let retryAfterSeconds = null;

    try {
      const parsed = JSON.parse(text);
      const rawRetryAfter =
        parsed && parsed.parameters ? parsed.parameters.retry_after : null;
      if (Number.isInteger(rawRetryAfter) && rawRetryAfter > 0) {
        retryAfterSeconds = rawRetryAfter;
      }
    } catch (parseErr) {
      // Si no es JSON valido, mantenemos solo el texto para logging.
    }

    return {
      text: text || fallback.text,
      retryAfterSeconds,
    };
  } catch (err) {
    return fallback;
  }
}

function isTelegramDeleteNotFound(status, errorText) {
  if (status !== 400) {
    return false;
  }

  return /message to delete not found/i.test(String(errorText || ""));
}

function dedupeById(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const id = getPublishedGameId(item);
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(item);
  }

  return result;
}

function buildPublishedEntry(item, messageId, publishedAt, status) {
  const id = getPublishedGameId(item);
  const title =
    item && typeof item === "object" && typeof item.title === "string"
      ? item.title.trim() || null
      : null;
  const titleMatch = normalizeTitleForMatch(title || id);

  return {
    id,
    messageId: Number.isInteger(messageId) ? messageId : null,
    publishedAt: Number.isInteger(publishedAt) ? publishedAt : Date.now(),
    status: normalizePublicationStatus(status, messageId),
    title,
    titleMatch,
    chatId: getPublishedChatId(item),
  };
}

function normalizeTrackedMap(trackedSent = []) {
  const byMessageId = new Map();
  const byId = new Map();
  const byTitle = new Map();

  for (const tracked of trackedSent) {
    const messageId = getPublishedMessageId(tracked);
    if (!Number.isInteger(messageId)) {
      continue;
    }

    const id = getPublishedGameId(tracked);
    const titleMatch = normalizeTitleForMatch(
      tracked && typeof tracked === "object"
        ? tracked.titleMatch || tracked.title || id
        : id
    );

    if (!byMessageId.has(messageId)) {
      byMessageId.set(messageId, tracked);
    }

    if (id && !byId.has(id)) {
      byId.set(id, tracked);
    }

    if (titleMatch && !byTitle.has(titleMatch)) {
      byTitle.set(titleMatch, tracked);
    }
  }

  return { byMessageId, byId, byTitle };
}

function escapeTelegramMarkdownText(value) {
  return String(value ?? "").replace(/([_\*\[\]\(\)`\\])/g, "\\$1");
}

function escapeTelegramMarkdownUrl(value) {
  return String(value ?? "").replace(/([\\\)\(])/g, "\\$1");
}

function buildAndroidMessage(item) {
  const title = item.title || item.id || "Android Deal";
  const score = Number.isFinite(item.score) ? item.score.toFixed(1) : "N/A";
  const url =
    item.url ||
    (item.id
      ? `https://play.google.com/store/apps/details?id=${item.id}`
      : "https://play.google.com/store/apps");
  const safeTitle = escapeTelegramMarkdownText(title);
  const safeUrl = escapeTelegramMarkdownUrl(url);

  return (
    `📱 **NEW ANDROID DEAL** 📱\n\n` +
    `🎮 *${safeTitle}*\n` +
    `⭐ Rating: ${score}\n\n` +
    `👉 [Get it on Google Play](${safeUrl})`
  );
}

function parseWatchlistNames(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (!raw || typeof raw !== "object") {
    return [];
  }

  if (Array.isArray(raw.games)) {
    return raw.games;
  }

  if (Array.isArray(raw.titles)) {
    return raw.titles;
  }

  if (Array.isArray(raw.items)) {
    return raw.items;
  }

  return [];
}

function normalizeWatchlistEntry(rawEntry) {
  if (typeof rawEntry === "string") {
    const name = rawEntry.trim();
    if (!name) {
      return null;
    }

    const pattern = normalizeTitleForMatch(name);
    if (!pattern) {
      return null;
    }

    return {
      name,
      matchMode: "includes",
      patterns: [pattern],
    };
  }

  if (!rawEntry || typeof rawEntry !== "object") {
    return null;
  }

  const rawName =
    typeof rawEntry.name === "string" ? rawEntry.name :
      typeof rawEntry.title === "string" ? rawEntry.title :
        typeof rawEntry.game === "string" ? rawEntry.game : "";
  const name = rawName.trim();
  if (!name) {
    return null;
  }

  const modeRaw = String(rawEntry.match || rawEntry.mode || "includes")
    .trim()
    .toLowerCase();
  const matchMode = ["includes", "exact", "word"].includes(modeRaw)
    ? modeRaw
    : "includes";

  const aliases = Array.isArray(rawEntry.aliases)
    ? rawEntry.aliases
    : [];
  const variants = [name, ...aliases]
    .map((value) => normalizeTitleForMatch(value))
    .filter(Boolean);
  const patterns = Array.from(new Set(variants));
  if (patterns.length === 0) {
    return null;
  }

  return {
    name,
    matchMode,
    patterns,
  };
}

function normalizeWatchlistEntries(names) {
  if (!Array.isArray(names)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];

  for (const entry of names) {
    const normalizedEntry = normalizeWatchlistEntry(entry);
    if (!normalizedEntry) {
      continue;
    }

    const signature = JSON.stringify({
      mode: normalizedEntry.matchMode,
      patterns: normalizedEntry.patterns,
    });

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    normalized.push(normalizedEntry);
  }

  return normalized;
}

async function resolveAndroidWatchlist(options = {}) {
  const envDisabled = String(process.env.ANDROID_WATCHLIST_ENABLED || "")
    .trim()
    .toLowerCase();
  const watchlistEnabled = !["0", "false", "no", "off"].includes(envDisabled);

  if (!watchlistEnabled) {
    return [];
  }

  if (Array.isArray(options.watchlistNames)) {
    return normalizeWatchlistEntries(options.watchlistNames);
  }

  const watchlistPath =
    options.watchlistPath
    || process.env.ANDROID_WATCHLIST_PATH
    || DEFAULT_ANDROID_WATCHLIST_PATH;

  try {
    const raw = await fs.readFile(watchlistPath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeWatchlistEntries(parseWatchlistNames(parsed));
  } catch (err) {
    console.warn(
      `[android-consumer] No se pudo cargar watchlist Android (${watchlistPath}): ${err.message}`
    );
    return [];
  }
}

function findAndroidWatchlistMatch(item, watchlist = []) {
  if (!Array.isArray(watchlist) || watchlist.length === 0) {
    return null;
  }

  const normalizedWatchlist = normalizeWatchlistEntries(watchlist);
  if (normalizedWatchlist.length === 0) {
    return null;
  }

  const id = getPublishedGameId(item);
  const title =
    item && typeof item === "object" && typeof item.title === "string"
      ? item.title
      : "";

  const normalizedTitle = normalizeTitleForMatch(title);
  const normalizedId = normalizeTitleForMatch(id);
  const normalizedCombined = `${normalizedTitle} ${normalizedId}`.trim();
  if (!normalizedCombined) {
    return null;
  }

  for (const entry of normalizedWatchlist) {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.patterns)) {
      continue;
    }

    for (const pattern of entry.patterns) {
      if (!pattern) {
        continue;
      }

      if (entry.matchMode === "exact") {
        if (normalizedTitle === pattern || normalizedId === pattern) {
          return { ...entry, matchedPattern: pattern };
        }
        continue;
      }

      if (entry.matchMode === "word") {
        const withPadding = ` ${normalizedCombined} `;
        const patternPadding = ` ${pattern} `;
        if (withPadding.includes(patternPadding)) {
          return { ...entry, matchedPattern: pattern };
        }
        continue;
      }

      if (normalizedCombined.includes(pattern)) {
        return { ...entry, matchedPattern: pattern };
      }
    }
  }

  return null;
}

function buildAndroidWatchlistAlertMessage(item, match = null) {
  const title = item.title || item.id || "Android Deal";
  const score = Number.isFinite(item.score) ? item.score.toFixed(1) : "N/A";
  const url =
    item.url ||
    (item.id
      ? `https://play.google.com/store/apps/details?id=${item.id}`
      : "https://play.google.com/store/apps");
  const watchName =
    match && typeof match === "object" && typeof match.name === "string"
      ? match.name
      : "Juego monitoreado";

  const safeTitle = escapeTelegramMarkdownText(title);
  const safeWatchName = escapeTelegramMarkdownText(watchName);
  const safeUrl = escapeTelegramMarkdownUrl(url);

  return (
    `📱 **NEW ANDROID DEAL** 📱\n\n` +
    `🎯 *WATCHLIST MATCH: ${safeWatchName}*\n` +
    `🎮 *${safeTitle}*\n` +
    `⭐ Rating: ${score}\n\n` +
    `👉 [Get it on Google Play](${safeUrl})`
  );
}

function normalizeWatchlistAlertEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = getPublishedGameId(entry);
  if (!id) {
    return null;
  }

  const sentAtRaw = entry.sentAt;
  const sentAt = Number.isInteger(sentAtRaw)
    ? sentAtRaw
    : typeof sentAtRaw === "string" && /^\d+$/.test(sentAtRaw)
      ? Number(sentAtRaw)
      : null;

  if (!Number.isInteger(sentAt) || sentAt <= 0) {
    return null;
  }

  const matchedName =
    typeof entry.matchedName === "string" && entry.matchedName.trim()
      ? entry.matchedName.trim()
      : null;

  return {
    id,
    sentAt,
    matchedName,
  };
}

async function readWatchlistAlerts(store) {
  const raw = await readJsonArray(store, KEY_ANDROID_WATCHLIST_ALERTS);
  const normalized = [];
  const seen = new Set();

  for (const entry of raw) {
    const parsed = normalizeWatchlistAlertEntry(entry);
    if (!parsed || seen.has(parsed.id)) {
      continue;
    }

    seen.add(parsed.id);
    normalized.push(parsed);
  }

  return normalized;
}

function shouldSendWatchlistAlert(item, history, cooldownMs, now) {
  const id = getPublishedGameId(item);
  if (!id) {
    return true;
  }

  const found = history.find((entry) => entry.id === id);
  if (!found) {
    return true;
  }

  return now - found.sentAt >= cooldownMs;
}

function upsertWatchlistAlertHistory(history, item, match, now) {
  const id = getPublishedGameId(item);
  if (!id) {
    return history;
  }

  const matchedName =
    match && typeof match === "object" && typeof match.name === "string"
      ? match.name
      : null;

  const next = history.filter((entry) => entry.id !== id);
  next.push({
    id,
    sentAt: now,
    matchedName,
  });

  return next;
}

function pruneWatchlistAlertHistory(history, now, retentionMs) {
  return history
    .filter((entry) => now - entry.sentAt <= retentionMs)
    .sort((a, b) => b.sentAt - a.sentAt)
    .slice(0, 1000);
}

async function sendAndroidWatchlistAlert(item, match) {
  const telegramBase = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;
  const response = await requestWithRetry(`${telegramBase}/sendMessage`, {
    chat_id: process.env.CHANNEL_ID,
    text: buildAndroidWatchlistAlertMessage(item, match),
    parse_mode: "Markdown",
    disable_web_page_preview: false,
  });

  return response;
}

async function sendAndroidPublication(item) {
  const message = buildAndroidMessage(item);
  const telegramBase = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

  if (item.icon) {
    const response = await requestWithRetry(
      `${telegramBase}/sendPhoto`,
      {
        chat_id: process.env.CHANNEL_ID,
        photo: item.icon,
        caption: message,
        parse_mode: "Markdown",
      }
    );

    return {
      response,
      publication: {
        messageKind: "photo",
        messageText: message,
      },
    };
  }

  const response = await requestWithRetry(
    `${telegramBase}/sendMessage`,
    {
      chat_id: process.env.CHANNEL_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    }
  );

  return {
    response,
    publication: {
      messageKind: "text",
      messageText: message,
    },
  };
}

async function markAndroidExpired(messageId, chatId) {
  const telegramBase = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

  return requestWithRetry(
    `${telegramBase}/deleteMessage`,
    {
      chat_id: getPublishedChatId({ chatId }),
      message_id: messageId,
    }
  );
}

function isTelegramEditNotFound(status, errorText) {
  if (status !== 400) {
    return false;
  }

  const text = String(errorText || "").toLowerCase();
  return text.includes("message to edit not found") || text.includes("message not found");
}

function isTelegramMessageNotModified(status, errorText) {
  if (status !== 400) {
    return false;
  }

  return /message is not modified/i.test(String(errorText || ""));
}

async function probeAndroidMessageExists(trackedEntry) {
  const messageId = getPublishedMessageId(trackedEntry);
  const messageKind =
    trackedEntry && typeof trackedEntry === "object" && typeof trackedEntry.messageKind === "string"
      ? trackedEntry.messageKind
      : "";
  const messageText =
    trackedEntry && typeof trackedEntry === "object" && typeof trackedEntry.messageText === "string"
      ? trackedEntry.messageText
      : "";

  if (!Number.isInteger(messageId) || !messageText || (messageKind !== "text" && messageKind !== "photo")) {
    return { status: "skipped" };
  }

  const telegramBase = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;
  const method = messageKind === "photo" ? "editMessageCaption" : "editMessageText";
  const payload = {
    chat_id: getPublishedChatId(trackedEntry),
    message_id: messageId,
    parse_mode: "Markdown",
  };

  if (messageKind === "photo") {
    payload.caption = messageText;
  } else {
    payload.text = messageText;
    payload.disable_web_page_preview = false;
  }

  try {
    const response = await requestWithRetry(`${telegramBase}/${method}`, payload);
    if (response.ok) {
      return { status: "exists" };
    }

    const details = await readTelegramError(response);
    if (isTelegramMessageNotModified(response.status, details.text)) {
      return { status: "exists" };
    }

    if (isTelegramEditNotFound(response.status, details.text)) {
      return { status: "missing" };
    }

    return { status: "error", reason: details.text };
  } catch (err) {
    return { status: "error", reason: err.message };
  }
}

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

async function checkAndroidDeals(store, publishedGames = [], options = {}) {
  console.log("[android-consumer] Procesando colas Android...");

  const processQueue = options.processQueue !== false;
  const processExpired = options.processExpired !== false;
  const maxPublishPerRun = readPositiveIntEnv("ANDROID_MAX_PUBLISH_PER_RUN", 18);
  const maxDeletePerRun = readPositiveIntEnv("ANDROID_MAX_DELETE_PER_RUN", 18);
  const now = Number.isInteger(options.now) ? options.now : Date.now();
  const watchlist = await resolveAndroidWatchlist(options);
  const watchlistCooldownHours = Number.isInteger(options.watchlistCooldownHours)
    ? options.watchlistCooldownHours
    : readPositiveIntEnv("ANDROID_WATCHLIST_ALERT_COOLDOWN_HOURS", 24);
  const watchlistCooldownMs = watchlistCooldownHours * 60 * 60 * 1000;
  const watchlistRetentionMs = Math.max(watchlistCooldownMs * 7, 7 * 24 * 60 * 60 * 1000);
  let watchlistAlertHistory = await readWatchlistAlerts(store);

  const queue = dedupeById(await readJsonArray(store, KEY_ANDROID_QUEUE));
  const expiredQueue = dedupeById(await readJsonArray(store, KEY_ANDROID_EXPIRED));

  const publishedIds = new Set(
    publishedGames.map(getPublishedGameId).filter(Boolean)
  );

  let publishedCount = 0;
  let expiredCount = 0;
  let publishErrors = 0;
  let deleteErrors = 0;
  let deleteAttempts = 0;
  let watchlistAlertsSent = 0;
  const retryQueue = [];
  const retryExpiredQueue = [];

  if (processQueue) {
    for (let index = 0; index < queue.length; index += 1) {
      if (publishedCount >= maxPublishPerRun) {
        console.warn(
          `[android-consumer] Limite por corrida alcanzado (${maxPublishPerRun}). Se difiere el resto de la cola.`
        );
        retryQueue.push(...queue.slice(index));
        break;
      }

      const item = queue[index];
      const id = getPublishedGameId(item);
      if (!id || publishedIds.has(id)) {
        continue;
      }

      try {
        const sendResult = await sendAndroidPublication(item);
        const telegramResponse = sendResult.response;

        if (!telegramResponse.ok) {
          const details = await readTelegramError(telegramResponse);
          console.error(
            "[android-consumer] Error publicando:",
            details.text
          );

          if (telegramResponse.status === 429) {
            const retryNote =
              details.retryAfterSeconds != null
                ? `reintentar en ~${details.retryAfterSeconds}s`
                : "reintentar en la siguiente corrida";
            console.warn(
              `[android-consumer] Rate limit detectado (${retryNote}). Se difiere el resto de la cola.`
            );

            retryQueue.push(...queue.slice(index));
            publishErrors += 1;
            break;
          }

          publishErrors += 1;
          retryQueue.push(item);
          continue;
        }

        const payload = await telegramResponse.json().catch(() => ({}));
        const messageId = payload && payload.result ? payload.result.message_id ?? null : null;
        const publishedAt = Date.now();

        publishedGames.push(
          buildPublishedEntry(
            item,
            messageId,
            publishedAt,
            Number.isInteger(messageId)
              ? PUBLICATION_STATUS.SENT_UNVERIFIED
              : PUBLICATION_STATUS.PENDING_SEND
          )
        );
        if (Number.isInteger(messageId)) {
          await trackTelegramMessage(store, {
            id,
            messageId,
            platform: "android",
            chatId: process.env.CHANNEL_ID || null,
            messageKind: sendResult.publication.messageKind,
            messageText: sendResult.publication.messageText,
            publishedAt,
            title:
              item && typeof item === "object" && typeof item.title === "string"
                ? item.title
                : null,
          });
        }
        publishedIds.add(id);
        publishedCount += 1;

        const watchlistMatch = findAndroidWatchlistMatch(item, watchlist);
        if (watchlistMatch) {
          if (!shouldSendWatchlistAlert(item, watchlistAlertHistory, watchlistCooldownMs, now)) {
            console.log(`[android-consumer] Alerta watchlist omitida por cooldown para ${id}`);
            continue;
          }

          try {
            const alertResponse = await sendAndroidWatchlistAlert(item, watchlistMatch);
            if (!alertResponse.ok) {
              const details = await readTelegramError(alertResponse);
              console.warn(
                `[android-consumer] No se pudo enviar alerta watchlist para ${id}: ${details.text}`
              );
            } else {
              watchlistAlertsSent += 1;
              watchlistAlertHistory = upsertWatchlistAlertHistory(
                watchlistAlertHistory,
                item,
                watchlistMatch,
                now
              );
              console.log(
                `[android-consumer] Alerta watchlist enviada para ${id} (${watchlistMatch.name})`
              );
            }
          } catch (watchlistErr) {
            console.warn(
              `[android-consumer] Error enviando alerta watchlist para ${id}: ${watchlistErr.message}`
            );
          }
        }
      } catch (err) {
        console.error("[android-consumer] Error de red publicando:", err.message);
        publishErrors += 1;
        retryQueue.push(item);
      }
    }
  }

  if (processExpired) {
    for (let index = 0; index < expiredQueue.length; index += 1) {
      const item = expiredQueue[index];
      const id = getPublishedGameId(item);
      if (!id) {
        continue;
      }

      const found = publishedGames.find((entry) => getPublishedGameId(entry) === id);
      const messageId = getPublishedMessageId(found) ?? getPublishedMessageId(item);
      const chatId = getPublishedChatId(found || item);

      if (messageId != null) {
        if (deleteAttempts >= maxDeletePerRun) {
          console.warn(
            `[android-consumer] Limite de borrados por corrida alcanzado (${maxDeletePerRun}). Se difiere el resto de expirados.`
          );
          retryExpiredQueue.push(...expiredQueue.slice(index));
          break;
        }

        deleteAttempts += 1;
        try {
          const telegramResponse = await markAndroidExpired(messageId, chatId);
          if (!telegramResponse.ok) {
            const details = await readTelegramError(telegramResponse);
            console.error(
              "[android-consumer] Error eliminando expirado:",
              details.text
            );

            if (isTelegramDeleteNotFound(telegramResponse.status, details.text)) {
              console.info(
                `[android-consumer] Mensaje expirado no encontrado (${messageId}), se marca como resuelto.`
              );
            } else {
              if (telegramResponse.status === 429) {
                const retryNote =
                  details.retryAfterSeconds != null
                    ? `reintentar en ~${details.retryAfterSeconds}s`
                    : "reintentar en la siguiente corrida";
                console.warn(
                  `[android-consumer] Rate limit en expirados (${retryNote}). Se difiere el resto.`
                );

                retryExpiredQueue.push(...expiredQueue.slice(index));
                deleteErrors += 1;
                break;
              }

              deleteErrors += 1;
              retryExpiredQueue.push(item);
              continue;
            }
          }
        } catch (err) {
          console.error("[android-consumer] Error de red eliminando expirado:", err.message);
          deleteErrors += 1;
          retryExpiredQueue.push(item);
          continue;
        }
      }

      const removeIndex = publishedGames.findIndex((entry) => getPublishedGameId(entry) === id);
      if (removeIndex >= 0) {
        publishedGames.splice(removeIndex, 1);
        publishedIds.delete(id);
        expiredCount += 1;
      }
    }
  }

  if (processQueue) {
    await writeQueue(store, KEY_ANDROID_QUEUE, dedupeById(retryQueue));
  }

  if (processExpired) {
    await writeQueue(store, KEY_ANDROID_EXPIRED, dedupeById(retryExpiredQueue));
  }

  if (processQueue) {
    const nextWatchlistHistory = pruneWatchlistAlertHistory(
      watchlistAlertHistory,
      now,
      watchlistRetentionMs
    );
    await writeQueue(store, KEY_ANDROID_WATCHLIST_ALERTS, nextWatchlistHistory);
  }

  console.log(
    `[android-consumer] Publicados: ${publishedCount} | Expirados: ${expiredCount}`
  );
  console.log(
    `[metrics] ${JSON.stringify({
      source: "consumer-android",
      items_published: publishedCount,
      items_expired: expiredCount,
      watchlist_alerts: watchlistAlertsSent,
      publish_errors: publishErrors,
      delete_errors: deleteErrors,
    })}`
  );

  return {
    publishedCount,
    expiredCount,
    watchlistAlertsSent,
    queueProcessed: queue.length,
    expiredProcessed: expiredQueue.length,
  };
}

async function reconcileAndroidPublications(store, publishedGames = [], options = {}) {
  const maxRepublishPerRun = Number.isInteger(options.maxRepublishPerRun)
    ? options.maxRepublishPerRun
    : readPositiveIntEnv("ANDROID_MAX_REPUBLISH_PER_RUN", 25);

  const trackedSent = await readTrackedMessages(store);
  const trackedMap = normalizeTrackedMap(trackedSent);
  const maxExistenceChecks = Number.isInteger(options.maxExistenceChecks)
    ? options.maxExistenceChecks
    : readPositiveIntEnv("ANDROID_MAX_EXISTENCE_CHECK_PER_RUN", 50);
  const removedTrackedMessageIds = new Set();

  let verifiedCount = 0;
  let republishedCount = 0;
  let republishErrors = 0;
  let existenceChecks = 0;
  let existenceMissing = 0;
  let existenceErrors = 0;

  for (let index = 0; index < publishedGames.length; index += 1) {
    const entry = publishedGames[index];
    const id = getPublishedGameId(entry);
    if (!id) {
      continue;
    }

    const currentMessageId = getPublishedMessageId(entry);
    const titleMatch = normalizeTitleForMatch(
      entry && typeof entry === "object"
        ? entry.titleMatch || entry.title || id
        : id
    );
    const trackedByMessage = Number.isInteger(currentMessageId)
      ? trackedMap.byMessageId.get(currentMessageId)
      : null;
    const trackedById = trackedMap.byId.get(id) || null;
    const trackedByTitle = titleMatch ? trackedMap.byTitle.get(titleMatch) || null : null;
    const tracked = trackedByMessage || trackedById || trackedByTitle;

    if (tracked) {
      const trackedMessageId = getPublishedMessageId(tracked);
      const trackedPublishedAt =
        tracked && typeof tracked === "object" && Number.isInteger(tracked.publishedAt)
          ? tracked.publishedAt
          : Date.now();

      if (existenceChecks < maxExistenceChecks) {
        existenceChecks += 1;
        const probe = await probeAndroidMessageExists(tracked);
        if (probe.status === "missing") {
          if (Number.isInteger(trackedMessageId)) {
            removedTrackedMessageIds.add(trackedMessageId);
          }

          publishedGames[index] = buildPublishedEntry(
            {
              ...entry,
              id,
              title:
                entry && typeof entry === "object" && typeof entry.title === "string"
                  ? entry.title
                  : tracked.title || id,
            },
            null,
            trackedPublishedAt,
            PUBLICATION_STATUS.PENDING_SEND
          );
          existenceMissing += 1;
          continue;
        }

        if (probe.status === "error") {
          existenceErrors += 1;
        }
      }

      publishedGames[index] = buildPublishedEntry(
        {
          ...entry,
          id,
          title:
            entry && typeof entry === "object" && typeof entry.title === "string"
              ? entry.title
              : tracked.title || id,
        },
        trackedMessageId,
        trackedPublishedAt,
        PUBLICATION_STATUS.SENT_VERIFIED
      );
      verifiedCount += 1;
      continue;
    }

    publishedGames[index] = buildPublishedEntry(
      { ...entry, id },
      currentMessageId,
      entry && typeof entry === "object" ? entry.publishedAt : null,
      normalizePublicationStatus(
        entry && typeof entry === "object" ? entry.status : null,
        currentMessageId
      )
    );
  }

  const pendingToPublish = [];
  for (const item of publishedGames) {
    const id = getPublishedGameId(item);
    if (!id) {
      continue;
    }

    const status = normalizePublicationStatus(item.status, item.messageId);
    if (status === PUBLICATION_STATUS.PENDING_SEND) {
      pendingToPublish.push(item);
    }
  }

  for (let index = 0; index < pendingToPublish.length; index += 1) {
    if (republishedCount >= maxRepublishPerRun) {
      break;
    }

    const item = pendingToPublish[index];
    const id = getPublishedGameId(item);

    try {
      const sendResult = await sendAndroidPublication(item);
      const telegramResponse = sendResult.response;
      if (!telegramResponse.ok) {
        const details = await readTelegramError(telegramResponse);
        console.warn(
          `[android-reconcile] No se pudo republicar ${id}: ${details.text}`
        );
        republishErrors += 1;
        continue;
      }

      const payload = await telegramResponse.json().catch(() => ({}));
      const messageId = payload && payload.result ? payload.result.message_id ?? null : null;
      const publishedAt = Date.now();

      const replaceIndex = publishedGames.findIndex(
        (entry) => getPublishedGameId(entry) === id
      );
      if (replaceIndex >= 0) {
        publishedGames[replaceIndex] = buildPublishedEntry(
          item,
          messageId,
          publishedAt,
          Number.isInteger(messageId)
            ? PUBLICATION_STATUS.SENT_UNVERIFIED
            : PUBLICATION_STATUS.PENDING_SEND
        );
      }

      if (Number.isInteger(messageId)) {
        await trackTelegramMessage(store, {
          id,
          messageId,
          platform: "android",
          chatId: process.env.CHANNEL_ID || null,
          messageKind: sendResult.publication.messageKind,
          messageText: sendResult.publication.messageText,
          publishedAt,
          title:
            item && typeof item === "object" && typeof item.title === "string"
              ? item.title
              : null,
        });
      }

      republishedCount += 1;
    } catch (err) {
      console.warn(
        `[android-reconcile] Error de red republicando ${id}: ${err.message}`
      );
      republishErrors += 1;
    }
  }

  if (removedTrackedMessageIds.size > 0) {
    const latestTracked = await readTrackedMessages(store);
    const nextTracked = latestTracked.filter((entry) => {
      const messageId = getPublishedMessageId(entry);
      return !Number.isInteger(messageId) || !removedTrackedMessageIds.has(messageId);
    });
    await saveTrackedMessages(store, nextTracked);
  }

  console.log(
    `[metrics] ${JSON.stringify({
      source: "android-reconcile",
      verified_existing: verifiedCount,
      republished_missing: republishedCount,
      republish_errors: republishErrors,
      existence_checks: existenceChecks,
      existence_missing: existenceMissing,
      existence_errors: existenceErrors,
    })}`
  );

  return {
    verifiedCount,
    republishedCount,
    republishErrors,
    existenceChecks,
    existenceMissing,
    existenceErrors,
    totalPublishedTracked: publishedGames.length,
  };
}

module.exports = {
  checkAndroidDeals,
  reconcileAndroidPublications,
  buildAndroidMessage,
  buildAndroidWatchlistAlertMessage,
  escapeTelegramMarkdownText,
  findAndroidWatchlistMatch,
  normalizeWatchlistEntries,
  parseWatchlistNames,
};
