// services/pc-games.js
// Extrae y filtra ofertas de PC desde la API de GamerPower.

const { sendToTelegram } = require('../utils/telegram');

async function checkPCGames(publishedGames) {
    console.log("Buscando juegos de PC...");
    const response = await fetch('https://www.gamerpower.com/api/giveaways');
    const games = await response.json();
    
    const topGame = games[0]; 
    const gameId = topGame.open_giveaway_url; // Usamos la URL como ID

    // Si el ID no está en la memoria, lo publicamos
    if (!publishedGames.includes(gameId)) {
        // Mensaje público en inglés
        const message = `🎮 *Free PC Game!* \n\n` +
                        `⭐ *Title:* ${topGame.title}\n` +
                        `💻 *Platform:* ${topGame.platforms}\n` +
                        `🔗 [Get it here](${topGame.open_giveaway_url})`;
        
        await sendToTelegram(message);
        publishedGames.push(gameId); // Actualizamos la memoria temporal
        console.log(`Nuevo juego de PC publicado: ${topGame.title}`);
    } else {
        console.log(`El juego de PC ${topGame.title} ya había sido publicado.`);
    }
}

module.exports = { checkPCGames };