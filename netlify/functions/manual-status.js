if (process.env.NODE_ENV !== "production") require("dotenv").config();

const {
  createBlobStoreFromEnv,
  getBlobCredentialReport,
} = require("../../utils/netlify-blobs");
const { getMaintenanceSnapshot } = require("../../services/manual-maintenance");

const KEY_MANUAL_DELETE_SMOKE_RESULT = "manual_delete_smoke_result";

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

function parseBool(raw, defaultValue) {
  if (raw == null || raw === "") {
    return defaultValue;
  }

  if (typeof raw === "boolean") {
    return raw;
  }

  if (typeof raw === "string") {
    const value = raw.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(value)) return true;
    if (["0", "false", "no", "n", "off"].includes(value)) return false;
  }

  return defaultValue;
}

function parsePositiveInt(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}

function getManualLogLevel() {
  const fallback =
    process.env.NODE_ENV === "production" ? "compact" : "debug";
  const raw = String(process.env.MANUAL_LOG_LEVEL || fallback)
    .trim()
    .toLowerCase();
  return raw === "debug" ? "debug" : "compact";
}

async function readDeleteSmokeResult(store) {
  try {
    const raw = await store.get(KEY_MANUAL_DELETE_SMOKE_RESULT);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      success: Boolean(parsed.success),
      action: typeof parsed.action === "string" ? parsed.action : "manual-delete-smoke",
      step: typeof parsed.step === "string" ? parsed.step : null,
      chatId:
        typeof parsed.chatId === "string" && parsed.chatId.trim()
          ? parsed.chatId.trim()
          : null,
      messageId: Number.isInteger(parsed.messageId) ? parsed.messageId : null,
      skipDelete: Boolean(parsed.skipDelete),
      sendStatus: Number.isInteger(parsed.sendStatus) ? parsed.sendStatus : null,
      deleteStatus: Number.isInteger(parsed.deleteStatus) ? parsed.deleteStatus : null,
      error:
        typeof parsed.error === "string" && parsed.error.trim()
          ? parsed.error.trim()
          : null,
      deleteError:
        typeof parsed.deleteError === "string" && parsed.deleteError.trim()
          ? parsed.deleteError.trim()
          : null,
      updatedAt:
        typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()
          ? parsed.updatedAt.trim()
          : null,
    };
  } catch (err) {
    console.warn(`[manual-status] No se pudo leer el ultimo smoke de borrado: ${err.message}`);
    return null;
  }
}

exports.handler = async (event) => {
  if (!isAuthorized(event)) {
    return {
      statusCode: 401,
      body: "No autorizado para ejecutar manual-status.",
    };
  }

  console.log("========================================");
  console.log("📊 INICIANDO MANUAL-STATUS");
  console.log("========================================");

  const logLevel = getManualLogLevel();

  try {
    const report = getBlobCredentialReport(process.env);
    if (report.issues.length > 0) {
      console.error("Credenciales invalidas:");
      for (const issue of report.issues) {
        console.error(` - ${issue}`);
      }
    }

    const includeSamples = parseBool(
      event && event.queryStringParameters
        ? event.queryStringParameters.includeSamples
        : null,
      false
    );
    const sampleSize = parsePositiveInt(
      event && event.queryStringParameters
        ? event.queryStringParameters.sampleSize
        : null,
      10
    );

    const store = createBlobStoreFromEnv({ storeName: "memory-store" });
    const result = await getMaintenanceSnapshot(store, {
      includeSamples,
      sampleSize,
    });
    const deleteSmoke = await readDeleteSmokeResult(store);

    if (deleteSmoke) {
      result.deleteSmoke = deleteSmoke;
    }

    console.log(
      "[manual-status] summary:",
      JSON.stringify({
        logLevel,
        includeSamples,
        sampleSize,
        ...result.summary,
      })
    );
    if (result.tracking) {
      console.log(
        "[manual-status] tracking:",
        JSON.stringify(result.tracking)
      );
    }
    if (deleteSmoke) {
      console.log(
        "[manual-status] delete-smoke:",
        JSON.stringify(deleteSmoke)
      );
    }
    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
      console.warn(
        "[manual-status] warnings:",
        JSON.stringify(result.warnings)
      );
    }
    if (includeSamples && result.samples && logLevel === "debug") {
      console.log("[manual-status] samples:", JSON.stringify(result.samples));
    } else if (includeSamples && result.samples) {
      console.log(
        "[manual-status] samples-resumen:",
        JSON.stringify(
          Object.fromEntries(
            Object.entries(result.samples).map(([key, items]) => [
              key,
              Array.isArray(items) ? items.length : 0,
            ])
          )
        )
      );
    }

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        success: true,
        action: "manual-status",
        includeSamples,
        sampleSize,
        deleteSmoke,
        result,
      }),
    };
  } catch (error) {
    console.error("❌ ERROR EN MANUAL-STATUS:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: String(error) }),
    };
  }
};
