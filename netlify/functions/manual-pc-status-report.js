if (process.env.NODE_ENV !== "production") require("dotenv").config();

const {
  createBlobStoreFromEnv,
  getBlobCredentialReport,
} = require("../../utils/netlify-blobs");
const { getPublishedGamesList } = require("../../utils/memory");
const { getMaintenanceSnapshot } = require("../../services/manual-maintenance");
const {
  buildPCStatusSummary,
  shouldAlertPCStatus,
  buildPCStatusAlertText,
} = require("../../services/pc-status-report");
const { sendStatusAlertAndDelete } = require("../../utils/status-alert");

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

  if (typeof raw === "boolean") {
    return raw;
  }

  if (typeof raw === "string") {
    const value = raw.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(value)) return true;
    if (["0", "false", "no", "n", "off"].includes(value)) return false;
  }

  return defaultValue;
}

function isAlertEnabled(env = process.env) {
  const raw = String(env.PC_STATUS_ALERT_ENABLED ?? "true")
    .trim()
    .toLowerCase();
  return !["0", "false", "off", "no", "n"].includes(raw);
}

async function sendStatusAlert(text) {
  const chatId = process.env.PC_STATUS_ALERT_CHAT_ID || process.env.CHANNEL_ID || "";
  return sendStatusAlertAndDelete(text, {
    chatId,
    telegramToken: process.env.TELEGRAM_TOKEN,
  });
}

exports.handler = async (event) => {
  if (!isAuthorized(event)) {
    return {
      statusCode: 401,
      body: "No autorizado para ejecutar manual-pc-status-report.",
    };
  }

  console.log("========================================");
  console.log("📈 INICIANDO MANUAL-PC-STATUS-REPORT");
  console.log("========================================");

  try {
    const report = getBlobCredentialReport(process.env);
    if (report.issues.length > 0) {
      console.error("Credenciales Blobs invalidas:");
      for (const issue of report.issues) {
        console.error(` - ${issue}`);
      }
    }

    const forceAlert = parseBool(
      event && event.queryStringParameters
        ? event.queryStringParameters.forceAlert
        : null,
      false
    );
    const sendAlert = parseBool(
      event && event.queryStringParameters
        ? event.queryStringParameters.sendAlert
        : null,
      true
    );

    const store = createBlobStoreFromEnv({ storeName: "memory-store" });
    const snapshot = await getMaintenanceSnapshot(store);
    const pcPublished = await getPublishedGamesList(store, "pc");

    const statusSummary = buildPCStatusSummary(snapshot, pcPublished);
    const alert = buildPCStatusAlertText(statusSummary);

    const mustAlert = shouldAlertPCStatus(statusSummary);
    const alertWanted = sendAlert && isAlertEnabled() && (mustAlert || forceAlert);

    let alertResult = {
      sent: false,
      reason: alertWanted ? "not_sent" : "skipped",
    };

    if (alertWanted) {
      alertResult = await sendStatusAlert(alert.text);
    }

    console.log(
      `[metrics] ${JSON.stringify({
        source: "manual-pc-status-report",
        health: alert.health,
        pending_send: statusSummary.pendingSend,
        sent_unverified: statusSummary.sentUnverified,
        sent_verified: statusSummary.sentVerified,
        alert_required: mustAlert,
        alert_forced: forceAlert,
        alert_sent: alertResult.sent === true,
      })}`
    );

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        success: true,
        action: "manual-pc-status-report",
        report: {
          ...statusSummary,
          health: alert.health,
        },
        forceAlert,
        sendAlert,
        alertRequired: mustAlert,
        alertResult,
      }),
    };
  } catch (error) {
    console.error("❌ ERROR EN MANUAL-PC-STATUS-REPORT:", error);
    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ success: false, error: String(error) }),
    };
  }
};
