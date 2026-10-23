const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { hasAuthorization, authorizationReceipt, wasAuthorized } = require("./lib/authorization");
const CLI = path.join(__dirname, "reviewctl.js");
const ID = "R1-F001-SEC";
const OTHER = "R1-F002-SEC";
const ACTIONS = ["main-agent-reproduction", "main-agent-verification", "skip-mandatory-challenge"];
function write(project, file, value) {
  const target = path.join(project, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value, null, 2));
}
function read(project, file) { return JSON.parse(fs.readFileSync(path.join(project, file), "utf8")); }
function run(project, args, failPattern) {
  const result = spawnSync(process.execPath, [CLI, ...args, "--project", project], { cwd: project, encoding: "utf8" });
  if (failPattern) { assert.notEqual(result.status, 0); assert.match(result.stderr + result.stdout, failPattern); }
  else assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}${result.stderr}`);
  return result;
}
function fixture(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "reviewctl-auth-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  for (const args of [["init", "-q"], ["config", "user.email", "test@example.com"], ["config", "user.name", "Auth Test"]]) execFileSync("git", args, { cwd: project });
  write(project, "README.md", "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: project });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: project });
  run(project, ["init", "--max-rounds", "2", "--user-confirmed"]);
  write(project, ".review-evidence/baseline.md", "# Baseline\nScope: authorization regression fixture\n");
  run(project, ["advance", "--to", "review"]);
  phase(project, "adjudication");
  const evidence = `.review-evidence/round-1/${ID}`;
  for (const file of ["counterexample.md", "adjudication.md", "manual-steps.md", "replay-review.md", "verification-result.md"]) write(project, `${evidence}/${file}`, "# Manual test evidence\nmain-agent 高风险\n");
  write(project, `${evidence}/adjudication.md`, "# Adjudication\n## Decision\n**Status**: accepted\nmain-agent 高风险\n");
  write(project, `${evidence}/verification-result.md`, "# Verification\n## Final Verdict\nfail\nmain-agent\n");
  return project;
}
function phase(project, name) {
  const state = read(project, ".review-evidence/state.json");
  state.current_phase = name;
  state.active_finding = name === "verification" ? ID : null;
  write(project, ".review-evidence/state.json", state);
  run(project, ["render"]);
}
function authorize(project, action, decision, scope = ID) {
  run(project, ["authorize", "--action", action, "--decision", decision, ...(scope ? ["--scope", scope] : [])]);
}
function recordArgs(action) {
  if (action === "main-agent-verification") return ["record-verification", "--id", ID, "--status", "fail", "--verified-by", "main-agent"];
  return ["record-finding", "--id", ID, "--role", "SEC", "--original-id", "SEC-001", "--severity", action === "skip-mandatory-challenge" ? "P1" : "P2", "--decision", "accepted", "--reproduced", "true", "--reproduction-status", "reproduced", "--change-origin", "pre-existing", ...(action === "skip-mandatory-challenge" ? ["--challenge-result", "skipped"] : ["--reproduced-by", "main-agent"])];
}
function prepareVerification(project) {
  const args = recordArgs("main-agent-reproduction");
  args[args.length - 1] = "agent";
  run(project, args);
  phase(project, "verification");
}
for (const action of ACTIONS) {
  test(`${action}: latest global/scoped consent and revocation`, () => {
    const state = { authorizations: [] };
    const append = (decision, scope = ID, name = action) => state.authorizations.push({ action: name, decision, scope, at: new Date().toISOString() });
    assert.equal(hasAuthorization(state, action, ID), false);
    append("authorized", ""); assert.equal(hasAuthorization(state, action, ID), true);
    append("declined", OTHER); assert.equal(hasAuthorization(state, action, ID), true);
    append("declined"); assert.equal(hasAuthorization(state, action, ID), false);
    append("authorized", OTHER); assert.equal(hasAuthorization(state, action, ID), false);
    append("authorized", ""); assert.equal(hasAuthorization(state, action, ID), true);
    append("declined", ""); assert.equal(hasAuthorization(state, action, ID), false);
    append("authorized"); assert.equal(hasAuthorization(state, action, ID), true);
    append("declined", ID, "unrelated"); assert.equal(hasAuthorization(state, action, ID), true);
  });
  test(`${action}: actual CLI refuses a revoked grant, preserves earlier evidence, rechecks updates`, (t) => {
    const project = fixture(t);
    if (action === "main-agent-verification") prepareVerification(project);
    authorize(project, action, "authorized", "");
    authorize(project, action, "declined");
    run(project, recordArgs(action), /授权/);
    authorize(project, action, "authorized");
    run(project, recordArgs(action));
    run(project, ["validate"]);
    const prior = read(project, ".review-evidence/findings.json");
    authorize(project, action, "declined", "");
    run(project, ["validate"]);
    run(project, recordArgs(action), /授权/);
    assert.deepEqual(read(project, ".review-evidence/findings.json"), prior);
    authorize(project, action, "authorized", OTHER);
    run(project, recordArgs(action), /授权/);
    authorize(project, action, "authorized");
    run(project, recordArgs(action));
    run(project, ["validate"]);
  });
}
test("authorization receipts reject malformed, mismatched, altered and truncated logs", () => {
  const action = ACTIONS[0];
  const state = { authorizations: [{ action, decision: "authorized", scope: ID, at: "2026-01-01T00:00:00.000Z" }] };
  const receipt = authorizationReceipt(state, action, ID);
  assert.equal(wasAuthorized(state, action, ID, { [action]: receipt }), true);
  for (const invalid of [null, false, [], {}, { ...receipt, action: ACTIONS[1] }, { ...receipt, scope: OTHER }, { ...receipt, log_length: "1" }, { ...receipt, log_length: 99 }, { ...receipt, authorization_index: -1 }, { ...receipt, authorization_index: 0.5 }, { ...receipt, recorded_at: "invalid" }, { ...receipt, recorded_at: "2025-01-01T00:00:00Z" }, { ...receipt, log_digest: "0".repeat(64) }]) {
    assert.equal(wasAuthorized(state, action, ID, { [action]: invalid }), false, JSON.stringify(invalid));
  }
  assert.equal(wasAuthorized(state, action, ID, null), false);
  assert.equal(wasAuthorized(state, action, OTHER, { [action]: receipt }), false);
  state.authorizations[0].scope = "";
  assert.equal(wasAuthorized(state, action, ID, { [action]: receipt }), false);
  state.authorizations = [];
  assert.equal(wasAuthorized(state, action, ID, { [action]: receipt }), false);
});
test("legacy evidence fails closed after ambiguous revocation, including absent receipt entries", () => {
  const action = ACTIONS[0];
  const state = { authorizations: [] };
  assert.equal(wasAuthorized(state, action, ID), false);
  state.authorizations.push({ action, decision: "authorized", scope: ID, at: new Date().toISOString() });
  assert.equal(wasAuthorized(state, action, ID), true);
  assert.equal(wasAuthorized(state, action, ID, {}), true);
  state.authorizations.push({ action, decision: "declined", scope: OTHER, at: new Date().toISOString() });
  assert.equal(wasAuthorized(state, action, ID), true);
  state.authorizations.push({ action, decision: "declined", scope: ID, at: new Date().toISOString() });
  state.authorizations.push({ action, decision: "authorized", scope: ID, at: new Date().toISOString() });
  assert.equal(wasAuthorized(state, action, ID), false);
  assert.equal(wasAuthorized(state, action, ID, {}), false);
  state.authorizations.push(null);
  assert.equal(hasAuthorization(state, action, ID), false);
  assert.equal(wasAuthorized(state, action, ID), false);
});
test("CLI validation detects receipt corruption after a later revocation", (t) => {
  const project = fixture(t);
  const action = ACTIONS[0];
  authorize(project, action, "authorized");
  run(project, recordArgs(action));
  authorize(project, action, "declined");
  const data = read(project, ".review-evidence/findings.json");
  data.findings[0].authorization_receipts[action].log_length = -1;
  write(project, ".review-evidence/findings.json", data);
  run(project, ["render"]);
  run(project, ["validate"], /授权/);
});
