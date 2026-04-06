if (process.env.NODE_ENV !== "production") require("dotenv").config();

const {
  getPublishedGamesList,
  savePublishedGamesList,
} = require("../../utils/memory");
const { reconcilePCPublications } = require("../../services/pc-games");
const {
  createBlobStoreFromEnv,
  getBlobCredentialReport,
} = require("../../utils/netlify-blobs");
const { withBlobLock } = require("../../utils/blob-lock");

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

exports.handler = async () => {
  console.log("========================================");
  console.log("✅ INICIANDO VERIFY-PC-PUBLICATIONS");
  console.log("========================================");

  try {
    const report = getBlobCredentialReport(process.env);
    if (report.issues.length > 0) {
      console.error("Credenciales Blobs invalidas:");
      for (const issue of report.issues) {
        console.error(` - ${issue}`);
      }
    }

    const store = createBlobStoreFromEnv({ storeName: "memory-store" });
    const result = await withBlobLock(
      store,
      {
        lockKey: process.env.PC_STATE_LOCK_KEY || "pc_state_lock",
        owner: "pc-reconcile",
        ttlMs: parsePositiveInt(process.env.PC_STATE_LOCK_TTL_MS, 90 * 1000),
        retries: parsePositiveInt(process.env.PC_STATE_LOCK_RETRIES, 20),
        retryDelayMs: parsePositiveInt(
          process.env.PC_STATE_LOCK_RETRY_DELAY_MS,
          1000
        ),
      },
      async () => {
        const publishedGames = await getPublishedGamesList(store, "pc");
        const reconcileResult = await reconcilePCPublications(store, publishedGames);
        await savePublishedGamesList(store, publishedGames, "pc");
        return {
          ...reconcileResult,
          pcPublished: publishedGames.length,
        };
      }
    );

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        success: true,
        action: "verify-pc-publications",
        result,
      }),
    };
  } catch (error) {
    console.error("❌ ERROR EN VERIFY-PC-PUBLICATIONS:", error);
    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ success: false, error: String(error) }),
    };
  }
};
