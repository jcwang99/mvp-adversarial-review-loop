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
  state.rounds = [1, 2].map((round) => ({ round, status: "completed", roles: [], raw_candidates: 0, duplicates: 0, screened_out: 0, replay_eligible: 0, new_in_scope_p0p1p2: 0 }));
  const findings = [1, 2].map((round) => {
    const tests = ["normal", "edge"].map((suffix) => `tests/review/verifications/r${round}_f001_func_adjacent_${suffix}.test.js`);
    for (const file of tests) write(file, `const { test } = require('node:test'); const assert = require('node:assert/strict'); test('round ${round}', () => assert.equal(require('../../../src.js')(${round}), ${round}));\n`);
    return { id: `R${round}-F001-FUNC`, decision: "accepted", verification: "pass", adjacent_round: round, adjacent_status: "pass", adjacent_tests: tests, test_files: [] };
  });
  save(state, { schema_version: 1, findings });
  const plan = (scope) => JSON.parse(cli("adjacent-plan", "--scope", scope));
  let logNumber = 0;
  const execute = (scope) => {
    const selected = plan(scope);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ["--test", ...selected.test_paths], { cwd: root, encoding: "utf8", env });
    assert.ifError(run.error);
    const log = `.review-evidence/batch-${++logNumber}.log`;
    write(log, `COMMAND=${selected.command}\n${run.stdout}${run.stderr}\nEXIT_CODE=${run.status}\n`);
    const count = run.stdout.match(/^# tests (\d+)$/m);
    const failed = run.stdout.match(/^# fail (\d+)$/m);
    assert.ok(count && failed, `test runner did not report actual test counts: ${run.stdout}${run.stderr}`);
    return { ...selected, log, exit: run.status, testCount: Number(count[1]), failedCount: Number(failed[1]) };
  };
  const record = (run, attempt = 1, commit = git("rev-parse", "HEAD")) => cli("record-final-adjacent-batch", "--attempt", String(attempt), "--status", run.exit ? "fail" : "pass", "--command", run.command, "--exit-status", String(run.exit), "--tree-hash", policy.gitTree(root, commit), "--tested-commit", commit, "--log", run.log, "--test-count", String(run.testCount), "--failed-count", String(run.failedCount), ...(run.exit ? ["--failed-finding", "R1-F001-FUNC"] : []));
  const errors = (attempt = 1) => {
    const result = [];
    policy.validateFinalAdjacentBatch(root, readState(), readData(), result, attempt);
    return result.join("; ");
  };
  return { root, cli, git, write, readState, readData, save, plan, execute, record, errors };
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
  p.cli("record-adjacent-batch", "--status", "pass", "--command", round.command, "--exit-status", "0", "--tree-hash", policy.gitTree(p.root, "HEAD"), "--tested-commit", p.git("rev-parse", "HEAD"), "--log", round.log, "--test-count", String(round.testCount), "--failed-count", "0");
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
});

test("a prior deferred finding is batched in its verification round", (t) => {
  const p = project(t);
  const data = p.readData();
  data.findings[0].adjacent_round = 2;
  p.save(p.readState(), data);
  assert.equal(p.plan("round").test_paths.length, 4);
});

test("re-adjudication cannot erase previously registered adjacent tests", (t) => {
  const p = project(t);
  const state = p.readState();
  const data = p.readData();
  state.adjacent_registry = policy.adjacentRegistry(state, data);
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
  for (const command of ["node --test {test_paths} tests/extra.test.js", "node --test {test_paths} || true", "node --test tests/review/verifications {test_paths}"]) {
    fs.writeFileSync(file, baseline.replace("node --test {test_paths}", command));
    assert.throws(() => p.cli("adjacent-plan", "--scope", "all"), /Adjacent test command/);
  }
});
