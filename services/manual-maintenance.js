const {
  getPublishedGamesList,
  savePublishedGamesList,
} = require("../utils/memory");
const { requestWithRetry } = require("../utils/telegram");

const KEY_ANDROID_QUEUE = "android_queue";
const KEY_PC_QUEUE = "pc_queue";
const KEY_ANDROID_EXPIRED = "android_expired";
const KEY_PC_EXPIRED = "pc_expired";
const KEY_MANUAL_TELEGRAM_BACKLOG = "manual_telegram_cleanup_queue";
const KEY_TELEGRAM_SENT_MESSAGES = "telegram_sent_messages";

function toId(entry) {
  if (typeof entry === "string") {
    return entry;
  }

  if (entry && typeof entry === "object" && entry.id != null) {
    return String(entry.id);
  }

  return "";
}

function toMessageId(entry) {
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

function dedupeById(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const item of items) {
    const id = toId(item);
    const messageId = toMessageId(item);
    const key = id ? `id:${id}` : Number.isInteger(messageId) ? `message:${messageId}` : "";

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
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
    console.warn(`[manual-maintenance] JSON invalido en ${key}, se reinicia a []`);
    return [];
  }
}

function uniqueValidMessageIds(items) {
  const result = new Set();

  for (const item of items) {
    const messageId = toMessageId(item);
    if (Number.isInteger(messageId)) {
      result.add(messageId);
    }
  }

  return result;
}

function toBacklogEntry(messageId) {
  if (!Number.isInteger(messageId)) {
    return null;
  }

  return {
    messageId,
    source: "manual-backlog",
  };
}

function toTrackedMessageEntry(entry) {
  const messageId = toMessageId(entry);
  if (!Number.isInteger(messageId)) {
    return null;
  }

  const id = toId(entry);
  const platformRaw =
    entry && typeof entry === "object" && entry.platform != null
      ? String(entry.platform).trim().toLowerCase()
      : "";
  const platform = platformRaw === "pc" ? "pc" : platformRaw === "android" ? "android" : null;

  const publishedAtRaw =
    entry && typeof entry === "object" ? entry.publishedAt : null;
  const publishedAt =
    Number.isInteger(publishedAtRaw) && publishedAtRaw > 0
      ? publishedAtRaw
      : Date.now();

  return {
    id: id || null,
    messageId,
    platform,
    publishedAt,
  };
}

function dedupeTrackedMessages(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const byMessageId = new Map();

  for (const item of items) {
    const parsed = toTrackedMessageEntry(item);
    if (!parsed) {
      continue;
    }

    const prev = byMessageId.get(parsed.messageId);
    if (!prev) {
      byMessageId.set(parsed.messageId, parsed);
      continue;
    }

    byMessageId.set(parsed.messageId, {
      id: parsed.id || prev.id || null,
      messageId: parsed.messageId,
      platform: parsed.platform || prev.platform || null,
      publishedAt:
        Number.isInteger(prev.publishedAt) && prev.publishedAt > 0
          ? prev.publishedAt
          : parsed.publishedAt,
    });
  }

  return Array.from(byMessageId.values()).sort((a, b) => {
    if (a.publishedAt === b.publishedAt) {
      return a.messageId - b.messageId;
    }

    return a.publishedAt - b.publishedAt;
  });
}

async function readTrackedMessages(store) {
  const raw = await readJsonArray(store, KEY_TELEGRAM_SENT_MESSAGES);
  return dedupeTrackedMessages(raw);
}

async function saveTrackedMessages(store, tracked) {
  await store.setJSON(KEY_TELEGRAM_SENT_MESSAGES, dedupeTrackedMessages(tracked));
}

async function trackTelegramMessage(store, entry) {
  const parsed = toTrackedMessageEntry(entry);
  if (!parsed) {
    return { tracked: false, reason: "invalid_message_id" };
  }

  const current = await readTrackedMessages(store);
  current.push(parsed);
  await saveTrackedMessages(store, current);

  return { tracked: true, messageId: parsed.messageId };
}

function isTelegramDeleteNotFound(status, errorText) {
  if (status !== 400) {
    return false;
  }

  return /message to delete not found/i.test(String(errorText || ""));
}

function collectMessageIds(items) {
  const result = [];
  for (const item of items) {
    const messageId = toMessageId(item);
    if (Number.isInteger(messageId)) {
      result.push(messageId);
    }
  }

  return result;
}

