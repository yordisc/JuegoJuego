// test/memory.test.js

const test = require("node:test");
const assert = require("node:assert");

// CORRECCIÓN: memory.js hace require('@netlify/blobs') al cargarse,
// pero ese módulo solo existe en el entorno de Netlify (producción).
// Lo interceptamos aquí igual que se hace con google-play-scraper en
// android-deals.test.js, antes de que memory.js sea requerido.
// Las funciones getPublishedGamesList y savePublishedGamesList reciben
// el store como parámetro, así que el módulo real nunca se usa en tests.
const Module = require("module");
const originalLoad = Module._load;

Module._load = function (request, ...args) {
  if (request === "@netlify/blobs") {
    return {
      getStore: () => ({
        get: async () => null,
        setJSON: async () => { },
      }),
    };
  }
  return originalLoad.call(this, request, ...args);
};

// Mockeamos fetch para evitar peticiones reales a Telegram
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  if (url && url.toString().includes("api.telegram.org")) {
    return { ok: true, json: async () => ({ ok: true }) };
  }
  return originalFetch ? originalFetch(url, options) : { ok: true };
};

process.env.TELEGRAM_TOKEN = "test-token";
process.env.CHANNEL_ID = "@testchannel";

// Ahora sí podemos requerir memory.js sin que explote
const {
  getPublishedGamesList,
  savePublishedGamesList,
} = require("../utils/memory");

test("🧪 Suite de Pruebas: Gestor de Memoria (Netlify Blobs)", async (t) => {
  await t.test(
    "✅ Caso 1: Debe devolver un array vacío [] si es la primera vez (nube vacía)",
    async () => {
      // Simulamos un store que devuelve null (primera ejecución, sin datos previos)
      const mockStoreEmpty = {
        get: async () => null,
      };

      const result = await getPublishedGamesList(mockStoreEmpty);

      assert.deepStrictEqual(
        result,
        [],
        "El bot no inicializó correctamente un array vacío"
      );
    }
  );

  await t.test(
    "✅ Caso 2: Debe leer y decodificar correctamente los datos guardados",
    async () => {
      const mockData = ["com.game.one", "com.game.two"];

      // Simulamos un store con datos previos guardados como JSON string
      const mockStoreWithData = {
        get: async () => JSON.stringify(mockData),
      };

      const result = await getPublishedGamesList(mockStoreWithData);

      assert.deepStrictEqual(
        result,
        mockData,
        "El bot no pudo leer los datos guardados"
      );
    }
  );

  await t.test(
    "✅ Caso 3: Debe guardar la lista exacta que recibe en la nube",
    async () => {
      const datosPrueba = ["juego_A", "juego_B", "juego_C"];

      let llaveGuardada = "";
      let datosQueSeIntentanGuardar = [];

      // Capturamos exactamente qué le llega al store al guardar
      const mockStore = {
        setJSON: async (key, data) => {
          llaveGuardada = key;
          datosQueSeIntentanGuardar = data;
        },
      };

      await savePublishedGamesList(mockStore, datosPrueba);

      // Verifica que use la clave correcta en la base de datos
      assert.strictEqual(
        llaveGuardada,
        "published_games",
        "Se guardó con una clave incorrecta en la base de datos"
      );

      // Verifica que los datos lleguen sin modificaciones (sin recortes ni transformaciones)
      assert.deepStrictEqual(
        datosQueSeIntentanGuardar,
        datosPrueba,
        "El gestor de memoria alteró los datos antes de guardarlos"
      );
    }
  );

  await t.test(
    "✅ Caso 4: Debe manejar un JSON malformado en la nube sin romper",
    async () => {
      // Si los datos en Netlify Blobs están corruptos, el bot no debe colapsar.
      // Debe devolver un array vacío de forma segura.
      const mockStoreCorrupted = {
        get: async () => "esto_no_es_json_valido{{{",
      };

      let result;
      try {
        result = await getPublishedGamesList(mockStoreCorrupted);
        // Si llegamos aquí sin error: verificamos que devuelva algo usable
        assert.ok(Array.isArray(result), "Debe devolver un array aunque el JSON sea inválido");
      } catch (err) {
        // Si lanza excepción, la capturamos para dar un mensaje claro
        // NOTA: si este test falla, considera añadir un try/catch en getPublishedGamesList
        assert.fail(
          `getPublishedGamesList lanzó excepción con datos corruptos: ${err.message}\n` +
          `Considera añadir manejo de errores en utils/memory.js para este caso.`
        );
      }
    }
  );
});