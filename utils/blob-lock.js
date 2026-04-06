function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseIntEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLockPayload(raw) {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const token = typeof parsed.token === "string" ? parsed.token : "";
    const expiresAt = Number.isInteger(parsed.expiresAt) ? parsed.expiresAt : 0;
    const owner = typeof parsed.owner === "string" ? parsed.owner : "unknown";

    if (!token || expiresAt <= 0) {
      return null;
    }

    return {
      token,
      owner,
      acquiredAt: Number.isInteger(parsed.acquiredAt) ? parsed.acquiredAt : null,
      expiresAt,
    };
  } catch (_err) {
    return null;
  }
}

function createToken(owner) {
  return `${owner}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function tryAcquireBlobLock(store, options = {}) {
  const lockKey = options.lockKey || "android_state_lock";
  const owner = options.owner || "unknown-owner";
  const ttlMs = parseIntEnv(options.ttlMs, 5 * 1000);
  const retries = parseIntEnv(options.retries, 5);
  const retryDelayMs = parseIntEnv(options.retryDelayMs, 500);

  const token = createToken(owner);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const now = Date.now();
    const currentRaw = await store.get(lockKey);
    const current = parseLockPayload(currentRaw);

    if (!current || current.expiresAt <= now) {
      await store.setJSON(lockKey, {
        token,
        owner,
        acquiredAt: now,
        expiresAt: now + ttlMs,
      });

      const verifyRaw = await store.get(lockKey);
      const verify = parseLockPayload(verifyRaw);
      if (verify && verify.token === token) {
        return {
          token,
          owner,
          lockKey,
          ttlMs,
        };
      }
    }

    if (attempt < retries) {
      await sleep(retryDelayMs);
    }
  }

  const err = new Error(
    `[blob-lock] No se pudo adquirir lock ${lockKey} tras ${retries} intentos`
  );
  err.code = "BLOB_LOCK_TIMEOUT";
  throw err;
}

async function releaseBlobLock(store, lock, options = {}) {
  if (!lock || !lock.lockKey || !lock.token) {
    return;
  }

  const lockKey = lock.lockKey;
  const owner = options.owner || lock.owner || "unknown-owner";
  const now = Date.now();

  const currentRaw = await store.get(lockKey);
  const current = parseLockPayload(currentRaw);
  if (!current || current.token !== lock.token) {
    return;
  }

  await store.setJSON(lockKey, {
    token: "",
    owner,
    acquiredAt: now,
    expiresAt: 0,
    releasedAt: now,
  });
}

async function withBlobLock(store, options = {}, handler) {
  const lock = await tryAcquireBlobLock(store, options);

  try {
    return await handler();
  } finally {
    await releaseBlobLock(store, lock, options).catch(() => {});
  }
}

module.exports = {
  tryAcquireBlobLock,
  releaseBlobLock,
  withBlobLock,
};
