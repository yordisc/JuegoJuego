const test = require("node:test");
const assert = require("node:assert");
const { checkAndroidDeals } = require("../services/android-deals");

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

test("Suite Android Consumer", async (t) => {
  t.beforeEach(() => {
    global.fetch = async (url) => {
      if (url.includes("sendPhoto") || url.includes("sendMessage")) {
        return {
          ok: true,
          json: async () => ({ ok: true, result: { message_id: 111 } }),
        };
      }

      if (url.includes("editMessageCaption")) {
        return { ok: true, json: async () => ({ ok: true }) };
      }

      return { ok: true, json: async () => ({ ok: true }) };
    };
  });

  t.afterEach(() => {
    global.fetch = originalFetch;
  });

  await t.test("Publica nuevos items de android_queue", async () => {
    const store = createStore({
      android_queue: [
        {
          id: "com.new.app",
          title: "New App",
          icon: "https://example.com/icon.png",
          url: "https://play.google.com/store/apps/details?id=com.new.app",
        },
      ],
      android_expired: [],
    });

    const publishedGames = [];
    const result = await checkAndroidDeals(store, publishedGames);

    assert.strictEqual(result.publishedCount, 1);
    assert.deepStrictEqual(publishedGames[0], {
      id: "com.new.app",
      messageId: 111,
    });
  });

  await t.test("No duplica IDs ya publicados", async () => {
    const store = createStore({
      android_queue: [{ id: "com.dup.app", title: "Dup" }],
      android_expired: [],
    });

    const publishedGames = [{ id: "com.dup.app", messageId: 22 }];
    const result = await checkAndroidDeals(store, publishedGames);

    assert.strictEqual(result.publishedCount, 0);
    assert.strictEqual(publishedGames.length, 1);
  });

  await t.test("Procesa expirados y los elimina de memoria", async () => {
    const store = createStore({
      android_queue: [],
      android_expired: [{ id: "com.old.app", messageId: 222 }],
    });

    const publishedGames = [{ id: "com.old.app", messageId: 222 }];
    const result = await checkAndroidDeals(store, publishedGames);

    assert.strictEqual(result.expiredCount, 1);
    assert.strictEqual(publishedGames.length, 0);
  });

  await t.test("Limpia android_queue y android_expired al final", async () => {
    const store = createStore({
      android_queue: [{ id: "com.to.clear" }],
      android_expired: [{ id: "com.exp.clear" }],
    });

    await checkAndroidDeals(store, []);
    const snapshot = store.snapshot();

    assert.deepStrictEqual(snapshot.android_queue, []);
    assert.deepStrictEqual(snapshot.android_expired, []);
  });

  await t.test("Re-encola item si Telegram falla al publicar", async () => {
    global.fetch = async (url) => {
      if (url.includes("sendPhoto") || url.includes("sendMessage")) {
        return { ok: false, status: 500, text: async () => "fail" };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    };

    const store = createStore({
      android_queue: [{ id: "com.retry.android", title: "Retry" }],
      android_expired: [],
    });

    const publishedGames = [];
    await checkAndroidDeals(store, publishedGames);
    const snapshot = store.snapshot();

    assert.strictEqual(publishedGames.length, 0);
    assert.strictEqual(snapshot.android_queue.length, 1);
    assert.strictEqual(snapshot.android_queue[0].id, "com.retry.android");
  });
});
