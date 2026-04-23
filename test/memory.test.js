// test/memory.test.js

const test = require("node:test");
const assert = require("node:assert");

// CORRECCION: memory.js puede usarse en entorno Netlify, pero estos tests son offline.
const Module = require("module");
const originalLoad = Module._load;

Module._load = function (request, ...args) {
  if (request === "@netlify/blobs") {
    return {
      getStore: () => ({
        get: async () => null,
        setJSON: async () => {},
      }),
    };
  }
  return originalLoad.call(this, request, ...args);
};

const {
  normalizePublishedGames,
  getPublishedGamesList,
  savePublishedGamesList,
} = require("../utils/memory");

test("Suite de Pruebas: Gestor de Memoria (Netlify Blobs)", async (t) => {
  t.after(() => {
    Module._load = originalLoad;
  });

  await t.test("Caso 1: Debe devolver [] si no hay datos en nube", async () => {
    const mockStoreEmpty = {
      get: async () => null,
    };

    const result = await getPublishedGamesList(mockStoreEmpty);
    assert.deepStrictEqual(result, []);
  });

  await t.test(
    "Caso 2: Debe normalizar strings heredados a objetos",
    async () => {
      const mockData = ["com.game.one", "com.game.two"];
      const mockStoreWithData = {
        get: async () => JSON.stringify(mockData),
      };

      const result = await getPublishedGamesList(mockStoreWithData);

      assert.deepStrictEqual(result, [
        {
          id: "com.game.one",
          messageId: null,
          publishedAt: null,
          status: "pending_send",
          title: null,
          titleMatch: "com game one",
          chatId: null,
        },
        {
          id: "com.game.two",
          messageId: null,
          publishedAt: null,
          status: "pending_send",
          title: null,
          titleMatch: "com game two",
          chatId: null,
        },
      ]);
    },
  );

  await t.test("Caso 3: Debe guardar en formato normalizado", async () => {
    const datosPrueba = ["juego_A", "juego_B", "juego_C"];

    let llaveGuardada = "";
    let datosQueSeIntentanGuardar = [];

    const mockStore = {
      setJSON: async (key, data) => {
        llaveGuardada = key;
        datosQueSeIntentanGuardar = data;
      },
    };

    await savePublishedGamesList(mockStore, datosPrueba);

    assert.strictEqual(llaveGuardada, "published_games_android");
    assert.deepStrictEqual(datosQueSeIntentanGuardar, [
      {
        id: "juego_A",
        messageId: null,
        publishedAt: null,
        status: "pending_send",
        title: null,
        titleMatch: "juego a",
        chatId: null,
      },
      {
        id: "juego_B",
        messageId: null,
        publishedAt: null,
        status: "pending_send",
        title: null,
        titleMatch: "juego b",
        chatId: null,
      },
      {
        id: "juego_C",
        messageId: null,
        publishedAt: null,
        status: "pending_send",
        title: null,
        titleMatch: "juego c",
        chatId: null,
      },
    ]);
  });

  await t.test("Caso 4: Debe manejar JSON malformado sin romper", async () => {
    const mockStoreCorrupted = {
      get: async () => "esto_no_es_json_valido{{{",
    };

    const result = await getPublishedGamesList(mockStoreCorrupted);
    assert.ok(Array.isArray(result));
    assert.deepStrictEqual(result, []);
  });

  await t.test(
    "Caso 5: Debe normalizar mezcla de strings y objetos permitiendo todos los registros (para procesar duplicados)",
    async () => {
      const mixed = [
        "com.legacy.one",
        { id: "com.new.one", messageId: 123 },
        { id: "com.legacy.one", messageId: 999 },
        { id: "", messageId: 1 },
        null,
      ];

      const result = normalizePublishedGames(mixed);

      assert.deepStrictEqual(result, [
        {
          id: "com.legacy.one",
          messageId: null,
          publishedAt: null,
          status: "pending_send",
          title: null,
          titleMatch: "com legacy one",
          chatId: null,
        },
        {
          id: "com.new.one",
          messageId: 123,
          publishedAt: null,
          status: "sent_unverified",
          title: null,
          titleMatch: "com new one",
          chatId: null,
        },
        {
          id: "com.legacy.one",
          messageId: 999,
          publishedAt: null,
          status: "sent_unverified",
          title: null,
          titleMatch: "com legacy one",
          chatId: null,
        },
      ]);
    },
  );

  await t.test(
    "Caso 7: Debe conservar estado sent_verified cuando viene en memoria",
    async () => {
      const raw = [
        {
          id: "com.status.ok",
          messageId: 321,
          publishedAt: 1111,
          status: "sent_verified",
          title: "Status Game",
        },
      ];

      const result = normalizePublishedGames(raw);

      assert.deepStrictEqual(result, [
        {
          id: "com.status.ok",
          messageId: 321,
          publishedAt: 1111,
          status: "sent_verified",
          title: "Status Game",
          titleMatch: "status game",
          chatId: null,
        },
      ]);
    },
  );

  await t.test(
    "Caso 6: Debe mantener solo los ultimos 300 en Android",
    async () => {
      const items = Array.from({ length: 305 }, (_, i) => ({
        id: `com.game.${i + 1}`,
        messageId: i + 1,
        publishedAt: 1000 + i,
      }));

      let saved = [];
      const mockStore = {
        setJSON: async (_key, data) => {
          saved = data;
        },
      };

      await savePublishedGamesList(mockStore, items, "android");

      assert.strictEqual(saved.length, 300);
      assert.strictEqual(saved[0].id, "com.game.6");
      assert.strictEqual(saved[299].id, "com.game.305");
    },
  );
});
