const test = require("node:test");
const assert = require("node:assert");

const { requestWithRetry } = require("../utils/telegram");

function createResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => headers[String(name).toLowerCase()] ?? null,
    },
    clone() {
      return {
        text: async () => String(body ?? ""),
      };
    },
  };
}

test("telegram requestWithRetry: respeta retry_after del body en 429", async () => {
  const originalFetch = global.fetch;
  const sleepCalls = [];
  let calls = 0;

  try {
    global.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return createResponse(
          429,
          JSON.stringify({
            ok: false,
            error_code: 429,
            parameters: { retry_after: 3 },
          })
        );
      }

      return createResponse(200, JSON.stringify({ ok: true }));
    };

    const response = await requestWithRetry(
      "https://api.telegram.org/botTEST/sendMessage",
      { text: "hello" },
      {
        attempts: 2,
        baseDelayMs: 100,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
      }
    );

    assert.strictEqual(response.ok, true);
    assert.deepStrictEqual(sleepCalls, [3000]);
    assert.strictEqual(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("telegram requestWithRetry: usa Retry-After header si existe", async () => {
  const originalFetch = global.fetch;
  const sleepCalls = [];
  let calls = 0;

  try {
    global.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return createResponse(429, "", { "retry-after": "4" });
      }

      return createResponse(200, JSON.stringify({ ok: true }));
    };

    const response = await requestWithRetry(
      "https://api.telegram.org/botTEST/sendMessage",
      { text: "hello" },
      {
        attempts: 2,
        baseDelayMs: 100,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
      }
    );

    assert.strictEqual(response.ok, true);
    assert.deepStrictEqual(sleepCalls, [4000]);
    assert.strictEqual(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("telegram requestWithRetry: mantiene fallback cuando no hay retry_after", async () => {
  const originalFetch = global.fetch;
  const sleepCalls = [];
  let calls = 0;

  try {
    global.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return createResponse(500, "server error");
      }

      return createResponse(200, JSON.stringify({ ok: true }));
    };

    const response = await requestWithRetry(
      "https://api.telegram.org/botTEST/sendMessage",
      { text: "hello" },
      {
        attempts: 2,
        baseDelayMs: 250,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
      }
    );

    assert.strictEqual(response.ok, true);
    assert.deepStrictEqual(sleepCalls, [250]);
    assert.strictEqual(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});
