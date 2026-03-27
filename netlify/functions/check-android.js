// Archivo: services/android-deals.js

async function checkAndroidDeals(publishedGames) {
    console.log("   [DEBUG] 🌐 Iniciando petición a Reddit con camuflaje...");

    // 1. EL CAMUFLAJE (Headers)
    const requestOptions = {
        method: 'GET',
        headers: {
            'User-Agent': 'Bot:JuegosJuegosScanner:v1.0.0 (by /u/DevAutomatizacion)'
        }
    };

    // 2. PETICIÓN A REDDIT
    const response = await fetch('https://www.reddit.com/r/googleplaydeals/new.json?limit=15', requestOptions);

    if (!response.ok) {
        throw new Error(`Reddit bloqueó la petición temporalmente. Código HTTP: ${response.status}`);
    }

    console.log("   [DEBUG] 📥 JSON recibido correctamente. Procesando ofertas...");
    const data = await response.json();
    const posts = data.data.children;

    let nuevasOfertas = 0;

    // 3. PROCESAMIENTO Y FILTRADO
    for (const post of posts) {
        const deal = post.data;
        const dealId = deal.id;
        
        // Protecciones básicas contra posts vacíos
        if (!deal) continue;

        const titulo = deal.title || "";
        const flair = deal.link_flair_text || "";

        // Si ya lo publicamos antes, lo saltamos en silencio
        if (publishedGames.includes(dealId)) {
            continue;
        }

        console.log(`   [DEBUG] 🔎 Evaluando post: "${titulo.substring(0, 50)}..."`);

        // Filtros: Buscamos "100% off", "free", o la etiqueta "popular" (revisando título y flair)
        const tituloLower = titulo.toLowerCase();
        const flairLower = flair.toLowerCase();
        
        const esGratis = tituloLower.includes('100% off') || tituloLower.includes('free');
        const esPopular = tituloLower.includes('popular') || flairLower.includes('popular');

        if (esGratis || esPopular) {
            console.log(`   [DEBUG] 🎯 ¡Match encontrado! (Gratis: ${esGratis}, Popular: ${esPopular})`);

            // Construimos el mensaje
            const etiqueta = esPopular && !esGratis ? "🌟 POPULAR" : "🔥 GRATIS";
            const mensaje = `📱 **NUEVA OFERTA ANDROID** 📱\n\n` +
                            `${etiqueta}: ${titulo}\n\n` +
                            `👉 [Ver en Google Play](${deal.url})`;

            // 4. ENVÍO A TELEGRAM
            try {
                const telegramResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: process.env.CHANNEL_ID,
                        text: mensaje,
                        parse_mode: 'Markdown',
                        disable_web_page_preview: false
                    })
                });

                if (telegramResponse.ok) {
                    console.log(`   [DEBUG] ✅ Publicado con éxito en Telegram (ID: ${dealId})`);
                    publishedGames.push(dealId);
                    nuevasOfertas++;
                } else {
                    console.error(`   [DEBUG] ❌ Error de Telegram:`, await telegramResponse.text());
                }
            } catch (err) {
                console.error(`   [DEBUG] ❌ Error de red al enviar a Telegram:`, err.message);
            }
        }
    }

    // 5. RESUMEN FINAL
    if (nuevasOfertas === 0) {
        console.log("   [DEBUG] 💤 No se encontraron ofertas nuevas en este ciclo.");
    } else {
        console.log(`   [DEBUG] 🎉 Ciclo terminado: Se publicaron ${nuevasOfertas} ofertas en Telegram.`);
    }
}

module.exports = { checkAndroidDeals };