// services/clean-duplicates.js

const { requestWithRetry } = require("../utils/telegram");

/**
 * Agrupa mensajes por ID de juego y retorna un mapa
 * donde cada clave es un ID de juego y el valor es un array de mensajes
 */
function groupMessagesByGameId(publishedGames = []) {
  const grouped = {};

  for (const game of publishedGames) {
    if (!game || typeof game !== "object" || !game.id) {
      continue;
    }

    const id = String(game.id);
    if (!grouped[id]) {
      grouped[id] = [];
    }

    grouped[id].push(game);
  }

  return grouped;
}

/**
 * Encuentra duplicados: juegos que aparecen más de una vez
 * Retorna un array de arrays, donde cada sub-array contiene los duplicados de un juego
 */
function findDuplicates(grouped = {}) {
  const duplicates = [];

  for (const gameId in grouped) {
    const games = grouped[gameId];
    if (games.length > 1) {
      duplicates.push(games);
    }
  }

  return duplicates;
}

/**
 * Ordena un array de mensajes por antiguedad (más antiguo primero)
 */
function sortByAge(messages = []) {
  return [...messages].sort((a, b) => {
    // Si ambos tienen publishedAt, usar eso
    if (
      Number.isInteger(a.publishedAt) &&
      Number.isInteger(b.publishedAt)
    ) {
      return a.publishedAt - b.publishedAt;
    }

    // Si solo uno tiene publishedAt, asume que es el más simple comparar
    if (Number.isInteger(a.publishedAt)) {
      return -1; // a es más antiguo
    }

    if (Number.isInteger(b.publishedAt)) {
      return 1; // b es más antiguo
    }

    // Si ninguno tiene publishedAt, mantener orden original
    return 0;
  });
}

/**
 * Obtiene los IDs de mensajes a eliminar de un array de duplicados ordenado
 */
function getMessagesToDelete(sortedDuplicates = []) {
  if (sortedDuplicates.length <= 1) {
    return [];
  }

  // Eliminar todos excepto el último (más reciente)
  return sortedDuplicates.slice(0, -1).map((msg) => msg.messageId).filter((id) => id != null);
}

/**
 * Elimina un mensaje de Telegram
 */
async function deleteMessageFromTelegram(messageId) {
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return { ok: false, reason: "messageId inválido" };
  }

  const telegramBase = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

  try {
    const response = await requestWithRetry(`${telegramBase}/deleteMessage`, {
      chat_id: process.env.CHANNEL_ID,
      message_id: messageId,
    });

    let responseText = "";
    if (!response.ok) {
      responseText = await response.text().catch(() => "");
    }

    const notFound =
      response.status === 400 && /message to delete not found/i.test(responseText);

    return {
      ok: response.ok || notFound,
      status: response.status,
      reason: response.ok
        ? "eliminado"
        : notFound
          ? "ya no existia"
          : `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `Error de red: ${err.message}`,
    };
  }
}

/**
 * Limpia duplicados de una lista de mensajes publicados
 * Retorna un objeto con el resultado de la operación
 */
async function cleanDuplicates(publishedGames = []) {
  console.log("[clean-duplicates] Iniciando limpieza de duplicados...");
  console.log(`[clean-duplicates] Total de juegos únicos: ${publishedGames.length}`);

  const grouped = groupMessagesByGameId(publishedGames);
  const duplicates = findDuplicates(grouped);

  if (duplicates.length === 0) {
    console.log("[clean-duplicates] ✅ No se encontraron duplicados.");
    return {
      success: true,
      duplicatesFound: 0,
      messagesDeleted: 0,
      errors: [],
    };
  }

  console.log(`[clean-duplicates] ⚠️ Se encontraron ${duplicates.length} juegos duplicados.`);

  const errors = [];
  let totalDeleted = 0;
  const removedMessageIds = new Set();

  for (let i = 0; i < duplicates.length; i += 1) {
    const groupedMessages = duplicates[i];
    const gameId = groupedMessages[0].id;

    // Ordenar por antigüedad (más antiguo primero)
    const sorted = sortByAge(groupedMessages);
    const toDelete = getMessagesToDelete(sorted);

    console.log(
      `[clean-duplicates] Juego "${gameId}": ${sorted.length} copias encontradas, ` +
      `eliminando ${toDelete.length} (mantener la más reciente pub: ${sorted[sorted.length - 1].publishedAt || "sin ts"})`
    );

    for (const messageId of toDelete) {
      try {
        const result = await deleteMessageFromTelegram(messageId);

        if (result.ok) {
          console.log(`[clean-duplicates]   ✅ Mensaje ${messageId} eliminado`);
          totalDeleted += 1;
          if (Number.isInteger(messageId)) {
            removedMessageIds.add(messageId);
          }
        } else {
          const errorMsg = `[clean-duplicates]   ❌ Error eliminando ${messageId}: ${result.reason}`;
          console.error(errorMsg);
          errors.push({
            messageId,
            gameId,
            reason: result.reason,
          });
        }
      } catch (err) {
        const errorMsg = `[clean-duplicates]   ❌ Excepción eliminando ${messageId}: ${err.message}`;
        console.error(errorMsg);
        errors.push({
          messageId,
          gameId,
          reason: err.message,
        });
      }
    }
  }

  if (removedMessageIds.size > 0 && Array.isArray(publishedGames)) {
    const compacted = publishedGames.filter((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }

      return !removedMessageIds.has(entry.messageId);
    });

    publishedGames.length = 0;
    publishedGames.push(...compacted);
  }

  return {
    success: errors.length === 0,
    duplicatesFound: duplicates.length,
    messagesDeleted: totalDeleted,
    removedMessageIds: Array.from(removedMessageIds),
    errors,
  };
}

module.exports = {
  groupMessagesByGameId,
  findDuplicates,
  sortByAge,
  getMessagesToDelete,
  deleteMessageFromTelegram,
  cleanDuplicates,
};
