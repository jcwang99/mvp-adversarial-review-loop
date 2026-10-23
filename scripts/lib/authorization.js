const { createHash } = require("node:crypto");

function validAuthorization(entry) {
  return entry && typeof entry === "object" && !Array.isArray(entry) &&
    typeof entry.action === "string" && entry.action.length > 0 &&
    ["authorized", "declined"].includes(entry.decision) &&
    (entry.scope === undefined || entry.scope === null || typeof entry.scope === "string") &&
    typeof entry.at === "string" && Number.isFinite(Date.parse(entry.at));
}

// Append order is authoritative, including records with identical timestamps.
function latestAuthorization(entries, action, scope) {
  if (!Array.isArray(entries) || !entries.every(validAuthorization)) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.action === action && (!entry.scope || entry.scope === scope)) return { entry, index };
  }
  return null;
}

function hasAuthorization(state, action, scope) {
  return latestAuthorization(state.authorizations, action, scope)?.entry.decision === "authorized";
}

function digest(entries) {
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

function authorizationReceipt(state, action, scope) {
  const latest = latestAuthorization(state.authorizations, action, scope);
  if (latest?.entry.decision !== "authorized") return null;
  return {
    action, scope, recorded_at: new Date().toISOString(),
    log_length: state.authorizations.length, authorization_index: latest.index,
    log_digest: digest(state.authorizations),
  };
}

function wasAuthorized(state, action, scope, receipts) {
  const entries = state.authorizations;
  if (!Array.isArray(entries) || !entries.every(validAuthorization)) return false;
  // Legacy records cannot prove whether an action preceded a revocation. Only
  // accept an unambiguous history; re-record the action after renewed consent.
  if (receipts === undefined || (receipts && typeof receipts === "object" && !Array.isArray(receipts) && !Object.hasOwn(receipts, action))) {
    return hasAuthorization(state, action, scope) && !entries.some((entry) =>
      entry.action === action && (!entry.scope || entry.scope === scope) && entry.decision === "declined");
  }
  if (!receipts || typeof receipts !== "object" || Array.isArray(receipts)) return false;
  const receipt = receipts[action];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
      receipt.action !== action || receipt.scope !== scope ||
      !Number.isInteger(receipt.log_length) || receipt.log_length < 1 || receipt.log_length > entries.length ||
      !Number.isInteger(receipt.authorization_index) || receipt.authorization_index < 0 ||
      receipt.authorization_index >= receipt.log_length ||
      typeof receipt.recorded_at !== "string" || !Number.isFinite(Date.parse(receipt.recorded_at)) ||
      typeof receipt.log_digest !== "string" || !/^[a-f0-9]{64}$/.test(receipt.log_digest)) return false;
  const prefix = entries.slice(0, receipt.log_length);
  const recordedAt = Date.parse(receipt.recorded_at);
  if (prefix.some((entry) => Date.parse(entry.at) > recordedAt) ||
      entries.slice(receipt.log_length).some((entry) => Date.parse(entry.at) < recordedAt) ||
      digest(prefix) !== receipt.log_digest) return false;
  const latest = latestAuthorization(prefix, action, scope);
  return latest?.entry.decision === "authorized" && latest.index === receipt.authorization_index;
}

module.exports = { validAuthorization, latestAuthorization, hasAuthorization, authorizationReceipt, wasAuthorized };
