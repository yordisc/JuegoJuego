if (process.env.NODE_ENV !== "production") require("dotenv").config();

const { handler: cleanMemoryHandler } = require("./manual-clean-memory");
const { handler: cleanTelegramHandler } = require("./manual-clean-telegram");
const { handler: checkAndroidHandler } = require("./check-android");
const { handler: checkPcHandler } = require("./check-pc");
const { handler: cleanExpiredHandler } = require("./clean-expired");
const { handler: cleanDuplicatesHandler } = require("./clean-duplicates");

function isAuthorized(event) {
  const requiredKey = process.env.MANUAL_FUNCTION_KEY;
  if (!requiredKey) {
    return true;
  }

  const headerKey =
    event && event.headers
      ? event.headers["x-manual-key"] || event.headers["X-Manual-Key"]
      : null;

  return headerKey === requiredKey;
}

function parseBody(body) {
  if (!body) {
    return {};
  }

  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

async function runStep(name, handler, event) {
  const startedAt = Date.now();
  const response = await handler(event, {});
  const durationMs = Date.now() - startedAt;
  const statusCode = response && Number.isInteger(response.statusCode)
    ? response.statusCode
    : 500;

  return {
    name,
    statusCode,
    ok: statusCode >= 200 && statusCode < 300,
    durationMs,
    body: response ? response.body : null,
  };
}

exports.handler = async (event) => {
  if (!isAuthorized(event)) {
    return {
      statusCode: 401,
      body: "No autorizado para ejecutar manual-run-all.",
    };
  }

  const body = parseBody(event && event.body);
  const stopOnError = body.stopOnError !== false;

  console.log("========================================");
  console.log("⚙️ INICIANDO MANUAL-RUN-ALL");
  console.log("========================================");

  const steps = [
    ["manual-clean-memory", cleanMemoryHandler],
    ["manual-clean-telegram", cleanTelegramHandler],
    ["check-android", checkAndroidHandler],
    ["check-pc", checkPcHandler],
    ["clean-expired", cleanExpiredHandler],
    ["clean-duplicates", cleanDuplicatesHandler],
  ];

  const results = [];

  for (const [name, handler] of steps) {
    console.log(`[manual-run-all] Ejecutando: ${name}`);
    const stepResult = await runStep(name, handler, event);
    results.push(stepResult);

    if (!stepResult.ok && stopOnError) {
      console.error(
        `[manual-run-all] Se detiene por error en ${name} (HTTP ${stepResult.statusCode})`
      );

      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          stoppedAt: name,
          stopOnError,
          steps: results,
        }),
      };
    }
  }

  const success = results.every((step) => step.ok);

  return {
    statusCode: success ? 200 : 207,
    body: JSON.stringify({
      success,
      stopOnError,
      steps: results,
    }),
  };
};
