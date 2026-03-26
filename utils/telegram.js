// utils/telegram.js
// Módulo responsable de la comunicación con Telegram.

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

async function sendToTelegram(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: CHANNEL_ID,
            text: message,
            parse_mode: 'Markdown'
        })
    });
}

// Exportamos la función para poder usarla en otros archivos
module.exports = { sendToTelegram };