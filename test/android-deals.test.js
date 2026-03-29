// test/android-deals.test.js
const test = require("node:test");
const assert = require("node:assert");

// 1. MOCKEAMOS EL REQUIRE DE google-play-scraper
const Module = require("module");
const originalLoad = Module._load;

Module._load = function (request, ...args) {
  if (request === "google-play-scraper") {
    return {
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
  const originalSetTimeout = global.setTimeout;

  t.beforeEach(() => {
    global.setTimeout = (cb) => cb();
  });

  t.afterEach(() => {
    global.__mockGplaySearch = null;
    global.setTimeout = originalSetTimeout;
  });

  // ------------------------------------------------------------------
  // CASOS DE FILTRO: ¿qué entra y qué no entra?
  // ------------------------------------------------------------------

  await t.test(
    '✅ Caso 1: Debe incluir app con "limited time" en el título',
    async () => {
      // CAMBIO respecto al test anterior:
      // Antes usaba title: "Monument Valley [Free]" con el keyword suelto "free".
      // Ahora usamos una frase que indica oferta temporal real, consistente
      // con los nuevos TITLE_KEYWORDS del servicio corregido.
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.monument",
          title: "Monument Valley - Free Limited Time",
          free: false,
        }),
      ];
      const results = await checkAndroidDeals();
      assert.ok(
        results.some((app) => app.appId === "com.monument"),
        'App con "limited time" no incluida'
      );
    }
  );

  await t.test(
    '✅ Caso 2: Debe incluir app con "sale" en el título',
    async () => {
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.sale.app",
          title: "Epic Adventure On Sale 100% Off",
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
    '✅ Caso 3: Debe incluir app con "price drop" en el título',
    async () => {
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.pricedrop.app",
          title: "Stardew Valley Price Drop",
          free: false,
        }),
      ];
      const results = await checkAndroidDeals();
      assert.ok(
        results.some((app) => app.appId === "com.pricedrop.app"),
        'App con "price drop" no incluida'
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
        "Se incluyó app de pago sin keywords de oferta"
      );
    }
  );

  await t.test(
    "❌ Caso 5 (BUG #1 — REGRESIÓN): NO debe incluir app F2P permanente solo por free=true",
    async () => {
      // Este caso prueba exactamente el bug que se corrigió.
      // Antes, una app con free=true (freemium permanente) siempre entraba.
      // Ahora solo debe entrar si su título indica una oferta real.
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.freemium.forever",
          title: "Generic Freemium Game",
          free: true,       // Siempre gratis en Google Play (F2P permanente)
          priceText: "Free",
        }),
      ];
      const results = await checkAndroidDeals();
      assert.ok(
        !results.some((app) => app.appId === "com.freemium.forever"),
        "BUG #1 REGRESIÓN: App F2P permanente fue incluida solo por tener free=true"
      );
    }
  );

  await t.test(
    "❌ Caso 6 (BUG #1 — REGRESIÓN): La blacklist debe funcionar incluso si el título tiene keywords de oferta",
    async () => {
      // Antes, un juego de la blacklist podía entrar por la condición "app.free ||".
      // Ahora la blacklist se evalúa PRIMERO dentro de matchesTitle(), siempre.
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.freefire.limited",
          title: "Free Fire - Limited Time Event",  // tiene keyword "limited time" pero está en blacklist
          free: false,
        }),
      ];
      const results = await checkAndroidDeals();
      assert.ok(
        !results.some((app) => app.appId === "com.freefire.limited"),
        "BUG #1 REGRESIÓN: Juego de la blacklist pasó el filtro"
      );
    }
  );

  // ------------------------------------------------------------------
  // CASOS DE DEDUPLICACIÓN Y MEMORIA
  // ------------------------------------------------------------------

  await t.test(
    "🔁 Caso 7: No debe publicar ni guardar en memoria un juego ya publicado",
    async () => {
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.already.published",
          title: "Great Game Limited Time Free",
          free: false,
        }),
      ];
      // Simulamos que este juego ya fue publicado en una ejecución anterior
      const publishedGames = ["com.already.published"];
      await checkAndroidDeals(publishedGames);

      // La memoria no debe crecer: el juego ya estaba y no debe duplicarse
      assert.strictEqual(
        publishedGames.length,
        1,
        "Se duplicó en memoria un juego que ya estaba publicado"
      );
    }
  );

  await t.test(
    "🔁 Caso 8: No debe haber duplicados en los resultados entre múltiples búsquedas",
    async () => {
      // El mismo appId aparece en varias búsquedas (comportamiento real del scraper)
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.duplicate.app",
          title: "Duplicate Game Sale 100% Off",
          free: false,
        }),
      ];
      const results = await checkAndroidDeals();
      const ids = results.map((app) => app.appId);
      assert.strictEqual(
        ids.length,
        new Set(ids).size,
        "Hay IDs duplicados en los resultados"
      );
    }
  );

  await t.test(
    "💾 Caso 9 (BUG #2 — REGRESIÓN): Solo debe guardarse en memoria si Telegram respondió OK",
    async () => {
      // Simulamos que Telegram falla para este juego
      global.fetch = async (url) => {
        if (url.includes("api.telegram.org")) {
          return { ok: false, text: async () => "Bad Request" };
        }
        return { ok: true };
      };
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.telegram.fail",
          title: "Great Game Limited Time Deal",
          free: false,
        }),
      ];
      const publishedGames = [];
      await checkAndroidDeals(publishedGames);

      // Si Telegram falló, el ID NO debe quedar guardado en memoria.
      // Así el bot reintentará publicarlo en la siguiente ejecución.
      assert.strictEqual(
        publishedGames.length,
        0,
        "BUG #2 REGRESIÓN: Se guardó en memoria un juego que Telegram no recibió"
      );

      // Restauramos fetch para los demás tests
      global.fetch = async (url) => {
        if (url.includes("api.telegram.org")) {
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return { ok: true };
      };
    }
  );

  // ------------------------------------------------------------------
  // CASOS DE ROBUSTEZ
  // ------------------------------------------------------------------

  await t.test(
    "⚠️ Caso 10: Si el scraper falla, debe retornar array vacío sin romper",
    async () => {
      global.__mockGplaySearch = async () => {
        throw new Error("Google Play no disponible");
      };
      let results;
      try {
        results = await checkAndroidDeals();
        assert.ok(
          Array.isArray(results),
          "Debe retornar un array aunque falle el scraper"
        );
        assert.strictEqual(
          results.length,
          0,
          "El array debería estar vacío si el scraper falló"
        );
      } catch (err) {
        assert.fail(
          `checkAndroidDeals lanzó excepción no controlada: ${err.message}`
        );
      }
    }
  );

  await t.test(
    "📦 Caso 11: Los resultados deben tener la estructura correcta",
    async () => {
      global.__mockGplaySearch = async () => [
        mockApp({
          appId: "com.structure.test",
          title: "Structure Test - Limited Time Sale",
          free: false,
        }),
      ];
      const results = await checkAndroidDeals();
      assert.ok(results.length > 0, "No se obtuvieron resultados");
      const app = results[0];
      ["appId", "title", "url", "priceText", "developer"].forEach((field) => {
        assert.ok(field in app, `Falta campo: ${field}`);
      });
    }
  );
});