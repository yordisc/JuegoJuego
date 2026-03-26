// 1. Configuración Inicial
// Cargamos las variables del archivo .env para proteger las credenciales
require("dotenv").config();

const CONFIG = {
  TOKEN: process.env.TELEGRAM_TOKEN,
  CHAT_ID: process.env.CHANNEL_ID,
  GAMERPOWER_URL: "https://www.gamerpower.com/api/giveaways",
};

// --- MÓDULOS DE LÓGICA ---

// Módulo A: Extraer Datos
async function fetchFreeGames() {
  console.log("📡 Consultando API de GamerPower...");
  // Usamos el fetch nativo de Node.js
  const response = await fetch(CONFIG.GAMERPOWER_URL);

  // Manejo de errores de red (Ej. si la API se cae)
  if (!response.ok) {
    throw new Error(`Error HTTP al consultar GamerPower: ${response.status}`);
  }

  return await response.json();
}

// Módulo B: Formatear el Mensaje
// Separamos el texto de la lógica. Textos públicos en INGLÉS.
function buildTelegramMessage(game) {
  return (
    `🎮 *Free PC Game!*\n\n` +
    `⭐ *Title:* ${game.title}\n` +
    `💻 *Platform:* ${game.platforms}\n` +
    `💰 *Original Price:* ${game.worth}\n` +
    `🔗 [Get it here](${game.open_giveaway_url})`
  );
}

// Módulo C: Enviar a Telegram
async function sendToTelegram(message) {
  console.log("🚀 Transmitiendo al canal de Telegram...");
  const url = `https://api.telegram.org/bot${CONFIG.TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CONFIG.CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    }),
  });

  const result = await response.json();

  // Verificamos si Telegram rechazó el mensaje
  if (!result.ok) {
    throw new Error(`Error de Telegram: ${result.description}`);
  }

  console.log("✅ Mensaje publicado con éxito en el canal.");
}

// --- ORQUESTADOR PRINCIPAL ---

async function runLocalTest() {
  try {
    // 0. Validación de seguridad
    if (!CONFIG.TOKEN || !CONFIG.CHAT_ID) {
      throw new Error(
        "Faltan las credenciales en el archivo .env. Verifica que TELEGRAM_TOKEN y CHANNEL_ID existan."
      );
    }

    // 1. Obtener
    const games = await fetchFreeGames();

    if (games.length === 0) {
      console.log("No se encontraron juegos gratis activos en este momento.");
      return;
    }

    // 2. Procesar (Tomamos el primero de la lista para la prueba)
    const topGame = games[0];
    const message = buildTelegramMessage(topGame);

    // 3. Ejecutar
    await sendToTelegram(message);
  } catch (error) {
    // Atrapamos cualquier error para que el script no colapse de forma abrupta
    console.error("\n❌ ERROR CRÍTICO EN LA EJECUCIÓN:");
    console.error(error.message);
  }
}

// Iniciar el script
runLocalTest();
