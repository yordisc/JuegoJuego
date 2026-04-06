const test = require("node:test");
const assert = require("node:assert");

const {
  buildAndroidStatusSummary,
  shouldAlertAndroidStatus,
  buildAndroidStatusAlertText,
  getHealthLabel,
} = require("../services/android-status-report");

test("Suite Android Status Report", async (t) => {
  await t.test("Construye resumen con defaults seguros", () => {
    const summary = buildAndroidStatusSummary({ summary: {} });

    assert.deepStrictEqual(summary, {
      pendingSend: 0,
      sentUnverified: 0,
      sentVerified: 0,
      androidPublished: 0,
      androidQueue: 0,
      androidExpired: 0,
    });
  });

  await t.test("Determina alerta por pending_send y sent_unverified", () => {
    const env = {
      ANDROID_STATUS_ALERT_PENDING_THRESHOLD: "2",
      ANDROID_STATUS_ALERT_UNVERIFIED_THRESHOLD: "3",
    };

    assert.strictEqual(
      shouldAlertAndroidStatus(
        { pendingSend: 2, sentUnverified: 0 },
        env
      ),
      true
    );

    assert.strictEqual(
      shouldAlertAndroidStatus(
        { pendingSend: 0, sentUnverified: 3 },
        env
      ),
      true
    );

    assert.strictEqual(
      shouldAlertAndroidStatus(
        { pendingSend: 1, sentUnverified: 2 },
        env
      ),
      false
    );
  });

  await t.test("Etiqueta de salud y mensaje", () => {
    const status = {
      pendingSend: 1,
      sentUnverified: 0,
      sentVerified: 10,
      androidPublished: 11,
      androidQueue: 2,
      androidExpired: 0,
    };

    assert.strictEqual(getHealthLabel(status), "warning-pending-send");

    const alert = buildAndroidStatusAlertText(status, {
      generatedAt: "2026-04-06T12:00:00.000Z",
    });

    assert.strictEqual(alert.health, "warning-pending-send");
    assert.ok(alert.text.includes("Estado pending_send: 1"));
    assert.ok(alert.text.includes("Accion sugerida"));
  });
});
