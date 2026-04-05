const test = require("node:test");
const assert = require("node:assert");

const { withBlobLock, tryAcquireBlobLock } = require("../utils/blob-lock");

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

test("blob-lock: withBlobLock adquiere y libera lock", async () => {
  const store = createStore();

  const result = await withBlobLock(
    store,
    {
      lockKey: "android_state_lock",
      owner: "test-owner",
      ttlMs: 30000,
      retries: 1,
      retryDelayMs: 1,
    },
    async () => "ok"
  );

  assert.strictEqual(result, "ok");
  const snapshot = store.snapshot();
  assert.ok(snapshot.android_state_lock);
  assert.strictEqual(snapshot.android_state_lock.expiresAt, 0);
});

test("blob-lock: evita adquisicion concurrente activa", async () => {
  const now = Date.now();
  const store = createStore({
    android_state_lock: {
      token: "other-lock-token",
      owner: "other",
      acquiredAt: now,
      expiresAt: now + 60_000,
    },
  });

  await assert.rejects(
    () =>
      tryAcquireBlobLock(store, {
        lockKey: "android_state_lock",
        owner: "contender",
        ttlMs: 30_000,
        retries: 2,
        retryDelayMs: 1,
      }),
    (err) => {
      assert.strictEqual(err.code, "BLOB_LOCK_TIMEOUT");
      return true;
    }
  );
});

test("blob-lock: recupera lock expirado", async () => {
  const now = Date.now();
  const store = createStore({
    android_state_lock: {
      token: "expired-token",
      owner: "old",
      acquiredAt: now - 120_000,
      expiresAt: now - 60_000,
    },
  });

  const lock = await tryAcquireBlobLock(store, {
    lockKey: "android_state_lock",
    owner: "new-owner",
    ttlMs: 30_000,
    retries: 2,
    retryDelayMs: 1,
  });

  assert.strictEqual(lock.owner, "new-owner");
  const snapshot = store.snapshot();
  assert.strictEqual(snapshot.android_state_lock.owner, "new-owner");
  assert.ok(snapshot.android_state_lock.expiresAt > now);
});
