// services/pc-games.js

const KEY_PC_QUEUE = "pc_queue";
const KEY_PC_EXPIRED = "pc_expired";
const { requestWithRetry } = require("../utils/telegram");

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

  return requestWithRetry(
    `${telegramBase}/sendMessage`,
    {
      chat_id: process.env.CHANNEL_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    }
  );
}

async function markPcExpired(messageId) {
  const telegramBase = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

  return requestWithRetry(
    `${telegramBase}/deleteMessage`,
    {
      chat_id: process.env.CHANNEL_ID,
      message_id: messageId,
    }
  );
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
        const telegramResponse = await sendPcPublication(item);

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

        publishedGames.push({ id, messageId });
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

      if (messageId != null) {
        try {
          const telegramResponse = await markPcExpired(messageId);
          if (!telegramResponse.ok) {
            const details = await readTelegramError(telegramResponse);
            console.error(
              "[pc-consumer] Error eliminando expirado:",
              details.text
            );

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

module.exports = { checkPCGames };