async function clearAllMemory(store, options = {}) {
  const stashTelegramIds = options.stashTelegramIds !== false;
  let backlogCount = 0;

  if (stashTelegramIds) {
    const androidPublished = await getPublishedGamesList(store, "android");
    const pcPublished = await getPublishedGamesList(store, "pc");
    const androidExpired = dedupeById(await readJsonArray(store, KEY_ANDROID_EXPIRED));
    const pcExpired = dedupeById(await readJsonArray(store, KEY_PC_EXPIRED));
    const prevBacklog = await readJsonArray(store, KEY_MANUAL_TELEGRAM_BACKLOG);

    const mergedIds = new Set([
      ...collectMessageIds(androidPublished),
      ...collectMessageIds(pcPublished),
      ...collectMessageIds(androidExpired),
      ...collectMessageIds(pcExpired),
      ...collectMessageIds(prevBacklog),
    ]);

    const nextBacklog = Array.from(mergedIds)
      .sort((a, b) => a - b)
      .map((messageId) => toBacklogEntry(messageId))
      .filter(Boolean);

    await store.setJSON(KEY_MANUAL_TELEGRAM_BACKLOG, nextBacklog);
    backlogCount = nextBacklog.length;
  }

  await savePublishedGamesList(store, [], "android");
  await savePublishedGamesList(store, [], "pc");
  await store.setJSON(KEY_ANDROID_QUEUE, []);
  await store.setJSON(KEY_PC_QUEUE, []);
  await store.setJSON(KEY_ANDROID_EXPIRED, []);
  await store.setJSON(KEY_PC_EXPIRED, []);

  return {
    androidPublished: 0,
    pcPublished: 0,
    androidQueue: 0,
    pcQueue: 0,
    androidExpired: 0,
    pcExpired: 0,
    telegramBacklog: backlogCount,
  };
}

