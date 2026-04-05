const test = require("node:test");
const assert = require("node:assert");
const Module = require("node:module");

const originalLoad = Module._load;

const calls = {
  getPublishedGamesList: [],
  savePublishedGamesList: [],
  checkAndroidDeals: [],
  checkPCGames: [],
};

const memoryByPlatform = {
  android: [],
  pc: [],
};

let mockStore = null;
let mockBlobReport = {
  siteID: "73ae4611-e40d-4cf1-bb2f-cab3fa825286",
  token: "test-token",
  issues: [],
};

function resetCalls() {
  calls.getPublishedGamesList = [];
  calls.savePublishedGamesList = [];
  calls.checkAndroidDeals = [];
  calls.checkPCGames = [];
}

function createStore(initial = {}) {
  const data = { ...initial };
  const setCalls = [];

  return {
    get: async (key) => (key in data ? JSON.stringify(data[key]) : null),
    setJSON: async (key, value) => {
      setCalls.push({ key, value });
      data[key] = value;
    },
    getSetCalls: () => setCalls.slice(),
  };
}

Module._load = function (request, parent, isMain) {
  if (request === "../../utils/memory") {
    return {
      getPublishedGamesList: async (store, platform = "android") => {
        calls.getPublishedGamesList.push({ platform });
        return [...(memoryByPlatform[platform] || [])];
      },
      savePublishedGamesList: async (store, data, platform = "android") => {
        calls.savePublishedGamesList.push({ platform, size: data.length });
      },
    };
  }

  if (request === "../../services/android-deals") {
    return {
      checkAndroidDeals: async (store, publishedGames, options) => {
        calls.checkAndroidDeals.push({ options, size: publishedGames.length });
      },
    };
  }

  if (request === "../../services/pc-games") {
    return {
      checkPCGames: async (store, publishedGames, options) => {
        calls.checkPCGames.push({ options, size: publishedGames.length });
      },
    };
  }

  if (request === "../../utils/netlify-blobs") {
    return {
      createBlobStoreFromEnv: () => mockStore,
      getBlobCredentialReport: () => mockBlobReport,
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { handler } = require("../netlify/functions/clean-expired");

test("Suite Clean Expired Function", async (t) => {
  t.after(() => {
    Module._load = originalLoad;
  });

  t.beforeEach(() => {
    resetCalls();
    mockBlobReport = {
      siteID: "73ae4611-e40d-4cf1-bb2f-cab3fa825286",
      token: "test-token",
      issues: [],
    };
    memoryByPlatform.android = [];
    memoryByPlatform.pc = [];
  });

  await t.test("Modo seguro: si falla GamerPower, limpia Android y omite limpieza PC", async () => {
    memoryByPlatform.android = [{ id: "com.android.old", messageId: 11 }];
    memoryByPlatform.pc = [{ id: "100", messageId: 22 }];

    mockStore = createStore({
      android_queue: [{ id: "com.android.active", messageId: 77 }],
      android_expired: [
        { id: "com.android.active", messageId: 77 },
        { id: "com.android.old", messageId: 11 },
      ],
      pc_expired: [{ id: "100", messageId: 22 }],
    });

    global.fetch = async () => {
      throw new Error("network down");
    };

    const result = await handler();
    const setCalls = mockStore.getSetCalls();

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(calls.checkAndroidDeals.length, 1);
    assert.strictEqual(calls.checkPCGames.length, 1);

    assert.deepStrictEqual(calls.checkAndroidDeals[0].options, {
      processQueue: false,
      processExpired: true,
    });
    assert.deepStrictEqual(calls.checkPCGames[0].options, {
      processQueue: false,
      processExpired: false,
    });

    const androidExpiredWrite = setCalls.find((row) => row.key === "android_expired");
    const pcExpiredWrite = setCalls.find((row) => row.key === "pc_expired");

    assert.ok(androidExpiredWrite);
    assert.deepStrictEqual(androidExpiredWrite.value, [
      { id: "com.android.old", messageId: 11 },
    ]);
    assert.strictEqual(pcExpiredWrite, undefined);
  });

  await t.test("Modo normal: limpia Android y PC con reconciliacion segura", async () => {
    memoryByPlatform.android = [{ id: "com.android.old", messageId: 11 }];
    memoryByPlatform.pc = [
      { id: "100", messageId: 21 },
      { id: "200", messageId: 22 },
    ];

    mockStore = createStore({
      android_queue: [],
      android_expired: [{ id: "com.android.old", messageId: 11 }],
      pc_expired: [{ id: "200", messageId: 22 }],
    });

    let requestedUrl = "";
    global.fetch = async (url) => {
      requestedUrl = String(url || "");
      return {
      ok: true,
      json: async () => [{ id: "100" }],
      };
    };

    const result = await handler();
    const setCalls = mockStore.getSetCalls();

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(calls.checkAndroidDeals.length, 1);
    assert.strictEqual(calls.checkPCGames.length, 1);

    assert.deepStrictEqual(calls.checkAndroidDeals[0].options, {
      processQueue: false,
      processExpired: true,
    });
    assert.deepStrictEqual(calls.checkPCGames[0].options, {
      processQueue: false,
      processExpired: true,
    });

    const androidExpiredWrite = setCalls.find((row) => row.key === "android_expired");
    const pcExpiredWrite = setCalls.find((row) => row.key === "pc_expired");

    assert.ok(androidExpiredWrite);
    assert.ok(pcExpiredWrite);
    assert.deepStrictEqual(pcExpiredWrite.value, [
      { id: "200", messageId: 22 },
    ]);
    assert.ok(requestedUrl.includes("/api/filter"));
    assert.ok(requestedUrl.includes("platform=pc"));
    assert.ok(requestedUrl.includes("type=game"));
  });

  await t.test("Android: no limpia expirados que tambien estan en android_queue", async () => {
    memoryByPlatform.android = [
      { id: "com.android.safe", messageId: 31 },
      { id: "com.android.old", messageId: 32 },
    ];

    mockStore = createStore({
      android_queue: [{ id: "com.android.safe", messageId: 31 }],
      android_expired: [
        { id: "com.android.safe", messageId: 31 },
        { id: "com.android.old", messageId: 32 },
      ],
      pc_expired: [],
    });

    global.fetch = async () => ({
      ok: true,
      json: async () => [],
    });

    const result = await handler();
    const setCalls = mockStore.getSetCalls();

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(calls.checkAndroidDeals.length, 1);
    assert.deepStrictEqual(calls.checkAndroidDeals[0].options, {
      processQueue: false,
      processExpired: true,
    });

    const androidExpiredWrite = setCalls.find((row) => row.key === "android_expired");
    assert.ok(androidExpiredWrite);
    assert.deepStrictEqual(androidExpiredWrite.value, [
      { id: "com.android.old", messageId: 32 },
    ]);
  });

  await t.test("PC: normaliza IDs con espacios para evitar falsos expirados", async () => {
    memoryByPlatform.pc = [{ id: " 100 ", messageId: 50 }];

    mockStore = createStore({
      android_queue: [],
      android_expired: [],
      pc_expired: [],
    });

    global.fetch = async () => ({
      ok: true,
      json: async () => [{ id: "100" }],
    });

    const result = await handler();
    const setCalls = mockStore.getSetCalls();
    const pcExpiredWrite = setCalls.find((row) => row.key === "pc_expired");

    assert.strictEqual(result.statusCode, 200);
    assert.ok(pcExpiredWrite);
    assert.deepStrictEqual(pcExpiredWrite.value, []);
  });
});
