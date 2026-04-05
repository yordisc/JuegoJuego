const test = require("node:test");
const assert = require("node:assert");

const {
  extractIdsFromPlayStoreUrl,
  collectItemAppIds,
  inferExpiredAndroidFromFeed,
  buildAndroidRssQueue,
} = require("../services/android-rss");

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

function createDetailsFetcher(map = {}) {
  return async function detailsFetcher(appId) {
    if (!(appId in map)) {
      throw new Error(`sin detalles mock para ${appId}`);
    }

    return map[appId];
  };
}

test("Suite Android RSS Producer", async (t) => {
  await t.test("Extrae app IDs desde URL directa de Google Play", () => {
    const ids = extractIdsFromPlayStoreUrl(
      "https://play.google.com/store/apps/details?id=com.example.game"
    );

    assert.deepStrictEqual(ids, ["com.example.game"]);
  });

  await t.test("Extrae app IDs desde URL codificada en enlace de Reddit", () => {
    const ids = extractIdsFromPlayStoreUrl(
      "https://www.reddit.com/r/googleplaydeals/comments/x/post/?url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.sample.app"
    );

    assert.deepStrictEqual(ids, ["com.sample.app"]);
  });

  await t.test("Deduplica IDs repetidos en un mismo item del feed", () => {
    const ids = collectItemAppIds({
      title: "Oferta",
      link: "https://play.google.com/store/apps/details?id=com.dup.app",
      content:
        "Mismo enlace https://play.google.com/store/apps/details?id=com.dup.app",
    });

    assert.deepStrictEqual(ids, ["com.dup.app"]);
  });

  await t.test("Agrega solo apps nuevas a android_queue", async () => {
    const store = createStore({
      published_games_android: [{ id: "com.already.published", messageId: 10 }],
      android_queue: [{ id: "com.already.queued", title: "Queued" }],
    });

    const feed = {
      items: [
        {
          title: "App ya en memoria",
          link: "https://play.google.com/store/apps/details?id=com.already.published",
        },
        {
          title: "App ya en queue",
          link: "https://play.google.com/store/apps/details?id=com.already.queued",
        },
        {
          title: "App nueva",
          link: "https://play.google.com/store/apps/details?id=com.new.from.rss",
        },
      ],
    };

    const detailsFetcher = createDetailsFetcher({
      "com.already.published": {
        title: "App ya en memoria",
        genreId: "GAME_ACTION",
        free: true,
        price: 0,
        originalPrice: 2.99,
      },
      "com.already.queued": {
        title: "App ya en queue",
        genreId: "GAME_ACTION",
        free: true,
        price: 0,
        originalPrice: 1.99,
      },
      "com.new.from.rss": {
        title: "App nueva",
        genreId: "GAME_PUZZLE",
        free: true,
        price: 0,
        originalPrice: 4.99,
      },
    });

    const result = await buildAndroidRssQueue(store, { feed, detailsFetcher, detailsDelayMs: 0 });
    const snapshot = store.snapshot();

    assert.strictEqual(result.added, 1);
    assert.strictEqual(snapshot.android_queue.length, 2);
    assert.ok(
      snapshot.android_queue.some((item) => item.id === "com.new.from.rss")
    );
  });

  await t.test("Filtra RSS y agrega solo juegos gratis", async () => {
    const store = createStore({
      published_games_android: [],
      android_queue: [],
    });

    const feed = {
      items: [
        {
          title: "Juego gratis",
          link: "https://play.google.com/store/apps/details?id=com.game.free",
        },
        {
          title: "Juego con descuento",
          link: "https://play.google.com/store/apps/details?id=com.game.discount",
        },
        {
          title: "App gratis no juego",
          link: "https://play.google.com/store/apps/details?id=com.app.free",
        },
      ],
    };

    const detailsFetcher = createDetailsFetcher({
      "com.game.free": {
        title: "Game Free",
        genreId: "GAME_STRATEGY",
        free: true,
        price: 0,
        originalPrice: 3.49,
      },
      "com.game.discount": {
        title: "Game Discount",
        genreId: "GAME_STRATEGY",
        free: false,
        price: 0.99,
        originalPrice: 2.99,
      },
      "com.app.free": {
        title: "Non Game",
        genreId: "PRODUCTIVITY",
        free: true,
        price: 0,
        originalPrice: 1.99,
      },
    });

    const result = await buildAndroidRssQueue(store, {
      feed,
      detailsFetcher,
      detailsDelayMs: 0,
    });
    const snapshot = store.snapshot();

    assert.strictEqual(result.feedActiveIds, 1);
    assert.deepStrictEqual(result.feedActiveIdList, ["com.game.free"]);
    assert.strictEqual(result.added, 1);
    assert.strictEqual(snapshot.android_queue.length, 1);
    assert.strictEqual(snapshot.android_queue[0].id, "com.game.free");
  });

  await t.test("Infiere expirados cuando el feed tiene muestra suficiente", () => {
    const now = Date.now();
    const publishedGames = [
      { id: "com.keep.active", messageId: 10, publishedAt: now - 48 * 60 * 60 * 1000 },
      { id: "com.to.expire", messageId: 11, publishedAt: now - 48 * 60 * 60 * 1000 },
    ];

    const activeIds = [
      "com.keep.active",
      "com.a",
      "com.b",
      "com.c",
      "com.d",
      "com.e",
      "com.f",
      "com.g",
      "com.h",
      "com.i",
    ];

    const expired = inferExpiredAndroidFromFeed(publishedGames, activeIds, {
      minActiveIds: 10,
      graceHours: 24,
      now,
    });

    assert.deepStrictEqual(expired, [
      { id: "com.to.expire", messageId: 11, source: "rss" },
    ]);
  });

  await t.test("No infiere expirados con feed insuficiente o dentro de gracia", () => {
    const now = Date.now();
    const publishedGames = [
      { id: "com.recent", messageId: 99, publishedAt: now - 2 * 60 * 60 * 1000 },
      { id: "com.old", messageId: 88, publishedAt: now - 72 * 60 * 60 * 1000 },
    ];

    const expiredBySmallFeed = inferExpiredAndroidFromFeed(
      publishedGames,
      ["com.x", "com.y"],
      { minActiveIds: 10, graceHours: 24, now }
    );
    assert.deepStrictEqual(expiredBySmallFeed, []);

    const expiredByGrace = inferExpiredAndroidFromFeed(
      publishedGames,
      ["com.x", "com.y", "com.z", "com.1", "com.2", "com.3", "com.4", "com.5", "com.6", "com.7"],
      { minActiveIds: 10, graceHours: 24, now }
    );

    assert.deepStrictEqual(expiredByGrace, [
      { id: "com.old", messageId: 88, source: "rss" },
    ]);
  });

  await t.test("No infiere expirados si excede el ratio maximo permitido", () => {
    const now = Date.now();
    const publishedGames = [
      { id: "com.keep.1", messageId: 1, publishedAt: now - 72 * 60 * 60 * 1000 },
      { id: "com.keep.2", messageId: 2, publishedAt: now - 72 * 60 * 60 * 1000 },
      { id: "com.expire.1", messageId: 3, publishedAt: now - 72 * 60 * 60 * 1000 },
      { id: "com.expire.2", messageId: 4, publishedAt: now - 72 * 60 * 60 * 1000 },
      { id: "com.expire.3", messageId: 5, publishedAt: now - 72 * 60 * 60 * 1000 },
    ];

    const activeIds = [
      "com.keep.1",
      "com.keep.2",
      "com.a",
      "com.b",
      "com.c",
      "com.d",
      "com.e",
      "com.f",
      "com.g",
      "com.h",
    ];

    const expired = inferExpiredAndroidFromFeed(publishedGames, activeIds, {
      minActiveIds: 10,
      graceHours: 24,
      maxExpireRatio: 0.4,
      now,
    });

    assert.deepStrictEqual(expired, []);
  });
});
