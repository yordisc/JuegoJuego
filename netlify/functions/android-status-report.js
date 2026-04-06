if (process.env.NODE_ENV !== "production") require("dotenv").config();

const {
  createBlobStoreFromEnv,
  getBlobCredentialReport,
} = require("../../utils/netlify-blobs");
const { getMaintenanceSnapshot } = require("../../services/manual-maintenance");
const {
  buildAndroidStatusSummary,
  shouldAlertAndroidStatus,
  buildAndroidStatusAlertText,
} = require("../../services/android-status-report");
const { requestWithRetry } = require("../../utils/telegram");

function isAlertEnabled(env = process.env) {
  const raw = String(env.ANDROID_STATUS_ALERT_ENABLED ?? "true")
    .trim()
    .toLowerCase();
  return !["0", "false", "off", "no", "n"].includes(raw);
}

async function sendStatusAlert(text) {
  const chatId =
    process.env.ANDROID_STATUS_ALERT_CHAT_ID || process.env.CHANNEL_ID || "";

  if (!chatId) {
    return { sent: false, reason: "missing_chat_id" };
  }

  if (!process.env.TELEGRAM_TOKEN) {
    return { sent: false, reason: "missing_telegram_token" };
  }

  const telegramBase = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;
  const response = await requestWithRetry(`${telegramBase}/sendMessage`, {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => `HTTP ${response.status}`);
    return {
      sent: false,
      reason: `telegram_http_${response.status}`,
      error: errText,
    };
  }

  return { sent: true };
}

exports.handler = async () => {
  console.log("========================================");
  console.log("📈 INICIANDO ANDROID-STATUS-REPORT");
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
    const statusSummary = buildAndroidStatusSummary(snapshot);
    const alert = buildAndroidStatusAlertText(statusSummary);

    const mustAlert = shouldAlertAndroidStatus(statusSummary);
    let alertResult = { sent: false, reason: "skipped" };

    if (isAlertEnabled() && mustAlert) {
      alertResult = await sendStatusAlert(alert.text);
    }

    console.log(
      `[metrics] ${JSON.stringify({
        source: "android-status-report",
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
        action: "android-status-report",
        report: {
          ...statusSummary,
          health: alert.health,
        },
        alertRequired: mustAlert,
        alertResult,
      }),
    };
  } catch (error) {
    console.error("❌ ERROR EN ANDROID-STATUS-REPORT:", error);
    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ success: false, error: String(error) }),
    };
  }
};
