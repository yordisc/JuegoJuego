// test/android-deals.test.js
const test = require("node:test");
const assert = require("node:assert");

// 1. MOCKEAMOS EL REQUIRE DE google-play-scraper
const Module = require("module");
const originalLoad = Module._load;

Module._load = function (request, ...args) {
  if (request === "google-play-scraper") {
    return {
      // Quitado el "default: {}". Ahora pasamos la función directamente.
      search: async (...a) => global.__mockGplaySearch?.(...a) ?? [],
    };
  }
  return originalLoad.call(this, request, ...args);
};

// 2. MOCKEAMOS EL FETCH GLOBAL
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  if (url && url.toString().includes("api.telegram.org")) {
    return { ok: true, json: async () => ({ ok: true }) };
  }
  return originalFetch ? originalFetch(url, options) : { ok: true };
};

const { checkAndroidDeals } = require("../services/android-deals");

process.env.TELEGRAM_TOKEN = "test-token";
process.env.CHANNEL_ID = "@testchannel";

function mockApp(overrides = {}) {
  return {
    appId: "com.test.app",
    title: "Test App",
    url: "https://play.google.com/store/apps/details?id=com.test.app",
    icon: "https://example.com/icon.png",
    developer: "Test Developer",
    score: 4.5,
    free: false,
    priceText: "$2.99",
    genre: "Action",
    summary: "A test app",
    ...overrides,
  };
}

test("🧪 Suite de Pruebas: Google Play Scraper (Android Deals)", async (t) => {
  // Guardamos el reloj original
  const originalSetTimeout = global.setTimeout;

  t.beforeEach(() => {
    // Acelerador de tiempo: Hacemos que cualquier setTimeout (como tu sleep) se ejecute al instante
    global.setTimeout = (cb) => cb();
  });

  t.afterEach(() => {
    global.__mockGplaySearch = null;
    // Restauramos el reloj normal al terminar cada prueba
    global.setTimeout = originalSetTimeout;
  });

  await t.test(
    '✅ Caso 1: Debe incluir app con "Free" en el título',
    async () => {
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.monument",
          title: "Monument Valley [Free]",
          free: false,
        }),
      ];
      const results = await checkAndroidDeals();
      assert.ok(
        results.some((app) => app.appId === "com.monument"),
        'App con "Free" no incluida'
      );
    }
  );

  await t.test("✅ Caso 2: Debe incluir app con free=true", async () => {
    global.__mockGplaySearch = async () => [
      mockApp({
        appId: "com.stardew",
        title: "Stardew Valley",
        free: true,
        priceText: "Free",
      }),
    ];
    const results = await checkAndroidDeals();
    assert.ok(
      results.some((app) => app.appId === "com.stardew"),
      "App gratuita no incluida"
    );
  });

  await t.test(
    '✅ Caso 3: Debe incluir app con "sale" en el título',
    async () => {
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.sale.app",
          title: "Epic Game On Sale 50% Off",
          free: false,
        }),
      ];
      const results = await checkAndroidDeals();
      assert.ok(
        results.some((app) => app.appId === "com.sale.app"),
        'App con "sale" no incluida'
      );
    }
  );

  await t.test(
    "❌ Caso 4: NO debe incluir app de pago sin palabras clave",
    async () => {
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.random.app",
          title: "Random Paid App",
          free: false,
          priceText: "$4.99",
        }),
      ];
      const results = await checkAndroidDeals();
      assert.ok(
        !results.some((app) => app.appId === "com.random.app"),
        "Se incluyó app de pago sin keywords"
      );
    }
  );

  await t.test(
    "🔁 Caso 5: No debe haber duplicados entre búsquedas",
    async () => {
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.duplicate.app",
          title: "Duplicate Free Game",
          free: true,
        }),
      ];
      const results = await checkAndroidDeals();
      const ids = results.map((app) => app.appId);
      assert.strictEqual(
        ids.length,
        new Set(ids).size,
        "Hay duplicados en los resultados"
      );
    }
  );

  await t.test(
    "⚠️ Caso 6: Si el scraper falla, debe retornar array vacío sin romper",
    async () => {
      global.__mockGplaySearch = async () => {
        throw new Error("Google Play no disponible");
      };
      let results;
      try {
        results = await checkAndroidDeals();
        assert.ok(
          Array.isArray(results),
          "Debe retornar un array aunque falle"
        );
      } catch (err) {
        assert.fail(
          `checkAndroidDeals lanzó excepción no controlada: ${err.message}`
        );
      }
    }
  );

  await t.test(
    "📦 Caso 7: Los resultados deben tener la estructura correcta",
    async () => {
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.structure.test",
          title: "Structure Test Free",
          free: true,
        }),
      ];
      const results = await checkAndroidDeals();
      assert.ok(results.length > 0, "No se obtuvieron resultados");
      const app = results[0];
      ["appId", "title", "url", "priceText", "developer"].forEach((field) => {
        assert.ok(field in app, `Falta campo ${field}`);
      });
    }
  );
});
