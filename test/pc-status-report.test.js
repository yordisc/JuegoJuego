const test = require("node:test");
const assert = require("node:assert");

const {
  buildPCStatusSummary,
  shouldAlertPCStatus,
  buildPCStatusAlertText,
  getHealthLabel,
} = require("../services/pc-status-report");

test("Suite PC Status Report", async () => {
  const summary = buildPCStatusSummary({ summary: {} }, []);
  assert.deepStrictEqual(summary, {
    pendingSend: 0,
    sentUnverified: 0,
    sentVerified: 0,
    pcPublished: 0,
    pcQueue: 0,
    pcExpired: 0,
  });

  const withData = buildPCStatusSummary(
    {
      summary: {
        pcQueue: 2,
        pcExpired: 1,
      },
    },
    [
      { id: "pc.a", messageId: null, status: "pending_send" },
      { id: "pc.b", messageId: 10, status: "sent_unverified" },
      { id: "pc.c", messageId: 11, status: "sent_verified" },
    ]
  );

  assert.deepStrictEqual(withData, {
    pendingSend: 1,
    sentUnverified: 1,
    sentVerified: 1,
    pcPublished: 3,
    pcQueue: 2,
    pcExpired: 1,
  });

  const env = {
    PC_STATUS_ALERT_PENDING_THRESHOLD: "2",
    PC_STATUS_ALERT_UNVERIFIED_THRESHOLD: "2",
  };
  assert.strictEqual(
    shouldAlertPCStatus({ pendingSend: 2, sentUnverified: 0 }, env),
    true
  );
  assert.strictEqual(
    shouldAlertPCStatus({ pendingSend: 0, sentUnverified: 2 }, env),
    true
  );
  assert.strictEqual(
    shouldAlertPCStatus({ pendingSend: 1, sentUnverified: 1 }, env),
    false
  );

  assert.strictEqual(
    getHealthLabel({ pendingSend: 1, sentUnverified: 0 }),
    "warning-pending-send"
  );
  assert.strictEqual(
    getHealthLabel({ pendingSend: 0, sentUnverified: 2 }),
    "warning-sent-unverified"
  );
  assert.strictEqual(
    getHealthLabel({ pendingSend: 0, sentUnverified: 0 }),
    "ok"
  );

  const alert = buildPCStatusAlertText(withData, {
    generatedAt: "2026-04-06T12:00:00.000Z",
  });
  assert.strictEqual(alert.health, "warning-pending-send");
  assert.ok(alert.text.includes("PC Status Diario"));
  assert.ok(alert.text.includes("Estado pending_send: 1"));
});
