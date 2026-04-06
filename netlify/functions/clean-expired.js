// netlify/functions/clean-expired.js

if (process.env.NODE_ENV !== "production") require("dotenv").config();
const {
  getPublishedGamesList,
  savePublishedGamesList,
} = require("../../utils/memory");
const { checkAndroidDeals } = require("../../services/android-deals");
const { checkPCGames } = require("../../services/pc-games");
const {
  createBlobStoreFromEnv,
  getBlobCredentialReport,
} = require("../../utils/netlify-blobs");
const { withBlobLock } = require("../../utils/blob-lock");

const KEY_ANDROID_QUEUE = "android_queue";
const KEY_ANDROID_EXPIRED = "android_expired";
const KEY_PC_EXPIRED = "pc_expired";
const GAMERPOWER_PC_FREE_GAMES_URL =
  "https://www.gamerpower.com/api/filter?platform=pc&type=game";

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeId(value) {
  if (value == null) {
    return "";
  }

  const normalized = String(value).trim();
  if (!normalized || normalized === "undefined" || normalized === "null") {
    return "";
  }

  return normalized;
}

function getEntryId(entry) {
  if (typeof entry === "string") {
    return normalizeId(entry);
  }

  if (entry && typeof entry === "object" && entry.id != null) {
    return normalizeId(entry.id);
  }

  return "";
}

function getEntryMessageId(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const raw = entry.messageId;
  if (Number.isInteger(raw)) {
    return raw;
  }

  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    return Number(raw);
  }

  return null;
}

function getEntrySource(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return typeof entry.source === "string" && entry.source.trim()
    ? entry.source.trim()
    : null;
}

function dedupeEntries(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const byId = new Map();

  for (const item of items) {
    const id = getEntryId(item);
    if (!id) {
      continue;
    }

    const candidate = {
      id,
      messageId: getEntryMessageId(item),
    };

    const source = getEntrySource(item);
    if (source) {
      candidate.source = source;
    }

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, candidate);
      continue;
    }

    if (existing.messageId == null && candidate.messageId != null) {
      existing.messageId = candidate.messageId;
    }

    if (!existing.source && candidate.source) {
      existing.source = candidate.source;
    }
  }

  return Array.from(byId.values());
}

async function readJsonArray(store, key) {
  const raw = await store.get(key);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`[clean-expired] JSON invalido en ${key}, se reinicia a []`);
    return [];
  }
}

