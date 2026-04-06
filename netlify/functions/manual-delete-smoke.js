if (process.env.NODE_ENV !== "production") require("dotenv").config();

const {
  createBlobStoreFromEnv,
  getBlobCredentialReport,
} = require("../../utils/netlify-blobs");
const { requestWithRetry } = require("../../utils/telegram");

const KEY_MANUAL_DELETE_SMOKE_RESULT = "manual_delete_smoke_result";

function isAuthorized(event) {
  const requiredKey = process.env.MANUAL_FUNCTION_KEY;
  if (!requiredKey) {
    return true;
  }

  const headerKey =
    event && event.headers
      ? event.headers["x-manual-key"] || event.headers["X-Manual-Key"]
      : null;

  return headerKey === requiredKey;
}

function parseBool(raw, defaultValue) {
  if (raw == null || raw === "") {
    return defaultValue;
  }

  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(value)) {
    return false;
  }

  return defaultValue;
}

function resolveTargetChatId(event) {
  const queryChatId =
    event && event.queryStringParameters && event.queryStringParameters.chatId
      ? String(event.queryStringParameters.chatId).trim()
      : "";

  return queryChatId || process.env.SMOKE_TELEGRAM_CHAT_ID || process.env.CHANNEL_ID || "";
}

function isTelegramDeleteNotAllowed(status, errorText) {
  if (status !== 400 && status !== 403) {
    return false;
  }

  const text = String(errorText || "")
    .toLowerCase()
    .replace(/\u2019/g, "'");

  return (
    text.includes("message can't be deleted") ||
    text.includes("message cant be deleted") ||
    text.includes("message can't be deleted for everyone") ||
    text.includes("not enough rights to delete message") ||
    text.includes("have no rights to delete a message") ||
    text.includes("message_delete_forbidden") ||
    text.includes("chat_admin_required")
  );
}

async function readResponseText(response) {
  try {
    return await response.text();
  } catch (err) {
    return `HTTP ${response.status}`;
  }
}

