// test/clean-duplicates.test.js

const assert = require("node:assert");
const { test } = require("node:test");
const {
  groupMessagesByGameId,
  findDuplicates,
  sortByAge,
  getMessagesToDelete,
  cleanDuplicates,
} = require("../services/clean-duplicates");

process.env.TELEGRAM_TOKEN = "test-token";
process.env.CHANNEL_ID = "@testchannel";

const originalFetch = global.fetch;

test("clean-duplicates: cleanDuplicates elimina duplicados y compacta memoria", async () => {
  try {
    global.fetch = async (url) => {
      if (url.includes("deleteMessage")) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }

      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const published = [
      { id: "game1", messageId: 100, publishedAt: 1000 },
      { id: "game1", messageId: 101, publishedAt: 2000 },
      { id: "game2", messageId: 200, publishedAt: 3000 },
    ];

    const result = await cleanDuplicates(published);

    assert.strictEqual(result.messagesDeleted, 1);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(published.length, 2);
    assert.strictEqual(published.some((x) => x.messageId === 100), false);
    assert.strictEqual(published.some((x) => x.messageId === 101), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("clean-duplicates: cleanDuplicates trata not found como resuelto", async () => {
  try {
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

      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const published = [
      { id: "game1", messageId: 100, publishedAt: 1000 },
      { id: "game1", messageId: 101, publishedAt: 2000 },
    ];

    const result = await cleanDuplicates(published);

    assert.strictEqual(result.messagesDeleted, 1);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(published.length, 1);
    assert.strictEqual(published[0].messageId, 101);
  } finally {
    global.fetch = originalFetch;
  }
});

test("clean-duplicates: groupMessagesByGameId agrupa correctamente", () => {
  const games = [
    { id: "game1", messageId: 100, publishedAt: 1000 },
    { id: "game1", messageId: 101, publishedAt: 2000 },
    { id: "game2", messageId: 200, publishedAt: 1500 },
  ];

  const grouped = groupMessagesByGameId(games);

  assert.strictEqual(Object.keys(grouped).length, 2);
  assert.strictEqual(grouped.game1.length, 2);
  assert.strictEqual(grouped.game2.length, 1);
});

test("clean-duplicates: groupMessagesByGameId ignora entradas inválidas", () => {
  const games = [
    { id: "game1", messageId: 100 },
    null,
    undefined,
    { messageId: 200 }, // sin id
    { id: "", messageId: 300 }, // id vacío
    { id: "game2", messageId: 400 },
  ];

  const grouped = groupMessagesByGameId(games);

  assert.strictEqual(Object.keys(grouped).length, 2);
  assert.strictEqual(grouped.game1.length, 1);
  assert.strictEqual(grouped.game2.length, 1);
});

test("clean-duplicates: findDuplicates solo retorna juegos duplicados", () => {
  const grouped = {
    game1: [
      { id: "game1", messageId: 100 },
      { id: "game1", messageId: 101 },
    ],
    game2: [{ id: "game2", messageId: 200 }],
    game3: [
      { id: "game3", messageId: 300 },
      { id: "game3", messageId: 301 },
      { id: "game3", messageId: 302 },
    ],
  };

  const duplicates = findDuplicates(grouped);

  assert.strictEqual(duplicates.length, 2);
  assert.strictEqual(duplicates[0].length, 2);
  assert.strictEqual(duplicates[1].length, 3);
});

test("clean-duplicates: findDuplicates retorna array vacío si no hay duplicados", () => {
  const grouped = {
    game1: [{ id: "game1", messageId: 100 }],
    game2: [{ id: "game2", messageId: 200 }],
  };

  const duplicates = findDuplicates(grouped);

  assert.strictEqual(duplicates.length, 0);
});

test("clean-duplicates: sortByAge ordena por publishedAt correctamente", () => {
  const messages = [
    { id: "game1", messageId: 100, publishedAt: 3000 },
    { id: "game1", messageId: 101, publishedAt: 1000 },
    { id: "game1", messageId: 102, publishedAt: 2000 },
  ];

  const sorted = sortByAge(messages);

  assert.strictEqual(sorted[0].publishedAt, 1000);
  assert.strictEqual(sorted[1].publishedAt, 2000);
  assert.strictEqual(sorted[2].publishedAt, 3000);
});

test("clean-duplicates: sortByAge maneja mensajes sin publishedAt", () => {
  const messages = [
    { id: "game1", messageId: 100, publishedAt: 2000 },
    { id: "game1", messageId: 101 }, // sin publishedAt
    { id: "game1", messageId: 102, publishedAt: 1000 },
  ];

  const sorted = sortByAge(messages);

  // Los que tienen publishedAt deben estar ordenados
  const withTimestamp = sorted.filter(m => Number.isInteger(m.publishedAt));
  const withoutTimestamp = sorted.filter(m => !Number.isInteger(m.publishedAt));
  
  assert.strictEqual(withTimestamp[0].publishedAt, 1000);
  assert.strictEqual(withTimestamp[1].publishedAt, 2000);
  assert.strictEqual(withoutTimestamp.length, 1);
});

test("clean-duplicates: getMessagesToDelete retorna todos excepto el más reciente", () => {
  const sorted = [
    { id: "game1", messageId: 100, publishedAt: 1000 },
    { id: "game1", messageId: 101, publishedAt: 2000 },
    { id: "game1", messageId: 102, publishedAt: 3000 },
  ];

  const toDelete = getMessagesToDelete(sorted);

  assert.strictEqual(toDelete.length, 2);
  assert.strictEqual(toDelete[0], 100);
  assert.strictEqual(toDelete[1], 101);
  assert.strictEqual(toDelete.every((id) => id !== 102), true);
});

test("clean-duplicates: getMessagesToDelete retorna array vacío para un solo mensaje", () => {
  const sorted = [{ id: "game1", messageId: 100, publishedAt: 1000 }];

  const toDelete = getMessagesToDelete(sorted);

  assert.strictEqual(toDelete.length, 0);
});

test("clean-duplicates: getMessagesToDelete ignora messageIds null", () => {
  const sorted = [
    { id: "game1", messageId: null, publishedAt: 1000 },
    { id: "game1", messageId: 101, publishedAt: 2000 },
    { id: "game1", messageId: 102, publishedAt: 3000 },
  ];

  const toDelete = getMessagesToDelete(sorted);

  // Elimina 2 (null y 101), mantiene 102 (el más reciente)
  // Pero null se filtra en getMessagesToDelete
  assert.strictEqual(toDelete.length, 1);
  assert.strictEqual(toDelete.includes(null), false);
  assert.strictEqual(toDelete[0], 101);
});

test("clean-duplicates: flujo completo de agrupación y deduplicación", () => {
  const games = [
    { id: "game1", messageId: 100, publishedAt: 1000 },
    { id: "game1", messageId: 101, publishedAt: 2000 }, // duplicado más reciente
    { id: "game2", messageId: 200, publishedAt: 1500 },
    { id: "game3", messageId: 300, publishedAt: 3000 },
    { id: "game3", messageId: 301, publishedAt: 2000 }, // duplicado más antiguo
    { id: "game3", messageId: 302, publishedAt: 2500 },
  ];

  const grouped = groupMessagesByGameId(games);
  const duplicates = findDuplicates(grouped);

  assert.strictEqual(duplicates.length, 2); // game1 y game3 son duplicados

  // Encontrar game1 y game3 en los duplicados (pueden estar en cualquier orden)
  let game1Dups = duplicates.find(dup => dup[0].id === "game1");
  let game3Dups = duplicates.find(dup => dup[0].id === "game3");

  // Para game1: debe eliminar 100
  const sorted1 = sortByAge(game1Dups);
  const toDelete1 = getMessagesToDelete(sorted1);
  assert.strictEqual(toDelete1.length, 1);
  assert.strictEqual(toDelete1[0], 100);

  // Para game3: debe eliminar 301 y 302 (mantener 300 que es el más reciente)
  const sorted3 = sortByAge(game3Dups);
  const toDelete3 = getMessagesToDelete(sorted3);
  assert.strictEqual(toDelete3.length, 2);
  assert.strictEqual(toDelete3.includes(301), true);
  assert.strictEqual(toDelete3.includes(302), true);
  assert.strictEqual(toDelete3.includes(300), false);
});
