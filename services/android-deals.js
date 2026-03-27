// services/android-deals.js

const SUBREDDIT = 'androidgaming';
const RSS_URL = `https://www.reddit.com/r/${SUBREDDIT}/new/.rss`;
const JSON_URL = `https://www.reddit.com/r/${SUBREDDIT}/new.json?limit=25`;

// Palabras clave para el título
const TITLE_KEYWORDS = ['free', 'gratis', 'deal', 'sale', 'discount', 'humble', 'bundle', '100%', 'off'];

// Palabras clave para el flair/bandera del post
const FLAIR_KEYWORDS = ['popular', 'free', 'deal', 'sale'];

function matchesTitleOrFlair(post) {
  const title = (post.title || '').toLowerCase();
  const flair = (post.link_flair_text || post.flair || '').toLowerCase();

  const titleMatch = TITLE_KEYWORDS.some(kw => title.includes(kw));
  const flairMatch = FLAIR_KEYWORDS.some(kw => flair.includes(kw));

  return titleMatch || flairMatch;
}

async function fetchFromRedditJSON() {
  const response = await fetch(JSON_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    }
  });

  if (!response.ok) {
    throw new Error(`Reddit bloqueó la petición temporalmente. Código HTTP: ${response.status}`);
  }

  const data = await response.json();
  // Preservamos link_flair_text que viene directo del JSON de Reddit
  return data.data.children.map(post => post.data);
}

async function fetchFromRedditRSS() {
  console.log('[FALLBACK] Usando RSS de Reddit...');
  const response = await fetch(RSS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GratisJuegoBot/1.0)',
      'Accept': 'application/rss+xml, application/xml, text/xml',
    }
  });

  if (!response.ok) {
    throw new Error(`RSS también falló. Código HTTP: ${response.status}`);
  }

  const text = await response.text();
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(text)) !== null) {
    const item = match[1];
    const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/))?.[1] || '';
    const link = (item.match(/<link>(.*?)<\/link>/) || [])[1] || '';
    const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';

    // El RSS de Reddit incluye el flair dentro del contenido HTML del <description>
    const description = (item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || [])[1] || '';
    const flairMatch = description.match(/\[([^\]]+)\]/); // e.g. [Popular] o [Deal]
    const flair = flairMatch ? flairMatch[1] : '';

    items.push({
      title,
      url: link,
      created_utc: new Date(pubDate).getTime() / 1000,
      link_flair_text: flair,
    });
  }

  return items;
}

async function checkAndroidDeals() {
  let posts = [];
  let source = 'json';

  try {
    // Opción 2: JSON con headers de navegador
    posts = await fetchFromRedditJSON();
    console.log(`[JSON] ✅ Obtenidos ${posts.length} posts de Reddit`);
  } catch (err) {
    console.warn(`[JSON] ⚠️ Falló: ${err.message}`);
    try {
      // Opción 3: RSS como fallback
      posts = await fetchFromRedditRSS();
      source = 'rss';
      console.log(`[RSS] ✅ Obtenidos ${posts.length} posts via RSS`);
    } catch (rssErr) {
      throw new Error(`Ambos métodos fallaron. JSON: ${err.message} | RSS: ${rssErr.message}`);
    }
  }

  // Filtrar por título O por flair/bandera
  const filtered = posts.filter(matchesTitleOrFlair);

  console.log(`[${source.toUpperCase()}] 🎯 Posts relevantes encontrados: ${filtered.length}`);

  // Log de flairs detectados para debug
  filtered.forEach(p => {
    const flair = p.link_flair_text ? ` [Flair: ${p.link_flair_text}]` : '';
    console.log(`  → ${p.title}${flair}`);
  });

  return filtered;
}

module.exports = { checkAndroidDeals };