async function persistSmokeResult(store, result) {
  if (!store || typeof store.setJSON !== "function") {
    return;
  }

  try {
    await store.setJSON(KEY_MANUAL_DELETE_SMOKE_RESULT, {
      ...result,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn(
      `[manual-delete-smoke] No se pudo guardar el ultimo resultado: ${err.message}`
    );
  }
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch (_err) {
    return null;
  }
}

async function getDeletePermissionDiagnostic(telegramBase, chatId) {
  const diagnostic = {
    ok: false,
    chatId,
    botUserId: null,
    botUsername: null,
    memberStatus: null,
    isAdmin: false,
    canDeleteMessages: false,
    details: null,
  };

  const meResponse = await requestWithRetry(`${telegramBase}/getMe`, {});
  if (!meResponse.ok) {
    diagnostic.details = {
      step: "getMe",
      status: meResponse.status,
      error: await readResponseText(meResponse),
    };
    return diagnostic;
  }

  const mePayload = await readJsonSafe(meResponse);
  const botId =
    mePayload && mePayload.result && Number.isInteger(mePayload.result.id)
      ? mePayload.result.id
      : null;
  diagnostic.botUserId = botId;
  diagnostic.botUsername =
    mePayload && mePayload.result && typeof mePayload.result.username === "string"
      ? mePayload.result.username
      : null;

  if (!Number.isInteger(botId)) {
    diagnostic.details = {
      step: "getMe",
      error: "No se pudo obtener bot id desde getMe",
      payload: mePayload,
    };
    return diagnostic;
  }

  const memberResponse = await requestWithRetry(`${telegramBase}/getChatMember`, {
    chat_id: chatId,
    user_id: botId,
  });

  if (!memberResponse.ok) {
    diagnostic.details = {
      step: "getChatMember",
      status: memberResponse.status,
      error: await readResponseText(memberResponse),
    };
    return diagnostic;
  }

  const memberPayload = await readJsonSafe(memberResponse);
  const member = memberPayload && memberPayload.result ? memberPayload.result : null;
  const status = member && typeof member.status === "string" ? member.status : null;
  const canDelete = Boolean(member && member.can_delete_messages === true);
  const isAdmin = status === "administrator" || status === "creator";

  diagnostic.ok = true;
  diagnostic.memberStatus = status;
  diagnostic.isAdmin = isAdmin;
  diagnostic.canDeleteMessages = canDelete;
  diagnostic.details = {
    step: "getChatMember",
    payload: member,
  };

  return diagnostic;
}

exports.handler = async (event) => {
  if (!isAuthorized(event)) {
    return {
      statusCode: 401,
      body: "No autorizado para ejecutar manual-delete-smoke.",
    };
  }

  console.log("========================================");
  console.log("🧪 INICIANDO MANUAL-DELETE-SMOKE");
  console.log("========================================");

  try {
    const blobReport = getBlobCredentialReport(process.env);
    if (blobReport.issues.length > 0) {
      console.error("Credenciales Blobs invalidas:");
      for (const issue of blobReport.issues) {
        console.error(` - ${issue}`);
      }
    }

    const store = createBlobStoreFromEnv({ storeName: "memory-store" });
    const chatId = resolveTargetChatId(event);
    const skipDelete = parseBool(
      event && event.queryStringParameters ? event.queryStringParameters.skipDelete : null,
      false
    );
    const softFailDeleteError = parseBool(
      event && event.queryStringParameters
        ? event.queryStringParameters.softFailDeleteError
        : null,
      false
    );

    if (!process.env.TELEGRAM_TOKEN) {
      await persistSmokeResult(store, {
        success: false,
        action: "manual-delete-smoke",
        step: "preflight",
        chatId: chatId || null,
        error: "Falta TELEGRAM_TOKEN",
      });

      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: "Falta TELEGRAM_TOKEN",
        }),
      };
    }

    if (!chatId) {
      await persistSmokeResult(store, {
        success: false,
        action: "manual-delete-smoke",
        step: "preflight",
        chatId: null,
        error: "Falta chatId objetivo",
      });

      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: "Falta chatId objetivo. Usa CHANNEL_ID, SMOKE_TELEGRAM_CHAT_ID o ?chatId=...",
        }),
      };
    }

    const telegramBase = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;
    const smokeText =
      event && event.queryStringParameters && event.queryStringParameters.text
        ? String(event.queryStringParameters.text).slice(0, 120)
        : "Telegram delete smoke check";

    const sendResponse = await requestWithRetry(`${telegramBase}/sendMessage`, {
      chat_id: chatId,
      text: smokeText,
      disable_web_page_preview: true,
    });

    const sendText = await readResponseText(sendResponse);
    if (!sendResponse.ok) {
      await persistSmokeResult(store, {
        success: false,
        action: "manual-delete-smoke",
        step: "sendMessage",
        chatId,
        status: sendResponse.status,
        error: sendText,
      });

      return {
        statusCode: 502,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          success: false,
          step: "sendMessage",
          chatId,
          status: sendResponse.status,
          error: sendText,
        }),
      };
    }

    const payload = await sendResponse.json().catch(() => ({}));
    const messageId = payload && payload.result ? payload.result.message_id ?? null : null;

    if (!Number.isInteger(messageId)) {
      await persistSmokeResult(store, {
        success: false,
        action: "manual-delete-smoke",
        step: "sendMessage",
        chatId,
        error: "No se pudo leer message_id del mensaje temporal",
        response: payload,
      });

      return {
        statusCode: 502,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          success: false,
          step: "sendMessage",
          chatId,
          error: "No se pudo leer message_id del mensaje temporal",
          response: payload,
        }),
      };
    }

    if (skipDelete) {
      await persistSmokeResult(store, {
        success: true,
        action: "manual-delete-smoke",
        step: "sendMessage",
        chatId,
        messageId,
        skipDelete: true,
        sendStatus: sendResponse.status,
      });

      return {
        statusCode: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          success: true,
          step: "sendMessage",
          chatId,
          messageId,
          skipDelete: true,
          note: "Se envio el mensaje temporal pero no se borro porque skipDelete=true.",
        }),
      };
    }

    const deleteResponse = await requestWithRetry(`${telegramBase}/deleteMessage`, {
      chat_id: chatId,
      message_id: messageId,
    });

    const deleteText = await readResponseText(deleteResponse);
    if (!deleteResponse.ok) {
      const notAllowed = isTelegramDeleteNotAllowed(deleteResponse.status, deleteText);
      let permissionDiagnostic = null;

      if (notAllowed) {
        try {
          permissionDiagnostic = await getDeletePermissionDiagnostic(telegramBase, chatId);
        } catch (diagErr) {
          permissionDiagnostic = {
            ok: false,
            chatId,
            details: {
              step: "diagnostic",
              error: diagErr.message,
            },
          };
        }
      }

      await persistSmokeResult(store, {
        success: false,
        action: "manual-delete-smoke",
        step: "deleteMessage",
        chatId,
        messageId,
        softFailDeleteError,
        nonDeletable: notAllowed,
        permissionDiagnostic,
        sendStatus: sendResponse.status,
        deleteStatus: deleteResponse.status,
        deleteError: deleteText,
        sendResponse: sendText,
      });

      if (softFailDeleteError && notAllowed) {
        return {
          statusCode: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            success: false,
            action: "manual-delete-smoke",
            step: "deleteMessage",
            degraded: true,
            reason: "message_not_deletable",
            hint:
              "Verifica que el bot sea admin en el chat/canal y tenga permiso can_delete_messages.",
            chatId,
            messageId,
            permissionDiagnostic,
            sendStatus: sendResponse.status,
            deleteStatus: deleteResponse.status,
            deleteError: deleteText,
          }),
        };
      }

      return {
        statusCode: 502,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          success: false,
          step: "deleteMessage",
          chatId,
          messageId,
          permissionDiagnostic,
          sendStatus: sendResponse.status,
          deleteStatus: deleteResponse.status,
          deleteError: deleteText,
          sendResponse: sendText,
        }),
      };
    }

    console.log(
      `[manual-delete-smoke] OK chatId=${chatId} messageId=${messageId} send=${sendResponse.status} delete=${deleteResponse.status}`
    );

    await persistSmokeResult(store, {
      success: true,
      action: "manual-delete-smoke",
      step: "deleteMessage",
      chatId,
      messageId,
      sendStatus: sendResponse.status,
      deleteStatus: deleteResponse.status,
    });

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        success: true,
        action: "manual-delete-smoke",
        chatId,
        messageId,
        sendStatus: sendResponse.status,
        deleteStatus: deleteResponse.status,
      }),
    };
  } catch (error) {
    console.error("❌ ERROR EN MANUAL-DELETE-SMOKE:", error);
    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ success: false, error: String(error) }),
    };
  }
};

exports._private = {
  isTelegramDeleteNotAllowed,
};
