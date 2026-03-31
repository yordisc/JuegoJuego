if (process.env.NODE_ENV !== "production") require("dotenv").config();

const {
  createBlobStoreFromEnv,
  getBlobCredentialReport,
} = require("../../utils/netlify-blobs");
const {
  cleanTelegramOrphanMessages,
} = require("../../services/manual-maintenance");

exports.handler = async () => {
  console.log("========================================");
  console.log("🧽 INICIANDO CLEAN-ORPHAN-TELEGRAM");
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
    const result = await cleanTelegramOrphanMessages(store);

    console.log(
      "[clean-orphan-telegram] result:",
      JSON.stringify(result)
    );

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        success: true,
        action: "clean-orphan-telegram",
        result,
      }),
    };
  } catch (error) {
    console.error("❌ ERROR EN CLEAN-ORPHAN-TELEGRAM:", error);
    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ success: false, error: String(error) }),
    };
  }
};
