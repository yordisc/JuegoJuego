const test = require("node:test");
const assert = require("node:assert");

const { _private } = require("../netlify/functions/manual-delete-smoke");

const {
  buildDeleteMessagePayload,
  buildMethodReference,
  isTelegramDeleteNotAllowed,
  isTelegramApiLogicalSuccess,
  resolveDeleteChatId,
} = _private;

test("manual-delete-smoke: usa metodo oficial deleteMessage(chat_id, message_id)", async () => {
  assert.deepStrictEqual(buildMethodReference(), {
    method: "deleteMessage",
    signature: "deleteMessage(chat_id, message_id)",
  });

  assert.deepStrictEqual(buildDeleteMessagePayload("@canal", 123), {
    chat_id: "@canal",
    message_id: 123,
  });
});

test("manual-delete-smoke: resuelve deleteChatId desde sendMessage result.chat.id", async () => {
  assert.strictEqual(
    resolveDeleteChatId(
      {
        ok: true,
        result: {
          chat: {
            id: -100123456789,
          },
        },
      },
      "@fallback"
    ),
    -100123456789
  );

  assert.strictEqual(
    resolveDeleteChatId(
      {
        ok: true,
        result: {
          chat: {
            id: "@canal_real",
          },
        },
      },
      "@fallback"
    ),
    "@canal_real"
  );

  assert.strictEqual(resolveDeleteChatId({ ok: true }, "@fallback"), "@fallback");
});

test("manual-delete-smoke: valida ok logico del payload Telegram", async () => {
  assert.strictEqual(isTelegramApiLogicalSuccess({ ok: true }), true);
  assert.strictEqual(isTelegramApiLogicalSuccess({ ok: false }), false);
  assert.strictEqual(isTelegramApiLogicalSuccess({ result: true }), false);
  assert.strictEqual(isTelegramApiLogicalSuccess(null), false);
});

test("manual-delete-smoke: detecta errores de borrado por permisos", async () => {
  const cases = [
    {
      status: 400,
      error: "Bad Request: message can't be deleted",
    },
    {
      status: 400,
      error: "Bad Request: message can\u2019t be deleted for everyone",
    },
    {
      status: 403,
      error: "Forbidden: bot was kicked from the channel",
      expected: false,
    },
    {
      status: 400,
      error: "Bad Request: MESSAGE_DELETE_FORBIDDEN",
    },
    {
      status: 403,
      error: "Forbidden: not enough rights to delete message",
    },
    {
      status: 403,
      error: "Forbidden: have no rights to delete a message",
    },
    {
      status: 400,
      error: "Bad Request: chat_admin_required",
    },
  ];

  for (const item of cases) {
    const expected = item.expected == null ? true : item.expected;
    assert.strictEqual(
      isTelegramDeleteNotAllowed(item.status, item.error),
      expected,
      `${item.status} ${item.error}`
    );
  }
});

test("manual-delete-smoke: no clasifica errores ajenos como no borrables", async () => {
  const cases = [
    { status: 500, error: "Internal Server Error" },
    { status: 400, error: "Bad Request: message to delete not found" },
    { status: 401, error: "Unauthorized" },
  ];

  for (const item of cases) {
    assert.strictEqual(
      isTelegramDeleteNotAllowed(item.status, item.error),
      false,
      `${item.status} ${item.error}`
    );
  }
});
