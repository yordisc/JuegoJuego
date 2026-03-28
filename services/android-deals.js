// services/android-deals.js

const TITLE_KEYWORDS = [
  "deal", "sale", "discount", "humble", "bundle", "100%", "off", "limited", 
  "pro", "premium", "vip" // Los juegos de pago que se vuelven gratis suelen tener estas etiquetas
];

// Añade una lista negra para evitar Falsos Positivos gigantes
const BLACKLIST = ["free fire", "roblox", "pubg", "candy crush", "clash"];

function matchesTitle(title) {
  const lower = (title || "").toLowerCase();
  
  // Si el juego está en la lista negra, lo ignoramos de inmediato
  if (BLACKLIST.some(black => lower.includes(black))) {
      return false;
  }

  return TITLE_KEYWORDS.some((kw) => lower.includes(kw));
}

const SEARCH_TERMS = [
  "free games limited time",
  "juegos gratis android",
  "android game sale",
  "paid game free",
];

function matchesTitle(title) {
  const lower = (title || "").toLowerCase();
  return TITLE_KEYWORDS.some((kw) => lower.includes(kw));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Le añadimos "publishedGames = []" para que la memoria funcione,
// y le damos un valor por defecto vacío para que tus Tests no se rompan.
async function checkAndroidDeals(publishedGames = []) {
  console.log("[google-play-scraper] 🔍 Iniciando búsqueda de ofertas...");

  // 1. INYECCIÓN DE DEPENDENCIAS (MAGIA PARA PRUEBAS Y PRODUCCIÓN)
  let gplay;
  if (global.__mockGplaySearch) {
    // Si estamos corriendo un test, usamos el simulador inyectado
    gplay = { search: global.__mockGplaySearch };
  } else {
    // Si estamos en Netlify/Producción, usamos el import dinámico real
    const modulo = await import("google-play-scraper");
    gplay = modulo.default || modulo;
  }

  const allResults = [];
  const seenAppIds = new Set();

  // --- 1. FASE DE BÚSQUEDA Y RECOLECCIÓN ---
  for (const term of SEARCH_TERMS) {
    try {
      console.log(`[google-play-scraper] 🔎 Buscando: "${term}"`);

      const results = await gplay.search({
        term,
        num: 30,
        lang: "es",
        country: "us",
        throttle: 10,
      });

      for (const app of results) {
        if (seenAppIds.has(app.appId)) continue;
        seenAppIds.add(app.appId);

        if (app.free || matchesTitle(app.title)) {
          allResults.push({
            title: app.title,
            appId: app.appId,
            url: app.url,
            icon: app.icon,
            developer: app.developer,
            score: app.score,
            free: app.free,
            priceText: app.priceText || "Free",
            genre: app.genre,
            summary: app.summary,
          });
        }
      }
      await sleep(1500);
    } catch (err) {
      console.warn(
        `[google-play-scraper] ⚠️ Falló búsqueda "${term}": ${err.message}`
      );
    }
  }

  console.log(
    `[google-play-scraper] ✅ Total ofertas encontradas: ${allResults.length}`
  );

  // --- 2. FASE DE ENVÍO A TELEGRAM Y GUARDADO EN MEMORIA ---
  for (const app of allResults) {
    // Si el juego ya está en la base de datos de Netlify Blobs, lo ignoramos
    if (publishedGames.includes(app.appId)) {
      continue;
    }

    console.log(
      `  → 🚀 Preparando para Telegram: [${app.priceText}] ${app.title}`
    );

// Construimos el texto (ahora será el "pie de foto" o caption)
    const mensaje =
      `📱 **NEW ANDROID DEAL** 📱\n\n` +
      `🎮 *${app.title}*\n` +
      `🏷️ Price: ${
        app.free || app.priceText.toLowerCase() === "free"
          ? "FREE!"
          : app.priceText
      }\n` +
      `⭐ Rating: ${app.score ? app.score.toFixed(1) : "N/A"}\n\n` +
      `👉 [Get it on Google Play](https://play.google.com/store/apps/details?id=${app.appId})`;

    try {
      // 🚨 Usamos /sendPhoto en lugar de /sendMessage
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendPhoto`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.CHANNEL_ID,
            photo: app.icon,       // Aquí le pasamos la URL de la imagen del juego
            caption: mensaje,      // El texto ahora va como pie de foto
            parse_mode: "Markdown"
          }),
        }
      );

      if (telegramResponse.ok) {
        console.log(
          `   [DEBUG] ✅ Publicado con éxito en Telegram con FOTO (ID: ${app.appId})`
        );
        publishedGames.push(app.appId);
      } else {
        console.error(
          `   [DEBUG] ❌ Error de Telegram:`,
          await telegramResponse.text()
        );
      }
    } catch (err) {
      console.error(
        `   [DEBUG] ❌ Error de red al enviar a Telegram:`,
        err.message
      );
    }

  // --- INICIO DE LIMPIEZA DE MEMORIA ---
  // Mantenemos un máximo de 300 IDs en el historial
  const LIMITE_MEMORIA = 300;
  if (publishedGames.length > LIMITE_MEMORIA) {
    const memoriaRecortada = publishedGames.slice(-LIMITE_MEMORIA);
    publishedGames.length = 0;
    publishedGames.push(...memoriaRecortada);
    console.log(
      `   [DEBUG] 🧹 Memoria Android recortada. Manteniendo solo los últimos ${LIMITE_MEMORIA} registros.`
    );
  }
  // --- FIN DE LIMPIEZA DE MEMORIA ---

  return allResults;
}

module.exports = { checkAndroidDeals };
