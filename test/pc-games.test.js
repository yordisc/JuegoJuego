const test = require("node:test");
const assert = require("node:assert");
const { checkPCGames } = require("../services/pc-games");

process.env.TELEGRAM_TOKEN = "test-token";
process.env.CHANNEL_ID = "@testchannel";

const originalFetch = global.fetch;

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

test("Suite PC Consumer", async (t) => {
  t.beforeEach(() => {
    global.fetch = async (url) => {
      if (url.includes("sendMessage")) {
        return {
          ok: true,
          json: async () => ({ ok: true, result: { message_id: 333 } }),
        };
      }

      if (url.includes("deleteMessage")) {
        return { ok: true, json: async () => ({ ok: true }) };
      }

      return { ok: true, json: async () => ({ ok: true }) };
    };
  });

  t.afterEach(() => {
    global.fetch = originalFetch;
  });

  await t.test("Publica nuevos items de pc_queue", async () => {
    const store = createStore({
      pc_queue: [
        {
          id: "999",
          title: "Mock PC Game",
          platforms: "PC",
          worth: "$19.99",
          description: "Un juego de prueba",
          openGiveawayUrl: "https://test.com",
        },
      ],
      pc_expired: [],
    });

    const publishedGames = [];
    const result = await checkPCGames(store, publishedGames);

    assert.strictEqual(result.publishedCount, 1);
    assert.deepStrictEqual(publishedGames[0], {
      id: "999",
      messageId: 333,
    });
  });

  await t.test("No duplica IDs ya publicados", async () => {
    const store = createStore({
      pc_queue: [{ id: "999", title: "Dup" }],
      pc_expired: [],
    });

    const publishedGames = [{ id: "999", messageId: 10 }];
    const result = await checkPCGames(store, publishedGames);

    assert.strictEqual(result.publishedCount, 0);
    assert.strictEqual(publishedGames.length, 1);
  });

  await t.test("Procesa expirados y los elimina de memoria", async () => {
    const calledUrls = [];
    global.fetch = async (url) => {
      calledUrls.push(url);
      return { ok: true, json: async () => ({ ok: true }) };
    };

    const store = createStore({
      pc_queue: [],
      pc_expired: [{ id: "999", messageId: 333 }],
    });

    const publishedGames = [{ id: "999", messageId: 333 }];
    const result = await checkPCGames(store, publishedGames);

    assert.strictEqual(result.expiredCount, 1);
    assert.strictEqual(publishedGames.length, 0);
    assert.ok(calledUrls.some((url) => url.includes("deleteMessage")));
  });

  await t.test("Limpia pc_queue y pc_expired al final", async () => {
    const store = createStore({
      pc_queue: [{ id: "999" }],
      pc_expired: [{ id: "111" }],
    });

    await checkPCGames(store, []);
    const snapshot = store.snapshot();

    assert.deepStrictEqual(snapshot.pc_queue, []);
    assert.deepStrictEqual(snapshot.pc_expired, []);
  });

  await t.test("Re-encola item si Telegram falla al publicar", async () => {
    global.fetch = async (url) => {
      if (url.includes("sendMessage")) {
        return { ok: false, status: 500, text: async () => "fail" };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    };

    const store = createStore({
      pc_queue: [{ id: "pc-retry", title: "Retry" }],
      pc_expired: [],
    });

    const publishedGames = [];
    await checkPCGames(store, publishedGames);
    const snapshot = store.snapshot();

    assert.strictEqual(publishedGames.length, 0);
    assert.strictEqual(snapshot.pc_queue.length, 1);
    assert.strictEqual(snapshot.pc_queue[0].id, "pc-retry");
  });

  await t.test("Modo solo expirados no publica pc_queue", async () => {
    const calledUrls = [];
    global.fetch = async (url) => {
      calledUrls.push(url);
      return { ok: true, json: async () => ({ ok: true }) };
    };

    const store = createStore({
      pc_queue: [{ id: "will-not-publish", title: "Skip" }],
      pc_expired: [{ id: "old-1", messageId: 333 }],
    });

    const publishedGames = [{ id: "old-1", messageId: 333 }];
    const result = await checkPCGames(store, publishedGames, {
      processQueue: false,
      processExpired: true,
    });

    const snapshot = store.snapshot();
    assert.strictEqual(result.publishedCount, 0);
    assert.strictEqual(result.expiredCount, 1);
    assert.ok(calledUrls.every((url) => !url.includes("sendMessage")));
    assert.ok(calledUrls.some((url) => url.includes("deleteMessage")));
    assert.strictEqual(snapshot.pc_queue.length, 1);
    assert.strictEqual(snapshot.pc_queue[0].id, "will-not-publish");
  });
});
