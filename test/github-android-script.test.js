const test = require("node:test");
const assert = require("node:assert");

const { inferSafeExpiredForProducer } = require("../scripts/github-android");

test("Suite Script Android Producer (expiracion segura)", async (t) => {
  t.beforeEach(() => {
    process.env.ANDROID_PRODUCER_MIN_ACTIVE_IDS = "10";
    process.env.ANDROID_PRODUCER_EXPIRATION_GRACE_HOURS = "24";
    process.env.ANDROID_PRODUCER_MAX_EXPIRE_RATIO = "0.35";
  });

  t.afterEach(() => {
    delete process.env.ANDROID_PRODUCER_MIN_ACTIVE_IDS;
    delete process.env.ANDROID_PRODUCER_EXPIRATION_GRACE_HOURS;
    delete process.env.ANDROID_PRODUCER_MAX_EXPIRE_RATIO;
  });

  await t.test("No infiere expirados con muestra activa insuficiente", () => {
    const now = Date.now();
    const publishedGames = [
      { id: "com.keep.active", messageId: 100, publishedAt: now - 48 * 60 * 60 * 1000 },
      { id: "com.old.maybe", messageId: 101, publishedAt: now - 48 * 60 * 60 * 1000 },
    ];

    const result = inferSafeExpiredForProducer(
      publishedGames,
      ["com.keep.active", "com.x"],
      [],
      []
    );

    assert.deepStrictEqual(result.inferredExpired, []);
    assert.deepStrictEqual(result.mergedExpired, []);
    assert.strictEqual(result.expirationMeta.reason, "low_active_ids");
  });

  await t.test("No infiere expirados cuando se activa failsafe por ratio", () => {
    const now = Date.now();
    const publishedGames = [
      { id: "com.keep.1", messageId: 1, publishedAt: now - 72 * 60 * 60 * 1000 },
      { id: "com.keep.2", messageId: 2, publishedAt: now - 72 * 60 * 60 * 1000 },
      { id: "com.expire.1", messageId: 3, publishedAt: now - 72 * 60 * 60 * 1000 },
      { id: "com.expire.2", messageId: 4, publishedAt: now - 72 * 60 * 60 * 1000 },
      { id: "com.expire.3", messageId: 5, publishedAt: now - 72 * 60 * 60 * 1000 },
    ];

    const activeDealIds = [
      "com.keep.1",
      "com.keep.2",
      "com.a",
      "com.b",
      "com.c",
      "com.d",
      "com.e",
      "com.f",
      "com.g",
      "com.h",
    ];

    const result = inferSafeExpiredForProducer(
      publishedGames,
      activeDealIds,
      [],
      [],
      { maxExpireRatio: 0.4 }
    );

    assert.deepStrictEqual(result.inferredExpired, []);
    assert.deepStrictEqual(result.mergedExpired, []);
    assert.strictEqual(result.expirationMeta.reason, "blocked_by_max_expire_ratio");
  });

  await t.test("Mergea expirados previos/inferidos y excluye IDs en queue", () => {
    const now = Date.now();
    const publishedGames = [
      { id: "com.keep.active", messageId: 10, publishedAt: now - 48 * 60 * 60 * 1000 },
      { id: "com.old.expire", messageId: 11, publishedAt: now - 48 * 60 * 60 * 1000 },
      { id: "com.in.queue", messageId: 12, publishedAt: now - 48 * 60 * 60 * 1000 },
    ];

    const existingExpired = [
      { id: "com.keep.prev", messageId: 99 },
      { id: "com.in.queue", messageId: 12 },
    ];

    const queue = [{ id: "com.in.queue" }];
    const activeDealIds = [
      "com.keep.active",
      "com.a",
      "com.b",
      "com.c",
      "com.d",
      "com.e",
      "com.f",
      "com.g",
      "com.h",
      "com.i",
    ];

    const result = inferSafeExpiredForProducer(
      publishedGames,
      activeDealIds,
      existingExpired,
      queue,
      { minActiveIds: 10, graceHours: 24, maxExpireRatio: 1 }
    );

    assert.deepStrictEqual(result.inferredExpired, [
      { id: "com.old.expire", messageId: 11 },
      { id: "com.in.queue", messageId: 12 },
    ]);

    assert.deepStrictEqual(result.mergedExpired, [
      { id: "com.keep.prev", messageId: 99 },
      { id: "com.old.expire", messageId: 11 },
    ]);
    assert.strictEqual(result.expirationMeta.reason, "ok");
  });
});
