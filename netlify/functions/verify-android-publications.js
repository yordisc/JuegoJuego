if (process.env.NODE_ENV !== "production") require("dotenv").config();

const {
  getPublishedGamesList,
  savePublishedGamesList,
} = require("../../utils/memory");
const {
  reconcileAndroidPublications,
} = require("../../services/android-deals");
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
  console.log("✅ INICIANDO VERIFY-ANDROID-PUBLICATIONS");
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
        lockKey: process.env.ANDROID_STATE_LOCK_KEY || "android_state_lock",
        owner: "android-reconcile",
        ttlMs: parsePositiveInt(
          process.env.ANDROID_STATE_LOCK_TTL_MS,
          90 * 1000
        ),
        retries: parsePositiveInt(process.env.ANDROID_STATE_LOCK_RETRIES, 20),
        retryDelayMs: parsePositiveInt(
          process.env.ANDROID_STATE_LOCK_RETRY_DELAY_MS,
          1000
        ),
      },
      async () => {
        const publishedGames = await getPublishedGamesList(store, "android");
        const reconcileResult = await reconcileAndroidPublications(
          store,
          publishedGames
        );
        await savePublishedGamesList(store, publishedGames, "android");
        return {
          ...reconcileResult,
          androidPublished: publishedGames.length,
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
        action: "verify-android-publications",
        result,
      }),
    };
  } catch (error) {
    console.error("❌ ERROR EN VERIFY-ANDROID-PUBLICATIONS:", error);
    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ success: false, error: String(error) }),
    };
  }
};
