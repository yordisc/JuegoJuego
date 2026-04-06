const { normalizePublicationStatus } = require("../utils/memory");

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function buildPCStatusSummary(snapshot = {}, pcPublished = []) {
  const summary = snapshot && snapshot.summary ? snapshot.summary : {};

  const pcStatus = {
    pendingSend: 0,
    sentUnverified: 0,
    sentVerified: 0,
  };

  const list = Array.isArray(pcPublished) ? pcPublished : [];
  for (const entry of list) {
    const messageId =
      entry && typeof entry === "object" && Number.isInteger(entry.messageId)
        ? entry.messageId
        : null;
    const status = normalizePublicationStatus(
      entry && typeof entry === "object" ? entry.status : null,
      messageId
    );

    if (status === "sent_verified") {
      pcStatus.sentVerified += 1;
      continue;
    }

    if (status === "sent_unverified") {
      pcStatus.sentUnverified += 1;
      continue;
    }

    pcStatus.pendingSend += 1;
  }

  const pcQueue = parsePositiveInt(summary.pcQueue, 0);
  const pcExpired = parsePositiveInt(summary.pcExpired, 0);

  return {
    pendingSend: pcStatus.pendingSend,
    sentUnverified: pcStatus.sentUnverified,
    sentVerified: pcStatus.sentVerified,
    pcPublished: list.length,
    pcQueue,
    pcExpired,
  };
}

function shouldAlertPCStatus(statusSummary, env = process.env) {
  const pendingThreshold = parsePositiveInt(
    env.PC_STATUS_ALERT_PENDING_THRESHOLD,
    1
  );
  const unverifiedThreshold = parsePositiveInt(
    env.PC_STATUS_ALERT_UNVERIFIED_THRESHOLD,
    1
  );

  return (
    statusSummary.pendingSend >= pendingThreshold ||
    statusSummary.sentUnverified >= unverifiedThreshold
  );
}

function getHealthLabel(statusSummary) {
  if (statusSummary.pendingSend > 0) {
    return "warning-pending-send";
  }

  if (statusSummary.sentUnverified > 0) {
    return "warning-sent-unverified";
  }

  return "ok";
}

function buildPCStatusAlertText(statusSummary, options = {}) {
  const generatedAt =
    typeof options.generatedAt === "string" && options.generatedAt.trim()
      ? options.generatedAt.trim()
      : new Date().toISOString();

  const health = getHealthLabel(statusSummary);
  const title = health === "ok" ? "✅ PC Status Diario" : "⚠️ PC Status Diario";

  const lines = [
    title,
    `Fecha UTC: ${generatedAt}`,
    "",
    `Publicado total PC: ${statusSummary.pcPublished}`,
    `En cola PC: ${statusSummary.pcQueue}`,
    `Expirados PC: ${statusSummary.pcExpired}`,
    "",
    `Estado pending_send: ${statusSummary.pendingSend}`,
    `Estado sent_unverified: ${statusSummary.sentUnverified}`,
    `Estado sent_verified: ${statusSummary.sentVerified}`,
  ];

  if (health !== "ok") {
    lines.push("");
    lines.push("Accion sugerida: revisar verify-pc-publications y logs de consumidor.");
  }

  return {
    health,
    text: lines.join("\n"),
  };
}

module.exports = {
  buildPCStatusSummary,
  shouldAlertPCStatus,
  buildPCStatusAlertText,
  getHealthLabel,
};
