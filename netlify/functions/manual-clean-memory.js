if (process.env.NODE_ENV !== "production") require("dotenv").config();

const {
  createBlobStoreFromEnv,
  getBlobCredentialReport,
} = require("../../utils/netlify-blobs");
const { clearAllMemory } = require("../../services/manual-maintenance");

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

function getManualLogLevel() {
  const fallback =
    process.env.NODE_ENV === "production" ? "compact" : "debug";
  const raw = String(process.env.MANUAL_LOG_LEVEL || fallback)
    .trim()
    .toLowerCase();
  return raw === "debug" ? "debug" : "compact";
}

exports.handler = async (event) => {
  if (!isAuthorized(event)) {
    return {
      statusCode: 401,
      body: "No autorizado para ejecutar manual-clean-memory.",
    };
  }

  console.log("========================================");
  console.log("🧽 INICIANDO MANUAL-CLEAN-MEMORY");
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

    const store = createBlobStoreFromEnv({ storeName: "memory-store" });
    const result = await clearAllMemory(store);

    if (logLevel === "debug") {
      console.log("[manual-clean-memory] result:", JSON.stringify(result));
    } else {
      console.log(
        "[manual-clean-memory] result-resumen:",
        JSON.stringify({
          logLevel,
          telegramBacklog: result.telegramBacklog,
          androidQueue: result.androidQueue,
          pcQueue: result.pcQueue,
        })
      );
    }

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        success: true,
        action: "manual-clean-memory",
        result,
      }),
    };
  } catch (error) {
    console.error("❌ ERROR EN MANUAL-CLEAN-MEMORY:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: String(error) }),
    };
  }
};
