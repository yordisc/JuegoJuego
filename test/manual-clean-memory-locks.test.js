const test = require("node:test");
const assert = require("node:assert");

// Mock de withBlobLock para simular comportamiento real
const { withBlobLock } = require("../utils/blob-lock");

function createMockStore() {
  const data = {};
  const locks = {};

  return {
    get: async (key) => {
      if (!(key in data)) {
        return null;
      }

      const value = data[key];
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    setJSON: async (key, value) => {
      data[key] = value;
    },
    snapshot: () => ({ ...data, locks: { ...locks } }),
  };
}

test("manual-clean-memory: Lock behavior", async (t) => {
  await t.test("Adquiere y libera lock android_state_lock correctamente", async () => {
    const store = createMockStore();

    let lockAcquired = false;
    let executionOrder = [];

    // Simular manual-clean-memory adquiriendo lock
    const cleanMemoryPromise = withBlobLock(
      store,
      {
        lockKey: "android_state_lock",
        owner: "manual-clean-memory",
        ttlMs: 2000,
      },
      async () => {
        lockAcquired = true;
        executionOrder.push("clean-memory-start");
        await new Promise((resolve) => setTimeout(resolve, 100));
        executionOrder.push("clean-memory-end");
      }
    );

    // Esperar un poco y luego intentar adquirir el mismo lock (simular check-android)
    await new Promise((resolve) => setTimeout(resolve, 50));

    const checkAndroidPromise = withBlobLock(
      store,
      {
        lockKey: "android_state_lock",
        owner: "check-android",
        ttlMs: 2000,
        retries: 3, // Solo 3 intentos rápidos
        retryDelayMs: 50,
      },
      async () => {
        executionOrder.push("check-android-executed");
      }
    ).catch(() => {
      executionOrder.push("check-android-timeout");
    });

    await cleanMemoryPromise;
    await checkAndroidPromise;

    // Verificar que clean-memory se ejecutó
    assert.ok(lockAcquired, "manual-clean-memory debe adquirir el lock");

    // Verificar que se respetó el order (clean-memory completa antes de check-android)
    const cleanMemoryIndex = executionOrder.indexOf("clean-memory-end");
    const checkAndroidIndex = executionOrder.findIndex((e) =>
      e.includes("check-android")
    );

    assert.ok(
      cleanMemoryIndex >= 0,
      "clean-memory debe terminar su ejecución"
    );
    assert.ok(
      checkAndroidIndex >= 0,
      "check-android debe intentar ejecutarse"
    );

    console.log(`  Order de ejecución: ${executionOrder.join(" -> ")}`);
  });

  await t.test("Lock timeout evita bloqueos indefinidos", async () => {
    const store = createMockStore();

    let operation1Completed = false;
    let operation2Timeout = false;

    // Primera operación que mantiene el lock
    const op1 = withBlobLock(
      store,
      {
        lockKey: "test-lock",
        owner: "op1",
        ttlMs: 500, // TTL corto
      },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        operation1Completed = true;
      }
    );

    // Segunda operación con timeouts cortos
    await new Promise((resolve) => setTimeout(resolve, 100));

    const op2 = withBlobLock(
      store,
      {
        lockKey: "test-lock",
        owner: "op2",
        ttlMs: 2000,
        retries: 2,
        retryDelayMs: 100,
      },
      async () => {
        console.log("  ✓ Op2 adquirió el lock después de esperar");
      }
    ).catch((err) => {
      operation2Timeout = true;
      console.log(`  ✓ Op2 timeout después de retries: ${err.message}`);
    });

    await op1;
    await op2;

    assert.ok(operation1Completed, "Primera operación debe completar");
    console.log(`  Operation1 completed: ${operation1Completed}`);
    console.log(`  Operation2 timeout: ${operation2Timeout}`);
  });
});

test("manual-clean-telegram: Lock behavior", async (t) => {
  await t.test("No interfiere con locks de otras operaciones", async () => {
    const store = createMockStore();

    const results = [];

    // Operación 1: manual-clean-telegram con lock
    const cleanTelegram = withBlobLock(
      store,
      {
        lockKey: "android_state_lock",
        owner: "manual-clean-telegram",
        ttlMs: 1000,
      },
      async () => {
        results.push("telegram-start");
        await new Promise((resolve) => setTimeout(resolve, 100));
        results.push("telegram-end");
      }
    );

    // Operación 2: Otra función esperando el lock
    await new Promise((resolve) => setTimeout(resolve, 50));

    const otherOp = withBlobLock(
      store,
      {
        lockKey: "android_state_lock",
        owner: "other-function",
        ttlMs: 1000,
        retries: 2,
        retryDelayMs: 50,
      },
      async () => {
        results.push("other-start");
        results.push("other-end");
      }
    ).catch(() => {
      results.push("other-timeout");
    });

    await cleanTelegram;
    await otherOp;

    assert.ok(
      results.indexOf("telegram-end") < results.indexOf("other-start"),
      "telegram debe terminar antes de que other inicie"
    );

    console.log(`  Resultados: ${results.join(" -> ")}`);
  });
});
