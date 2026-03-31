const test = require("node:test");
const assert = require("node:assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === "@netlify/blobs") {
    return {
      getStore: () => ({
        get: async () => null,
        setJSON: async () => {},
      }),
    };
  }

  return originalLoad.call(this, request, ...args);
};

const {
  getMaintenanceSnapshot,
  deleteTrackedTelegramMessages,
} = require("../services/manual-maintenance");

function createMockStore(dataByKey) {
  const data = { ...dataByKey };

  return {
    get: async (key) => {
      if (!(key in data)) {
        return null;
      }

      const value = data[key];
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    setJSON: async (key, value) => {
      data[key] = value;
    },
    snapshot: () => ({ ...data }),
  };
}

test("Snapshot manual de mantenimiento", async (t) => {
  t.after(() => {
    Module._load = originalLoad;
  });

  await t.test("Retorna conteos agregados correctos", async () => {
    const store = createMockStore({
      published_games_android: JSON.stringify([
        { id: "com.a", messageId: 101 },
        { id: "com.b", messageId: 102 },
      ]),
      published_games_pc: JSON.stringify([{ id: "pc.a", messageId: 201 }]),
      android_queue: JSON.stringify([{ id: "com.c" }, { id: "com.c" }]),
      pc_queue: JSON.stringify([]),
      android_expired: JSON.stringify([{ id: "com.x", messageId: 301 }]),
      pc_expired: JSON.stringify([{ id: "pc.x", messageId: 401 }]),
      manual_telegram_cleanup_queue: JSON.stringify([
        { id: "manual.1", messageId: 401 },
        { id: "manual.2", messageId: 501 },
      ]),
    });

    const snapshot = await getMaintenanceSnapshot(store);

    assert.deepStrictEqual(snapshot.summary, {
      androidPublished: 2,
      pcPublished: 1,
      androidQueue: 1,
      pcQueue: 0,
      androidExpired: 1,
      pcExpired: 1,
      telegramBacklog: 2,
      trackedTelegramMessages: 6,
    });
  });

  await t.test("Incluye muestras cuando se solicitan", async () => {
    const store = createMockStore({
      published_games_android: JSON.stringify([]),
      published_games_pc: JSON.stringify([]),
      android_queue: JSON.stringify([
        { id: "com.q1", messageId: 10 },
        { id: "com.q2", messageId: 11 },
      ]),
      pc_queue: JSON.stringify([]),
      android_expired: JSON.stringify([]),
      pc_expired: JSON.stringify([]),
      manual_telegram_cleanup_queue: JSON.stringify([
        { messageId: 50 },
        { messageId: 51 },
      ]),
    });

    const snapshot = await getMaintenanceSnapshot(store, {
      includeSamples: true,
      sampleSize: 1,
    });

    assert.ok(snapshot.samples);
    assert.deepStrictEqual(snapshot.samples.androidQueue, [
      { id: "com.q1", messageId: 10 },
    ]);
    assert.deepStrictEqual(snapshot.samples.telegramBacklog, [
      { id: null, messageId: 50 },
    ]);
  });

  await t.test("Considera 'message to delete not found' como borrado resuelto", async () => {
    process.env.TELEGRAM_TOKEN = "test-token";
    process.env.CHANNEL_ID = "@testchannel";

    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          ok: false,
          error_code: 400,
          description: "Bad Request: message to delete not found",
        }),
    });

    const store = createMockStore({
      published_games_android: JSON.stringify([{ id: "com.a", messageId: 160 }]),
      published_games_pc: JSON.stringify([]),
      android_expired: JSON.stringify([]),
      pc_expired: JSON.stringify([]),
      manual_telegram_cleanup_queue: JSON.stringify([{ messageId: 160 }]),
    });

    const result = await deleteTrackedTelegramMessages(store);
    const snapshot = store.snapshot();

    assert.strictEqual(result.trackedMessages, 1);
    assert.strictEqual(result.deleted, 1);
    assert.strictEqual(result.failed, 0);
    assert.deepStrictEqual(result.unresolvedMessageIds, []);
    assert.deepStrictEqual(snapshot.manual_telegram_cleanup_queue, []);
    assert.deepStrictEqual(snapshot.published_games_android, []);

    global.fetch = originalFetch;
  });
});
