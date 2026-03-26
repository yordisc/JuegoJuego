// test/memory.test.js

const test = require('node:test');
const assert = require('node:assert');
const { getPublishedGamesList, savePublishedGamesList } = require('../utils/memory');

test('🧪 Suite de Pruebas: Gestor de Memoria (Netlify Blobs)', async (t) => {

    await t.test('✅ Caso 1: Debe devolver un array vacío [] si es la primera vez (nube vacía)', async () => {
        // Simulamos un "cajón" que devuelve null cuando se le pide la data
        const mockStoreEmpty = {
            get: async () => null
        };
        
        const result = await getPublishedGamesList(mockStoreEmpty);
        
        assert.deepStrictEqual(result, [], "El bot no inicializó correctamente un array vacío");
    });

    await t.test('✅ Caso 2: Debe leer y decodificar correctamente los datos guardados', async () => {
        const mockData = ["https://link1.com", "https://link2.com"];
        
        // Simulamos un "cajón" que devuelve un texto JSON (como lo hace Netlify)
        const mockStoreWithData = {
            get: async () => JSON.stringify(mockData)
        };
        
        const result = await getPublishedGamesList(mockStoreWithData);
        
        assert.deepStrictEqual(result, mockData, "El bot no pudo leer los datos guardados");
    });

    await t.test('🧠 Caso 3: Debe recortar la lista para proteger la memoria si supera los 100 juegos', async () => {
        // Generamos dinámicamente una lista de 105 juegos falsos
        const arrayGigante = Array.from({ length: 105 }, (_, i) => `juego_${i}`);

        let datosQueSeIntentanGuardar = [];
        
        // Simulamos el store, pero esta vez "atrapamos" lo que la función intenta guardar
        const mockStore = {
            setJSON: async (key, data) => { 
                datosQueSeIntentanGuardar = data; 
            }
        };

        // Ejecutamos la función de guardado
        await savePublishedGamesList(mockStore, arrayGigante);

        // 1. Verificamos que el tamaño final sea exactamente 100
        assert.strictEqual(datosQueSeIntentanGuardar.length, 100, "El gestor de memoria no recortó el exceso de datos");
        
        // 2. Verificamos que conservó los juegos MÁS RECIENTES (los del final de la lista)
        // El último elemento debe ser "juego_104"
        assert.strictEqual(datosQueSeIntentanGuardar[99], "juego_104", "El gestor borró los juegos nuevos en lugar de los viejos");
    });
});