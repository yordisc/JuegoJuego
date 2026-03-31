if (process.env.NODE_ENV !== "production") require("dotenv").config();

const {
  createBlobStoreFromEnv,
  getBlobCredentialReport,
} = require("../../utils/netlify-blobs");
const { getMaintenanceSnapshot } = require("../../services/manual-maintenance");

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

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        action: "manual-status",
        includeSamples,
        sampleSize,
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
