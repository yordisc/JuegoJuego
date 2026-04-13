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

exports.handler = async () => {
  console.log("========================================");
  console.log("📈 INICIANDO PC-STATUS-REPORT");
  console.log("========================================");

  try {
    const report = getBlobCredentialReport(process.env);
    if (report.issues.length > 0) {
      console.error("Credenciales Blobs invalidas:");
      for (const issue of report.issues) {
        console.error(` - ${issue}`);
      }
    }

    const store = createBlobStoreFromEnv({ storeName: "memory-store" });
    const snapshot = await getMaintenanceSnapshot(store);
    const pcPublished = await getPublishedGamesList(store, "pc");

    const statusSummary = buildPCStatusSummary(snapshot, pcPublished);
    const alert = buildPCStatusAlertText(statusSummary);

    const mustAlert = shouldAlertPCStatus(statusSummary);
    let alertResult = { sent: false, reason: "skipped" };

    if (isAlertEnabled() && mustAlert) {
      alertResult = await sendStatusAlert(alert.text);
    }

    console.log(
      `[metrics] ${JSON.stringify({
        source: "pc-status-report",
        health: alert.health,
        pending_send: statusSummary.pendingSend,
        sent_unverified: statusSummary.sentUnverified,
        sent_verified: statusSummary.sentVerified,
        alert_required: mustAlert,
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
        action: "pc-status-report",
        report: {
          ...statusSummary,
          health: alert.health,
        },
        alertRequired: mustAlert,
        alertResult,
      }),
    };
  } catch (error) {
    console.error("❌ ERROR EN PC-STATUS-REPORT:", error);
    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ success: false, error: String(error) }),
    };
  }
};