async function deleteTrackedTelegramMessages(store) {
  const telegramBase = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

  const androidPublished = await getPublishedGamesList(store, "android");
  const pcPublished = await getPublishedGamesList(store, "pc");
  const androidExpired = dedupeById(await readJsonArray(store, KEY_ANDROID_EXPIRED));
  const pcExpired = dedupeById(await readJsonArray(store, KEY_PC_EXPIRED));
  const backlogItems = dedupeById(
    await readJsonArray(store, KEY_MANUAL_TELEGRAM_BACKLOG)
  );
  const trackedSent = await readTrackedMessages(store);

  const trackedEntries = [
    ...androidPublished.map((entry) => ({
      source: "android-published",
      id: toId(entry),
      messageId: toMessageId(entry),
    })),
    ...pcPublished.map((entry) => ({
      source: "pc-published",
      id: toId(entry),
      messageId: toMessageId(entry),
    })),
    ...androidExpired.map((entry) => ({
      source: "android-expired",
      id: toId(entry),
      messageId: toMessageId(entry),
    })),
    ...pcExpired.map((entry) => ({
      source: "pc-expired",
      id: toId(entry),
      messageId: toMessageId(entry),
    })),
    ...backlogItems.map((entry) => ({
      source: "manual-backlog",
      id: toId(entry) || `message-${toMessageId(entry)}`,
      messageId: toMessageId(entry),
    })),
    ...trackedSent.map((entry) => ({
      source: `tracked-${entry.platform || "unknown"}`,
      id: toId(entry) || `message-${toMessageId(entry)}`,
      messageId: toMessageId(entry),
    })),
  ];

  const uniqueMessages = [];
  const seenMessageIds = new Set();
  for (const item of trackedEntries) {
    if (!Number.isInteger(item.messageId)) {
      continue;
    }

    if (seenMessageIds.has(item.messageId)) {
      continue;
    }

    seenMessageIds.add(item.messageId);
    uniqueMessages.push(item);
  }

  let deleted = 0;
  let deletedNotFound = 0;
  let failed = 0;
  const deletedMessageIds = new Set();
  const failedMessageIds = new Set();

  for (const item of uniqueMessages) {
    try {
      const response = await requestWithRetry(
        `${telegramBase}/deleteMessage`,
        {
          chat_id: process.env.CHANNEL_ID,
          message_id: item.messageId,
        }
      );

      if (response.ok) {
        deleted += 1;
        deletedMessageIds.add(item.messageId);
        continue;
      }

      const text = await response.text().catch(() => `HTTP ${response.status}`);

      if (isTelegramDeleteNotFound(response.status, text)) {
        deleted += 1;
        deletedNotFound += 1;
        deletedMessageIds.add(item.messageId);
        console.info(
          `[manual-maintenance] Mensaje ${item.messageId} ya no existe (${item.source}), se marca como resuelto.`
        );
        continue;
      }

      failed += 1;
      failedMessageIds.add(item.messageId);
      console.warn(
        `[manual-maintenance] No se pudo borrar mensaje ${item.messageId} (${item.source}): ${text}`
      );
    } catch (err) {
      failed += 1;
      failedMessageIds.add(item.messageId);
      console.warn(
        `[manual-maintenance] Error de red borrando ${item.messageId} (${item.source}): ${err.message}`
      );
    }
  }

  const filteredAndroidPublished = androidPublished.filter((entry) => {
    const messageId = toMessageId(entry);
    return messageId == null || !deletedMessageIds.has(messageId);
  });

  const filteredPcPublished = pcPublished.filter((entry) => {
    const messageId = toMessageId(entry);
    return messageId == null || !deletedMessageIds.has(messageId);
  });

  const filteredAndroidExpired = androidExpired.filter((entry) => {
    const messageId = toMessageId(entry);
    return messageId == null || !deletedMessageIds.has(messageId);
  });

  const filteredPcExpired = pcExpired.filter((entry) => {
    const messageId = toMessageId(entry);
    return messageId == null || !deletedMessageIds.has(messageId);
  });

  await savePublishedGamesList(store, filteredAndroidPublished, "android");
  await savePublishedGamesList(store, filteredPcPublished, "pc");
  await store.setJSON(KEY_ANDROID_EXPIRED, filteredAndroidExpired);
  await store.setJSON(KEY_PC_EXPIRED, filteredPcExpired);
  const unresolvedBacklog = Array.from(failedMessageIds)
    .sort((a, b) => a - b)
    .map((messageId) => toBacklogEntry(messageId))
    .filter(Boolean);
  await store.setJSON(KEY_MANUAL_TELEGRAM_BACKLOG, unresolvedBacklog);

  const trackedRemaining = trackedSent.filter((entry) => {
    const messageId = toMessageId(entry);
    return messageId != null && failedMessageIds.has(messageId);
  });
  await saveTrackedMessages(store, trackedRemaining);

  const tracking = {
    scope: "memory_only",
    channelHistoryReadable: false,
    sources: [
      "published_games_android",
      "published_games_pc",
      "android_expired",
      "pc_expired",
      "manual_telegram_cleanup_queue",
      "telegram_sent_messages",
    ],
  };

  const warnings = [];
  if (uniqueMessages.length === 0) {
    warnings.push(
      "No hay mensajes rastreados en memoria para borrar; puede haber mensajes en el canal no registrados en Blobs."
    );
  }

  return {
    tracking,
    warnings,
    trackedMessages: uniqueMessages.length,
    deleted,
    deletedNotFound,
    failed,
    unresolvedMessageIds: Array.from(failedMessageIds),
    androidPublishedRemaining: filteredAndroidPublished.length,
    pcPublishedRemaining: filteredPcPublished.length,
    androidExpiredRemaining: filteredAndroidExpired.length,
    pcExpiredRemaining: filteredPcExpired.length,
  };
}

async function cleanTelegramOrphanMessages(store) {
  const telegramBase = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

  const androidPublished = await getPublishedGamesList(store, "android");
  const pcPublished = await getPublishedGamesList(store, "pc");
  const trackedSent = await readTrackedMessages(store);

  const activeIds = new Set(
    [...androidPublished, ...pcPublished].map((entry) => toId(entry)).filter(Boolean)
  );
  const activeMessageIds = new Set(
    [...androidPublished, ...pcPublished]
      .map((entry) => toMessageId(entry))
      .filter((messageId) => Number.isInteger(messageId))
  );

  const orphanCandidates = trackedSent.filter((entry) => {
    const messageId = toMessageId(entry);
    const id = toId(entry);

    if (!Number.isInteger(messageId)) {
      return false;
    }

    if (activeMessageIds.has(messageId)) {
      return false;
    }

    if (id && activeIds.has(id)) {
      return false;
    }

    return true;
  });

  let deleted = 0;
  let deletedNotFound = 0;
  let failed = 0;
  const deletedMessageIds = new Set();
  const failedMessageIds = new Set();

  for (const item of orphanCandidates) {
    const messageId = toMessageId(item);
    try {
      const response = await requestWithRetry(
        `${telegramBase}/deleteMessage`,
        {
          chat_id: process.env.CHANNEL_ID,
          message_id: messageId,
        }
      );

      if (response.ok) {
        deleted += 1;
        deletedMessageIds.add(messageId);
        continue;
      }

      const text = await response.text().catch(() => `HTTP ${response.status}`);

      if (isTelegramDeleteNotFound(response.status, text)) {
        deleted += 1;
        deletedNotFound += 1;
        deletedMessageIds.add(messageId);
        continue;
      }

      failed += 1;
      failedMessageIds.add(messageId);
      console.warn(
        `[manual-maintenance] No se pudo borrar huerfano ${messageId}: ${text}`
      );
    } catch (err) {
      failed += 1;
      failedMessageIds.add(messageId);
      console.warn(
        `[manual-maintenance] Error de red borrando huerfano ${messageId}: ${err.message}`
      );
    }
  }

  const nextTracked = trackedSent.filter((entry) => {
    const messageId = toMessageId(entry);
    if (!Number.isInteger(messageId)) {
      return false;
    }

    if (deletedMessageIds.has(messageId)) {
      return false;
    }

    return true;
  });

  await saveTrackedMessages(store, nextTracked);

  return {
    trackedTotal: trackedSent.length,
    activeOffersTracked: activeMessageIds.size,
    orphanCandidates: orphanCandidates.length,
    deleted,
    deletedNotFound,
    failed,
    unresolvedMessageIds: Array.from(failedMessageIds).sort((a, b) => a - b),
    trackedRemaining: nextTracked.length,
  };
}

