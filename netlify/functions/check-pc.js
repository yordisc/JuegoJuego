//netlify/functions/check-pc.js

if (process.env.NODE_ENV !== "production") require("dotenv").config();
const { getStore } = require("@netlify/blobs");
const {
  getPublishedGamesList,
  savePublishedGamesList,
} = require("../../utils/memory");
const { checkPCGames } = require("../../services/pc-games");

exports.handler = async (event, context) => {
  console.log("========================================");
  console.log("🚀 INICIANDO CHECK-PC (DEBUG MODE)");
  console.log("========================================");

  try {
    // --- PASO 1: VERIFICACIÓN DE ENTORNO ---
    console.log("🔍 [DEBUG 1/4] Verificando Variables de Entorno:");
    const siteId = process.env.NETLIFY_SITE_ID;
    const apiToken = process.env.NETLIFY_API_TOKEN;

    console.log(
      `   - NETLIFY_SITE_ID: ${siteId
        ? "✅ Presente (" + siteId.substring(0, 5) + "...)"
        : "❌ NO DEFINIDO"
      }`
    );
    console.log(
      `   - NETLIFY_API_TOKEN: ${apiToken ? "✅ Presente (Oculto por seguridad)" : "❌ NO DEFINIDO"
      }`
    );
    console.log(
      `   - TELEGRAM_TOKEN: ${process.env.TELEGRAM_TOKEN ? "✅ Presente" : "❌ NO DEFINIDO"
      }`
    );
    console.log(
      `   - CHANNEL_ID: ${process.env.CHANNEL_ID
        ? "✅ Presente (" + process.env.CHANNEL_ID + ")"
        : "❌ NO DEFINIDO"
      }`
    );

    const blobOptions = { name: "memory-store" };
    if (siteId && apiToken) {
      blobOptions.siteID = siteId;
      blobOptions.token = apiToken;
    }

    // --- PASO 2: CONEXIÓN A BASE DE DATOS ---
    console.log("🔌 [DEBUG 2/4] Conectando a Netlify Blobs...");
    const store = getStore(blobOptions);
    // 🟢 AÑADE "pc" AQUÍ
    const publishedGames = await getPublishedGamesList(store, "pc");
    console.log(`   - Elementos en memoria actual: ${publishedGames.length}`);

    // --- PASO 3: LÓGICA DE NEGOCIO ---
    console.log("📡 [DEBUG 3/4] Procesando pc_queue y pc_expired...");
    await checkPCGames(store, publishedGames);
    console.log("   - Colas PC procesadas.");

    // --- PASO 4: GUARDADO DE ESTADO ---
    console.log("💾 [DEBUG 4/4] Guardando nueva memoria en Blobs...");
    await savePublishedGamesList(store, publishedGames, "pc");
    console.log("   - Memoria actualizada exitosamente.");

    console.log("✅ EJECUCIÓN EXITOSA COMPLETADA");
    console.log("========================================");
    return { statusCode: 200, body: "Consumo PC completado con éxito." };
  } catch (error) {
    console.error("❌ ERROR CRÍTICO EN PC:");
    console.error(error);
    return { statusCode: 500, body: error.toString() };
  }
};
