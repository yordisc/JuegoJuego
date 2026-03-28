// services/pc-games.js

async function checkPCGames(publishedGames = []) {
  console.log(
    "   [DEBUG] 💻 Iniciando búsqueda de juegos de PC en GamerPower..."
  );

  try {
    // 1. FILTRO DE PLATAFORMA EN LA URL
    // Le pedimos a la API que solo nos traiga ofertas de "pc"
    const response = await fetch(
      "https://www.gamerpower.com/api/giveaways?platform=pc"
    );

    if (!response.ok) {
      throw new Error(`GamerPower falló. Código HTTP: ${response.status}`);
    }

    const games = await response.json();
    let nuevasOfertas = 0;

    // --- INICIO DE LIMPIEZA DE MEMORIA (GARBAGE COLLECTION) ---
    // 1. Obtenemos todos los IDs que están activos en este momento
    const activeIds = games.map((game) => game.id.toString());

    // 2. Filtramos nuestra memoria: nos quedamos SOLO con los que siguen activos
    const memoriaLimpia = publishedGames.filter((id) => activeIds.includes(id));

    // 3. Vaciamos la memoria vieja y le inyectamos la limpia
    const eliminados = publishedGames.length - memoriaLimpia.length;
    publishedGames.length = 0;
    publishedGames.push(...memoriaLimpia);

    if (eliminados > 0) {
      console.log(
        `   [DEBUG] 🧹 Se eliminaron ${eliminados} juegos expirados de la memoria.`
      );
    }
    // --- FIN DE LIMPIEZA DE MEMORIA ---

    // 2. EL BUCLE REVISOR
    for (const game of games.slice(0, 10)) {
      // Es más seguro usar el ID oficial de la API que la URL
      const gameId = game.id.toString();

      // Si ya está en la memoria de Netlify Blobs, pasamos al siguiente
      if (publishedGames.includes(gameId)) {
        continue;
      }

      console.log(
        `   [DEBUG] 🎮 ¡Nuevo juego de PC encontrado!: ${game.title}`
      );

      // 3. ARMADO DEL MENSAJE
      const message =
        `🎮 **FREE PC GAME!** 🎮\n\n` +
        `⭐ *Title:* ${game.title}\n` +
        `💻 *Platform:* ${game.platforms}\n` +
        `💰 *Value:* ${game.worth}\n` +
        `📝 *Description:* ${game.description.substring(0, 100)}...\n\n` +
        `🔗 [Get it here](${game.open_giveaway_url})`;

      // 4. ENVÍO DIRECTO A TELEGRAM
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.CHANNEL_ID,
            text: message,
            parse_mode: "Markdown",
            disable_web_page_preview: false,
          }),
        }
      );

      if (telegramResponse.ok) {
        console.log(
          `   [DEBUG] ✅ Publicado con éxito en Telegram (ID: ${gameId})`
        );
        publishedGames.push(gameId); // Guardamos en memoria
        nuevasOfertas++;
      } else {
        console.error(
          `   [DEBUG] ❌ Error de Telegram:`,
          await telegramResponse.text()
        );
      }
    }

    // 5. RESUMEN
    if (nuevasOfertas === 0) {
      console.log("   [DEBUG] 💤 No hay juegos nuevos de PC en este momento.");
    } else {
      console.log(
        `   [DEBUG] 🎉 Ciclo PC terminado: Se publicaron ${nuevasOfertas} juegos.`
      );
    }
  } catch (error) {
    console.error(
      "   [DEBUG] ❌ Error de red consultando GamerPower:",
      error.message
    );
  }
}

module.exports = { checkPCGames };
