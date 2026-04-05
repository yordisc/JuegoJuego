// utils/telegram.js

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status) {
  return status === 429 || status >= 500;
}

function parseRetryAfterHeader(value) {
  if (value == null) {
    return null;
  }

  const asNumber = Number.parseInt(String(value), 10);
  if (Number.isInteger(asNumber) && asNumber > 0) {
    return asNumber;
  }

  const dateMs = Date.parse(String(value));
  if (!Number.isNaN(dateMs)) {
    const deltaMs = dateMs - Date.now();
    if (deltaMs > 0) {
      return Math.ceil(deltaMs / 1000);
    }
  }

  return null;
}

async function readRetryAfterSecondsFromBody(response) {
  try {
    const rawText = await response.clone().text();
    if (!rawText) {
      return null;
    }

    const parsed = JSON.parse(rawText);
    const retryAfter =
      parsed && parsed.parameters && parsed.parameters.retry_after != null
        ? Number.parseInt(String(parsed.parameters.retry_after), 10)
        : null;

    return Number.isInteger(retryAfter) && retryAfter > 0 ? retryAfter : null;
  } catch (_err) {
    return null;
  }
}

async function getRetryDelayMs(response, fallbackMs) {
  const headerValue = response.headers && typeof response.headers.get === "function"
    ? response.headers.get("retry-after")
    : null;
  const headerSeconds = parseRetryAfterHeader(headerValue);
  if (Number.isInteger(headerSeconds) && headerSeconds > 0) {
    return headerSeconds * 1000;
  }

  const bodySeconds = await readRetryAfterSecondsFromBody(response);
  if (Number.isInteger(bodySeconds) && bodySeconds > 0) {
    return bodySeconds * 1000;
  }

  return fallbackMs;
}

async function requestWithRetry(url, payload, options = {}) {
  const attempts = Number.isInteger(options.attempts) ? options.attempts : 3;
  const baseDelayMs = Number.isInteger(options.baseDelayMs)
    ? options.baseDelayMs
    : 500;
  const sleepFn = typeof options.sleepFn === "function" ? options.sleepFn : sleep;

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

      const fallbackDelayMs = baseDelayMs * attempt;
      const retryDelayMs = await getRetryDelayMs(response, fallbackDelayMs);
      await sleepFn(retryDelayMs);
      continue;
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) {
        throw err;
      }

      await sleepFn(baseDelayMs * attempt);
      continue;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("requestWithRetry no pudo completar la solicitud");
}

module.exports = {
  requestWithRetry,
};
