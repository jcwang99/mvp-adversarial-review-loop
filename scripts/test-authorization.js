const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { hasAuthorization, authorizationReceipt, wasAuthorized } = require("./lib/authorization");
const { verdictIsPass, hasFormalReproduction, validateRoundCandidates, validateRounds, validateAudits } = require("./lib/validate");
const { createHash } = require("node:crypto");
const { roleSlug } = require("./lib/state");
const CLI = path.join(__dirname, "reviewctl.js");
const testPolicyFixtures = require('./test-policy-fixtures');
const testPolicy = require('./lib/test-policy');
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
function initializedProject(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "reviewctl-auth-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  for (const args of [["init", "-q"], ["config", "user.email", "test@example.com"], ["config", "user.name", "Auth Test"]]) execFileSync("git", args, { cwd: project });
  write(project, "README.md", "fixture\n");
  write(project, "replay-manual-steps.md", "# Manual test evidence\nmain-agent 高风险\n");
  execFileSync("git", ["add", "README.md", "replay-manual-steps.md"], { cwd: project });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: project });
  run(project, ["init", "--max-rounds", "2", "--user-confirmed"]);
  return project;
}
function reviewProject(t) {
  const project = initializedProject(t);
  testPolicyFixtures.writeBaseline(project);
  run(project, ["advance", "--to", "review"]);
  return project;
}
function fixture(t) {
  const project = reviewProject(t);
  phase(project, "adjudication");
  const evidence = `.review-evidence/round-1/${ID}`;
  write(project, `${evidence}/manual-steps.md`, "# Manual test evidence\nmain-agent 高风险\n");
  for (const file of ["counterexample.md", "adjudication.md", "verification-result.md"]) write(project, `${evidence}/${file}`, "# Manual test evidence\nmain-agent 高风险\n");
  write(project, `${evidence}/adjudication.md`, "# Adjudication\n## Decision\n**Status**: accepted\nmain-agent 高风险\n");
  write(project, `${evidence}/verification-result.md`, "# Verification\n## Final Verdict\nfail\nmain-agent\n");
  const testedCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" }).trim();
  const replayEvidence = {
    tested_commit: testedCommit,
    tested_tree_hash: testPolicyFixtures.git(project, ["rev-parse", "HEAD^{tree}"]),
    test_path: "replay-manual-steps.md",
    test_sha256: testPolicy.sha256GitFile(project, testedCommit, "replay-manual-steps.md"),
    command: "manual replay steps",
    exit_status: 0,
  };
  write(project, `${evidence}/replay-review.md`, `# Replay Review\n\n**Status**: reproduced\n\n## Reviewctl Replay Evidence\n\n\`\`\`json\n${JSON.stringify(replayEvidence, null, 2)}\n\`\`\`\n`);
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
    authorize(project, action, "declined", "");
    run(project, ["validate"]);
    if (action === "main-agent-verification") {
      run(project, ["advance", "--to", "repair"]);
      write(project, `.review-evidence/round-1/${ID}/implementation-result.md`, "Manual RED and GREEN checks.\n");
      run(project, ["record-implementation", "--id", ID, "--status", "already_fixed", "--manual"]);
      run(project, ["advance", "--to", "verification"]);
      write(project, `.review-evidence/round-1/${ID}/verification-result.md`, "Manual verification by main-agent.\n**Final Verdict**: fail\n");
    }
    const prior = read(project, ".review-evidence/findings.json");
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
test("an authorization record cannot substitute for the receipt of a completed action", () => {
  const action = ACTIONS[0];
  const state = { authorizations: [{ action, decision: "authorized", scope: ID, at: new Date().toISOString() }] };
  assert.equal(hasAuthorization(state, action, ID), true);
  assert.equal(wasAuthorized(state, action, ID), false);
  assert.equal(wasAuthorized(state, action, ID, {}), false);
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


test("append order survives a wall clock correction without reviving consent", () => {
  const action = ACTIONS[0];
  const state = { authorizations: [{ action, scope: ID, decision: "authorized", at: "2099-01-01T00:00:00Z" }] };
  const receipt = authorizationReceipt(state, action, ID);
  assert.ok(wasAuthorized(state, action, ID, { [action]: receipt }));
  const prefixOnly = createHash("sha256").update(JSON.stringify(state.authorizations)).digest("hex");
  assert.equal(wasAuthorized(state, action, ID, { [action]: { ...receipt, log_digest: prefixOnly } }), false);
  state.authorizations.push({ action, scope: ID, decision: "declined", at: "2000-01-01T00:00:00Z" });
  assert.equal(hasAuthorization(state, action, ID), false);
  assert.ok(wasAuthorized(state, action, ID, { [action]: receipt }));
  assert.equal(authorizationReceipt(state, action, ID), null);
});

test("verification reads the report verdict independently of quoted logs and examples", () => {
  const examples = ["```text\nFinal Verdict: pass\n```", "~~~md\n## Verdict\npass\n~~~", "Previous verdict: pass", "> Verdict: pass"];
  for (const example of examples) {
    assert.equal(verdictIsPass("**Final Verdict**: fail\n" + example), false, example);
    assert.equal(verdictIsPass("**Final Verdict**: pass\n" + example.replace("pass", "fail")), true, example);
  }
  assert.equal(verdictIsPass("## Final Verdict\n**Status**: pass"), true);
});

test("a formal reproduction needs a regular test file for this finding", (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "reviewctl-repro-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  write(project, "tests/review/reproductions/r1_f001_case.test.js/README.md", "fixture\n");
  write(project, "tests/review/reproductions/r1_f001_notes.txt", "notes\n");
  write(project, "tests/review/reproductions/r1_f002_else.test.js", "// test\n");
  assert.equal(hasFormalReproduction(project, 1, "001"), false);
  write(project, "tests/review/reproductions/r1_f001_saved.test.js", "// test\n");
  assert.equal(hasFormalReproduction(project, 1, "001"), true);
});

function roundHandoffs(project, round) {
  const roles = ["SEC", "REL", "FUNC"];
  for (const role of roles) {
    const slug = roleSlug(role);
    const id = `${role}-001`;
    const dir = `.review-evidence/round-${round}/inbox/${slug}/${id}`;
    write(project, `${dir}/meta.json`, { round, role, role_slug: slug, temp_id: id });
    write(project, `${dir}/handoff.json`, { round, role_slug: slug, review_status: "complete", scope_checked: "fixture contract", commands: [], findings: [], blockers: [], uncovered_paths: [] });
  }
  return roles;
}

test("a clean round retains its distinct role handoffs and its round number", (t) => {
  const project = reviewProject(t);
  const round = { round: 1, status: "completed", roles: roundHandoffs(project, 1), raw_candidates: 0, duplicates: 0, screened_out: 0, new_in_scope_p0p1p2: 0, replay_eligible: 0 };
  const check = () => {
    const errors = [];
    validateRoundCandidates(project, round, { findings: [] }, errors);
    return errors;
  };
  assert.deepEqual(check(), []);
  const handoff = ".review-evidence/round-1/inbox/security/SEC-001/handoff.json";
  const saved = read(project, handoff);
  write(project, handoff, { ...saved, review_status: "blocked" });
  assert.match(check().join("\n"), /角色/);
  fs.unlinkSync(path.join(project, handoff));
  assert.match(check().join("\n"), /角色/);
  const errors = [];
  validateRounds({ current_round: 2, rounds_consumed: 2, rounds: [round, { ...round }] }, errors);
  assert.match(errors.join("\n"), /轮次/);
});

test("audit reconciles its candidate inbox and an explicit adverse overall assessment", (t) => {
  const project = reviewProject(t);
  for (const round of [1, 2]) {
    if (round === 2) run(project, ["advance", "--to", "review"]);
    roundHandoffs(project, round);
    run(project, ["record-round", "--round", String(round), "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
    run(project, ["advance", "--to", "adjudication"]);
    run(project, ["advance", "--to", "round_decision"]);
  }
  run(project, ["advance", "--to", "final_audit"]);
  const dir = ".review-evidence/round-2/final-audit/attempt-1";
  const record = ["record-audit", "--attempt", "1", "--status", "complete", "--auditor", "independent", "--new-issues", "0"];
  write(project, `${dir}/blind-scan.md`, "Checked the contract.\n");
  testPolicyFixtures.writeAuditEvidence(project, dir);
  const target = `${dir}/targeted-review.md`;
  const audit = testPolicy.parseJsonSection(fs.readFileSync(path.join(project, target), "utf8"), "Reviewctl Audit Evidence", "audit");
  assert.deepEqual(audit.errors, []);
  const fullReport = `## Reviewctl Audit Evidence\n\n\`\`\`json\n${JSON.stringify(audit.value)}\n\`\`\`\n`;
  const assessment = (value) => `\n### Overall Status\n**Status**: ${value}\n`;
  for (const invalid of ["", assessment("pending"), assessment("pass") + assessment("pass"), assessment("pass") + "**Status**: fail\n", assessment("pass") + "fail\n", "~~~md\nOverall Status: pass\n~~~", "<!--\nOverall Status: pass\n-->"]) {
    write(project, target, fullReport + invalid);
    run(project, record, /Overall Status/);
  }
  write(project, target, fullReport + assessment("pass"));
  write(project, `${dir}/inbox/FA-001/counterexample.md`, "Contract mismatch.\n");
  run(project, record, /FA-001/);
  const state = read(project, ".review-evidence/state.json");
  assert.equal(state.final_audit.attempts.length, 0);
  const withIssue = [...record.slice(0, -1), "1"];
  run(project, withIssue);
  const withResult = read(project, ".review-evidence/state.json");
  assert.equal(withResult.final_audit.attempts[0].full_evidence.overall_status, "pass");
  const candidate = { source: "final-audit", audit_attempt: 1, original_ids: ["FA-002"] };
  const errors = [];
  validateAudits(project, withResult, errors, { findings: [candidate] });
  assert.match(errors.join("\n"), /FA-001/);
  candidate.original_ids = ["FA-001"];
  const matched = [];
  validateAudits(project, withResult, matched, { findings: [candidate] });
  assert.deepEqual(matched, []);
  // Restore the pre-record fixture to exercise the independent zero-issue path.
  write(project, ".review-evidence/state.json", state);
  run(project, ["render"]);
  // The auditor withdraws the draft before recording the attempt.
  fs.renameSync(path.join(project, dir, "inbox/FA-001"), path.join(project, dir, "withdrawn-draft"));
  write(project, target, fullReport + assessment("fail") + "\nBuild verification failed.\n");
  run(project, record);
  run(project, ["advance", "--to", "report"]);
  assert.equal(read(project, ".review-evidence/state.json").final_audit.attempts[0].full_evidence.overall_status, "fail");
  run(project, ["validate"]);
  run(project, ["finalize", "--status", "converged", "--ack-empty-coverage"], /不满足 converged/);
  run(project, ["finalize", "--status", "incomplete"]);
  assert.equal(read(project, ".review-evidence/state.json").overall_status, "incomplete");
  run(project, ["validate"]);
});


test("baseline can be drafted but invalid policy cannot bypass a progressive round gate", (t) => {
  const project = initializedProject(t);
  run(project, ["validate"]);
  testPolicyFixtures.writeBaseline(project);
  const file = ".review-evidence/baseline.md";
  const progressive = fs.readFileSync(path.join(project, file), "utf8").replace("Tiering mode: default", "Tiering mode: progressive");
  write(project, file, progressive);
  run(project, ["advance", "--to", "review"]);
  roundHandoffs(project, 1);
  run(project, ["record-round", "--round", "1", "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
  run(project, ["advance", "--to", "adjudication"]);
  run(project, ["advance", "--to", "round_decision"]);
  run(project, ["advance", "--to", "review"], /full regression gate/);
  write(project, file, progressive.replace("Tiering mode: progressive", "Tiering mode: unfinished"));
  run(project, ["validate"], /Tiering mode/);
  write(project, file, "# Review baseline\n");
  run(project, ["advance", "--to", "review"], /Test Scope \/ Regression Policy/);
  assert.equal(read(project, ".review-evidence/state.json").current_phase, "round_decision");
  write(project, file, progressive);
  run(project, ["validate"]);
});