async function getMaintenanceSnapshot(store, options = {}) {
  const includeSamples = options.includeSamples === true;
  const sampleSize = Number.isInteger(options.sampleSize)
    ? Math.max(1, options.sampleSize)
    : 10;

  const androidPublished = await getPublishedGamesList(store, "android");
  const pcPublished = await getPublishedGamesList(store, "pc");
  const androidQueue = dedupeById(await readJsonArray(store, KEY_ANDROID_QUEUE));
  const pcQueue = dedupeById(await readJsonArray(store, KEY_PC_QUEUE));
  const androidExpired = dedupeById(await readJsonArray(store, KEY_ANDROID_EXPIRED));
  const pcExpired = dedupeById(await readJsonArray(store, KEY_PC_EXPIRED));
  const backlog = dedupeById(await readJsonArray(store, KEY_MANUAL_TELEGRAM_BACKLOG));
  const trackedSent = await readTrackedMessages(store);

  const messageIds = new Set([
    ...Array.from(uniqueValidMessageIds(androidPublished)),
    ...Array.from(uniqueValidMessageIds(pcPublished)),
    ...Array.from(uniqueValidMessageIds(androidExpired)),
    ...Array.from(uniqueValidMessageIds(pcExpired)),
    ...Array.from(uniqueValidMessageIds(backlog)),
    ...Array.from(uniqueValidMessageIds(trackedSent)),
  ]);

  const summary = {
    androidPublished: androidPublished.length,
    pcPublished: pcPublished.length,
    androidQueue: androidQueue.length,
    pcQueue: pcQueue.length,
    androidExpired: androidExpired.length,
    pcExpired: pcExpired.length,
    telegramBacklog: backlog.length,
    trackedTelegramMessages: messageIds.size,
  };

  const tracking = {
    scope: "memory_only",
    channelHistoryReadable: false,
    sources: [
      "published_games_android",
      "published_games_pc",
      "android_expired",
      "pc_expired",
      "manual_telegram_cleanup_queue",
      "telegram_sent_messages",
    ],
  };

  const warnings = [];
  warnings.push(
    "manual-status refleja solo memoria rastreada en Blobs, no el historial completo del canal de Telegram."
  );
  if (summary.trackedTelegramMessages === 0) {
    warnings.push(
      "No hay messageId rastreados actualmente; si el canal tiene mensajes antiguos, no podran reflejarse ni borrarse automaticamente sin registro previo."
    );
  }

  if (!includeSamples) {
    return { summary, tracking, warnings };
  }

  const sampleFrom = (items) =>
    items
      .slice(0, sampleSize)
      .map((entry) => ({
        id: toId(entry) || null,
        messageId: toMessageId(entry),
      }));

  return {
    summary,
    tracking,
    warnings,
    samples: {
      androidQueue: sampleFrom(androidQueue),
      pcQueue: sampleFrom(pcQueue),
      androidExpired: sampleFrom(androidExpired),
      pcExpired: sampleFrom(pcExpired),
      telegramBacklog: sampleFrom(backlog),
      telegramTracked: sampleFrom(trackedSent),
    },
  };
}

module.exports = {
  clearAllMemory,
  cleanTelegramOrphanMessages,
  deleteTrackedTelegramMessages,
  getMaintenanceSnapshot,
  readTrackedMessages,
  saveTrackedMessages,
  trackTelegramMessage,
};
