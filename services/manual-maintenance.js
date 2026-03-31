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

      failed += 1;
      failedMessageIds.add(item.messageId);
      const text = await response.text().catch(() => `HTTP ${response.status}`);
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

  return {
    trackedMessages: uniqueMessages.length,
    deleted,
    failed,
    unresolvedMessageIds: Array.from(failedMessageIds),
    androidPublishedRemaining: filteredAndroidPublished.length,
    pcPublishedRemaining: filteredPcPublished.length,
    androidExpiredRemaining: filteredAndroidExpired.length,
    pcExpiredRemaining: filteredPcExpired.length,
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

  const messageIds = new Set([
    ...Array.from(uniqueValidMessageIds(androidPublished)),
    ...Array.from(uniqueValidMessageIds(pcPublished)),
    ...Array.from(uniqueValidMessageIds(androidExpired)),
    ...Array.from(uniqueValidMessageIds(pcExpired)),
    ...Array.from(uniqueValidMessageIds(backlog)),
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

  if (!includeSamples) {
    return { summary };
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
    samples: {
      androidQueue: sampleFrom(androidQueue),
      pcQueue: sampleFrom(pcQueue),
      androidExpired: sampleFrom(androidExpired),
      pcExpired: sampleFrom(pcExpired),
      telegramBacklog: sampleFrom(backlog),
    },
  };
}

module.exports = {
  clearAllMemory,
  deleteTrackedTelegramMessages,
  getMaintenanceSnapshot,
};
