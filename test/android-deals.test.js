// test/android-deals.test.js
const test = require("node:test");
const assert = require("node:assert");

// Mockeamos google-play-scraper ANTES de importar el servicio
const Module = require("module");
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id === "google-play-scraper") {
    return { search: global.__mockGplaySearch };
  }
  return originalRequire.apply(this, arguments);
};

const { checkAndroidDeals } = require("../services/android-deals");

// Restauramos require original al terminar
process.on("exit", () => {
  Module.prototype.require = originalRequire;
});

// Variables de entorno falsas
process.env.TELEGRAM_TOKEN = "test-token";
process.env.CHANNEL_ID = "@testchannel";

// Helper para crear un app falsa de Google Play
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
  t.afterEach(() => {
    global.__mockGplaySearch = null;
  });

  // ─────────────────────────────────────────────
  await t.test(
    '✅ Caso 1: Debe incluir app con "Free" en el título',
    async () => {
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.monument",
          title: "Monument Valley [Free]",
          free: false,
          priceText: "$0.00",
        }),
      ];

      const results = await checkAndroidDeals();

      assert.ok(results.length > 0, "No se encontró ninguna oferta");
      assert.ok(
        results.some((app) => app.appId === "com.monument"),
        'La app con "Free" en el título no fue incluida'
      );
    }
  );

  // ─────────────────────────────────────────────
  await t.test(
    "✅ Caso 2: Debe incluir app que esté marcada como free=true",
    async () => {
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.stardew",
          title: "Stardew Valley",
          free: true,
          priceText: "Free",
        }),
      ];

      const results = await checkAndroidDeals();

      assert.ok(results.length > 0, "No se encontró ninguna oferta");
      assert.ok(
        results.some((app) => app.appId === "com.stardew"),
        "La app gratuita no fue incluida"
      );
    }
  );

  // ─────────────────────────────────────────────
  await t.test(
    '✅ Caso 3: Debe incluir app con "sale" en el título',
    async () => {
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.sale.app",
          title: "Epic Game On Sale 50% Off",
          free: false,
          priceText: "$0.99",
        }),
      ];

      const results = await checkAndroidDeals();

      assert.ok(
        results.some((app) => app.appId === "com.sale.app"),
        'La app con "sale" en el título no fue incluida'
      );
    }
  );

  // ─────────────────────────────────────────────
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
        "Se incluyó una app de pago sin palabras clave relevantes"
      );
    }
  );

  // ─────────────────────────────────────────────
  await t.test(
    "🔁 Caso 5: No debe haber duplicados si el mismo appId aparece en varias búsquedas",
    async () => {
      let callCount = 0;
      global.__mockGplaySearch = async () => {
        callCount++;
        // Simula que todos los términos de búsqueda devuelven la misma app
        return [
          mockApp({
            appId: "com.duplicate.app",
            title: "Duplicate Free Game",
            free: true,
          }),
        ];
      };

      const results = await checkAndroidDeals();

      const ids = results.map((app) => app.appId);
      const unique = new Set(ids);
      assert.strictEqual(
        ids.length,
        unique.size,
        "Hay apps duplicadas en los resultados"
      );
    }
  );

  // ─────────────────────────────────────────────
  await t.test(
    "⚠️ Caso 6: Si google-play-scraper falla, debe manejar el error sin romper",
    async () => {
      global.__mockGplaySearch = async () => {
        throw new Error("Google Play no disponible");
      };

      // No debe lanzar una excepción, debe devolver array vacío o manejar el error
      let results;
      try {
        results = await checkAndroidDeals();
        assert.ok(
          Array.isArray(results),
          "Debe devolver un array aunque falle una búsqueda"
        );
      } catch (err) {
        assert.fail(
          `checkAndroidDeals lanzó una excepción no controlada: ${err.message}`
        );
      }
    }
  );

  // ─────────────────────────────────────────────
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
      assert.ok("appId" in app, "Falta campo appId");
      assert.ok("title" in app, "Falta campo title");
      assert.ok("url" in app, "Falta campo url");
      assert.ok("priceText" in app, "Falta campo priceText");
      assert.ok("developer" in app, "Falta campo developer");
    }
  );
});
