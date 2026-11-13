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
  "- Full suite composition: unit", "- Focused test command: node test.js", "- Impacted test command: node test.js",
  "- Fast test command: node test.js", "- Fast test profile: none", "- Fast profile semantics: not_applicable",
  "- Long-running test policy: none", "- Long-running test inventory: none", "- Full runtime scale: not_applicable",
  "- Time/volume scaling evidence: not_applicable", "- Code quality command: node --check src.js",
  "- Optimistic repair policy: bounded", "- Optimistic max active worktrees: 1", "- Optimistic eligible severities: P2,P3",
  "- Code quality policy: run before each repair commit", "- Baseline code quality result: pass",
  "- Baseline code quality log: .review-evidence/baseline-quality.log", "- Full test command: node test.js",
  "- Adjacent test command: node --test {test_paths}", "- High-risk paths: none", "- Verification default: impacted",
].join("\n") + "\n";
write(project, ".review-evidence/baseline.md", baseline);
write(project, ".review-evidence/baseline-full.log", "EXIT_CODE=0\n");
write(project, ".review-evidence/baseline-quality.log", "QUALITY_COMMAND=node --check src.js\nEXIT_CODE=0\n");
write(project, "test.js", "process.exit(0);\n");
execFileSync("git", ["add", "test.js"], { cwd: project });
execFileSync("git", ["commit", "-qm", "test: add fixture"], { cwd: project });

const statePath = path.join(project, ".review-evidence/state.json");
const findingsPath = path.join(project, ".review-evidence/findings.json");
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
state.current_phase = "repair";
state.active_finding = "R1-F001-FUNC";
state.optimistic_repairs = [];
fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
const findings = { schema_version: 1, findings: [{
  id: "R1-F001-FUNC", original_ids: ["FUNC-001"], source: "review", audit_attempt: null,
  role: "FUNC", severity: "P2", decision: "accepted", reproduced: true, reproduction_status: "reproduced",
  change_origin: "pre-existing", evidence_dir: ".review-evidence/round-1/R1-F001-FUNC", verification: "pending",
  implementation_status: "none", adjacent_tests: [], test_files: [], commit: null,
}] };
fs.writeFileSync(findingsPath, JSON.stringify(findings, null, 2) + "\n");
run(project, ["render"]);

const worktree = path.join(path.dirname(project), `${path.basename(project)}-candidate`);
write(project, "tests/review/reproductions/r1_f001_fix.test.js", "test\n");
write(project, ".review-evidence/round-1/R1-F001-FUNC/replay-review.md", "replayed\n");
run(project, ["optimistic-start", "--id", "R1-F001-FUNC", "--worktree", worktree, "--risk-assessment", "normal"]);
write(worktree, "src.js", "module.exports = 2;\n");
execFileSync("git", ["add", "src.js"], { cwd: worktree });
execFileSync("git", ["commit", "-qm", "fix(review): candidate"], { cwd: worktree });
const candidate = git(worktree, ["rev-parse", "HEAD"]);
const candidateTree = git(worktree, ["rev-parse", `${candidate}^{tree}`]);
write(worktree, ".review-evidence/candidate-test.log", `COMMAND=node test.js\nTREE_HASH=${candidateTree}\nEXIT_CODE=0\n`);
write(worktree, ".review-evidence/candidate-quality.log", `QUALITY_COMMAND=node --check src.js\nQUALITY_TREE_HASH=${candidateTree}\nEXIT_CODE=0\n`);
run(project, ["optimistic-record", "--id", "R1-F001-FUNC", "--candidate-commit", candidate, "--test-status", "pass", "--quality-status", "pass", "--test-log", ".review-evidence/candidate-test.log", "--quality-log", ".review-evidence/candidate-quality.log"]);
run(project, ["optimistic-promote", "--id", "R1-F001-FUNC"]);
assert.equal(fs.readFileSync(path.join(project, "src.js"), "utf8").replace(/\r/g, ""), "module.exports = 2;\n");
run(project, ["optimistic-discard", "--id", "R1-F001-FUNC"]);
const finalState = JSON.parse(fs.readFileSync(statePath, "utf8"));
assert.equal(finalState.optimistic_repairs[0].status, "discarded");
execFileSync("git", ["reset", "--hard", "-q"], { cwd: project });
console.log("optimistic repair lifecycle passed");
