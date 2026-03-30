// services/pc-games.js

const KEY_PC_QUEUE = "pc_queue";
const KEY_PC_EXPIRED = "pc_expired";
const EXPIRED_MARK = "[❌ OFERTA EXPIRADA]";
const { requestWithRetry } = require("../utils/telegram");

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
    `${telegramBase}/editMessageText`,
    {
      chat_id: process.env.CHANNEL_ID,
      message_id: messageId,
      text: `${EXPIRED_MARK}\n\nEsta oferta ya no esta disponible.`,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }
  );
}

async function checkPCGames(store, publishedGames = []) {
  console.log("[pc-consumer] Procesando colas PC...");

  const queue = await readJsonArray(store, KEY_PC_QUEUE);
  const expiredQueue = await readJsonArray(store, KEY_PC_EXPIRED);

  const publishedIds = new Set(
    publishedGames.map(getPublishedGameId).filter(Boolean)
  );

  let publishedCount = 0;
  let expiredCount = 0;
  let publishErrors = 0;
  let editErrors = 0;
  const retryQueue = [];
  const retryExpiredQueue = [];

  for (const item of dedupeById(queue)) {
    const id = getPublishedGameId(item);
    if (!id || publishedIds.has(id)) {
      continue;
    }

    try {
      const telegramResponse = await sendPcPublication(item);

      if (!telegramResponse.ok) {
        console.error("[pc-consumer] Error publicando:", await telegramResponse.text());
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

  for (const item of dedupeById(expiredQueue)) {
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
          console.error(
            "[pc-consumer] Error editando expirado:",
            await telegramResponse.text()
          );
          editErrors += 1;
          retryExpiredQueue.push(item);
          continue;
        }
      } catch (err) {
        console.error("[pc-consumer] Error de red editando expirado:", err.message);
        editErrors += 1;
        retryExpiredQueue.push(item);
        continue;
      }
    }

    const index = publishedGames.findIndex((entry) => getPublishedGameId(entry) === id);
    if (index >= 0) {
      publishedGames.splice(index, 1);
      publishedIds.delete(id);
      expiredCount += 1;
    }
  }

  await writeQueue(store, KEY_PC_QUEUE, dedupeById(retryQueue));
  await writeQueue(store, KEY_PC_EXPIRED, dedupeById(retryExpiredQueue));

  console.log(`[pc-consumer] Publicados: ${publishedCount} | Expirados: ${expiredCount}`);
  console.log(
    `[metrics] ${JSON.stringify({
      source: "consumer-pc",
      items_published: publishedCount,
      items_expired: expiredCount,
      publish_errors: publishErrors,
      edit_errors: editErrors,
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
