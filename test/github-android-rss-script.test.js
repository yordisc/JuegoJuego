const test = require("node:test");
const assert = require("node:assert");
const Module = require("node:module");

const originalLoad = Module._load;

let mockStore = null;
let mockPublishedGames = [];
let mockRssResult = {
  feedItems: 0,
  feedActiveIds: 0,
  feedActiveIdList: [],
  queueBefore: 0,
  queueAfter: 0,
  added: 0,
};
let mockExpirationResult = { expired: [], meta: { reason: "ok" } };
let cleanupExpiredCount = 0;
let saveCalls = [];
let cleanupCalls = [];
let capturedWarnings = [];
let summaryWrites = [];

function createStore(initial = {}) {
  const data = { ...initial };

  return {
    get: async (key) => (key in data ? JSON.stringify(data[key]) : null),
    setJSON: async (key, value) => {
      data[key] = value;
    },
    snapshot: () => ({ ...data }),
  };
}

Module._load = function (request, parent, isMain) {
  if (request === "node:fs/promises") {
    return {
      appendFile: async (_path, content) => {
        summaryWrites.push(String(content));
      },
    };
  }

  if (request === "@netlify/blobs") {
    return {
      getStore: () => mockStore,
    };
  }

  if (request === "../utils/memory") {
    return {
      getPublishedGamesList: async () => [...mockPublishedGames],
      savePublishedGamesList: async (_store, data, platform) => {
        saveCalls.push({ size: data.length, platform });
      },
    };
  }

  if (request === "../services/android-rss") {
    return {
      buildAndroidRssQueue: async () => ({ ...mockRssResult }),
      inferExpiredAndroidFromFeed: () => mockExpirationResult,
    };
  }

  if (request === "../services/android-deals") {
    return {
      checkAndroidDeals: async (_store, _publishedGames, options) => {
        cleanupCalls.push(options);
        return { expiredCount: cleanupExpiredCount };
      },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { main } = require("../scripts/github-android-rss");

test("Suite Script Android RSS (Actions)", async (t) => {
  const originalWarn = console.warn;

  t.after(() => {
    Module._load = originalLoad;
    console.warn = originalWarn;
    delete process.env.NETLIFY_SITE_ID;
    delete process.env.NETLIFY_API_TOKEN;
    delete process.env.ANDROID_RSS_SKIP_CLEANUP;
    delete process.env.ANDROID_RSS_EXPIRATION_ENABLED;
    delete process.env.GITHUB_STEP_SUMMARY;
  });

  t.beforeEach(() => {
    mockStore = createStore({
      android_queue: [{ id: "com.safe.in.queue", messageId: 101 }],
      android_expired: [
        { id: "com.keep.expired", messageId: 202 },
        { id: "com.old", messageId: 303 },
      ],
    });
    mockPublishedGames = [{ id: "com.old", messageId: 303, publishedAt: 1000 }];
    mockRssResult = {
      feedItems: 20,
      feedActiveIds: 15,
      feedActiveIdList: ["com.safe.in.queue", "com.active"],
      queueBefore: 1,
      queueAfter: 2,
      added: 1,
    };
    mockExpirationResult = {
      expired: [
        { id: "com.old", messageId: 303, source: "rss" },
        { id: "com.safe.in.queue", messageId: 101, source: "rss" },
      ],
      meta: { reason: "ok", blockedByRatio: false },
    };
    cleanupExpiredCount = 1;
    saveCalls = [];
    cleanupCalls = [];
    capturedWarnings = [];
    summaryWrites = [];

    console.warn = (...args) => {
      capturedWarnings.push(args.join(" "));
    };

    process.env.NETLIFY_SITE_ID = "site-test";
    process.env.NETLIFY_API_TOKEN = "token-test";
    process.env.ANDROID_RSS_EXPIRATION_ENABLED = "true";
    process.env.ANDROID_RSS_SKIP_CLEANUP = "true";
  });

  await t.test("mergea expirados deduplicados y excluye IDs aun en queue", async () => {
    await main();

    const snapshot = mockStore.snapshot();
    assert.deepStrictEqual(snapshot.android_expired, [
      { id: "com.keep.expired", messageId: 202 },
      { id: "com.old", messageId: 303, source: "rss" },
    ]);

    assert.strictEqual(cleanupCalls.length, 0);
    assert.deepStrictEqual(saveCalls, [{ size: 1, platform: "android" }]);
  });

  await t.test("ejecuta cleanup cuando skip_cleanup es false", async () => {
    process.env.ANDROID_RSS_SKIP_CLEANUP = "false";

    await main();

    assert.strictEqual(cleanupCalls.length, 1);
    assert.deepStrictEqual(cleanupCalls[0], {
      processQueue: false,
      processExpired: true,
    });
  });

  await t.test("loggea advertencia cuando el failsafe por ratio bloquea expiracion", async () => {
    mockExpirationResult = {
      expired: [],
      meta: {
        reason: "blocked_by_max_expire_ratio",
        blockedByRatio: true,
        candidateExpired: 20,
        maxAllowed: 5,
        publishedCount: 30,
        maxExpireRatio: 0.35,
      },
    };

    await main();

    assert.ok(
      capturedWarnings.some((line) =>
        line.includes("Failsafe de expiracion activado por ratio")
      )
    );
  });

  await t.test("escribe detalle del failsafe en GITHUB_STEP_SUMMARY", async () => {
    process.env.GITHUB_STEP_SUMMARY = "/tmp/fake-summary.md";
    mockExpirationResult = {
      expired: [],
      meta: {
        reason: "blocked_by_max_expire_ratio",
        blockedByRatio: true,
        candidateExpired: 14,
        maxAllowed: 4,
        publishedCount: 20,
        maxExpireRatio: 0.2,
      },
    };

    await main();

    const summary = summaryWrites.join("\n");
    assert.ok(summary.includes("Razon expiracion: blocked_by_max_expire_ratio"));
    assert.ok(summary.includes("Failsafe ratio activado: si"));
    assert.ok(summary.includes("candidatos=14"));
    assert.ok(summary.includes("maximo=4"));
  });

  await t.test("aborta por kill-switch si feed activo es cero", async () => {
    mockRssResult = {
      feedItems: 0,
      feedActiveIds: 0,
      feedActiveIdList: [],
      queueBefore: 0,
      queueAfter: 0,
      added: 0,
    };

    await assert.rejects(() => main(), /Kill switch activado/);
  });
});
