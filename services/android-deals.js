// services/android-deals.js

const gplay = require('google-play-scraper');

const TITLE_KEYWORDS = [
  "free",
  "gratis",
  "deal",
  "sale",
  "discount",
  "humble",
  "bundle",
  "100%",
  "off",
  "limited",
];

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

    // Construimos un mensaje atractivo
    const mensaje =
      `📱 **NEW ANDROID DEAL** 📱\n\n` +
      `🎮 *${app.title}*\n` +
      `🏷️ Price: ${
        app.free || app.priceText.toLowerCase() === "free"
          ? "FREE!"
          : app.priceText
      }\n` +
      `⭐ Rating: ${app.score ? app.score.toFixed(1) : "N/A"}\n\n` +
      `👉 [Get it on Google Play](${app.url})`;

    try {
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.CHANNEL_ID,
            text: mensaje,
            parse_mode: "Markdown",
            disable_web_page_preview: false,
          }),
        }
      );

      if (telegramResponse.ok) {
        console.log(
          `   [DEBUG] ✅ Publicado con éxito en Telegram (ID: ${app.appId})`
        );
        // Lo guardamos en memoria para no volver a enviarlo en el futuro
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
