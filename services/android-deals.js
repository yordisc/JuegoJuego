// services/android-deals.js

// CORRECCIÓN BUG #1:
// Se eliminó "free" y palabras genéricas sueltas de TITLE_KEYWORDS.
// Ahora los keywords son FRASES que indican genuinamente una oferta temporal,
// no palabras que aparecen en el título de cualquier app gratuita permanente.
const TITLE_KEYWORDS = [
  "deal",
  "sale",
  "discount",
  "humble",
  "bundle",
  "100% off",
  "limited time",
  "paid game free",
  "price drop",
  "normally paid",
  "gratis por tiempo",
  "oferta limitada",
  "free today",
  "free this week",
  "goes free",
  "premium",
  "vip",
];

const BLACKLIST = [
  "free fire",
  "roblox",
  "pubg",
  "candy crush",
  "clash",
  "brawl stars",
  "subway surfers",
  "among us",
];

const SEARCH_TERMS = [
  "free games limited time",
  "juegos gratis android",
  "android game sale",
  "paid game free",
];

// CORRECCIÓN BUG #1:
// La blacklist ahora se aplica SIEMPRE, y la condición de entrada es
// SOLO matchesTitle(). Se eliminó "app.free" como condición de entrada
// porque app.free=true en google-play-scraper significa que la app es
// gratuita en este momento, NO que está "de oferta". Eso incluye
// todos los juegos freemium permanentes (Free Fire, Subway Surfers, etc.)
// que antes llenaban la memoria y causaban las repeticiones.
function matchesTitle(title) {
  const lower = (title || "").toLowerCase();

  // La blacklist se evalúa primero, siempre, sin excepción
  if (BLACKLIST.some((black) => lower.includes(black))) {
    return false;
  }

  return TITLE_KEYWORDS.some((kw) => lower.includes(kw));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkAndroidDeals(publishedGames = []) {
  console.log("[google-play-scraper] 🔍 Iniciando búsqueda de ofertas...");

  // INYECCIÓN DE DEPENDENCIAS (para pruebas y producción)
  let gplay;
  if (global.__mockGplaySearch) {
    gplay = { search: global.__mockGplaySearch };
  } else {
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

        // CORRECCIÓN BUG #1 aplicada aquí:
        // Solo se usa matchesTitle(), que siempre verifica la blacklist primero.
        // Se eliminó "app.free ||" que era la causa raíz del spam.
        if (matchesTitle(app.title)) {
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
    `[google-play-scraper] ✅ Total ofertas candidatas: ${allResults.length}`
  );

  // --- 2. FASE DE ENVÍO A TELEGRAM Y GUARDADO EN MEMORIA ---
  for (const app of allResults) {
    if (publishedGames.includes(app.appId)) {
      console.log(`  → ⏭️  Saltando (ya publicado): ${app.title}`);
      continue;
    }

    console.log(
      `  → 🚀 Preparando para Telegram: [${app.priceText}] ${app.title}`
    );

    const mensaje =
      `📱 **NEW ANDROID DEAL** 📱\n\n` +
      `🎮 *${app.title}*\n` +
      `🏷️ Price: ${app.free || app.priceText.toLowerCase() === "free"
        ? "FREE!"
        : app.priceText
      }\n` +
      `⭐ Rating: ${app.score ? app.score.toFixed(1) : "N/A"}\n\n` +
      `👉 [Get it on Google Play](https://play.google.com/store/apps/details?id=${app.appId})`;

    try {
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendPhoto`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.CHANNEL_ID,
            photo: app.icon,
            caption: mensaje,
            parse_mode: "Markdown",
          }),
        }
      );

      if (telegramResponse.ok) {
        console.log(
          `   [DEBUG] ✅ Publicado en Telegram (ID: ${app.appId})`
        );
        // Solo se guarda en memoria DESPUÉS de confirmar publicación exitosa
        publishedGames.push(app.appId);
      } else {
        console.error(
          `   [DEBUG] ❌ Error de Telegram:`,
          await telegramResponse.text()
        );
        // No se guarda en memoria si Telegram falló, para reintentar la próxima vez
      }
    } catch (err) {
      console.error(
        `   [DEBUG] ❌ Error de red al enviar a Telegram:`,
        err.message
      );
      // Tampoco se guarda si hubo error de red
    }
  }

  // --- LIMPIEZA DE MEMORIA (FIFO) ---
  // CORRECCIÓN BUG #2:
  // Se redujo el límite de 300 a 150. Con el BUG #1 resuelto, ahora solo
  // entran apps que realmente son ofertas. Esas ofertas duran días/semanas,
  // por lo que 150 slots son más que suficientes y la cola tarda mucho más
  // en rotar, evitando que IDs válidos sean eliminados prematuramente.
  // Si en el futuro el volumen sube, se puede subir gradualmente este número.
  const LIMITE_MEMORIA = 150;
  if (publishedGames.length > LIMITE_MEMORIA) {
    const memoriaRecortada = publishedGames.slice(-LIMITE_MEMORIA);
    publishedGames.length = 0;
    publishedGames.push(...memoriaRecortada);
    console.log(
      `   [DEBUG] 🧹 Memoria Android recortada a ${LIMITE_MEMORIA} registros.`
    );
  }

  return allResults;
}

module.exports = { checkAndroidDeals };