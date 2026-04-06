function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function buildAndroidStatusSummary(snapshot = {}) {
  const summary = snapshot && snapshot.summary ? snapshot.summary : {};
  const androidStatus =
    summary && typeof summary.androidStatus === "object"
      ? summary.androidStatus
      : {};

  const pendingSend = parsePositiveInt(androidStatus.pendingSend, 0);
  const sentUnverified = parsePositiveInt(androidStatus.sentUnverified, 0);
  const sentVerified = parsePositiveInt(androidStatus.sentVerified, 0);

  const androidPublished = parsePositiveInt(summary.androidPublished, 0);
  const androidQueue = parsePositiveInt(summary.androidQueue, 0);
  const androidExpired = parsePositiveInt(summary.androidExpired, 0);

  return {
    pendingSend,
    sentUnverified,
    sentVerified,
    androidPublished,
    androidQueue,
    androidExpired,
  };
}

function shouldAlertAndroidStatus(statusSummary, env = process.env) {
  const pendingThreshold = parsePositiveInt(
    env.ANDROID_STATUS_ALERT_PENDING_THRESHOLD,
    1
  );
  const unverifiedThreshold = parsePositiveInt(
    env.ANDROID_STATUS_ALERT_UNVERIFIED_THRESHOLD,
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

function buildAndroidStatusAlertText(statusSummary, options = {}) {
  const generatedAt =
    typeof options.generatedAt === "string" && options.generatedAt.trim()
      ? options.generatedAt.trim()
      : new Date().toISOString();

  const health = getHealthLabel(statusSummary);
  const title =
    health === "ok"
      ? "✅ Android Status Diario"
      : "⚠️ Android Status Diario";

  const lines = [
    title,
    `Fecha UTC: ${generatedAt}`,
    "",
    `Publicado total: ${statusSummary.androidPublished}`,
    `En cola Android: ${statusSummary.androidQueue}`,
    `Expirados Android: ${statusSummary.androidExpired}`,
    "",
    `Estado pending_send: ${statusSummary.pendingSend}`,
    `Estado sent_unverified: ${statusSummary.sentUnverified}`,
    `Estado sent_verified: ${statusSummary.sentVerified}`,
  ];

  if (health !== "ok") {
    lines.push("");
    lines.push("Accion sugerida: revisar verify-android-publications y logs de consumidor.");
  }

  return {
    health,
    text: lines.join("\n"),
  };
}

module.exports = {
  buildAndroidStatusSummary,
  shouldAlertAndroidStatus,
  buildAndroidStatusAlertText,
  getHealthLabel,
};
