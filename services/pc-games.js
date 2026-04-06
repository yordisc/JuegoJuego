// services/pc-games.js

const KEY_PC_QUEUE = "pc_queue";
const KEY_PC_EXPIRED = "pc_expired";
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

function readPositiveIntEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

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
    console.warn(`[pc-consumer] JSON invalido en ${key}, se reinicia a []`);
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

function buildPcMessage(item) {
  const title = item.title || item.id || "PC Game";
  const platforms = item.platforms || "PC";
  const worth = item.worth || "N/A";
  const description = (item.description || "").slice(0, 100);
  const url = item.openGiveawayUrl || item.open_giveaway_url || "";

  return (
    `🎮 **FREE PC GAME!** 🎮\n\n` +
    `⭐ *Title:* ${title}\n` +
    `💻 *Platform:* ${platforms}\n` +
    `💰 *Value:* ${worth}\n` +
    `📝 *Description:* ${description}${description ? "..." : "N/A"}\n\n` +
    `🔗 [Get it here](${url || "https://www.gamerpower.com/"})`
  );
}

async function sendPcPublication(item) {
  const message = buildPcMessage(item);
  const telegramBase = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

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

async function markPcExpired(messageId, chatId) {
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

async function probePcMessageExists(trackedEntry) {
  const messageId = getPublishedMessageId(trackedEntry);
  const messageText =
    trackedEntry && typeof trackedEntry === "object" && typeof trackedEntry.messageText === "string"
      ? trackedEntry.messageText
      : "";

  if (!Number.isInteger(messageId) || !messageText) {
    return { status: "skipped" };
  }

  const telegramBase = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;
  const payload = {
    chat_id: getPublishedChatId(trackedEntry),
    message_id: messageId,
    text: messageText,
    parse_mode: "Markdown",
    disable_web_page_preview: false,
  };

  try {
    const response = await requestWithRetry(`${telegramBase}/editMessageText`, payload);
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

async function checkPCGames(store, publishedGames = [], options = {}) {
  console.log("[pc-consumer] Procesando colas PC...");

  const processQueue = options.processQueue !== false;
  const processExpired = options.processExpired !== false;

  const maxPublishesPerRun = readPositiveIntEnv(
    process.env.PC_MAX_PUBLISH_PER_RUN,
    15
  );

  const queue = dedupeById(await readJsonArray(store, KEY_PC_QUEUE));
  const expiredQueue = dedupeById(await readJsonArray(store, KEY_PC_EXPIRED));

  const publishedIds = new Set(
    publishedGames.map(getPublishedGameId).filter(Boolean)
  );

  let publishedCount = 0;
  let expiredCount = 0;
  let publishErrors = 0;
  let deleteErrors = 0;
  const retryQueue = [];
  const retryExpiredQueue = [];

  if (processQueue) {
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index];
      const id = getPublishedGameId(item);
      if (!id || publishedIds.has(id)) {
        continue;
      }

      if (publishedCount >= maxPublishesPerRun) {
        retryQueue.push(...queue.slice(index));
        console.info(
          `[pc-consumer] Limite por corrida alcanzado (${maxPublishesPerRun}). Se difiere el resto de la cola.`
        );
        break;
      }

      try {
        const sendResult = await sendPcPublication(item);
        const telegramResponse = sendResult.response;

        if (!telegramResponse.ok) {
          const details = await readTelegramError(telegramResponse);
          console.error("[pc-consumer] Error publicando:", details.text);

          if (telegramResponse.status === 429) {
            const retryNote =
              details.retryAfterSeconds != null
                ? `reintentar en ~${details.retryAfterSeconds}s`
                : "reintentar en la siguiente corrida";
            console.warn(
              `[pc-consumer] Rate limit detectado (${retryNote}). Se difiere el resto de la cola.`
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
            platform: "pc",
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
      } catch (err) {
        console.error("[pc-consumer] Error de red publicando:", err.message);
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
        try {
          const telegramResponse = await markPcExpired(messageId, chatId);
          if (!telegramResponse.ok) {
            const details = await readTelegramError(telegramResponse);
            console.error(
              "[pc-consumer] Error eliminando expirado:",
              details.text
            );

            if (isTelegramDeleteNotFound(telegramResponse.status, details.text)) {
              console.info(
                `[pc-consumer] Mensaje expirado no encontrado (${messageId}), se marca como resuelto.`
              );
            } else {
              if (telegramResponse.status === 429) {
                const retryNote =
                  details.retryAfterSeconds != null
                    ? `reintentar en ~${details.retryAfterSeconds}s`
                    : "reintentar en la siguiente corrida";
                console.warn(
                  `[pc-consumer] Rate limit en expirados (${retryNote}). Se difiere el resto.`
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
          console.error("[pc-consumer] Error de red eliminando expirado:", err.message);
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
    await writeQueue(store, KEY_PC_QUEUE, dedupeById(retryQueue));
  }

  if (processExpired) {
    await writeQueue(store, KEY_PC_EXPIRED, dedupeById(retryExpiredQueue));
  }

  console.log(`[pc-consumer] Publicados: ${publishedCount} | Expirados: ${expiredCount}`);
  console.log(
    `[metrics] ${JSON.stringify({
      source: "consumer-pc",
      items_published: publishedCount,
      items_expired: expiredCount,
      publish_errors: publishErrors,
      delete_errors: deleteErrors,
    })}`
  );

  return {
    publishedCount,
    expiredCount,
    queueProcessed: queue.length,
    expiredProcessed: expiredQueue.length,
  };
}

async function reconcilePCPublications(store, publishedGames = [], options = {}) {
  const maxRepublishPerRun = Number.isInteger(options.maxRepublishPerRun)
    ? options.maxRepublishPerRun
    : readPositiveIntEnv(process.env.PC_MAX_REPUBLISH_PER_RUN, 25);
  const maxExistenceChecks = Number.isInteger(options.maxExistenceChecks)
    ? options.maxExistenceChecks
    : readPositiveIntEnv(process.env.PC_MAX_EXISTENCE_CHECK_PER_RUN, 25);

  const trackedSent = await readTrackedMessages(store);
  const trackedMap = normalizeTrackedMap(trackedSent);
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
        const probe = await probePcMessageExists(tracked);
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
      const sendResult = await sendPcPublication(item);
      const telegramResponse = sendResult.response;

      if (!telegramResponse.ok) {
        const details = await readTelegramError(telegramResponse);
        console.warn(`[pc-reconcile] No se pudo republicar ${id}: ${details.text}`);
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
          platform: "pc",
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
      console.warn(`[pc-reconcile] Error de red republicando ${id}: ${err.message}`);
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
      source: "pc-reconcile",
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
  checkPCGames,
  reconcilePCPublications,
};
