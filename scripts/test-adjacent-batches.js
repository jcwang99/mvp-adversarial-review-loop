const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { test } = require("node:test");
const policy = require("./lib/test-policy");
const fixtures = require("./test-policy-fixtures");
const CLI = path.join(__dirname, "reviewctl.js");

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adjacent-batches-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const cli = (...args) => execFileSync(process.execPath, [CLI, ...args, "--project", root], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Adjacent Tests");
  write("src.js", "module.exports = n => n;\n");
  git("add", "src.js"); git("commit", "-qm", "baseline");
  cli("init", "--max-rounds", "3", "--user-confirmed");
  fixtures.writeBaseline(root);
  const readState = () => JSON.parse(fs.readFileSync(path.join(root, ".review-evidence/state.json")));
  const readData = () => JSON.parse(fs.readFileSync(path.join(root, ".review-evidence/findings.json")));
  const save = (state, data) => {
    write(".review-evidence/state.json", JSON.stringify(state));
    write(".review-evidence/findings.json", JSON.stringify(data));
    cli("render");
  };
  const state = readState();
  state.current_phase = "round_decision";
  state.current_round = 2;
  state.rounds_consumed = 2;
  state.rounds = [1, 2].map((round) => ({ round, status: "completed", roles: [], regression_gate_attempts: [], raw_candidates: 0, duplicates: 0, screened_out: 0, replay_eligible: 0, new_in_scope_p0p1p2: 0 }));
  const findings = [1, 2].map((round) => {
    const tests = ["normal", "edge"].map((suffix) => `tests/review/verifications/r${round}_f001_func_adjacent_${suffix}.test.js`);
    for (const file of tests) write(file, `const { test } = require('node:test'); const assert = require('node:assert/strict'); test('round ${round}', () => assert.equal(require('../../../src.js')(${round}), ${round}));\n`);
    return { id: `R${round}-F001-FUNC`, decision: "accepted", verification: "pass", adjacent_round: round, adjacent_status: "pass", adjacent_tests: tests, test_files: [] };
  });
  state.adjacent_registry = findings.flatMap((finding) => finding.adjacent_tests.map((file) => ({
    test_path: file, finding_id: finding.id, round: finding.adjacent_round,
  })));
  save(state, { schema_version: 1, findings });
  const plan = (scope) => JSON.parse(cli("adjacent-plan", "--scope", scope));
  let logNumber = 0;
  const execute = (scope) => {
    const selected = plan(scope);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const [executable, ...args] = selected.command.split(" ");
    assert.equal(executable, "node");
    const run = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", env });
    assert.ifError(run.error);
    const log = `.review-evidence/batch-${++logNumber}.log`;
    write(log, `COMMAND=${selected.command}\n${run.stdout}${run.stderr}\nEXIT_CODE=${run.status}\n`);
    // Node >= 23 defaults to the spec reporter; accept TAP and spec counts alike.
    const count = run.stdout.match(/^(?:# tests|ℹ tests) (\d+)$/m);
    const failed = run.stdout.match(/^(?:# fail|ℹ fail) (\d+)$/m);
    assert.ok(count && failed, `test runner did not report actual test counts: ${run.stdout}${run.stderr}`);
    return { ...selected, log, exit: run.status, testCount: Number(count[1]), failedCount: Number(failed[1]) };
  };
  const record = (run, attempt = 1, commit = git("rev-parse", "HEAD")) => cli("record-final-adjacent-batch", "--attempt", String(attempt), "--status", run.exit ? "fail" : "pass", "--command", run.command, "--exit-status", String(run.exit), "--tree-hash", policy.gitTree(root, commit), "--tested-commit", commit, "--log", run.log, "--test-count", String(run.testCount), "--failed-count", String(run.failedCount), ...(run.exit ? ["--failed-finding", "R1-F001-FUNC"] : []));
  const recordRound = (run) => cli("record-adjacent-batch", "--status", "pass", "--command", run.command,
    "--exit-status", "0", "--tree-hash", policy.gitTree(root, "HEAD"), "--tested-commit", git("rev-parse", "HEAD"),
    "--log", run.log, "--test-count", String(run.testCount), "--failed-count", "0");
  const roundErrors = (number) => {
    const state = readState();
    const result = [];
    policy.validateAdjacentBatch(root, state.rounds.find((round) => round.round === number), state, readData(), result);
    return result.join("; ");
  };
  const errors = (attempt = 1) => {
    const result = [];
    policy.validateFinalAdjacentBatch(root, readState(), readData(), result, attempt);
    return result.join("; ");
  };
  return { root, cli, git, write, readState, readData, save, plan, execute, record, recordRound, errors, roundErrors };
}

test("round plan runs only that round; aggregate detects a regression in an earlier round", (t) => {
  const p = project(t);
  p.write("src.js", "module.exports = n => n === 1 ? 0 : n;\n");
  p.git("add", "src.js"); p.git("commit", "-qm", "round two regression");
  const round = p.execute("round");
  assert.equal(round.exit, 0);
  const aggregate = p.execute("all");
  assert.notEqual(aggregate.exit, 0, `${aggregate.command}\n${fs.readFileSync(path.join(p.root, aggregate.log), "utf8")}`);
  assert.equal(aggregate.test_paths.length, 4);
  p.record(aggregate);
  assert.match(p.errors(), /尚未通过/);
  p.write("src.js", "module.exports = n => n;\n");
  p.git("add", "src.js"); p.git("commit", "-qm", "repair regression");
  const repaired = p.execute("all");
  assert.equal(repaired.exit, 0);
  p.record(repaired);
  assert.equal(p.errors(), "");
  const archived = fs.readFileSync(path.join(p.root, ".review-evidence/round-2/final-audit/attempt-1/adjacent-batch-attempt-1.md"), "utf8");
  assert.match(archived, /"status": "fail"/);
  assert.equal(fs.existsSync(path.join(p.root, aggregate.log)), true);
});

test("aggregate evidence rejects stale HEAD, changed tests, mismatched command and missing audit attempt", (t) => {
  const p = project(t);
  const run = p.execute("all");
  const oldHead = p.git("rev-parse", "HEAD");
  p.record(run);
  assert.equal(p.errors(), "");
  assert.match(p.errors(2), /缺少终审前/);
  p.write(run.test_paths[0], "// changed after execution\n");
  assert.match(p.errors(), /hash 不匹配/);
  p.git("commit", "--allow-empty", "-qm", "new HEAD with same tree");
  assert.match(p.errors(), /已过期/);
  assert.throws(() => p.record(run, 1, oldHead), /当前 HEAD/);
  assert.throws(() => p.record({ ...run, command: "node --test tests/review/verifications" }), /精确运行/);
});

test("log command matching is exact and replays preserve the prior log", (t) => {
  const p = project(t);
  const run = p.execute("all");
  const original = fs.readFileSync(path.join(p.root, run.log), "utf8");
  p.write(run.log, original.replace(`COMMAND=${run.command}\n`, `COMMAND=${run.command} extra.test.js\n`));
  assert.throws(() => p.record(run), /COMMAND/);
  p.write(run.log, original);
  p.record(run);
  assert.throws(() => p.record(run), /新的 --log/);
  p.write(run.log, original + "changed\n");
  assert.match(p.errors(), /日志哈希/);
});

test("verified promotion excludes only its original test from aggregate, retaining historical evidence", (t) => {
  const p = project(t);
  const testPath = p.plan("all").test_paths[0];
  const state = p.readState();
  state.current_round = 1;
  p.save(state, p.readData());
  const round = p.execute("round");
  p.recordRound(round);
  const updatedState = p.readState();
  updatedState.current_round = 2;
  p.save(updatedState, p.readData());
  p.write("tests/formal.test.js", "const {test}=require('node:test'); const assert=require('node:assert/strict'); test('regression',()=>assert.equal(require('../src.js')(1),1));\n");
  p.git("add", "tests/formal.test.js"); p.git("commit", "-qm", "formal regression");
  const data = p.readData();
  data.findings[1].test_files = ["tests/formal.test.js"];
  p.save(p.readState(), data);
  p.cli("promote-adjacent-test", "--test", testPath, "--finding", "R2-F001-FUNC", "--formal-test", "tests/formal.test.js", "--reason", "The formal test retains the n=1 regression assertion");
  const planned = p.plan("all");
  assert.equal(planned.test_paths.length, 3);
  assert.equal(planned.test_paths.includes(testPath), false);
  assert.equal(fs.existsSync(path.join(p.root, testPath)), true);
  const promotionErrors = [];
  policy.validateAdjacentPromotions(p.root, p.readState(), p.readData(), promotionErrors);
  assert.deepEqual(promotionErrors, []);
  p.record(p.execute("all"));
  assert.equal(p.errors(), "");
  assert.throws(() => p.cli("promote-adjacent-test", "--test", testPath, "--finding", "R2-F001-FUNC", "--formal-test", "tests/formal.test.js", "--reason", "again"), /已经升级/);
  const originalFormal = fs.readFileSync(path.join(p.root, "tests/formal.test.js"), "utf8");
  p.write("tests/formal.test.js", "require('node:test')('regression', () => {});\n");
  assert.ok(p.plan("all").test_paths.includes(testPath));
  p.git("add", "tests/formal.test.js"); p.git("commit", "-qm", "drop formal assertion");
  assert.ok(p.plan("all").test_paths.includes(testPath));
  assert.match(p.errors(), /test_paths/);
  p.record(p.execute("all"));
  assert.equal(p.errors(), "");
  assert.equal(p.readState().adjacent_promotions.length, 1);
  p.write("tests/formal.test.js", originalFormal);
  assert.ok(p.plan("all").test_paths.includes(testPath));
  p.git("add", "tests/formal.test.js"); p.git("commit", "-qm", "restore formal assertion");
  assert.equal(p.plan("all").test_paths.includes(testPath), false);
});

test("a prior deferred finding is batched in its verification round", (t) => {
  const p = project(t);
  const data = p.readData();
  const state = p.readState();
  data.findings[0].adjacent_round = 2;
  for (const entry of state.adjacent_registry) if (entry.finding_id === data.findings[0].id) entry.round = 2;
  p.save(state, data);
  assert.equal(p.plan("round").test_paths.length, 4);
});

test("re-adjudication cannot erase previously registered adjacent tests", (t) => {
  const p = project(t);
  const state = p.readState();
  const data = p.readData();
  data.findings[0].verification = "pending";
  data.findings[0].adjacent_tests = [];
  p.save(state, data);
  assert.equal(p.plan("all").test_paths.length, 4);
  assert.equal(p.plan("round").test_paths.length, 2);
});

test("baseline rejects a directory-only command without exact path substitution", (t) => {
  const p = project(t);
  const file = path.join(p.root, ".review-evidence/baseline.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("node --test {test_paths}", "node --test tests/review/verifications"));
  assert.throws(() => p.cli("adjacent-plan", "--scope", "all"), /test_paths/);
});

test("baseline rejects extra paths and shell failure suppression after the placeholder", (t) => {
  const p = project(t);
  const file = path.join(p.root, ".review-evidence/baseline.md");
  const baseline = fs.readFileSync(file, "utf8");
  for (const command of ["node --test {test_paths} tests/extra.test.js", "node --test {test_paths} || true", "node --test tests/review/verifications {test_paths}", "node --test # {test_paths}", "node --test{test_paths}"]) {
    fs.writeFileSync(file, baseline.replace("node --test {test_paths}", command));
    assert.throws(() => p.cli("adjacent-plan", "--scope", "all"), /Adjacent test command/);
  }
});

test("round count follows the registered paths when a finding supplies one test and a reason", (t) => {
  const p = project(t);
  const state = p.readState();
  const data = p.readData();
  const finding = data.findings[1];
  const file = finding.adjacent_tests[0];
  const dir = ".review-evidence/round-2/" + finding.id;
  const formal = "tests/formal.test.js";
  p.write(formal, "require('node:test')('regression', () => {});\n");
  p.git("add", formal); p.git("commit", "-qm", "formal regression");
  Object.assign(finding, { severity: "P2", evidence_dir: dir, verification: "pending", implementation_status: "already_fixed",
    commit: p.git("rev-parse", "HEAD"), test_files: [formal], adjacent_tests: [] });
  state.current_phase = "verification";
  state.active_finding = finding.id;
  state.adjacent_registry = state.adjacent_registry.filter((entry) => entry.finding_id !== finding.id);
  p.save(state, data);
  p.write(dir + "/verification-result.md", "# Verification\n\n**Final Verdict**: pass\n");
  fixtures.writeVerificationEvidence(p.root, dir, finding);
  p.cli("record-verification", "--id", finding.id, "--status", "pass", "--adjacent-test", file,
    "--adjacent-reason", "Only one independently executable boundary case is available");
  const decision = p.readState();
  decision.current_phase = "round_decision";
  p.save(decision, p.readData());
  const run = p.execute("round");
  assert.equal(run.exit, 0);
  assert.equal(run.testCount, 1);
  p.recordRound(run);
  assert.equal(p.roundErrors(2), "");
  p.git("commit", "--allow-empty", "-qm", "next HEAD");
  assert.match(p.roundErrors(2), /HEAD/);
  const next = p.readState();
  next.current_round = 3;
  next.current_phase = "review";
  p.save(next, p.readData());
  assert.equal(p.roundErrors(2), "");
});

test("a batch log describes one command and its actual exit status", (t) => {
  const p = project(t);
  const run = p.execute("all");
  const original = fs.readFileSync(path.join(p.root, run.log), "utf8");
  for (const marker of ["EXIT_CODE=1", "COMMAND=node --test unrelated.test.js"]) {
    p.write(run.log, original + marker + "\n");
    assert.throws(() => p.record(run), /COMMAND|EXIT_CODE/);
  }
  p.write(run.log, original.replace("EXIT_CODE=0", "EXIT_CODE=2"));
  assert.throws(() => p.record({ ...run, exit: 1, failedCount: 1 }), /EXIT_CODE/);
});

test("round full evidence rejects a fast command log before the result can be reused", (t) => {
  const p = project(t);
  const baselinePath = path.join(p.root, ".review-evidence/baseline.md");
  fs.writeFileSync(baselinePath, fs.readFileSync(baselinePath, "utf8").replace("Tiering mode: default", "Tiering mode: progressive"));
  const suite = fixtures.fullSuite(p.root, ".review-evidence/round-2", policy.gitTree(p.root, "HEAD"));
  suite.tested_commit = p.git("rev-parse", "HEAD");
  const file = ".review-evidence/round-2/full-suite.json";
  p.write(file, JSON.stringify({ full_suite: suite }));
  const record = () => p.cli("record-round-regression", "--status", "pass", "--evidence", file);
  p.write(suite.log, "COMMAND=node --test --test-name-pattern=fast\nEXIT_CODE=0\n");
  assert.throws(record, /COMMAND/);
  p.write(suite.log, "EXIT_CODE=0\n");
  assert.throws(record, /COMMAND/);
  p.write(suite.log, "COMMAND=node --test\nEXIT_CODE=0\n");
  p.write(file, JSON.stringify({ full_suite: { ...suite, tested_commit: "" } }));
  assert.throws(record, /tested_commit/);
  p.write(file, JSON.stringify({ full_suite: { ...suite, log: ".review-evidence/baseline-full.log" } }));
  assert.throws(record, /独立.*日志/);
  p.write(file, JSON.stringify({ full_suite: suite }));
  record();
  p.cli("record-round-regression", "--reuse");
  assert.equal(p.readState().rounds[1].regression_gate.reused_from, "round-2");
});

test("baseline requires one full command and one successful exit", (t) => {
  const p = project(t);
  const log = ".review-evidence/baseline-full.log";
  for (const text of ["COMMAND=node --test --test-name-pattern=fast\nEXIT_CODE=0\n", "EXIT_CODE=0\nEXIT_CODE=1\n"]) {
    p.write(log, text);
    assert.throws(() => p.plan("round"), /COMMAND|EXIT_CODE/);
  }
  p.write(log, "EXIT_CODE=0\n");
  assert.throws(() => p.plan("round"), /COMMAND/);
});

test("fast and impacted evidence require at least one test to pass", (t) => {
  const p = project(t);
  const tree = policy.gitTree(p.root, "HEAD");
  const dir = ".review-evidence/round-2/R2-F001-FUNC";
  const suite = fixtures.fullSuite(p.root, dir, tree);
  const baseline = policy.parseBaselinePolicy(p.root).policy;
  suite.command = baseline.fastCommand;
  suite.fast_profile = baseline.fastProfile;
  suite.test_counts = { total: 1, passed: 0, failed: 0, skipped: 1 };
  p.write(suite.log, `COMMAND=${suite.command}\nEXIT_CODE=0\n`);
  assert.match(policy.validateFastRun(p.root, suite, baseline, "fast", tree).join("; "), /test_counts/);

  const finding = { severity: "P2", implementation_status: "fixed", commit: p.git("rev-parse", "HEAD") };
  fixtures.writeGreenEvidence(p.root, dir, tree);
  fixtures.writeVerificationEvidence(p.root, dir, finding);
  const report = path.join(p.root, dir, "verification-result.md");
  const original = fs.readFileSync(report, "utf8");
  const evidence = policy.parseJsonSection(original, "Reviewctl Verification Evidence", "verification").value;
  evidence.regression.test_counts = suite.test_counts;
  fixtures.appendReport(p.root, path.relative(p.root, report), "Reviewctl Verification Evidence", evidence);
  assert.match(policy.validateVerificationEvidence(p.root, finding, {}, report, tree).join("; "), /impacted test_counts/);
});

test("verification and command expansion share the canonical adjacent path check", () => {
  const file = "tests/review/verifications/round-1/normal.test.js";
  policy.validateAdjacentPaths([]);
  assert.equal(policy.expandAdjacentCommand("runner {test_paths}", [file]), `runner ${file}`);
  for (const paths of [[file, file], [file.replace("round-1", "..")], [file.replace("/normal", "//normal")], [null], null]) {
    assert.throws(() => policy.validateAdjacentPaths(paths), /相邻测试/);
    assert.throws(() => policy.expandAdjacentCommand("runner {test_paths}", paths), /相邻测试/);
  }
});

test("quality logs bind a single quality command to a single successful exit", (t) => {
  const p = project(t);
  const rel = ".review-evidence/quality.log";
  const log = path.join(p.root, rel);
  const command = "node --check src.js";
  const valid = `QUALITY_COMMAND=${command}\r\nEXIT_CODE=0\r\n`;
  p.write(rel, valid);
  assert.equal(policy.hasRunMarkers(log, command, 0, "QUALITY_COMMAND"), true);
  for (const extra of ["EXIT_CODE=1", `QUALITY_COMMAND=${command}`, " QUALITY_COMMAND = other"]) {
    p.write(rel, valid + extra + "\r\n");
    assert.equal(policy.hasRunMarkers(log, command, 0, "QUALITY_COMMAND"), false);
  }
});

test("a final aggregate needs its own run even if the round had the same paths and HEAD", (t) => {
  const p = project(t);
  const state = p.readState();
  const data = p.readData();
  for (const entry of state.adjacent_registry) entry.round = 2;
  for (const finding of data.findings) finding.adjacent_round = 2;
  p.save(state, data);
  const round = p.execute("round");
  p.recordRound(round);
  assert.throws(() => p.record(round), /独立.*日志/);
  assert.equal(p.readState().final_audit.preflight_batches.length, 0);
  const final = p.execute("all");
  p.record(final);
  assert.equal(p.errors(), "");
  // Replay validation of persisted evidence that cites the earlier round run.
  const recorded = p.readState();
  const batch = recorded.final_audit.preflight_batches[0];
  batch.log = round.log;
  batch.log_sha256 = policy.sha256File(path.join(p.root, round.log));
  fixtures.appendReport(p.root, ".review-evidence/round-2/final-audit/attempt-1/adjacent-batch.md", "Reviewctl Final Adjacent Batch Evidence", batch);
  p.save(recorded, p.readData());
  assert.match(p.errors(), /独立.*日志/);
});

test("independent full verification cannot use its baseline or GREEN log", (t) => {
  const p = project(t);
  const tree = policy.gitTree(p.root, "HEAD");
  const dir = ".review-evidence/round-2/R2-F001-FUNC";
  const finding = { severity: "P1", implementation_status: "fixed", commit: p.git("rev-parse", "HEAD") };
  fixtures.writeGreenEvidence(p.root, dir, tree);
  fixtures.writeVerificationEvidence(p.root, dir, finding);
  const report = path.join(p.root, dir, "verification-result.md");
  const check = () => policy.validateVerificationEvidence(p.root, finding, {}, report, tree);
  assert.deepEqual(check(), []);
  const evidence = policy.parseJsonSection(fs.readFileSync(report, "utf8"), "Reviewctl Verification Evidence", "verification").value;
  for (const log of [".review-evidence/baseline-full.log", dir + "/output-full-suite.log"]) {
    evidence.regression.log = evidence.full_test_suite.log = log;
    fixtures.appendReport(p.root, path.relative(p.root, report), "Reviewctl Verification Evidence", evidence);
    assert.match(check().join("; "), /独立.*日志/);
  }
});
