const test = require("node:test");
const assert = require("node:assert");
const Module = require("node:module");

const originalLoad = Module._load;

let mockStore = null;
let mockPublishedGames = [];
let mockScanResult = { expired: [], meta: { reason: "ok" } };
let cleanupCalls = [];
let saveCalls = [];
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
        saveCalls.push({ platform, size: data.length });
      },
    };
  }

  if (request === "../services/android-expiration") {
    return {
      scanAndroidPublishedGamesForExpiration: async () => ({ ...mockScanResult }),
    };
  }

  if (request === "../services/android-deals") {
    return {
      checkAndroidDeals: async (_store, _publishedGames, options) => {
        cleanupCalls.push(options);
        return { expiredCount: 2 };
      },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { main } = require("../scripts/github-android-expired");

test("Suite Script Android Expired (Actions)", async (t) => {
  t.after(() => {
    Module._load = originalLoad;
    delete process.env.NETLIFY_SITE_ID;
    delete process.env.NETLIFY_API_TOKEN;
    delete process.env.ANDROID_EXPIRATION_SCAN_SKIP_CLEANUP;
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
    mockScanResult = {
      expired: [
        { id: "com.old", messageId: 303, source: "playstore" },
        { id: "com.safe.in.queue", messageId: 101, source: "playstore" },
      ],
      meta: { reason: "ok", blockedByRatio: false },
    };
    cleanupCalls = [];
    saveCalls = [];
    summaryWrites = [];

    process.env.NETLIFY_SITE_ID = "site-test";
    process.env.NETLIFY_API_TOKEN = "token-test";
    process.env.ANDROID_EXPIRATION_SCAN_SKIP_CLEANUP = "true";
  });

  await t.test("mergea expirados y excluye los que siguen en queue", async () => {
    await main();

    const snapshot = mockStore.snapshot();
    assert.deepStrictEqual(snapshot.android_expired, [
      { id: "com.keep.expired", messageId: 202 },
      { id: "com.old", messageId: 303, source: "playstore" },
    ]);
    assert.strictEqual(cleanupCalls.length, 0);
    assert.deepStrictEqual(saveCalls, [{ platform: "android", size: 1 }]);
  });

  await t.test("ejecuta cleanup cuando skip_cleanup es false", async () => {
    process.env.ANDROID_EXPIRATION_SCAN_SKIP_CLEANUP = "false";

    await main();

    assert.strictEqual(cleanupCalls.length, 1);
    assert.deepStrictEqual(cleanupCalls[0], {
      processQueue: false,
      processExpired: true,
    });
  });

  await t.test("escribe resumen en GITHUB_STEP_SUMMARY", async () => {
    process.env.GITHUB_STEP_SUMMARY = "/tmp/fake-summary.md";

    await main();

    const summary = summaryWrites.join("\n");
    assert.ok(summary.includes("Android Expiration Scanner (Actions)"));
    assert.ok(summary.includes("Expirados guardados: 2"));
  });
});