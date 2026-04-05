const test = require("node:test");
const assert = require("node:assert");

const {
  scanAndroidPublishedGamesForExpiration,
  isCurrentlyFree,
} = require("../services/android-expiration");

test("Suite Android Expiration Scanner", async (t) => {
  await t.test("Marca expirados cuando el juego deja de ser gratis", async () => {
    const publishedGames = [
      { id: "com.keep.free", messageId: 11, publishedAt: 1000 },
      { id: "com.expired.now", messageId: 22, publishedAt: 2000 },
    ];

    const result = await scanAndroidPublishedGamesForExpiration(publishedGames, {
      detailsFetcher: async (appId) => {
        if (appId === "com.keep.free") {
          return { free: true, price: 0, priceText: "Free" };
        }

        return { free: false, price: 1.99, priceText: "$1.99" };
      },
      maxExpireRatio: 1,
      detailsDelayMs: 0,
      withMeta: true,
      now: 10_000,
    });

    assert.deepStrictEqual(result.expired, [
      { id: "com.expired.now", messageId: 22, source: "playstore" },
    ]);
    assert.strictEqual(result.meta.reason, "ok");
    assert.strictEqual(result.meta.candidateExpired, 1);
  });

  await t.test("Respeta el failsafe de ratio ante una caida masiva", async () => {
    const publishedGames = [
      { id: "com.expired.1", messageId: 1, publishedAt: 1 },
      { id: "com.expired.2", messageId: 2, publishedAt: 2 },
      { id: "com.expired.3", messageId: 3, publishedAt: 3 },
      { id: "com.expired.4", messageId: 4, publishedAt: 4 },
      { id: "com.keep.5", messageId: 5, publishedAt: 5 },
    ];

    const result = await scanAndroidPublishedGamesForExpiration(publishedGames, {
      detailsFetcher: async () => ({ free: false, price: 3.99, priceText: "$3.99" }),
      maxExpireRatio: 0.4,
      detailsDelayMs: 0,
      withMeta: true,
    });

    assert.deepStrictEqual(result.expired, []);
    assert.strictEqual(result.meta.reason, "blocked_by_max_expire_ratio");
    assert.strictEqual(result.meta.blockedByRatio, true);
  });

  await t.test("No considera gratis un precio con valor positivo", () => {
    assert.strictEqual(isCurrentlyFree({ free: false, price: 1.99, priceText: "$1.99" }), false);
    assert.strictEqual(isCurrentlyFree({ free: true, price: 4.99, priceText: "$4.99" }), true);
  });
});