const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CLI = path.join(__dirname, "reviewctl.js");
const run = (project, args) => execFileSync(process.execPath, [CLI, ...args, "--project", project], { cwd: project, encoding: "utf8" });
const write = (project, file, text) => { const target = path.join(project, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
const git = (project, args) => execFileSync("git", args, { cwd: project, encoding: "utf8" }).trim();

const project = fs.mkdtempSync(path.join(os.tmpdir(), "reviewctl-optimistic-"));
execFileSync("git", ["init", "-q"], { cwd: project });
execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: project });
execFileSync("git", ["config", "user.name", "Review Test"], { cwd: project });
write(project, ".gitignore", ".review-evidence/\n");
write(project, "src.js", "module.exports = 1;\n");
execFileSync("git", ["add", "."], { cwd: project });
execFileSync("git", ["commit", "-qm", "init"], { cwd: project });
run(project, ["init", "--max-rounds", "2", "--user-confirmed"]);

const baseline = [
  "# Review Baseline", "", "## Test Scope / Regression Policy",
  "- Tiering mode: default", "- Full-suite duration: short", "- Baseline full result: pass",
  "- Baseline full log: .review-evidence/baseline-full.log", "- Expected test count: 1 / 1 / 0 / 0",
  "- Full suite composition: unit", "- Focused test command: node test.js", "- Impacted test command: node test.js --impacted",
  "- Fast test command: node test.js", "- Fast test profile: none", "- Fast profile semantics: not_applicable",
  "- Long-running test policy: none", "- Long-running test inventory: none", "- Full runtime scale: not_applicable",
  "- Time/volume scaling evidence: not_applicable", "- Code quality command: node --check src.js",
  "- Optimistic repair policy: bounded", "- Optimistic max active worktrees: 2", "- Optimistic eligible severities: P2,P3",
  "- Code quality policy: run before each repair commit", "- Baseline code quality result: pass",
  "- Baseline code quality log: .review-evidence/baseline-quality.log", "- Full test command: node test.js",
  "- Adjacent test command: node --test {test_paths}", "- High-risk paths: none", "- Verification default: impacted",
].join("\n") + "\n";
write(project, ".review-evidence/baseline.md", baseline);
write(project, ".review-evidence/baseline-full.log", "COMMAND=node test.js\nEXIT_CODE=0\n");
write(project, ".review-evidence/baseline-quality.log", "QUALITY_COMMAND=node --check src.js\nEXIT_CODE=0\n");
write(project, "test.js", "process.exit(0);\n");
execFileSync("git", ["add", "test.js"], { cwd: project });
execFileSync("git", ["commit", "-qm", "test: add fixture"], { cwd: project });

const statePath = path.join(project, ".review-evidence/state.json");
const findingsPath = path.join(project, ".review-evidence/findings.json");
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
state.current_phase = "repair";
require("./lib/staged-baseline").captureStagedBaseline(project, state);
state.active_finding = "R1-F001-FUNC";
state.optimistic_repairs = [];
fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
const findings = { schema_version: 1, findings: [{
  id: "R1-F001-FUNC", original_ids: ["FUNC-001"], source: "review", audit_attempt: null,
  role: "FUNC", severity: "P2", decision: "accepted", reproduced: true, reproduction_status: "reproduced",
  change_origin: "pre-existing", evidence_dir: ".review-evidence/round-1/R1-F001-FUNC", verification: "pending",
  implementation_status: "none", adjacent_tests: [], test_files: [], commit: null,
}] };
const first = findings.findings[0].id;
const second = "R1-F002-FUNC";
findings.findings.push({ ...findings.findings[0], id: second, original_ids: ["FUNC-002"], evidence_dir: ".review-evidence/round-1/" + second });
fs.writeFileSync(findingsPath, JSON.stringify(findings, null, 2) + "\n");
run(project, ["render"]);

