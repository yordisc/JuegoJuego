// services/android-deals.js
// Extrae y filtra ofertas de Android desde el Subreddit.

const { sendToTelegram } = require('../utils/telegram');

async function checkAndroidDeals(publishedGames) {
    console.log("Buscando juegos de Android...");
    const response = await fetch('https://www.reddit.com/r/googleplaydeals/new.json');
    const json = await response.json();
    const posts = json.data.children;

    if (posts.length > 0) {
        const post = posts[0].data;
        const gameId = post.url;

        // 1. Extraemos el texto de la etiqueta (flair) del post de Reddit
        const flair = post.link_flair_text || ""; 

        // 2. Reglas de negocio
        const isFree = post.title.toLowerCase().includes('free') || post.title.includes('$0.00');
        const isPopularSale = flair.toLowerCase().includes('popular');

        if ((isFree || isPopularSale) && !publishedGames.includes(gameId)) {
            // Mensaje público en inglés dependiendo de si es gratis o solo popular
            const status = isFree ? "🆓 *FREE APP!*" : `🔥 *POPULAR SALE*`;
            const message = `${status}\n\n` +
                            `📱 *App:* ${post.title}\n\n` +
                            `🔗 [Get it on Google Play](${post.url})`;
            
            await sendToTelegram(message);
            publishedGames.push(gameId);
            console.log(`Nueva app de Android publicada: ${post.title}`);
        }
    }
}

module.exports = { checkAndroidDeals };