// services/android-deals.js

const TITLE_KEYWORDS = [
  'free', 'gratis', 'deal', 'sale', 'discount',
  'humble', 'bundle', '100%', 'off', 'limited'
];

const SEARCH_TERMS = [
  'free games limited time',
  'juegos gratis android',
  'android game sale',
  'paid game free',
];

function matchesTitle(title) {
  const lower = (title || '').toLowerCase();
  return TITLE_KEYWORDS.some(kw => lower.includes(kw));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkAndroidDeals() {
  // Import dinámico para compatibilidad con ES Module
  const gplay = (await import('google-play-scraper')).default;

  console.log('[google-play-scraper] 🔍 Iniciando búsqueda de ofertas...');

  const allResults = [];
  const seenAppIds = new Set();

  for (const term of SEARCH_TERMS) {
    try {
      console.log(`[google-play-scraper] 🔎 Buscando: "${term}"`);

      const results = await gplay.search({
        term,
        num: 30,
        lang: 'es',
        country: 'us',
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
            priceText: app.priceText || 'Free',
            genre: app.genre,
            summary: app.summary,
          });
        }
      }

      await sleep(1500);

    } catch (err) {
      console.warn(`[google-play-scraper] ⚠️ Falló búsqueda "${term}": ${err.message}`);
    }
  }

  console.log(`[google-play-scraper] ✅ Total ofertas encontradas: ${allResults.length}`);

  allResults.forEach(app => {
    console.log(`  → [${app.priceText}] ${app.title} (${app.appId})`);
  });

  return allResults;
}

module.exports = { checkAndroidDeals };