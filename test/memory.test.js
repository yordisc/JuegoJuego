// test/memory.test.js

const test = require("node:test");
const assert = require("node:assert");
const {
  getPublishedGamesList,
  savePublishedGamesList,
} = require("../utils/memory");

test("🧪 Suite de Pruebas: Gestor de Memoria (Netlify Blobs)", async (t) => {
  await t.test(
    "✅ Caso 1: Debe devolver un array vacío [] si es la primera vez (nube vacía)",
    async () => {
      // Simulamos un "cajón" que devuelve null cuando se le pide la data
      const mockStoreEmpty = {
        get: async () => null,
      };

      const result = await getPublishedGamesList(mockStoreEmpty);

      assert.deepStrictEqual(
        result,
        [],
        "El bot no inicializó correctamente un array vacío"
      );
    }
  );

  await t.test(
    "✅ Caso 2: Debe leer y decodificar correctamente los datos guardados",
    async () => {
      const mockData = ["https://link1.com", "https://link2.com"];

      // Simulamos un "cajón" que devuelve un texto JSON (como lo hace Netlify)
      const mockStoreWithData = {
        get: async () => JSON.stringify(mockData),
      };

      const result = await getPublishedGamesList(mockStoreWithData);

      assert.deepStrictEqual(
        result,
        mockData,
        "El bot no pudo leer los datos guardados"
      );
    }
  );

  await t.test(
    "✅ Caso 3: Debe guardar la lista exacta que recibe en la nube",
    async () => {
      // Creamos una lista de prueba
      const datosPrueba = ["juego_A", "juego_B", "juego_C"];

      let llaveGuardada = "";
      let datosQueSeIntentanGuardar = [];

      // Simulamos el store, y "atrapamos" lo que la función intenta guardar
      const mockStore = {
        setJSON: async (key, data) => {
          llaveGuardada = key;
          datosQueSeIntentanGuardar = data;
        },
      };

      // Ejecutamos la función de guardado
      await savePublishedGamesList(mockStore, datosPrueba);

      // 1. Verificamos que use la llave correcta
      assert.strictEqual(
        llaveGuardada,
        "published_games",
        "Se guardó con una llave incorrecta en la base de datos"
      );

      // 2. Verificamos que los datos guardados sean EXACTAMENTE los que le pasamos (sin recortes)
      assert.deepStrictEqual(
        datosQueSeIntentanGuardar,
        datosPrueba,
        "El gestor de memoria alteró los datos antes de guardarlos"
      );
    }
  );
});
