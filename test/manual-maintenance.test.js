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
  cleanTelegramOrphanMessages,
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
      androidStatus: {
        pendingSend: 0,
        sentUnverified: 2,
        sentVerified: 0,
      },
    });
    assert.deepStrictEqual(snapshot.tracking, {
      scope: "memory_only",
      channelHistoryReadable: false,
      sources: [
        "published_games_android",
        "published_games_pc",
        "android_expired",
        "pc_expired",
        "manual_telegram_cleanup_queue",
        "telegram_sent_messages",
      ],
    });
    assert.ok(Array.isArray(snapshot.warnings));
    assert.ok(snapshot.warnings.length >= 1);
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
    assert.strictEqual(result.deletedNotFound, 1);
    assert.strictEqual(result.failed, 0);
    assert.deepStrictEqual(result.unresolvedMessageIds, []);
    assert.deepStrictEqual(snapshot.manual_telegram_cleanup_queue, []);
    assert.deepStrictEqual(snapshot.published_games_android, []);

    global.fetch = originalFetch;
  });

  await t.test("Considera 'message can't be deleted' como resuelto no reintentable", async () => {
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
          description: "Bad Request: message can't be deleted",
        }),
    });

    const store = createMockStore({
      published_games_android: JSON.stringify([{ id: "com.b", messageId: 170 }]),
      published_games_pc: JSON.stringify([]),
      android_expired: JSON.stringify([]),
      pc_expired: JSON.stringify([]),
      manual_telegram_cleanup_queue: JSON.stringify([{ messageId: 170 }]),
    });

    const result = await deleteTrackedTelegramMessages(store);
    const snapshot = store.snapshot();

    assert.strictEqual(result.trackedMessages, 1);
    assert.strictEqual(result.deleted, 1);
    assert.strictEqual(result.deletedNotAllowed, 1);
    assert.strictEqual(result.failed, 0);
    assert.deepStrictEqual(result.unresolvedMessageIds, []);
    assert.deepStrictEqual(snapshot.manual_telegram_cleanup_queue, []);
    assert.deepStrictEqual(snapshot.published_games_android, []);

    global.fetch = originalFetch;
  });

  await t.test("Limpia huerfanos y conserva mensajes de ofertas activas", async () => {
    process.env.TELEGRAM_TOKEN = "test-token";
    process.env.CHANNEL_ID = "@testchannel";

    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (_url, opts) => {
      const body = JSON.parse(opts.body || "{}");
      calls.push(body.message_id);

      if (body.message_id === 600) {
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              ok: false,
              error_code: 400,
              description: "Bad Request: message to delete not found",
            }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: true }),
        text: async () => "",
      };
    };

    const store = createMockStore({
      published_games_android: JSON.stringify([{ id: "com.active", messageId: 500 }]),
      published_games_pc: JSON.stringify([]),
      telegram_sent_messages: JSON.stringify([
        { id: "com.active", messageId: 500, platform: "android", publishedAt: 1 },
        { id: "com.old.one", messageId: 600, platform: "android", publishedAt: 2 },
        { id: "pc.old", messageId: 700, platform: "pc", publishedAt: 3 },
      ]),
    });

    const result = await cleanTelegramOrphanMessages(store);
    const snapshot = store.snapshot();

    assert.deepStrictEqual(calls.sort((a, b) => a - b), [600, 700]);
    assert.strictEqual(result.trackedTotal, 3);
    assert.strictEqual(result.orphanCandidates, 2);
    assert.strictEqual(result.deleted, 2);
    assert.strictEqual(result.deletedNotFound, 1);
    assert.strictEqual(result.failed, 0);
    assert.deepStrictEqual(result.unresolvedMessageIds, []);
    assert.deepStrictEqual(snapshot.telegram_sent_messages, [
      {
        id: "com.active",
        messageId: 500,
        platform: "android",
        publishedAt: 1,
        title: null,
        titleMatch: "com active",
      },
    ]);

    global.fetch = originalFetch;
  });

  await t.test("Huerfanos: trata 'message can't be deleted' como resuelto", async () => {
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
          description: "Bad Request: message can't be deleted",
        }),
    });

    const store = createMockStore({
      published_games_android: JSON.stringify([]),
      published_games_pc: JSON.stringify([]),
      telegram_sent_messages: JSON.stringify([
        { id: "pc.old", messageId: 701, platform: "pc", publishedAt: 3 },
      ]),
    });

    const result = await cleanTelegramOrphanMessages(store);
    const snapshot = store.snapshot();

    assert.strictEqual(result.orphanCandidates, 1);
    assert.strictEqual(result.deleted, 1);
    assert.strictEqual(result.deletedNotAllowed, 1);
    assert.strictEqual(result.failed, 0);
    assert.deepStrictEqual(result.unresolvedMessageIds, []);
    assert.deepStrictEqual(snapshot.telegram_sent_messages, []);

    global.fetch = originalFetch;
  });

  await t.test("Limpia mensaje viejo cuando el id sigue activo pero el messageId cambio", async () => {
    process.env.TELEGRAM_TOKEN = "test-token";
    process.env.CHANNEL_ID = "@testchannel";

    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (_url, opts) => {
      const body = JSON.parse(opts.body || "{}");
      calls.push(body.message_id);

      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: true }),
        text: async () => "",
      };
    };

    const store = createMockStore({
      published_games_android: JSON.stringify([{ id: "com.active", messageId: 500 }]),
      published_games_pc: JSON.stringify([]),
      telegram_sent_messages: JSON.stringify([
        { id: "com.active", messageId: 500, platform: "android", publishedAt: 10 },
        { id: "com.active", messageId: 450, platform: "android", publishedAt: 5 },
      ]),
    });

    const result = await cleanTelegramOrphanMessages(store);
    const snapshot = store.snapshot();

    assert.deepStrictEqual(calls, [450]);
    assert.strictEqual(result.trackedTotal, 2);
    assert.strictEqual(result.orphanCandidates, 1);
    assert.strictEqual(result.deleted, 1);
    assert.strictEqual(result.failed, 0);
    assert.deepStrictEqual(snapshot.telegram_sent_messages, [
      {
        id: "com.active",
        messageId: 500,
        platform: "android",
        publishedAt: 10,
        title: null,
        titleMatch: "com active",
      },
    ]);

    global.fetch = originalFetch;
  });

  await t.test("Usa chatId rastreado al borrar y resuelve not found en ese chat", async () => {
    process.env.TELEGRAM_TOKEN = "test-token";
    process.env.CHANNEL_ID = "@currentchannel";

    const originalFetch = global.fetch;
    const fetchCalls = [];
    global.fetch = async (_url, opts) => {
      fetchCalls.push(JSON.parse(opts.body || "{}"));

      return {
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "Bad Request: message to delete not found",
          }),
      };
    };

    const store = createMockStore({
      published_games_android: JSON.stringify([]),
      published_games_pc: JSON.stringify([]),
      android_expired: JSON.stringify([]),
      pc_expired: JSON.stringify([]),
      manual_telegram_cleanup_queue: JSON.stringify([]),
      telegram_sent_messages: JSON.stringify([
        {
          id: "com.old.channel",
          messageId: 888,
          platform: "android",
          chatId: "@oldchannel",
          publishedAt: 1,
        },
      ]),
    });

    const result = await deleteTrackedTelegramMessages(store);
    const snapshot = store.snapshot();

    assert.strictEqual(result.trackedMessages, 1);
    assert.strictEqual(result.deleted, 1);
    assert.strictEqual(result.deletedNotFound, 1);
    assert.strictEqual(result.failed, 0);
    assert.deepStrictEqual(result.unresolvedMessageIds, []);
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].chat_id, "@oldchannel");
    assert.strictEqual(fetchCalls[0].message_id, 888);
    assert.deepStrictEqual(snapshot.manual_telegram_cleanup_queue, []);
    assert.deepStrictEqual(snapshot.telegram_sent_messages, []);

    global.fetch = originalFetch;
  });

  await t.test("Expone el ultimo smoke de borrado en el snapshot", async () => {
    const store = createMockStore({
      published_games_android: JSON.stringify([]),
      published_games_pc: JSON.stringify([]),
      android_expired: JSON.stringify([]),
      pc_expired: JSON.stringify([]),
      manual_telegram_cleanup_queue: JSON.stringify([]),
      manual_delete_smoke_result: JSON.stringify({
        success: true,
        action: "manual-delete-smoke",
        step: "deleteMessage",
        chatId: "@testchannel",
        messageId: 999,
        sendStatus: 200,
        deleteStatus: 200,
        updatedAt: "2026-04-06T00:00:00.000Z",
      }),
    });

    const snapshot = await getMaintenanceSnapshot(store);

    assert.deepStrictEqual(snapshot.deleteSmoke, {
      success: true,
      action: "manual-delete-smoke",
      step: "deleteMessage",
      chatId: "@testchannel",
      messageId: 999,
      sendStatus: 200,
      deleteStatus: 200,
      updatedAt: "2026-04-06T00:00:00.000Z",
    });
  });
});
