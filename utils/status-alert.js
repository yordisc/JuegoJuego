const { requestWithRetry } = require("./telegram");

function isDeleteNotFound(status, errorText) {
  return status === 400 && /message to delete not found/i.test(String(errorText || ""));
}

async function readResponseText(response) {
  try {
    return await response.text();
  } catch (_err) {
    return "";
  }
}

function readJsonSafe(rawText) {
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch (_err) {
    return null;
  }
}

function extractMessageId(payload) {
  const id = payload && payload.result ? payload.result.message_id : null;
  return Number.isInteger(id) ? id : null;
}

async function sendStatusAlertAndDelete(text, options = {}) {
  const chatId =
    options.chatId != null && String(options.chatId).trim()
      ? String(options.chatId).trim()
      : "";
  const telegramToken =
    options.telegramToken != null && String(options.telegramToken).trim()
      ? String(options.telegramToken).trim()
      : "";

  if (!chatId) {
    return { sent: false, reason: "missing_chat_id" };
  }

  if (!telegramToken) {
    return { sent: false, reason: "missing_telegram_token" };
  }

  const telegramBase = `https://api.telegram.org/bot${telegramToken}`;
  const response = await requestWithRetry(`${telegramBase}/sendMessage`, {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });

  const responseText = await readResponseText(response);

  if (!response.ok) {
    return {
      sent: false,
      reason: `telegram_http_${response.status}`,
      error: responseText || `HTTP ${response.status}`,
    };
  }

  const payload = readJsonSafe(responseText);
  const messageId = extractMessageId(payload);
  if (!Number.isInteger(messageId)) {
    return { sent: true, deleted: false, deleteReason: "missing_message_id" };
  }

  const deleteResponse = await requestWithRetry(`${telegramBase}/deleteMessage`, {
    chat_id: chatId,
    message_id: messageId,
  });
  const deleteText = await readResponseText(deleteResponse);

  if (!deleteResponse.ok && !isDeleteNotFound(deleteResponse.status, deleteText)) {
    return {
      sent: true,
      messageId,
      deleted: false,
      deleteReason: `telegram_delete_http_${deleteResponse.status}`,
      deleteError: deleteText || `HTTP ${deleteResponse.status}`,
    };
  }

  return {
    sent: true,
    messageId,
    deleted: true,
    deleteReason: deleteResponse.ok ? "deleted" : "already_deleted",
  };
}

module.exports = {
  sendStatusAlertAndDelete,
};
