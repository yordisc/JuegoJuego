// netlify/functions/clean-duplicates.js

if (process.env.NODE_ENV !== "production") require("dotenv").config();
const {
  getPublishedGamesList,
  savePublishedGamesList,
} = require("../../utils/memory");
const { cleanDuplicates } = require("../../services/clean-duplicates");
const {
  readTrackedMessages,
  saveTrackedMessages,
} = require("../../services/manual-maintenance");
const {
  createBlobStoreFromEnv,
  getBlobCredentialReport,
} = require("../../utils/netlify-blobs");

function isValidMessageId(value) {
  return Number.isInteger(value) && value > 0;
}

function normalizeTrackedEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id =
    entry.id == null
      ? ""
      : typeof entry.id === "string"
        ? entry.id.trim()
        : String(entry.id).trim();
  const messageId =
    Number.isInteger(entry.messageId) ||
    (typeof entry.messageId === "string" && /^\d+$/.test(entry.messageId))
      ? Number(entry.messageId)
      : null;
  const platformRaw =
    typeof entry.platform === "string" ? entry.platform.trim().toLowerCase() : "";
  const platform = platformRaw === "pc" ? "pc" : platformRaw === "android" ? "android" : null;
  const publishedAt = Number.isInteger(entry.publishedAt) ? entry.publishedAt : Date.now();

  if (!id || !isValidMessageId(messageId)) {
    return null;
  }

  return { id, messageId, platform, publishedAt };
}

function dedupeTrackedByMessageId(tracked = []) {
  const seen = new Set();
  const result = [];

  for (const item of tracked) {
    if (!item || typeof item !== "object") {
      continue;
    }

    if (!isValidMessageId(item.messageId) || seen.has(item.messageId)) {
      continue;
    }

    seen.add(item.messageId);
    result.push(item);
  }

  return result;
}

function buildPublishedStateFromTracked(tracked = [], platform) {
  const filtered = tracked.filter(
    (item) => item && item.platform === platform && item.id && isValidMessageId(item.messageId)
  );

  const bestByGameId = new Map();
  for (const item of filtered) {
    const prev = bestByGameId.get(item.id);
    if (!prev || item.publishedAt >= prev.publishedAt) {
      bestByGameId.set(item.id, {
        id: item.id,
        messageId: item.messageId,
        publishedAt: item.publishedAt,
      });
    }
  }

  return Array.from(bestByGameId.values()).sort((a, b) => a.publishedAt - b.publishedAt);
}

exports.handler = async (event, context) => {
  console.log("========================================");
  console.log("🧹 INICIANDO CLEAN-DUPLICATES (DEBUG MODE)");
  console.log("========================================");

  try {
    // --- PASO 1: VERIFICACIÓN DE ENTORNO ---
    console.log("🔍 [DEBUG 1/5] Verificando Variables de Entorno:");
    const report = getBlobCredentialReport(process.env);
    const siteId = report.siteID;
    const apiToken = report.token;

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

    if (report.issues.length > 0) {
      console.error("   - Credenciales Blobs invalidas:");
      for (const issue of report.issues) {
        console.error(`     * ${issue}`);
      }
    }

    // --- PASO 2: CONEXIÓN A BASE DE DATOS ---
    console.log("🔌 [DEBUG 2/5] Conectando a Netlify Blobs...");
    const store = createBlobStoreFromEnv({ storeName: "memory-store" });

    // --- PASO 3: CARGAR JUEGOS PUBLICADOS ---
    console.log("📖 [DEBUG 3/5] Cargando mensajes publicados...");
    const androidGames = await getPublishedGamesList(store, "android");
    const pcGames = await getPublishedGamesList(store, "pc");
    const trackedMessages = await readTrackedMessages(store);

    const trackedAndroid = trackedMessages
      .map((entry) => normalizeTrackedEntry(entry))
      .filter((entry) => entry && entry.platform === "android");
    const trackedPc = trackedMessages
      .map((entry) => normalizeTrackedEntry(entry))
      .filter((entry) => entry && entry.platform === "pc");

    console.log(`   - Android: ${androidGames.length} mensajes en memoria`);
    console.log(`   - PC: ${pcGames.length} mensajes en memoria`);
    console.log(
      `   - Tracked Android: ${trackedAndroid.length} | Tracked PC: ${trackedPc.length}`
    );

    // --- PASO 4: LIMPIAR DUPLICADOS ---
    console.log("🧹 [DEBUG 4/5] Ejecutando limpieza de duplicados...");

    console.log("   📱 Limpiando Android...");
    const androidResult = await cleanDuplicates(trackedAndroid);
    console.log(`   ✅ Android: ${androidResult.messagesDeleted} mensajes eliminados`);

    console.log("   🖥️  Limpiando PC...");
    const pcResult = await cleanDuplicates(trackedPc);
    console.log(`   ✅ PC: ${pcResult.messagesDeleted} mensajes eliminados`);

    const remainingTracked = dedupeTrackedByMessageId([...trackedAndroid, ...trackedPc]);
    await saveTrackedMessages(store, remainingTracked);

    const syncedAndroidGames = buildPublishedStateFromTracked(remainingTracked, "android");
    const syncedPcGames = buildPublishedStateFromTracked(remainingTracked, "pc");

    // --- PASO 5: GUARDAR ESTADO ACTUALIZADO ---
    console.log("💾 [DEBUG 5/5] Guardando estado actualizado en Blobs...");

    await savePublishedGamesList(store, syncedAndroidGames, "android");
    console.log(`   ✅ Android: ${syncedAndroidGames.length} mensajes guardados`);

    await savePublishedGamesList(store, syncedPcGames, "pc");
    console.log(`   ✅ PC: ${syncedPcGames.length} mensajes guardados`);

    // --- MÉTRICAS FINALES ---
    const totalErrors = androidResult.errors.length + pcResult.errors.length;
    const totalDeleted = androidResult.messagesDeleted + pcResult.messagesDeleted;
    const totalDuplicatesFound =
      androidResult.duplicatesFound + pcResult.duplicatesFound;

    console.log("========================================");
    console.log("📊 [METRICS] Resumen de Limpieza:");
    console.log(`   - Duplicados encontrados: ${totalDuplicatesFound}`);
    console.log(`   - Mensajes eliminados: ${totalDeleted}`);
    console.log(`   - Errores de limpieza: ${totalErrors}`);
    console.log("========================================");

    if (totalErrors > 0) {
      console.warn(`⚠️  Se encontraron ${totalErrors} errores durante la limpieza:`);
      for (const error of [...androidResult.errors, ...pcResult.errors]) {
        console.warn(`   - [${error.gameId}] msg ${error.messageId}: ${error.reason}`);
      }
    }

    const isSuccess = totalErrors === 0;
    console.log(
      isSuccess ? "✅ EJECUCIÓN EXITOSA" : "⚠️  EJECUCIÓN CON ADVERTENCIAS"
    );

    return {
      statusCode: isSuccess ? 200 : 207,
      body: JSON.stringify({
        success: isSuccess,
        metrics: {
          duplicatesFound: totalDuplicatesFound,
          messagesDeleted: totalDeleted,
          errors: totalErrors,
        },
        details: {
          android: androidResult,
          pc: pcResult,
        },
      }),
    };
  } catch (error) {
    console.error("❌ ERROR CRÍTICO EN CLEAN-DUPLICATES:");
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

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.toString(),
      }),
    };
  }
};
