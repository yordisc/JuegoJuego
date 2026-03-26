// test/pc-games.test.js

const test = require('node:test');
const assert = require('node:assert');
const { checkPCGames } = require('../services/pc-games');

// Entorno falso para pruebas
process.env.TELEGRAM_TOKEN = 'test-token';
process.env.CHANNEL_ID = '@testchannel';

test('🧪 Suite de Pruebas: Filtro de PC (GamerPower)', async (t) => {
    const originalFetch = global.fetch;

    // Simulador de la API de GamerPower
    function mockGamerPowerResponse(gamesArray) {
        global.fetch = async (url) => {
            if (url.includes('gamerpower.com')) {
                // GamerPower devuelve un array directo
                return { json: async () => gamesArray }; 
            }
            if (url.includes('api.telegram.org')) {
                return { json: async () => ({ ok: true }) };
            }
            throw new Error(`URL no simulada: ${url}`);
        };
    }

    t.afterEach(() => {
        global.fetch = originalFetch;
    });

    await t.test('✅ Caso 1: Debe publicar y guardar si el juego es nuevo', async () => {
        const mockGame = {
            title: "Cyberpunk 2077 - Edición Prueba",
            platforms: "PC, Steam",
            open_giveaway_url: "https://www.gamerpower.com/open/cyberpunk-test"
        };
        
        // Simulamos que la API devuelve este juego
        mockGamerPowerResponse([mockGame]);

        let publishedGames = []; // Memoria vacía
        await checkPCGames(publishedGames);

        assert.strictEqual(publishedGames.length, 1, "El juego no se guardó en la memoria");
        assert.strictEqual(publishedGames[0], mockGame.open_giveaway_url);
    });

    await t.test('🧠 Caso 2: NO debe publicar si el juego ya está en la memoria', async () => {
        const mockGameUrl = "https://www.gamerpower.com/open/witcher-test";
        const mockGame = {
            title: "The Witcher 3 - Edición Prueba",
            platforms: "GOG",
            open_giveaway_url: mockGameUrl
        };
        
        mockGamerPowerResponse([mockGame]);

        // Simulamos que el bot ya había guardado este enlace antes
        let publishedGames = [mockGameUrl]; 
        await checkPCGames(publishedGames);

        // La memoria debe seguir teniendo 1 solo elemento
        assert.strictEqual(publishedGames.length, 1, "El bot intentó publicar un duplicado");
    });
});