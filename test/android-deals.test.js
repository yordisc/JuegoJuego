// test/android-deals.test.js

const test = require('node:test');
const assert = require('node:assert');
const { checkAndroidDeals } = require('../services/android-deals');

// Configuramos variables de entorno falsas para que el código no falle
process.env.TELEGRAM_TOKEN = 'test-token';
process.env.CHANNEL_ID = '@testchannel';

test('🧪 Suite de Pruebas: Filtro de Reddit (Android Deals)', async (t) => {
    
    // Guardamos el fetch original de Node para restaurarlo después
    const originalFetch = global.fetch;

    // Esta función nos ayuda a simular la respuesta de Reddit
    function mockRedditResponse(postData) {
        global.fetch = async (url) => {
            // Si el código intenta llamar a Reddit, le damos nuestros datos falsos
            if (url.includes('reddit.com')) {
                return {
                    json: async () => ({ data: { children: [{ data: postData }] } })
                };
            }
            // Si el código intenta llamar a Telegram, simulamos un éxito absoluto
            if (url.includes('api.telegram.org')) {
                return { json: async () => ({ ok: true }) };
            }
            throw new Error(`URL no simulada: ${url}`);
        };
    }

    t.afterEach(() => {
        // Limpiamos el mock después de cada prueba
        global.fetch = originalFetch;
    });

    await t.test('✅ Caso 1: Debe publicar si el título contiene "Free"', async () => {
        mockRedditResponse({
            title: "Monument Valley [Free]",
            url: "https://play.google.com/store/apps/details?id=com.monument",
            link_flair_text: "Sale",
            ups: 10
        });

        let publishedGames = [];
        await checkAndroidDeals(publishedGames);

        // Verificamos que el ID se guardó en la memoria
        assert.strictEqual(publishedGames.length, 1, "El juego no se guardó en la memoria");
        assert.strictEqual(publishedGames[0], "https://play.google.com/store/apps/details?id=com.monument");
    });

    await t.test('✅ Caso 2: Debe publicar si la etiqueta es "Popular app"', async () => {
        mockRedditResponse({
            title: "Stardew Valley sale $2.99",
            url: "https://play.google.com/store/apps/details?id=com.stardew",
            link_flair_text: "Popular app", 
            ups: 5
        });

        let publishedGames = [];
        await checkAndroidDeals(publishedGames);

        assert.strictEqual(publishedGames.length, 1);
        assert.strictEqual(publishedGames[0], "https://play.google.com/store/apps/details?id=com.stardew");
    });

    await t.test('❌ Caso 3: NO debe publicar si no es gratis ni popular', async () => {
        mockRedditResponse({
            title: "Random App sale $0.99",
            url: "https://play.google.com/store/apps/details?id=com.random",
            link_flair_text: "Sale",
            ups: 15
        });

        let publishedGames = [];
        await checkAndroidDeals(publishedGames);

        // La memoria debe seguir vacía porque no cumplió las reglas
        assert.strictEqual(publishedGames.length, 0, "Se publicó una oferta que no era gratis ni popular");
    });

    await t.test('🧠 Caso 4: NO debe publicar si el juego ya está en la memoria', async () => {
        const gameUrl = "https://play.google.com/store/apps/details?id=com.already.published";
        
        mockRedditResponse({
            title: "Awesome Game [Free]",
            url: gameUrl,
            link_flair_text: "Free",
            ups: 100
        });

        // Simulamos que el bot ya corrió antes y guardó este link
        let publishedGames = [gameUrl];
        await checkAndroidDeals(publishedGames);

        // La memoria debe seguir teniendo exactamente 1 elemento, no 2
        assert.strictEqual(publishedGames.length, 1, "El bot duplicó la publicación");
    });
});