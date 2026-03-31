if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const fs = require("node:fs");
const path = require("node:path");
const { getStore } = require("@netlify/blobs");

const REQUIRED_FILES = [
  ".github/workflows/scraper.yml",
  ".github/workflows/scraper-pc.yml",
  ".github/workflows/scraper-android-rss.yml",
  "netlify/functions/check-android.js",
  "netlify/functions/check-pc.js",
  "scripts/github-android.js",
  "scripts/github-android-rss.js",
  "scripts/github-pc.js",
];

const REQUIRED_SECRETS = ["NETLIFY_SITE_ID", "NETLIFY_API_TOKEN"];
const REQUIRED_CONSUMER_ENV = ["TELEGRAM_TOKEN", "CHANNEL_ID"];
const KEYS_TO_CHECK = [
  "published_games_android",
  "published_games_pc",
  "android_queue",
  "android_expired",
  "pc_queue",
  "pc_expired",
];

function exists(filePath) {
  return fs.existsSync(path.join(process.cwd(), filePath));
}

function readEnvReport(keys) {
  return keys.map((key) => ({
    key,
    present: Boolean(process.env[key]),
  }));
}

function validateProducerCredentials() {
  const issues = [];
  const siteID = process.env.NETLIFY_SITE_ID || "";
  const token = process.env.NETLIFY_API_TOKEN || "";

  const siteIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (siteID && !siteIdPattern.test(siteID)) {
    issues.push("NETLIFY_SITE_ID no tiene formato UUID valido");
  }

  if (token) {
    if (/\s/.test(token)) {
      issues.push("NETLIFY_API_TOKEN contiene espacios (token invalido)");
    }

    if (/^(ssh-rsa|ssh-ed25519|ecdsa-sha2-)/i.test(token)) {
      issues.push("NETLIFY_API_TOKEN parece clave SSH, no un token de Netlify");
    }

    if (/^-----BEGIN/i.test(token)) {
      issues.push("NETLIFY_API_TOKEN parece llave PEM, no un token de Netlify");
    }
  }

  return issues;
}

async function readKeyCount(store, key) {
  const raw = await store.get(key);
  if (!raw) {
    return 0;
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch (err) {
    return -1;
  }
}

async function main() {
  const strict = process.argv.includes("--strict");
  let hasBlockingIssue = false;

  console.log("[smoke] Verificando archivos criticos...");
  for (const file of REQUIRED_FILES) {
    const ok = exists(file);
    console.log(`- ${file}: ${ok ? "OK" : "MISSING"}`);
    if (!ok) {
      hasBlockingIssue = true;
    }
  }

  console.log("[smoke] Verificando variables para productor...");
  const producerEnv = readEnvReport(REQUIRED_SECRETS);
  for (const row of producerEnv) {
    console.log(`- ${row.key}: ${row.present ? "OK" : "MISSING"}`);
  }

  console.log("[smoke] Verificando variables para consumidor...");
  const consumerEnv = readEnvReport(REQUIRED_CONSUMER_ENV);
  for (const row of consumerEnv) {
    console.log(`- ${row.key}: ${row.present ? "OK" : "MISSING"}`);
  }

  const producerReady = producerEnv.every((row) => row.present);
  const credentialIssues = validateProducerCredentials();

  if (credentialIssues.length > 0) {
    hasBlockingIssue = true;
    console.error("[smoke] ERROR formato invalido en credenciales de productor:");
    for (const issue of credentialIssues) {
      console.error(`- ${issue}`);
    }
    console.error("[smoke] HINT usa un Personal Access Token de Netlify para NETLIFY_API_TOKEN.");
  }

  if (producerReady && credentialIssues.length === 0) {
    try {
      const store = getStore({
        name: "memory-store",
        siteID: process.env.NETLIFY_SITE_ID,
        token: process.env.NETLIFY_API_TOKEN,
      });

      console.log("[smoke] Verificando acceso a Blobs...");
      for (const key of KEYS_TO_CHECK) {
        const count = await readKeyCount(store, key);
        const label = count >= 0 ? String(count) : "JSON_INVALID";
        console.log(`- ${key}: ${label}`);
        if (count < 0) {
          hasBlockingIssue = true;
        }
      }
    } catch (err) {
      hasBlockingIssue = true;
      const message = String(err && err.message ? err.message : err);
      console.error(`[smoke] ERROR ${message}`);

      if (message.includes("401")) {
        console.error("[smoke] HINT 401: credenciales de Blobs invalidas o sin permisos para este sitio.");
        console.error("[smoke] HINT revisa NETLIFY_SITE_ID y NETLIFY_API_TOKEN (token con scope de Blobs para ese site).");
      } else if (message.includes("403")) {
        console.error("[smoke] HINT 403: token valido pero sin permisos suficientes para Blobs.");
      } else {
        console.error("[smoke] HINT valida conectividad y que el site/token pertenezcan al mismo proyecto.");
      }
    }
  } else {
    if (!producerReady) {
      console.log("[smoke] Se omite chequeo de Blobs porque faltan secretos de productor.");
    } else {
      console.log("[smoke] Se omite chequeo de Blobs porque las credenciales de productor son invalidas.");
    }
    if (strict) {
      hasBlockingIssue = true;
    }
  }

  console.log(
    `[metrics] ${JSON.stringify({
      source: "smoke-verify",
      items_produced: 0,
      items_published: 0,
      items_expired: 0,
      publish_errors: 0,
      delete_errors: hasBlockingIssue ? 1 : 0,
    })}`
  );

  if (hasBlockingIssue) {
    process.exitCode = 1;
    console.log("[smoke] Resultado: FAIL");
    return;
  }

  console.log("[smoke] Resultado: OK");
}

main().catch((err) => {
  console.error("[smoke] ERROR", err.message);
  process.exitCode = 1;
});
