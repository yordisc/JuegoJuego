const { getStore } = require("@netlify/blobs");

function cleanEnvValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  // Elimina comillas accidentalmente pegadas al copiar secretos en UI.
  return value.trim().replace(/^['\"]|['\"]$/g, "");
}

function validateBlobCredentials(siteID, token) {
  const issues = [];

  const siteIdPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!siteID) {
    issues.push("NETLIFY_SITE_ID no definido");
  } else if (!siteIdPattern.test(siteID)) {
    issues.push("NETLIFY_SITE_ID no tiene formato UUID valido");
  }

  if (!token) {
    issues.push("NETLIFY_API_TOKEN no definido");
  } else {
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

function getBlobCredentialReport(env = process.env) {
  const siteID = cleanEnvValue(env.NETLIFY_SITE_ID);
  const token = cleanEnvValue(env.NETLIFY_API_TOKEN);
  const issues = validateBlobCredentials(siteID, token);

  return {
    siteID,
    token,
    issues,
    hasValidCredentials: issues.length === 0,
  };
}

function createBlobStoreFromEnv(options = {}) {
  const { storeName = "memory-store" } = options;
  const report = getBlobCredentialReport(process.env);

  if (!report.hasValidCredentials) {
    const reason = report.issues.join("; ");
    throw new Error(
      `[blobs] Credenciales invalidas para acceder a ${storeName}: ${reason}`
    );
  }

  return getStore({
    name: storeName,
    siteID: report.siteID,
    token: report.token,
  });
}

module.exports = {
  cleanEnvValue,
  validateBlobCredentials,
  getBlobCredentialReport,
  createBlobStoreFromEnv,
};