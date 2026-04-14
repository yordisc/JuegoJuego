const test = require("node:test");
const assert = require("node:assert");
const {
  checkPCGames,
  reconcilePCPublications,
} = require("../services/pc-games");

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
    process.env.PC_EXPIRED_DELETE_DELAY_MS = "0";

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
    delete process.env.PC_EXPIRED_DELETE_DELAY_MS;
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
    assert.ok(Number.isInteger(publishedGames[0].publishedAt));
    assert.strictEqual(publishedGames[0].id, "999");
    assert.strictEqual(publishedGames[0].messageId, 333);
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

  await t.test("Escapa caracteres conflictivos de Markdown en titulo y descripcion", async () => {
    let sentBody = null;
    global.fetch = async (url, opts) => {
      if (url.includes("sendMessage")) {
        sentBody = JSON.parse(opts.body || "{}");
      }

      return { ok: true, json: async () => ({ ok: true, result: { message_id: 333 } }) };
    };

    const store = createStore({
      pc_queue: [
        {
          id: "pc-md-1",
          title: "[Juego] Call of *Duty* _2_",
          description: "Incluye [DLC] *VIP* _Pack_",
          platforms: "PC_[Win]",
          worth: "$19_*",
          openGiveawayUrl: "https://example.com/game",
        },
      ],
      pc_expired: [],
    });

    await checkPCGames(store, []);

    assert.ok(sentBody);
    assert.ok(sentBody.text.includes("\\[Juego\\] Call of \\*Duty\\* \\_2\\_"));
    assert.ok(sentBody.text.includes("Incluye \\[DLC\\] \\*VIP\\* \\_Pack\\_"));
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
      pc_queue: [],
      pc_expired: [{ id: "pc.notfound", messageId: 777 }],
    });

    const publishedGames = [{ id: "pc.notfound", messageId: 777 }];
    const result = await checkPCGames(store, publishedGames, {
      processQueue: false,
      processExpired: true,
    });

    const snapshot = store.snapshot();

    assert.strictEqual(result.expiredCount, 1);
    assert.strictEqual(publishedGames.length, 0);
    assert.deepStrictEqual(snapshot.pc_expired, []);
  });

  await t.test("Elimina tracking paralelo cuando se borra un expirado", async () => {
    const store = createStore({
      pc_queue: [],
      pc_expired: [{ id: "pc.cleanup", messageId: 700 }],
      telegram_sent_messages: [
        { id: "pc.cleanup", messageId: 700, platform: "pc", messageKind: "text", messageText: "x" },
        { id: "pc.keep", messageId: 701, platform: "pc", messageKind: "text", messageText: "y" },
      ],
    });

    const publishedGames = [{ id: "pc.cleanup", messageId: 700 }];
    await checkPCGames(store, publishedGames, {
      processQueue: false,
      processExpired: true,
    });

    const snapshot = store.snapshot();
    assert.strictEqual(snapshot.telegram_sent_messages.some((item) => item.messageId === 700), false);
    assert.strictEqual(snapshot.telegram_sent_messages.some((item) => item.messageId === 701), true);
  });

  await t.test("Aborta cuando encuentra JSON invalido en memoria PC", async () => {
    const store = {
      get: async (key) => (key === "pc_queue" ? "<html>500</html>" : null),
      setJSON: async () => {},
      snapshot: () => ({}),
    };

    await assert.rejects(() => checkPCGames(store, []), /JSON invalido en pc_queue/);
  });

  await t.test("Reconciliacion verifica por tracking de id/titulo y republica pendientes", async () => {
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body || "{}") });

      if (url.includes("sendMessage")) {
        return {
          ok: true,
          json: async () => ({ ok: true, result: { message_id: 444 } }),
        };
      }

      return {
        ok: true,
        json: async () => ({ ok: true }),
      };
    };

    const store = createStore({
      telegram_sent_messages: [
        {
          id: "pc.already.sent",
          title: "PC Already Sent",
          titleMatch: "pc already sent",
          messageId: 333,
          platform: "pc",
          publishedAt: 10,
          messageKind: "text",
          messageText: "Hello",
        },
      ],
    });

    const publishedGames = [
      {
        id: "pc.already.sent",
        title: "PC Already Sent",
        messageId: null,
        status: "pending_send",
      },
      {
        id: "pc.needs.publish",
        title: "PC Needs Publish",
        messageId: null,
        status: "pending_send",
      },
    ];

    const result = await reconcilePCPublications(store, publishedGames, {
      maxRepublishPerRun: 5,
      maxExistenceChecks: 0,
    });

    assert.strictEqual(result.verifiedCount, 1);
    assert.strictEqual(result.republishedCount, 1);
    assert.strictEqual(result.republishErrors, 0);

    const verified = publishedGames.find((item) => item.id === "pc.already.sent");
    const republished = publishedGames.find((item) => item.id === "pc.needs.publish");

    assert.strictEqual(verified.messageId, 333);
    assert.strictEqual(verified.status, "sent_verified");

    assert.strictEqual(republished.messageId, 444);
    assert.strictEqual(republished.status, "sent_unverified");

    assert.strictEqual(
      calls.filter((entry) => entry.url.includes("sendMessage")).length,
      1
    );
  });

  await t.test("Reconciliacion reprocesa juego PC si el mensaje rastreado ya no existe en Telegram", async () => {
    const calls = [];
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body || "{}");
      calls.push({ url, body });

      if (url.includes("editMessageText")) {
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              ok: false,
              error_code: 400,
              description: "Bad Request: message to edit not found",
            }),
        };
      }

      if (url.includes("sendMessage")) {
        return {
          ok: true,
          json: async () => ({ ok: true, result: { message_id: 888 } }),
        };
      }

      return { ok: true, json: async () => ({ ok: true }) };
    };

    const store = createStore({
      telegram_sent_messages: [
        {
          id: "pc.deleted.by.admin",
          title: "PC Deleted By Admin",
          titleMatch: "pc deleted by admin",
          messageId: 777,
          messageKind: "text",
          messageText: "🎮 **FREE PC GAME!** 🎮\n\n⭐ *Title:* PC Deleted By Admin",
          platform: "pc",
          publishedAt: 1,
        },
      ],
    });

    const publishedGames = [
      {
        id: "pc.deleted.by.admin",
        title: "PC Deleted By Admin",
        messageId: 777,
        status: "sent_verified",
      },
    ];

    const result = await reconcilePCPublications(store, publishedGames, {
      maxRepublishPerRun: 5,
      maxExistenceChecks: 5,
    });

    assert.strictEqual(result.existenceChecks, 1);
    assert.strictEqual(result.existenceMissing, 1);
    assert.strictEqual(result.republishedCount, 1);

    assert.strictEqual(publishedGames[0].messageId, 888);
    assert.strictEqual(publishedGames[0].status, "sent_unverified");

    assert.strictEqual(
      calls.filter((entry) => entry.url.includes("editMessageText")).length,
      1
    );
    assert.strictEqual(
      calls.filter((entry) => entry.url.includes("sendMessage")).length,
      1
    );

    const snapshot = store.snapshot();
    assert.strictEqual(Array.isArray(snapshot.telegram_sent_messages), true);
    assert.strictEqual(snapshot.telegram_sent_messages.some((item) => item.messageId === 777), false);
    assert.strictEqual(snapshot.telegram_sent_messages.some((item) => item.messageId === 888), true);
  });
});
