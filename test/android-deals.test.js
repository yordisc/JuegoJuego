const test = require("node:test");
const assert = require("node:assert");
const {
  checkAndroidDeals,
  buildAndroidMessage,
  escapeTelegramMarkdownText,
} = require("../services/android-deals");

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
  t.before(() => {
    process.env.ANDROID_MAX_PUBLISH_PER_RUN = "18";
    process.env.ANDROID_MAX_DELETE_PER_RUN = "18";
  });

  t.after(() => {
    delete process.env.ANDROID_MAX_PUBLISH_PER_RUN;
    delete process.env.ANDROID_MAX_DELETE_PER_RUN;
  });

  t.beforeEach(() => {
    global.fetch = async (url) => {
      if (url.includes("sendPhoto") || url.includes("sendMessage")) {
        return {
          ok: true,
          json: async () => ({ ok: true, result: { message_id: 111 } }),
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
    assert.ok(Number.isInteger(publishedGames[0].publishedAt));
    assert.strictEqual(publishedGames[0].id, "com.new.app");
    assert.strictEqual(publishedGames[0].messageId, 111);
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
    const calledUrls = [];
    global.fetch = async (url) => {
      calledUrls.push(url);
      return { ok: true, json: async () => ({ ok: true }) };
    };

    const store = createStore({
      android_queue: [],
      android_expired: [{ id: "com.old.app", messageId: 222 }],
    });

    const publishedGames = [{ id: "com.old.app", messageId: 222 }];
    const result = await checkAndroidDeals(store, publishedGames);

    assert.strictEqual(result.expiredCount, 1);
    assert.strictEqual(publishedGames.length, 0);
    assert.ok(calledUrls.some((url) => url.includes("deleteMessage")));
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

  await t.test("Modo solo expirados no publica android_queue", async () => {
    const calledUrls = [];
    global.fetch = async (url) => {
      calledUrls.push(url);
      return { ok: true, json: async () => ({ ok: true }) };
    };

    const store = createStore({
      android_queue: [{ id: "com.skip.publish", title: "Skip" }],
      android_expired: [{ id: "com.old.app", messageId: 222 }],
    });

    const publishedGames = [{ id: "com.old.app", messageId: 222 }];
    const result = await checkAndroidDeals(store, publishedGames, {
      processQueue: false,
      processExpired: true,
    });

    const snapshot = store.snapshot();
    assert.strictEqual(result.publishedCount, 0);
    assert.strictEqual(result.expiredCount, 1);
    assert.ok(
      calledUrls.every(
        (url) => !url.includes("sendMessage") && !url.includes("sendPhoto")
      )
    );
    assert.ok(calledUrls.some((url) => url.includes("deleteMessage")));
    assert.strictEqual(snapshot.android_queue.length, 1);
    assert.strictEqual(snapshot.android_queue[0].id, "com.skip.publish");
  });

  await t.test("Limita publicaciones por corrida y difiere el resto", async () => {
    const queue = Array.from({ length: 20 }, (_, index) => ({
      id: `com.batch.${index + 1}`,
      title: `Batch ${index + 1}`,
    }));

    const store = createStore({
      android_queue: queue,
      android_expired: [],
    });

    const publishedGames = [];
    const result = await checkAndroidDeals(store, publishedGames);
    const snapshot = store.snapshot();

    assert.strictEqual(result.publishedCount, 18);
    assert.strictEqual(publishedGames.length, 18);
    assert.strictEqual(snapshot.android_queue.length, 2);
    assert.strictEqual(snapshot.android_queue[0].id, "com.batch.19");
    assert.strictEqual(snapshot.android_queue[1].id, "com.batch.20");
  });

  await t.test("Limita borrados por corrida y difiere expirados restantes", async () => {
    process.env.ANDROID_MAX_DELETE_PER_RUN = "2";

    const calledUrls = [];
    global.fetch = async (url) => {
      calledUrls.push(url);

      if (url.includes("deleteMessage")) {
        return { ok: true, json: async () => ({ ok: true }) };
      }

      return { ok: true, json: async () => ({ ok: true }) };
    };

    const store = createStore({
      android_queue: [],
      android_expired: [
        { id: "com.exp.1", messageId: 101 },
        { id: "com.exp.2", messageId: 102 },
        { id: "com.exp.3", messageId: 103 },
      ],
    });

    const publishedGames = [
      { id: "com.exp.1", messageId: 101 },
      { id: "com.exp.2", messageId: 102 },
      { id: "com.exp.3", messageId: 103 },
    ];

    const result = await checkAndroidDeals(store, publishedGames, {
      processQueue: false,
      processExpired: true,
    });

    const snapshot = store.snapshot();

    assert.strictEqual(result.expiredCount, 2);
    assert.strictEqual(snapshot.android_expired.length, 1);
    assert.strictEqual(snapshot.android_expired[0].id, "com.exp.3");
    assert.strictEqual(publishedGames.length, 1);
    assert.strictEqual(publishedGames[0].id, "com.exp.3");
    assert.strictEqual(
      calledUrls.filter((url) => url.includes("deleteMessage")).length,
      2
    );

    process.env.ANDROID_MAX_DELETE_PER_RUN = "18";
  });

  await t.test("Trata 'message to delete not found' como expirado resuelto", async () => {
    global.fetch = async (url) => {
      if (url.includes("deleteMessage")) {
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

      return { ok: true, json: async () => ({ ok: true }) };
    };

    const store = createStore({
      android_queue: [],
      android_expired: [{ id: "com.notfound", messageId: 555 }],
    });

    const publishedGames = [{ id: "com.notfound", messageId: 555 }];
    const result = await checkAndroidDeals(store, publishedGames, {
      processQueue: false,
      processExpired: true,
    });

    const snapshot = store.snapshot();

    assert.strictEqual(result.expiredCount, 1);
    assert.strictEqual(publishedGames.length, 0);
    assert.deepStrictEqual(snapshot.android_expired, []);
  });

  await t.test("Escapa caracteres Markdown en titulos", () => {
    const raw = "Super_[Deal]* (VIP)`\\";
    const escaped = escapeTelegramMarkdownText(raw);

    assert.strictEqual(escaped, "Super\\_\\[Deal\\]\\* \\(VIP\\)\\`\\\\");
  });

  await t.test("buildAndroidMessage genera enlace y titulo escapados", () => {
    const message = buildAndroidMessage({
      id: "com.markdown.test",
      title: "A_[B]* (C)",
      score: 4.8,
      url: "https://play.google.com/store/apps/details?id=com.markdown.test&ref=(promo)",
    });

    assert.ok(message.includes("*A\\_\\[B\\]\\* \\(C\\)*"));
    assert.ok(
      message.includes(
        "[Get it on Google Play](https://play.google.com/store/apps/details?id=com.markdown.test&ref=\\(promo\\))"
      )
    );
  });
});
