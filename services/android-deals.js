// services/android-deals.js

const gplay = require("google-play-scraper");

// Palabras clave para filtrar por título
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

// Términos de búsqueda en Google Play
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

// Espera entre peticiones para no ser bloqueado
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkAndroidDeals() {
  console.log("[google-play-scraper] 🔍 Iniciando búsqueda de ofertas...");

  const allResults = [];
  const seenAppIds = new Set();

  for (const term of SEARCH_TERMS) {
    try {
      console.log(`[google-play-scraper] 🔎 Buscando: "${term}"`);

      const results = await gplay.search({
        term,
        num: 30,
        lang: "es",
        country: "us",
        throttle: 10, // max 10 peticiones por segundo
      });

      for (const app of results) {
        // Evitar duplicados
        if (seenAppIds.has(app.appId)) continue;
        seenAppIds.add(app.appId);

        // Solo incluir apps gratuitas o que el título sugiera oferta
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

      // Pausa entre búsquedas para evitar bloqueos
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

  // Log de resultados para debug
  allResults.forEach((app) => {
    console.log(`  → [${app.priceText}] ${app.title} (${app.appId})`);
  });

  return allResults;
}

module.exports = { checkAndroidDeals };
