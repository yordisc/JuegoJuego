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

    return {
      statusCode: 200,
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
