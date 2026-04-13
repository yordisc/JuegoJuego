// netlify/functions/check-android.js

if (process.env.NODE_ENV !== "production") require("dotenv").config();
const {
  getPublishedGamesList,
  savePublishedGamesList,
} = require("../../utils/memory");
const { checkAndroidDeals } = require("../../services/android-deals");
const {
  createBlobStoreFromEnv,
  getBlobCredentialReport,
} = require("../../utils/netlify-blobs");
const { withBlobLock } = require("../../utils/blob-lock");

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isDebugLogsEnabled(env = process.env) {
  const fallback = env.NODE_ENV === "production" ? "compact" : "debug";
  const raw = String(env.FUNCTION_LOG_LEVEL || fallback).trim().toLowerCase();
  return raw === "debug";
}

exports.handler = async (event, context) => {
  const debug = isDebugLogsEnabled();
  console.log("========================================");
  console.log(`🚀 INICIANDO CHECK-ANDROID (${debug ? "DEBUG" : "COMPACT"} MODE)`);
  console.log("========================================");

  try {
    // --- PASO 1: VERIFICACIÓN DE ENTORNO ---
    if (debug) {
      console.log("🔍 [DEBUG 1/4] Verificando Variables de Entorno:");
    }
    const report = getBlobCredentialReport(process.env);
    const siteId = report.siteID;
    const apiToken = report.token;

    if (debug) {
      console.log(
        `   - NETLIFY_SITE_ID: ${
          siteId
            ? "✅ Presente (" + siteId.substring(0, 5) + "...)"
            : "❌ NO DEFINIDO"
        }`
      );
      console.log(
        `   - NETLIFY_API_TOKEN: ${
          apiToken ? "✅ Presente (Oculto por seguridad)" : "❌ NO DEFINIDO"
        }`
      );
      console.log(
        `   - TELEGRAM_TOKEN: ${
          process.env.TELEGRAM_TOKEN ? "✅ Presente" : "❌ NO DEFINIDO"
        }`
      );
      console.log(
        `   - CHANNEL_ID: ${
          process.env.CHANNEL_ID
            ? "✅ Presente (" + process.env.CHANNEL_ID + ")"
            : "❌ NO DEFINIDO"
        }`
      );
    }

    if (report.issues.length > 0) {
      console.error("   - Credenciales Blobs invalidas:");
      for (const issue of report.issues) {
        console.error(`     * ${issue}`);
      }
    }

    // --- PASO 2: CONEXIÓN A BASE DE DATOS ---
    if (debug) {
      console.log("🔌 [DEBUG 2/4] Conectando a Netlify Blobs...");
    }
    const store = createBlobStoreFromEnv({ storeName: "memory-store" });
    await withBlobLock(
      store,
      {
        lockKey: process.env.ANDROID_STATE_LOCK_KEY || "android_state_lock",
        owner: "consumer-android",
        ttlMs: parsePositiveInt(process.env.ANDROID_STATE_LOCK_TTL_MS, 5 * 1000),
        retries: parsePositiveInt(process.env.ANDROID_STATE_LOCK_RETRIES, 5),
        retryDelayMs: parsePositiveInt(
          process.env.ANDROID_STATE_LOCK_RETRY_DELAY_MS,
          500
        ),
      },
      async () => {
        const publishedGames = await getPublishedGamesList(store);
        if (debug) {
          console.log(`   - Elementos en memoria actual: ${publishedGames.length}`);
        }

        // --- PASO 3: LÓGICA DE NEGOCIO ---
        if (debug) {
          console.log("📡 [DEBUG 3/4] Procesando solo android_queue...");
        }
        await checkAndroidDeals(store, publishedGames, {
          processQueue: true,
          processExpired: false,
        });
        if (debug) {
          console.log("   - Cola Android procesada (publicaciones).");
        }

        // --- PASO 4: GUARDADO DE ESTADO ---
        if (debug) {
          console.log("💾 [DEBUG 4/4] Guardando nueva memoria en Blobs...");
        }
        await savePublishedGamesList(store, publishedGames, "android");
        if (debug) {
          console.log("   - Memoria actualizada exitosamente.");
        }
      }
    );

    console.log("✅ EJECUCIÓN EXITOSA COMPLETADA");
    console.log("========================================");
    return { statusCode: 200, body: "Consumo Android completado con éxito." };
  } catch (error) {
    console.error("❌ ERROR CRÍTICO EN ANDROID:");
    console.error(error);
    const errorText = String(error && error.message ? error.message : error);
    if (errorText.includes("401")) {
      console.error(
        "[HINT] 401 en Blobs: valida NETLIFY_SITE_ID/NETLIFY_API_TOKEN, quita espacios/comillas y usa un PAT de Netlify del mismo site."
      );
    } else if (errorText.includes("403")) {
      console.error(
        "[HINT] 403 en Blobs: el token es valido, pero sin permisos suficientes para este site."
      );
    }
    return { statusCode: 500, body: error.toString() };
  }
};