async function fetchActivePcIds() {
  const response = await fetch(GAMERPOWER_PC_FREE_GAMES_URL);

  if (!response.ok) {
    throw new Error(`GamerPower devolvio HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    return new Set();
  }

  return new Set(
    data
      .map((item) => (item && typeof item === "object" ? normalizeId(item.id) : ""))
      .filter(Boolean)
  );
}

exports.handler = async () => {
  console.log("========================================");
  console.log("🧹 INICIANDO CLEAN-EXPIRED (DEBUG MODE)");
  console.log("========================================");

  try {
    console.log("🔍 [DEBUG 1/4] Verificando Variables de Entorno:");
    const report = getBlobCredentialReport(process.env);
    const siteId = report.siteID;
    const apiToken = report.token;

    console.log(
      `   - NETLIFY_SITE_ID: ${
        siteId
          ? "✅ Presente (" + siteId.substring(0, 5) + "...)"
          : "❌ NO DEFINIDO"
      }`
    );
    console.log(
      `   - NETLIFY_API_TOKEN: ${
        apiToken ? "✅ Presente (Oculto por seguridad)" : "❌ NO DEFINIDO"
      }`
    );
    console.log(
      `   - TELEGRAM_TOKEN: ${
        process.env.TELEGRAM_TOKEN ? "✅ Presente" : "❌ NO DEFINIDO"
      }`
    );
    console.log(
      `   - CHANNEL_ID: ${
        process.env.CHANNEL_ID
          ? "✅ Presente (" + process.env.CHANNEL_ID + ")"
          : "❌ NO DEFINIDO"
      }`
    );

    if (report.issues.length > 0) {
      console.error("   - Credenciales Blobs invalidas:");
      for (const issue of report.issues) {
        console.error(`     * ${issue}`);
      }
    }

    console.log("🔌 [DEBUG 2/4] Conectando a Netlify Blobs...");
    const store = createBlobStoreFromEnv({ storeName: "memory-store" });

    await withBlobLock(
      store,
      {
        lockKey: process.env.ANDROID_STATE_LOCK_KEY || "android_state_lock",
        owner: "clean-expired",
        ttlMs: parsePositiveInt(process.env.ANDROID_STATE_LOCK_TTL_MS, 5 * 1000),
        retries: parsePositiveInt(process.env.ANDROID_STATE_LOCK_RETRIES, 5),
        retryDelayMs: parsePositiveInt(
          process.env.ANDROID_STATE_LOCK_RETRY_DELAY_MS,
          500
        ),
      },
      async () => {
        const androidPublished = await getPublishedGamesList(store, "android");
        const pcPublished = await getPublishedGamesList(store, "pc");
        const androidQueue = dedupeEntries(await readJsonArray(store, KEY_ANDROID_QUEUE));
        const androidExpired = dedupeEntries(await readJsonArray(store, KEY_ANDROID_EXPIRED));
        const pcExpired = dedupeEntries(await readJsonArray(store, KEY_PC_EXPIRED));

        const androidQueueIds = new Set(androidQueue.map((entry) => entry.id));
        const safeAndroidExpired = androidExpired.filter(
          (entry) => !androidQueueIds.has(entry.id)
        );

      let pcCleanupEnabled = true;
      let activePcIds = new Set();
      let mergedPcExpired = pcExpired;

        try {
          activePcIds = await fetchActivePcIds();
          const inferredPcExpired = dedupeEntries(
            pcPublished.filter((entry) => !activePcIds.has(getEntryId(entry)))
          );
          mergedPcExpired = dedupeEntries([...pcExpired, ...inferredPcExpired]).filter(
            (entry) => !activePcIds.has(entry.id)
          );
        } catch (err) {
          pcCleanupEnabled = false;
          console.warn(
            `[clean-expired] WARN no se pudo validar activos de PC (${err.message}). Se omite limpieza PC para evitar falsos positivos.`
          );
        }

        await store.setJSON(KEY_ANDROID_EXPIRED, safeAndroidExpired);
        if (pcCleanupEnabled) {
          await store.setJSON(KEY_PC_EXPIRED, mergedPcExpired);
        }

        console.log(`   - Android memoria actual: ${androidPublished.length}`);
        console.log(`   - PC memoria actual: ${pcPublished.length}`);
        console.log(`   - Android expirados seguros: ${safeAndroidExpired.length}`);
        console.log(
          `   - PC expirados a limpiar: ${
            pcCleanupEnabled ? String(mergedPcExpired.length) : "OMITIDO (modo seguro)"
          }`
        );

        console.log("📡 [DEBUG 3/4] Limpiando expirados de Android y PC...");
        await checkAndroidDeals(store, androidPublished, {
          processQueue: false,
          processExpired: true,
        });
        await checkPCGames(store, pcPublished, {
          processQueue: false,
          processExpired: pcCleanupEnabled,
        });
        console.log("   - Expirados procesados en ambas plataformas.");

        console.log("💾 [DEBUG 4/4] Guardando memoria actualizada...");
        await savePublishedGamesList(store, androidPublished, "android");
        await savePublishedGamesList(store, pcPublished, "pc");
        console.log("   - Memorias Android/PC actualizadas.");
      }
    );

    console.log("✅ EJECUCIÓN EXITOSA COMPLETADA");
    console.log("========================================");
    return { statusCode: 200, body: "Limpieza de expirados completada con éxito." };
  } catch (error) {
    console.error("❌ ERROR CRÍTICO EN CLEAN-EXPIRED:");
    console.error(error);
    const errorText = String(error && error.message ? error.message : error);
    if (errorText.includes("401")) {
      console.error(
        "[HINT] 401 en Blobs: valida NETLIFY_SITE_ID/NETLIFY_API_TOKEN, quita espacios/comillas y usa un PAT de Netlify del mismo site."
      );
    } else if (errorText.includes("403")) {
      console.error(
        "[HINT] 403 en Blobs: el token es valido, pero sin permisos suficientes para este site."
      );
    }
    return { statusCode: 500, body: error.toString() };
  }
};
