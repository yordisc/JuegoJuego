// test/pc-games.test.js
const test = require("node:test");
const assert = require("node:assert");
const { checkPCGames } = require("../services/pc-games");

// Variables de entorno falsas para las pruebas locales
process.env.TELEGRAM_TOKEN = "test-token";
process.env.CHANNEL_ID = "@testchannel";

// Guardamos el comportamiento original por si lo necesitamos
const originalFetch = global.fetch;

test("🧪 Suite de Pruebas: Filtro de PC (GamerPower)", async (t) => {
  // --- PREPARACIÓN DEL SIMULADOR (MOCK) ---
  t.beforeEach(() => {
    global.fetch = async (url, options) => {
      // 1. Simulamos a Telegram diciendo "Mensaje recibido"
      if (url && url.toString().includes("api.telegram.org")) {
        return { ok: true, json: async () => ({ ok: true }) };
      }

      // 2. Simulamos a GamerPower (EL ARREGLO PRINCIPAL 🛡️)
      if (url && url.toString().includes("gamerpower.com")) {
        return {
          ok: true, // Esto pasa el escudo `if (!response.ok)`
          status: 200, // Simula un OK de HTTP
          json: async () => [
            {
              id: 999,
              title: "Mock PC Game",
              platforms: "PC",
              worth: "$19.99",
              description: "Un juego de prueba",
              open_giveaway_url: "https://test.com",
            },
          ],
        };
      }

      // Si hay alguna otra petición extraña, devolvemos un OK genérico
      return { ok: true };
    };
  });

  // Limpiamos el simulador al terminar cada prueba
  t.afterEach(() => {
    global.fetch = originalFetch;
  });

  // --- LOS CASOS DE PRUEBA ---

  await t.test(
    "✅ Caso 1: Debe publicar y guardar si el juego es nuevo",
    async () => {
      const publishedGames = []; // Empezamos con la memoria vacía

      await checkPCGames(publishedGames);

      // Verificamos que el ID '999' del juego falso se haya guardado en la memoria
      assert.strictEqual(
        publishedGames.length,
        1,
        "El juego no se guardó en la memoria"
      );
      assert.strictEqual(
        publishedGames[0],
        "999",
        "El ID guardado no es el correcto"
      );
    }
  );

  await t.test(
    "🧠 Caso 2: NO debe publicar si el juego ya está en la memoria",
    async () => {
      // Empezamos con la memoria "recordando" el ID 999
      const publishedGames = ["999"];

      await checkPCGames(publishedGames);

      // Como el juego ya estaba, la memoria debería seguir teniendo exactamente 1 elemento (no debe duplicarlo)
      assert.strictEqual(
        publishedGames.length,
        1,
        "Se duplicó un juego que ya estaba en memoria"
      );
    }
  );

  await t.test(
    "🛡️ Caso 3: Debe manejar errores de red limpiamente",
    async () => {
      // Para este caso específico, obligamos al simulador a lanzar un error 500 (Servidor Caído)
      global.fetch = async () => {
        return { ok: false, status: 500 };
      };

      const publishedGames = [];

      // Evaluamos que nuestro bloque try/catch en producción funcione y no rompa el bot
      await assert.doesNotReject(async () => {
        await checkPCGames(publishedGames);
      }, "El bot colapsó por un error de red en lugar de atraparlo con el catch");
    }
  );
});
