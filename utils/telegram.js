// utils/telegram.js

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status) {
  return status === 429 || status >= 500;
}

async function requestWithRetry(url, payload, options = {}) {
  const attempts = Number.isInteger(options.attempts) ? options.attempts : 3;
  const baseDelayMs = Number.isInteger(options.baseDelayMs)
    ? options.baseDelayMs
    : 500;

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        return response;
      }

      const canRetry = shouldRetryStatus(response.status) && attempt < attempts;
      if (!canRetry) {
        return response;
      }
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) {
        throw err;
      }
    }

    await sleep(baseDelayMs * attempt);
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("requestWithRetry no pudo completar la solicitud");
}

module.exports = {
  requestWithRetry,
};
