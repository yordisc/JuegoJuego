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

function parseStepBody(rawBody) {
  if (!rawBody || typeof rawBody !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    return null;
  }
}

function getManualLogLevel() {
  const fallback =
    process.env.NODE_ENV === "production" ? "compact" : "debug";
  const raw = String(process.env.MANUAL_LOG_LEVEL || fallback)
    .trim()
    .toLowerCase();
  return raw === "debug" ? "debug" : "compact";
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
  const logLevel = getManualLogLevel();

  console.log("========================================");
  console.log("⚙️ INICIANDO MANUAL-RUN-ALL");
  console.log("========================================");
  console.log("[manual-run-all] log-level:", logLevel);

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

    const parsed = parseStepBody(stepResult.body);
    const summary =
      parsed && typeof parsed === "object"
        ? parsed.result || parsed.metrics || { success: parsed.success }
        : null;
    if (logLevel === "debug") {
      console.log(
        `[manual-run-all] Resultado ${name}: ` +
          JSON.stringify({
            ok: stepResult.ok,
            statusCode: stepResult.statusCode,
            durationMs: stepResult.durationMs,
            summary,
          })
      );
    } else {
      console.log(
        `[manual-run-all] Resultado ${name}: ` +
          JSON.stringify({
            ok: stepResult.ok,
            statusCode: stepResult.statusCode,
            durationMs: stepResult.durationMs,
          })
      );
    }

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

  console.log(
    "[manual-run-all] resumen final:",
    JSON.stringify({
      success,
      totalSteps: results.length,
      failedSteps: results.filter((step) => !step.ok).map((step) => step.name),
      totalDurationMs: results.reduce(
        (acc, step) => acc + (step.durationMs || 0),
        0
      ),
    })
  );

  return {
    statusCode: success ? 200 : 207,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      success,
      stopOnError,
      steps: results,
    }),
  };
};