const worktree = path.join(path.dirname(project), `${path.basename(project)}-candidate`);
const otherWorktree = worktree + "-2";
const readState = () => JSON.parse(fs.readFileSync(statePath, "utf8"));
const entry = id => readState().optimistic_repairs.find(item => item.finding_id === id);
const start = (id, dir) => run(project, ["optimistic-start", "--id", id, "--worktree", dir, "--risk-assessment", "normal"]);
const promote = id => run(project, ["optimistic-promote", "--id", id]);
const discard = id => run(project, ["optimistic-discard", "--id", id]);
write(project, "tests/review/reproductions/r1_f002_fix.test.js", "test\n");
write(project, ".review-evidence/round-1/" + second + "/replay-review.md", "replayed\n");
write(project, "tests/review/reproductions/r1_f001_fix.test.js", "test\n");
write(project, ".review-evidence/round-1/R1-F001-FUNC/replay-review.md", "replayed\n");
start(first, worktree);
start(second, otherWorktree);
// Promotion applies the entire base-to-candidate diff, including earlier commits.
const transientFile = "tests/review/candidates/temporary.test.js";
write(worktree, transientFile, "// transient review artifact\n");
git(worktree, ["add", transientFile]);
git(worktree, ["commit", "-qm", "add earlier candidate file"]);
write(worktree, "src.js", "module.exports = 2;\n");
execFileSync("git", ["add", "src.js"], { cwd: worktree });
execFileSync("git", ["commit", "-qm", "fix(review): candidate"], { cwd: worktree });
function precheck(dir) {
  const candidate = git(dir, ["rev-parse", "HEAD"]);
  const testLog = ".review-evidence/" + candidate + "-test.log";
  const qualityLog = ".review-evidence/" + candidate + "-quality.log";
  run(dir, ["run-logged", "--candidate", "--command", "node test.js --impacted", "--log", testLog]);
  run(dir, ["run-logged", "--candidate", "--quality", "--command", "node --check src.js", "--log", qualityLog]);
  return { candidate, testLog, qualityLog };
}
function record(id, { candidate, testLog, qualityLog }) {
  return run(project, ["optimistic-record", "--id", id, "--candidate-commit", candidate,
    "--test-status", "pass", "--quality-status", "pass", "--test-log", testLog, "--quality-log", qualityLog]);
}
function recordCandidate(id, dir) {
  record(id, precheck(dir));
}
assert.throws(() => recordCandidate(first, worktree), /禁止文件/);
git(worktree, ["rm", "--", transientFile]);
git(worktree, ["commit", "-qm", "remove temporary artifact"]);
recordCandidate(first, worktree);
function commitFile(dir, file, contents) {
  write(dir, file, contents);
  git(dir, ["add", "--", file]);
  git(dir, ["commit", "-qm", "change " + file]);
}
commitFile(otherWorktree, "other.js", "module.exports = 3;\n");
recordCandidate(second, otherWorktree);
// Retry the identical commit, so only the attempt can distinguish the two runs.
const old = entry(second);
const testArchive = path.join(project, old.test_log);
const qualityArchive = path.join(project, old.quality_log);
const firstTest = fs.readFileSync(testArchive);
const firstQuality = fs.readFileSync(qualityArchive);
discard(second);
start(second, otherWorktree);
const pending = entry(second);
assert.equal(pending.status, "started");
assert.equal(pending.test_status, "not_run");
assert.equal(pending.quality_status, "not_run");
assert.equal(pending.test_log, null);
assert.equal(pending.quality_log, null);
assert.equal(pending.attempt, old.attempt + 1);
git(otherWorktree, ["merge", "--ff-only", old.candidate_commit]);
const fresh = precheck(otherWorktree);
assert.equal(fresh.candidate, old.candidate_commit);
assert.throws(() => record(second, { ...fresh, testLog: testArchive }), /候选分支/);
assert.throws(() => record(second, { ...fresh, qualityLog: qualityArchive }), /候选分支/);
assert.equal(entry(second).status, "started");
// Resume after the first copy, without overwriting a different archive on retry.
const archiveDir = path.join(project, ".review-evidence", "optimistic", second, "attempt-" + pending.attempt);
fs.mkdirSync(archiveDir, { recursive: true });
fs.copyFileSync(path.join(otherWorktree, fresh.testLog), path.join(archiveDir, "test.log"));
const conflictingLog = path.join(archiveDir, "quality.log");
fs.writeFileSync(conflictingLog, "existing evidence");
assert.throws(() => record(second, fresh), /不同的归档日志/);
assert.equal(fs.readFileSync(conflictingLog, "utf8"), "existing evidence");
assert.equal(entry(second).test_log, null);
fs.unlinkSync(conflictingLog);
record(second, fresh);
for (const [key, source] of [["test_log", fresh.testLog], ["quality_log", fresh.qualityLog]]) {
  assert.notEqual(entry(second)[key], old[key]);
  assert.deepEqual(fs.readFileSync(path.join(project, entry(second)[key])), fs.readFileSync(path.join(otherWorktree, source)));
}
assert.deepEqual(fs.readFileSync(testArchive), firstTest);
assert.deepEqual(fs.readFileSync(qualityArchive), firstQuality);
assert.equal(entry(first).base_commit, entry(second).base_commit);
assert.deepEqual(entry(first).touched_files, ["src.js"]);
assert.throws(() => promote(second), /active_finding/);
promote(first);
assert.equal(git(project, ["show", ":src.js"]), "module.exports = 2;");
git(project, ["commit", "-qm", "land first candidate"]);
discard(first);
assert.equal(entry(first).status, "discarded");
// Seed the completed verification, then use the ordinary transition to the next repair.
findings.findings[0].verification = "pass";
fs.writeFileSync(findingsPath, JSON.stringify(findings));
run(project, ["next-finding"]);
assert.equal(readState().active_finding, second);
const advanced = git(project, ["rev-parse", "HEAD"]);
write(project, "user-work.txt", "in progress\n");
git(project, ["add", "user-work.txt"]);
const dirtyIndex = git(project, ["write-tree"]);
assert.throws(() => promote(second), /主工作树/);
assert.equal(entry(second).status, "candidate_green");
assert.equal(git(project, ["write-tree"]), dirtyIndex);
git(project, ["rm", "-qf", "user-work.txt"]);
findings.findings[1].severity = "P1";
fs.writeFileSync(findingsPath, JSON.stringify(findings));
assert.throws(() => promote(second), /severity/);
assert.equal(entry(second).status, "candidate_green");
assert.equal(git(project, ["diff", "--cached", "--name-only"]), "");
findings.findings[1].severity = "P2";
fs.writeFileSync(findingsPath, JSON.stringify(findings));
promote(second);
assert.equal(entry(second).promotion_head, advanced);
assert.equal(entry(second).status, "promote_pending_commit");
assert.equal(git(project, ["diff", "--cached", "--name-only"]), "other.js");
assert.equal(git(project, ["rev-parse", ":other.js"]), git(otherWorktree, ["rev-parse", "HEAD:other.js"]));
git(project, ["commit", "-qm", "land second candidate"]);
discard(second);

// A clean textual merge in the same file would still change the prechecked patch.
const lines = Array.from({ length: 15 }, (_, index) => "// line " + index + "\n").join("");
commitFile(project, "other.js", lines);
start(second, otherWorktree);
commitFile(otherWorktree, "other.js", lines.replace("line 0", "candidate"));
recordCandidate(second, otherWorktree);
commitFile(project, "other.js", lines.replace("line 14", "main"));
function assertRejected(status) {
  const index = git(project, ["write-tree"]);
  assert.throws(() => promote(second), new RegExp(status));
  assert.equal(entry(second).status, status);
  assert.equal(git(project, ["write-tree"]), index);
  assert.equal(git(project, ["diff", "--name-only"]), "");
  discard(second);
}
assertRejected("stale");

start(second, otherWorktree);
commitFile(otherWorktree, "other.js", "candidate version\n");
recordCandidate(second, otherWorktree);
commitFile(project, "other.js", "main version\n");
assertRejected("conflict");

start(second, otherWorktree);
commitFile(otherWorktree, "independent.js", "module.exports = 4;\n");
recordCandidate(second, otherWorktree);
git(project, ["checkout", "--detach", "-q", "HEAD~1"]);
assertRejected("stale");
console.log("optimistic repair lifecycle passed");
