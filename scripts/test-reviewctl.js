#!/usr/bin/env node

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  isCandidateTestFile,
  isReproductionTestFile,
  isAdjacentTestFile,
  isFormalTestFile,
  verdictIsPass,
} = require("./lib/validate");
const { convergenceReasons } = require("./lib/state");

const CLI = path.join(__dirname, "reviewctl.js");
let passed = 0;
let failed = 0;
const testPolicyFixtures = require('./test-policy-fixtures');
const testPolicy = require("./lib/test-policy");

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reviewctl-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Review Test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "init\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
  return dir;
}

function run(project, args, { expectFail = false } = {}) {
  if (!expectFail && args[0] === "advance" && ["review", "final_audit"].includes(args[args.indexOf("--to") + 1])) {
    const statePath = path.join(project, ".review-evidence/state.json");
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (state.current_phase === "round_decision") {
        const findingsPath = path.join(project, ".review-evidence/findings.json");
        const findings = JSON.parse(fs.readFileSync(findingsPath, "utf8")).findings || [];
        const adjacent = findings.filter((finding) => testPolicy.adjacentRound(finding) === state.current_round && finding.verification === "pass" && (finding.adjacent_tests || []).length > 0);
        if (adjacent.length) {
          const paths = [...new Set(adjacent.flatMap((finding) => finding.adjacent_tests))].sort();
          const command = testPolicy.expandAdjacentCommand("node --test {test_paths}", paths);
          const log = `.review-evidence/round-${state.current_round}/adjacent-auto.log`;
          write(project, log, `COMMAND=${command}\nEXIT_CODE=0\n`);
          const tree = testPolicyFixtures.git(project, ["rev-parse", "HEAD^{tree}"]);
          const testedCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" }).trim();
          execFileSync(process.execPath, [CLI, "record-adjacent-batch", "--status", "pass", "--command", command, "--exit-status", "0", "--tree-hash", tree, "--tested-commit", testedCommit, "--log", log, "--test-count", String(paths.length), "--failed-count", "0", "--project", project], { cwd: project, stdio: "ignore" });
        }
        const allPaths = testPolicy.adjacentTestPaths({ findings }, state.current_round, state.adjacent_promotions || [], state);
        if (args[args.indexOf("--to") + 1] === "final_audit" && allPaths.length) {
          const command = testPolicy.expandAdjacentCommand("node --test {test_paths}", allPaths);
          const log = `.review-evidence/final-adjacent-${state.final_audit_attempt + 1}-${Date.now()}.log`;
          write(project, log, `COMMAND=${command}\nEXIT_CODE=0\n`);
          execFileSync(process.execPath, [CLI, "record-final-adjacent-batch", "--attempt", String(state.final_audit_attempt + 1), "--status", "pass", "--command", command, "--exit-status", "0", "--tree-hash", testPolicy.gitTree(project, "HEAD"), "--tested-commit", testPolicyFixtures.git(project, ["rev-parse", "HEAD"]), "--log", log, "--test-count", String(allPaths.length), "--failed-count", "0", "--project", project], { cwd: project, stdio: "ignore" });
        }
      }
    }
  }
  if (args[0] === "record-finding" && !expectFail) {
    const id = String(args[args.indexOf("--id") + 1]).toUpperCase();
    const evidenceArg = args.indexOf("--evidence-dir");
    const evidence = evidenceArg >= 0
      ? args[evidenceArg + 1]
      : `.review-evidence/round-${id.match(/^R(\d+)-/)?.[1]}/${id}`;
    const replayPath = path.join(project, evidence, "replay-review.md");
    const testCandidate = fs.existsSync(path.join(project, evidence, "reproduce.test.js"))
      ? "reproduce.test.js"
      : "manual-steps.md";
    const testPath = path.join(project, evidence, testCandidate);
    if (fs.existsSync(replayPath) && fs.existsSync(testPath)) {
      execFileSync("git", ["add", "-f", "--", path.relative(project, testPath)], { cwd: project });
      let stagedChanges = false;
      try {
        execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: project, stdio: "ignore" });
      } catch {
        stagedChanges = true;
      }
      if (stagedChanges) {
        execFileSync("git", ["commit", "-qm", `test(review): record replay fixture ${id}`], { cwd: project });
      }
      const commit = testPolicyFixtures.git(project, ["rev-parse", "HEAD"]);
      const replayEvidence = {
        schema_version: 1,
        tested_commit: commit,
        tested_tree_hash: testPolicyFixtures.git(project, ["rev-parse", "HEAD^{tree}"]),
        test_path: path.relative(project, testPath).replace(/\\/g, "/"),
        test_sha256: testPolicy.sha256GitFile(project, commit, path.relative(project, testPath).replace(/\\/g, "/")),
        command: "node --test reproduction",
        exit_status: 0,
      };
      write(project, `${evidence}/replay-review.md`, `# Replay Review\n\n**Status**: reproduced\n\n## Reviewctl Replay Evidence\n\n\`\`\`json\n${JSON.stringify(replayEvidence, null, 2)}\n\`\`\`\n`);
    }
  }
  if (!expectFail && args[0] === 'record-implementation' && args.includes('fixed')) {
    const id = String(args[args.indexOf('--id') + 1]).toUpperCase();
    const commit = args[args.indexOf('--commit') + 1];
    const items = JSON.parse(fs.readFileSync(path.join(project, '.review-evidence/findings.json'), 'utf8')).findings;
    const finding = items.find((item) => item.id === id);
    testPolicyFixtures.writeGreenEvidence(project, finding.evidence_dir, testPolicyFixtures.git(project, ['rev-parse', commit + '^{tree}']));
  }
  if (!expectFail && args[0] === 'record-verification' && args.includes('pass')) {
    const id = String(args[args.indexOf('--id') + 1]).toUpperCase();
    const items = JSON.parse(fs.readFileSync(path.join(project, '.review-evidence/findings.json'), 'utf8')).findings;
    const finding = items.find((item) => item.id === id);
    testPolicyFixtures.writeVerificationEvidence(project, finding.evidence_dir, finding);
  }
  let output;
  try {
    output = execFileSync(
      process.execPath,
      [CLI, ...args, "--project", project],
      { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (error) {
    if (expectFail) return error;
    const stderr = error.stderr ? String(error.stderr) : "";
    const stdout = error.stdout ? String(error.stdout) : "";
    error.message = `command failed: reviewctl ${args.join(" ")}\n${stdout}${stderr}`;
    throw error;
  }
  if (expectFail) throw new Error(`expected failure: ${args.join(" ")}`);
  return output;
}

function assertCommandFails(project, args) {
  let didFail = false;
  try {
    execFileSync(process.execPath, [CLI, ...args, "--project", project], {
      cwd: project,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    didFail = true;
  }
  assert.equal(didFail, true, `expected command to fail: reviewctl ${args.join(" ")}`);
}

function write(project, relative, content) {
  const absolute = path.join(project, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
}

function writeJson(project, relative, value) {
  write(project, relative, JSON.stringify(value, null, 2) + "\n");
}

function roleSlug(role) {
  return {
    SEC: "security",
    FUNC: "functionality",
    REL: "reliability",
    API: "api",
    PERF: "performance",
    UX: "accessibility",
    OPS: "operations",
    PROD: "product",
  }[role];
}

function writeHandoff(project, round, role, tempId, findings = []) {
  writeJson(
    project,
    `.review-evidence/round-${round}/inbox/${roleSlug(role)}/${tempId}/meta.json`,
    {
      round,
      role,
      role_slug: roleSlug(role),
      temp_id: tempId,
      created_at: new Date().toISOString(),
    }
  );
  writeJson(
    project,
    `.review-evidence/round-${round}/inbox/${roleSlug(role)}/${tempId}/handoff.json`,
    {
      review_status: "complete",
      round: String(round),
      role_slug: roleSlug(role),
      scope_checked: "test scope",
      commands: [],
      findings,
      blockers: [],
      uncovered_paths: [],
    }
  );
}

function init(project, maxRounds = 2) {
  run(project, [
    "init",
    "--max-rounds",
    String(maxRounds),
    "--user-confirmed",
  ]);
  write(
    project,
    ".review-evidence/baseline.md",
    "# Review Baseline\n\n## MVP Scope\n- Included: test\n- Explicitly excluded: none\n\n## Verification\n- Unit: node test\n"
  );
  testPolicyFixtures.writeBaseline(project);
}

function addRoundHandoffs(project, round) {
  writeHandoff(project, round, "SEC", `SEC-00${round}`);
  writeHandoff(project, round, "FUNC", `FUNC-00${round}`);
  writeHandoff(project, round, "REL", `REL-00${round}`);
}

function addCandidate(project, round, original, severity = "P2") {
  const role = original.split("-")[0];
  const evidence = `.review-evidence/round-${round}/inbox/${roleSlug(role)}/${original}`;
  write(project, `${evidence}/counterexample.md`, "# Candidate accounting fixture\n");
  writeHandoff(project, round, role, original, [{
    finding_id: original, severity, kind: "defect", confidence: "high",
    claim: "Synthetic lifecycle accounting fixture", evidence_dir: evidence,
    counterexample_file: `${evidence}/counterexample.md`, reproduction_file: "none",
    reproduction_status: "not_observed",
  }]);
}

function recordRejectedCandidate(project, round, number, originals) {
  const role = originals[0].split("-")[0];
  const id = `R${round}-F${String(number).padStart(3, "0")}-${role}`;
  const evidence = `.review-evidence/round-${round}/${id}`;
  write(project, `${evidence}/counterexample.md`, "# Counterexample\n");
  write(project, `${evidence}/adjudication.md`, "# Adjudication\n\n## Decision\n**Status**: rejected\n");
  write(project, `${evidence}/replay-review.md`, "# Replay Review\nNot reproduced.\n");
  write(project, `${evidence}/reproduce.test.js`, "// Accounting fixture reproduction\n");
  run(project, ["record-finding", "--id", id, "--role", role,
    ...originals.flatMap((original) => ["--original-id", original]),
    "--severity", "P2", "--decision", "rejected", "--reproduced", "false",
    "--reproduction-status", "not-reproduced", "--change-origin", "pre-existing"]);
  return id;
}

function setupAcceptedFinding(project, { id, role, original, severity, slug }) {
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
  addCandidate(project, 1, original, severity);
  run(project, ["record-round", "--round", "1", "--raw", "1", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "1"]);
  run(project, ["advance", "--to", "adjudication"]);
  const evidence = `.review-evidence/round-1/${id}`;
  write(project, `${evidence}/counterexample.md`, "# Counterexample\n");
  write(project, `${evidence}/adjudication.md`, "# Adjudication\n\n## Decision\n**Status**: accepted\n");
  write(project, `${evidence}/replay-review.md`, "# Replay Review\n\n**Status**: reproduced\n");
  write(project, `${evidence}/reproduce.test.js`, "// repro\n");
  write(project, `tests/review/reproductions/${slug}.test.js`, "// formal repro\n");
  const args = [
    "record-finding", "--id", id, "--role", role, "--original-id", original,
    "--severity", severity, "--decision", "accepted", "--reproduced", "true",
    "--reproduction-status", "reproduced", "--evidence-dir", evidence,
    "--change-origin", "pre-existing",
  ];
  if (["P0", "P1"].includes(severity)) {
    args.push("--challenge-required", "true", "--challenge-result", "supports");
  }
  run(project, args);
  return evidence;
}

function setupDeferredFinding(project, { id = "R1-F001-PERF", role = "PERF", original = "PERF-001", severity = "P2", slug = "perf" } = {}) {
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
  addCandidate(project, 1, original, severity);
  run(project, ["record-round", "--round", "1", "--raw", "1", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", severity === "P3" ? "0" : "1"]);
  run(project, ["advance", "--to", "adjudication"]);
  const evidence = `.review-evidence/round-1/${id}`;
  write(project, `${evidence}/counterexample.md`, "# Counterexample\n");
  write(project, `${evidence}/adjudication.md`, "# Adjudication\n\n## Decision\n**Status**: deferred\n");
  write(project, `${evidence}/replay-review.md`, "# Replay Review\n\n**Status**: reproduced\n");
  write(project, `${evidence}/reproduce.test.js`, "// repro\n");
  const args = [
    "record-finding", "--id", id, "--role", role, "--original-id", original,
    "--severity", severity, "--decision", "deferred", "--reproduced", "true",
    "--reproduction-status", "reproduced", "--evidence-dir", evidence,
    "--change-origin", "pre-existing", "--deferred-reason", "limited repair capacity",
    "--disposition-plan", "address in the next release",
  ];
  run(project, args);
  run(project, ["advance", "--to", "round_decision"]);
  return { evidence, args, slug };
}

function startAdjudication(project, round) {
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, round);
  run(project, ["record-round", "--round", String(round), "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
  run(project, ["advance", "--to", "adjudication"]);
}

function setupTwoCleanRounds(project) {
  init(project, 2);
  for (const round of [1, 2]) {
    run(project, ["advance", "--to", "review"]);
    addRoundHandoffs(project, round);
    run(project, ["record-round", "--round", String(round), "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
    run(project, ["advance", "--to", "adjudication"]);
    run(project, ["advance", "--to", "round_decision"]);
  }
  run(project, ["advance", "--to", "final_audit"]);
}

function test(name, fn) {
  if (process.env.REVIEWCTL_TEST_FILTER && !name.includes(process.env.REVIEWCTL_TEST_FILTER)) return;
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error.message);
  }
}

// FUNC-001: every raw candidate must have exactly one accounted disposition.
test("validate rejects replay evidence when its reproduction file hash changes", () => {
  const project = makeProject();
  init(project);
  const evidence = setupAcceptedFinding(project, {
    id: "R1-F001-SEC", role: "SEC", original: "SEC-001", severity: "P2",
    slug: "r1_f001_replay_hash",
  });
  write(project, `${evidence}/reproduce.test.js`, "// altered after replay\n");
  const result = run(project, ["validate"], { expectFail: true });
  assert.match(String(result.stderr) + String(result.stdout), /replay 测试文件 SHA-256 不匹配/);
});

test("an inconclusive adjacent batch permits final audit but cannot converge", () => {
  const state = {
    current_phase: "report",
    rounds_consumed: 2,
    final_audit_attempt: 1,
    final_audit: { attempts: [{ attempt: 1, status: "complete", new_issues: 0 }], reentry_pending: false },
  };
  const finding = {
    id: "R1-F001-SEC", severity: "P2", decision: "accepted", verification: "pass",
    implementation_status: "fixed", commit: "abcdef1", test_files: ["tests/app.test.js"],
    adjacent_tests: ["tests/review/verifications/r1_f001_sec_adjacent.test.js"],
    adjacent_status: "inconclusive", reproduced: true, reproduction_status: "reproduced",
    change_origin: "pre-existing", original_ids: ["SEC-001"],
    evidence_dir: ".review-evidence/round-1/R1-F001-SEC", source: "review", manual: false,
  };
  const { convergenceReasons } = require("./lib/state");
  const reasons = convergenceReasons(state, { max_rounds: 2 }, { findings: [finding] }, "converged", { ackEmptyCoverage: true });
  assert.ok(reasons.some((reason) => /相邻测试批量验证尚未通过/.test(reason)));
});

test("reviewctl no longer accepts the removed merged-test argument", () => {
  const project = makeProject();
  init(project);
  const output = run(project, ["help"]);
  assert.doesNotMatch(output, /--merged-test/);
});

test("FUNC-001 blocks omitted candidates at the regular round boundary", () => {
  const project = makeProject();
  init(project);
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
  addCandidate(project, 1, "FUNC-001");
  addCandidate(project, 1, "FUNC-002");
  run(project, ["record-round", "--round", "1", "--raw", "2", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
  run(project, ["advance", "--to", "adjudication"]);
  recordRejectedCandidate(project, 1, 1, ["FUNC-001"]);
  const failure = run(project, ["advance", "--to", "round_decision"], { expectFail: true });
  assert.match(String(failure.stderr), /candidate accounting.*FUNC-002/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, ".review-evidence/state.json"))).current_phase, "adjudication");
  recordRejectedCandidate(project, 1, 2, ["FUNC-002"]);
  run(project, ["advance", "--to", "round_decision"]);
  run(project, ["validate"]);
});

test("FUNC-001 reconciles identities, exclusions, duplicate mappings and counts", () => {
  const { validateRoundCandidates } = require("./lib/validate");
  const project = makeProject();
  init(project);
  addRoundHandoffs(project, 1);
  for (const original of ["FUNC-001", "FUNC-002", "SEC-001", "REL-001"]) addCandidate(project, 1, original);
  const entry = { round: 1, raw_candidates: 4, duplicates: 2, screened_out: 1, replay_eligible: 1 };
  const data = { findings: [{ id: "R1-F001-FUNC", source: "review", original_ids: ["FUNC-001", "FUNC-002"] }] };
  const exclusions = [
    { original_id: "SEC-001", disposition: "duplicate", canonical_id: "R1-F001-FUNC", reason: "Same root cause" },
    { original_id: "REL-001", disposition: "screened_out_scope", reason: "Outside explicit MVP contract" },
  ];
  const check = () => {
    const errors = [];
    validateRoundCandidates(project, entry, data, errors);
    return errors.join("; ");
  };
  writeJson(project, ".review-evidence/round-1/screening.json", exclusions);
  assert.equal(check(), "");
  // Same-role duplicates can also be explicitly documented without double counting.
  exclusions.push({ original_id: "FUNC-002", disposition: "duplicate", canonical_id: "R1-F001-FUNC", reason: "Same claim" });
  writeJson(project, ".review-evidence/round-1/screening.json", exclusions);
  assert.equal(check(), "");
  for (const key of ["raw_candidates", "duplicates", "screened_out", "replay_eligible"]) {
    entry[key] += 1;
    assert.match(check(), new RegExp(key));
    entry[key] -= 1;
  }
  exclusions[2].canonical_id = "R1-F999-FUNC";
  writeJson(project, ".review-evidence/round-1/screening.json", exclusions);
  assert.match(check(), /canonical/);
  exclusions[2].canonical_id = "R1-F001-FUNC";
  exclusions[2].disposition = "screened_out_scope";
  writeJson(project, ".review-evidence/round-1/screening.json", exclusions);
  assert.match(check(), /FUNC-002/);
  exclusions.pop();
  exclusions.push({ original_id: "FUNC-999", disposition: "screened_out_scope", reason: "Invented candidate" });
  writeJson(project, ".review-evidence/round-1/screening.json", exclusions);
  assert.match(check(), /FUNC-999/);
  exclusions.pop();
  writeJson(project, ".review-evidence/round-1/screening.json", exclusions);
  data.findings[0].original_ids.push("FUNC-999");
  assert.match(check(), /FUNC-999/);
  data.findings[0].original_ids.pop();
  data.findings.push({ id: "R1-F002-FUNC", source: "review", original_ids: ["FUNC-001"] });
  assert.match(check(), /FUNC-001/);
  data.findings.pop();
  // Prior deferred and audit findings have independent accounting scopes.
  data.findings.push({ id: "R2-F001-FUNC", source: "review", original_ids: ["FUNC-001"], decision: "deferred" });
  data.findings.push({ id: "R1-F003-FUNC", source: "final-audit", original_ids: ["FA-001"] });
  assert.equal(check(), "");
  // Canonical directories retain handoffs when evidence is moved out of inbox.
  const moved = path.join(project, ".review-evidence/round-1/R1-F001-FUNC");
  fs.renameSync(path.join(project, ".review-evidence/round-1/inbox/functionality/FUNC-001"), moved);
  const movedHandoff = JSON.parse(fs.readFileSync(path.join(moved, "handoff.json")));
  movedHandoff.findings[0].evidence_dir = ".review-evidence/round-1/R1-F001-FUNC";
  movedHandoff.findings[0].counterexample_file = ".review-evidence/round-1/R1-F001-FUNC/counterexample.md";
  writeJson(project, ".review-evidence/round-1/R1-F001-FUNC/handoff.json", movedHandoff);
  assert.equal(check(), "");
});

test("FUNC-001 completed rounds are rechecked by validate and finalize", () => {
  const project = makeProject();
  setupTwoCleanRounds(project);
  const audit = ".review-evidence/round-2/final-audit/attempt-1";
  write(project, `${audit}/blind-scan.md`, "# Blind Scan\n");
  write(project, `${audit}/targeted-review.md`, "# Targeted Review\n");
  run(project, ["record-audit", "--attempt", "1", "--status", "complete", "--new-issues", "0", "--auditor", "independent-auditor"]);
  run(project, ["advance", "--to", "report"]);
  run(project, ["finalize", "--status", "converged", "--ack-empty-coverage"]);
  addCandidate(project, 1, "FUNC-099");
  for (const args of [["validate"], ["finalize", "--status", "converged", "--ack-empty-coverage"]]) {
    const failure = run(project, args, { expectFail: true });
    assert.match(String(failure.stderr || failure.stdout), /candidate accounting/);
  }
});

test("FUNC-001 preserves batched handoffs copied into canonical evidence", () => {
  const { validateRoundCandidates } = require("./lib/validate");
  const project = makeProject();
  init(project);
  addCandidate(project, 1, "FUNC-001");
  const inbox = ".review-evidence/round-1/inbox/functionality/FUNC-001";
  const batch = JSON.parse(fs.readFileSync(path.join(project, inbox, "handoff.json")));
  batch.findings.push({ ...batch.findings[0], finding_id: "FUNC-002" });
  writeJson(project, `${inbox}/handoff.json`, batch);
  const data = { findings: [
    { id: "R1-F001-FUNC", role: "FUNC", original_ids: ["FUNC-001"] },
    { id: "R1-F002-FUNC", role: "FUNC", original_ids: ["FUNC-002"] },
  ] };
  const round = { round: 1, raw_candidates: 2, duplicates: 0, screened_out: 0, replay_eligible: 2 };
  for (const finding of data.findings) writeJson(project, `.review-evidence/round-1/${finding.id}/handoff.json`, batch);
  const check = () => {
    const errors = [];
    validateRoundCandidates(project, round, data, errors);
    return errors.join("; ");
  };
  assert.equal(check(), "");
  // Agents may save their complete batch response in each candidate inbox.
  writeHandoff(project, 1, "FUNC", "FUNC-002", batch.findings);
  assert.equal(check(), "");
  // Removing only the original handoff exercises recovery from retained copies.
  fs.unlinkSync(path.join(project, inbox, "handoff.json"));
  assert.equal(check(), "");
  batch.findings[0].claim = "Conflicting copy";
  writeJson(project, ".review-evidence/round-1/R1-F002-FUNC/handoff.json", batch);
  assert.match(check(), /FUNC-001.*矛盾/);
});

test("OPS-001 permits documented candidate promotion without losing evidence", () => {
  const project = makeProject();
  init(project);
  const id = "R1-F001-FUNC";
  const evidence = setupAcceptedFinding(project, {
    id, role: "FUNC", original: "FUNC-001", severity: "P2", slug: "r1_f001_promoted",
  });
  const inbox = ".review-evidence/round-1/inbox/functionality/FUNC-001";
  const candidate = "tests/review/candidates/r1_func_001.test.js";
  const handoff = JSON.parse(fs.readFileSync(path.join(project, inbox, "handoff.json")));
  handoff.findings[0].reproduction_file = candidate;
  writeJson(project, `${inbox}/handoff.json`, handoff);
  write(project, candidate, "// durable reproduction\n");
  run(project, ["validate"]);
  fs.renameSync(path.join(project, candidate), path.join(project, "tests/review/reproductions/r1_f001_promoted.test.js"));
  run(project, ["validate"]);
  run(project, ["advance", "--to", "repair"]);
  const promoted = path.join(project, "tests/review/reproductions/r1_f001_promoted.test.js");
  fs.unlinkSync(promoted);
  assert.match(String(run(project, ["validate"], { expectFail: true }).stderr), /复现测试/);
  fs.writeFileSync(promoted, "// durable reproduction\n");
  fs.unlinkSync(path.join(project, evidence, "reproduce.test.js"));
  assert.match(String(run(project, ["validate"], { expectFail: true }).stderr), /reproduce|reproduction_file/);
});

test("OPS-001 permits adjudicated rejected candidate deletion but rejects lost provenance", () => {
  const project = makeProject();
  init(project);
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
  addCandidate(project, 1, "FUNC-001");
  const inbox = ".review-evidence/round-1/inbox/functionality/FUNC-001";
  const candidate = "tests/review/candidates/r1_func_001.test.js";
  const handoff = JSON.parse(fs.readFileSync(path.join(project, inbox, "handoff.json")));
  handoff.findings[0].reproduction_file = candidate;
  writeJson(project, `${inbox}/handoff.json`, handoff);
  write(project, candidate, "// candidate\n");
  run(project, ["record-round", "--round", "1", "--raw", "1", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
  run(project, ["advance", "--to", "adjudication"]);
  const id = recordRejectedCandidate(project, 1, 1, ["FUNC-001"]);
  fs.unlinkSync(path.join(project, candidate));
  run(project, ["advance", "--to", "round_decision"]);
  run(project, ["validate"]);
  fs.unlinkSync(path.join(project, `.review-evidence/round-1/${id}/reproduce.test.js`));
  const failure = run(project, ["validate"], { expectFail: true });
  assert.match(String(failure.stderr), /reproduction_file|reproduce/);
});

test("FUNC-002 preserves the repair limit through re-adjudication", () => {
  const project = makeProject();
  init(project);
  const id = "R1-F001-FUNC";
  const evidence = setupAcceptedFinding(project, { id, role: "FUNC", original: "FUNC-001", severity: "P2", slug: "r1_f001_retry" });
  write(project, `${evidence}/implementation-result.md`, "# Manual implementation\nRED GREEN\n");
  write(project, `${evidence}/verification-result.md`, "# Manual verification\n**Final Verdict**: fail\n");
  run(project, ["advance", "--to", "repair"]);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) run(project, ["advance", "--to", "repair"]);
    run(project, ["record-implementation", "--id", id, "--status", "already_fixed", "--manual"]);
    run(project, ["advance", "--to", "verification"]);
    run(project, ["record-verification", "--id", id, "--status", "fail"]);
  }
  run(project, ["advance", "--to", "repair"], { expectFail: true });
  run(project, ["advance", "--to", "adjudication"]);
  run(project, ["advance", "--to", "repair"], { expectFail: true });
  run(project, ["record-finding", "--id", id, "--role", "FUNC", "--original-id", "FUNC-001", "--severity", "P2",
    "--decision", "accepted", "--reproduced", "true", "--reproduction-status", "reproduced", "--change-origin", "pre-existing"]);
  const finding = JSON.parse(fs.readFileSync(path.join(project, ".review-evidence/findings.json"))).findings[0];
  assert.equal(finding.verification_attempts, 2);
  run(project, ["advance", "--to", "repair"], { expectFail: true });
  run(project, ["mark-unresolved", "--id", id, "--reason", "Two attempts exhausted"]);
  run(project, ["advance", "--to", "round_decision"]);
});

test("FUNC-002 skips exhausted findings when selecting the next repair", () => {
  const project = makeProject();
  init(project);
  const id = "R1-F001-FUNC";
  const evidence = setupAcceptedFinding(project, { id, role: "FUNC", original: "FUNC-001", severity: "P2", slug: "r1_f001_retry" });
  write(project, `${evidence}/implementation-result.md`, "# Manual implementation\nRED GREEN\n");
  write(project, `${evidence}/verification-result.md`, "# Manual verification\n**Final Verdict**: fail\n");
  run(project, ["advance", "--to", "repair"]);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) run(project, ["advance", "--to", "repair"]);
    run(project, ["record-implementation", "--id", id, "--status", "already_fixed", "--manual"]);
    run(project, ["advance", "--to", "verification"]);
    run(project, ["record-verification", "--id", id, "--status", "fail"]);
  }
  run(project, ["advance", "--to", "adjudication"]);
  const second = "R1-F002-FUNC";
  const secondEvidence = `.review-evidence/round-1/${second}`;
  addCandidate(project, 1, "FUNC-002");
  for (const name of ["counterexample.md", "adjudication.md", "replay-review.md", "reproduce.test.js", "implementation-result.md"]) {
    write(project, `${secondEvidence}/${name}`, fs.readFileSync(path.join(project, evidence, name), "utf8"));
  }
  write(project, "tests/review/reproductions/r1_f002_retry.test.js", "// second reproduction\n");
  run(project, ["record-finding", "--id", second, "--role", "FUNC", "--original-id", "FUNC-002", "--severity", "P2",
    "--decision", "accepted", "--reproduced", "true", "--reproduction-status", "reproduced", "--change-origin", "pre-existing"]);
  run(project, ["advance", "--to", "repair"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, ".review-evidence/state.json"))).active_finding, second);
  run(project, ["record-implementation", "--id", second, "--status", "blocked", "--reason", "dependency missing"]);
  run(project, ["next-finding"], { expectFail: true });
  run(project, ["mark-unresolved", "--id", id, "--reason", "repair budget exhausted"]);
  run(project, ["advance", "--to", "adjudication"]);
  run(project, ["record-round", "--round", "1", "--raw", "2", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "2"]);
  run(project, ["advance", "--to", "round_decision"]);
});

test("init records max_rounds and generated views", () => {
  const project = makeProject();
  const output = run(project, [
    "init",
    "--max-rounds",
    "3",
    "--user-confirmed",
  ]);
  assert.match(output, /init/i);
  const config = JSON.parse(
    fs.readFileSync(path.join(project, ".review-evidence/review-config.json"), "utf8")
  );
  assert.equal(config.max_rounds, 3);
  assert.equal(config.confirmed_by_user, true);
  assert.ok(fs.existsSync(path.join(project, ".review-evidence/state.json")));
  assert.ok(fs.existsSync(path.join(project, ".review-evidence/findings.json")));
  assert.ok(fs.existsSync(path.join(project, ".review-evidence/run-state.md")));
  const baseline = fs.readFileSync(path.join(project, ".review-evidence/baseline.md"), "utf8");
  assert.match(baseline, /Test Scope \/ Regression Policy/);
  assert.match(baseline, /Tiering mode/);
  assert.match(baseline, /Baseline full result/);
  assert.match(baseline, /Expected test count/);
  assert.match(baseline, /Full suite composition/);
  assert.match(baseline, /Feature matrix/);
  assert.match(baseline, /Full test command/);
  assert.match(baseline, /High-risk paths/);
  fs.unlinkSync(path.join(project, ".review-evidence/review-config.json"));
  run(project, ["init", "--max-rounds", "2", "--user-confirmed"], { expectFail: true });
});

test("code quality policy requires a baseline result and GREEN evidence tied to the repair tree", () => {
  const project = makeProject();
  testPolicyFixtures.writeBaseline(project);
  const baselinePath = path.join(project, ".review-evidence/baseline.md");
  let baseline = fs.readFileSync(baselinePath, "utf8");
  baseline = baseline
    .replace("Code quality command: not_applicable: no formatter or linter applies to synthetic fixture", "Code quality command: cargo fmt --all -- --check && cargo clippy --workspace --all-targets --all-features -- -D warnings")
    .replace("Code quality policy: run the declared formatter/linter before each repair commit; no tool applies to this fixture", "Code quality policy: run formatter and linter before each repair commit")
    .replace("Baseline code quality result: not_applicable", "Baseline code quality result: pass")
    .replace("Baseline code quality log: not_applicable", "Baseline code quality log: .review-evidence/baseline-quality.log");
  fs.writeFileSync(baselinePath, baseline);
  const qualityCommand = "cargo fmt --all -- --check && cargo clippy --workspace --all-targets --all-features -- -D warnings";
  write(project, ".review-evidence/baseline-quality.log", `QUALITY_COMMAND=${qualityCommand}\nEXIT_CODE=0\n`);
  let parsed = testPolicy.parseBaselinePolicy(project);
  assert.deepEqual(parsed.errors, []);

  const tree = testPolicy.gitTree(project, "HEAD");
  const log = ".review-evidence/round-1/R1-F001-FUNC/output-quality.log";
  write(project, log, `QUALITY_COMMAND=${qualityCommand}\nEXIT_CODE=0\n`);
  const evidence = {
    status: "pass", command: qualityCommand, exit_status: 0,
    tree_hash_before: tree, tree_hash_after: tree,
    run_location: "main-workspace", workspace_clean_before: true, workspace_clean_after: true,
    log,
  };
  assert.deepEqual(testPolicy.validateQualityRun(project, evidence, parsed.policy, "GREEN quality evidence", tree), []);
  assert.match(testPolicy.validateQualityRun(project, { ...evidence, exit_status: 1 }, parsed.policy, "GREEN quality evidence", tree).join("; "), /exit_status/);
  assert.match(testPolicy.validateQualityRun(project, { ...evidence, tree_hash_after: "f".repeat(40) }, parsed.policy, "GREEN quality evidence", tree).join("; "), /tree hash/);
  write(project, log, `QUALITY_COMMAND=${qualityCommand}\nEXIT_CODE=1\n`);
  assert.match(testPolicy.validateQualityRun(project, evidence, parsed.policy, "GREEN quality evidence", tree).join("; "), /EXIT_CODE=0/);
});

test("expectFail distinguishes successful commands and preserves failure diagnostics", () => {
  const project = makeProject();
  const failure = run(project, ["init", "--max-rounds", "2"], { expectFail: true });
  assert.notEqual(failure.status, 0);
  assert.ok("stdout" in failure);
  assert.ok("stderr" in failure);
  assert.notEqual(String(failure.stderr), "");

  assert.throws(
    () => run(project, ["init", "--max-rounds", "2", "--user-confirmed"], { expectFail: true }),
    /expected failure: init/
  );
});

test("init refuses missing user confirmation or invalid max_rounds", () => {
  const project = makeProject();
  run(project, ["init", "--max-rounds", "3"], { expectFail: true });
  run(project, ["init", "--max-rounds", "1", "--user-confirmed"], {
    expectFail: true,
  });
  run(project, ["init", "--max-rounds", "3", "--user-confirmed", "false"], {
    expectFail: true,
  });
});

test("illegal phase transition is rejected", () => {
  const project = makeProject();
  init(project);
  run(project, ["advance", "--to", "review"]);
  run(project, ["advance", "--to", "repair"], { expectFail: true });
});

test("new-inbox creates the canonical path and rejects bad ids", () => {
  const project = makeProject();
  init(project);
  run(project, ["advance", "--to", "review"]);
  run(project, [
    "new-inbox",
    "--round",
    "1",
    "--role",
    "SEC",
    "--temp-id",
    "SEC-001",
  ]);
  assert.ok(
    fs.existsSync(
      path.join(
        project,
        ".review-evidence/round-1/inbox/security/SEC-001/meta.json"
      )
    )
  );
  run(
    project,
    ["new-inbox", "--round", "1", "--role", "SEC", "--temp-id", "BAD-001"],
    { expectFail: true }
  );
});

test("review to adjudication needs three role handoffs", () => {
  const project = makeProject();
  init(project);
  run(project, ["advance", "--to", "review"]);
  run(project, ["advance", "--to", "adjudication"], { expectFail: true });
  addRoundHandoffs(project, 1);
  run(project, [
    "record-round",
    "--round",
    "1",
    "--raw",
    "3",
    "--duplicates",
    "0",
    "--screened",
    "0",
    "--new-p0p1p2",
    "1",
  ]);
  run(project, ["advance", "--to", "adjudication"]);
});

test("accepted finding requires evidence before it is recorded", () => {
  const project = makeProject();
  init(project);
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
  run(project, [
    "record-round",
    "--round",
    "1",
    "--raw",
    "1",
    "--duplicates",
    "0",
    "--screened",
    "0",
    "--new-p0p1p2",
    "1",
  ]);
  run(project, ["advance", "--to", "adjudication"]);

  const findingArgs = [
    "record-finding",
    "--id",
    "R1-F001-SEC",
    "--role",
    "SEC",
    "--original-id",
    "SEC-001",
    "--severity",
    "P1",
    "--decision",
    "accepted",
    "--reproduced",
    "true",
    "--reproduction-status",
    "reproduced",
    "--evidence-dir",
    ".review-evidence/round-1/R1-F001-SEC",
    "--challenge-required",
    "true",
    "--challenge-result",
    "supports",
    "--change-origin",
    "pre-existing",
  ];
  run(project, findingArgs, { expectFail: true });

  write(project, ".review-evidence/round-1/R1-F001-SEC/counterexample.md", "# Counterexample\n");
  write(project, ".review-evidence/round-1/R1-F001-SEC/adjudication.md", "# Adjudication\n\n## Scope & Contract Check\nok\n\n## Decision\n**Status**: accepted\n");
  write(project, ".review-evidence/round-1/R1-F001-SEC/reproduce.test.js", "// repro\n");
  write(project, "tests/review/reproductions/r1_f001_auth_bypass.test.js", "// formal repro\n");
  run(project, findingArgs, { expectFail: true });

  write(project, ".review-evidence/round-1/R1-F001-SEC/replay-review.md", "# Replay Review\n\n**Status**: reproduced\n");
  const noOriginArgs = [];
  for (let index = 0; index < findingArgs.length; index += 1) {
    if (findingArgs[index] === "--change-origin") {
      index += 1;
      continue;
    }
    noOriginArgs.push(findingArgs[index]);
  }
  run(project, noOriginArgs, { expectFail: true });
  run(project, findingArgs);
  run(project, ["advance", "--to", "repair"]);
});

test("adjudication can revise current-round counts after a P3 candidate is upgraded to deferred P2", () => {
  const project = makeProject();
  init(project, 2);
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
  addCandidate(project, 1, "FUNC-001", "P3");
  run(project, ["record-round", "--round", "1", "--raw", "1", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
  run(project, ["advance", "--to", "adjudication"]);

  const evidence = ".review-evidence/round-1/R1-F001-FUNC";
  write(project, `${evidence}/counterexample.md`, "# Counterexample\\n");
  write(project, `${evidence}/adjudication.md`, "# Adjudication\\n\\n## Decision\\n**Status**: deferred\\n");
  write(project, `${evidence}/replay-review.md`, "# Replay Review\\n\\n**Status**: reproduced\\n");
  write(project, `${evidence}/reproduce.test.js`, "// repro\\n");
  const findingArgs = ["record-finding", "--id", "R1-F001-FUNC", "--role", "FUNC", "--original-id", "FUNC-001", "--severity", "P3", "--decision", "deferred", "--reproduced", "true", "--reproduction-status", "reproduced", "--evidence-dir", evidence, "--change-origin", "pre-existing", "--deferred-reason", "limited repair capacity", "--disposition-plan", "address in the next release"];
  run(project, findingArgs);
  findingArgs[findingArgs.indexOf("P3")] = "P2";
  run(project, findingArgs);

  const blockedAdvance = run(project, ["advance", "--to", "round_decision"], { expectFail: true });
  assert.match(String(blockedAdvance.stderr), /record-round 计数/);
  const undercount = run(project, ["record-round", "--round", "1", "--raw", "1", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"], { expectFail: true });
  assert.match(String(undercount.stderr), /小于 findings.json 中的 1/);
  run(project, ["record-round", "--round", "1", "--raw", "1", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "1"]);
  run(project, ["advance", "--to", "round_decision"]);
  const state = JSON.parse(fs.readFileSync(path.join(project, ".review-evidence/state.json"), "utf8"));
  assert.equal(state.current_phase, "round_decision");
  assert.equal(state.rounds[0].new_in_scope_p0p1p2, 1);
  const completedRoundEdit = run(project, ["record-round", "--round", "1", "--raw", "1", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"], { expectFail: true });
  assert.match(String(completedRoundEdit.stderr), /只能在 review 或 adjudication/);
  run(project, ["validate"]);
});

test("prior-round deferred must be reviewed before leaving adjudication", () => {
  const project = makeProject();
  init(project, 3);
  const { args } = setupDeferredFinding(project);
  startAdjudication(project, 2);

  const blocked = run(project, ["advance", "--to", "round_decision"], { expectFail: true });
  assert.match(String(blocked.stderr), /deferred.*复核|复核.*deferred/i);

  const missing = run(project, args, { expectFail: true });
  assert.match(String(missing.stderr), /deferred-review/);

  run(project, [
    ...args,
    "--deferred-review-action", "continue",
    "--deferred-review-reason", "still deferred this round",
  ]);
  run(project, ["advance", "--to", "round_decision"]);

  const data = JSON.parse(fs.readFileSync(path.join(project, ".review-evidence/findings.json"), "utf8"));
  assert.equal(data.findings.length, 1);
  assert.equal(data.findings[0].decision, "deferred");
  assert.equal(data.findings[0].deferred_review_action, "continue");
  assert.equal(data.findings[0].deferred_review_round, 2);
  assert.equal(data.findings[0].deferred_review_reason, "still deferred this round");
});

test("prior-round deferred can be included without duplicating the finding", () => {
  const project = makeProject();
  init(project, 2);
  const { evidence } = setupDeferredFinding(project);
  startAdjudication(project, 2);

  const before = JSON.parse(fs.readFileSync(path.join(project, ".review-evidence/findings.json"), "utf8")).findings[0];
  write(project, `${evidence}/adjudication.md`, "# Adjudication\n\n## Decision\n**Status**: accepted\n");
  write(project, "tests/review/reproductions/r1_f001_perf.test.js", "// formal repro\n");
  run(project, [
    "record-finding", "--id", "R1-F001-PERF", "--role", "PERF", "--original-id", "PERF-001",
    "--severity", "P2", "--decision", "accepted", "--reproduced", "true",
    "--reproduction-status", "reproduced", "--evidence-dir", evidence,
    "--change-origin", "pre-existing",
    "--deferred-review-action", "include",
    "--deferred-review-reason", "now worth fixing this round",
  ]);
  run(project, ["advance", "--to", "repair"]);

  const data = JSON.parse(fs.readFileSync(path.join(project, ".review-evidence/findings.json"), "utf8"));
  assert.equal(data.findings.length, 1);
  assert.equal(data.findings[0].id, "R1-F001-PERF");
  assert.equal(data.findings[0].created_at, before.created_at);
  assert.equal(data.findings[0].decision, "accepted");
  assert.equal(data.findings[0].deferred_review_action, "include");
  assert.equal(data.findings[0].deferred_review_round, 2);
});

test("prior-round deferred can be rejected with counter-evidence", () => {
  const project = makeProject();
  init(project, 2);
  const { evidence } = setupDeferredFinding(project);
  startAdjudication(project, 2);

  write(project, `${evidence}/adjudication.md`, "# Adjudication\n\n## Decision\n**Status**: rejected\n");
  write(project, `${evidence}/replay-review.md`, "# Replay Review\n\n**Status**: not-reproduced\n");
  run(project, [
    "record-finding", "--id", "R1-F001-PERF", "--role", "PERF", "--original-id", "PERF-001",
    "--severity", "P2", "--decision", "rejected", "--reproduced", "false",
    "--reproduction-status", "not-reproduced", "--evidence-dir", evidence,
    "--change-origin", "pre-existing",
    "--deferred-review-action", "reject",
    "--deferred-review-reason", "counter-evidence invalidated the claim",
  ]);
  run(project, ["advance", "--to", "round_decision"]);

  const data = JSON.parse(fs.readFileSync(path.join(project, ".review-evidence/findings.json"), "utf8"));
  assert.equal(data.findings.length, 1);
  assert.equal(data.findings[0].decision, "rejected");
  assert.equal(data.findings[0].deferred_review_action, "reject");
  assert.equal(data.findings[0].deferred_review_round, 2);
});

test("full happy path reaches converged", () => {
  const project = makeProject();
  init(project, 2);
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
  addCandidate(project, 1, "SEC-001", "P1");
  run(project, [
    "record-round",
    "--round",
    "1",
    "--raw",
    "1",
    "--duplicates",
    "0",
    "--screened",
    "0",
    "--new-p0p1p2",
    "1",
  ]);
  run(project, ["advance", "--to", "adjudication"]);

  const evidence = ".review-evidence/round-1/R1-F001-SEC";
  write(project, `${evidence}/counterexample.md`, "# Counterexample\n");
  write(project, `${evidence}/adjudication.md`, "# Adjudication\n\n## Scope & Contract Check\nok\n\n## Decision\n**Status**: accepted\n");
  write(project, `${evidence}/replay-review.md`, "# Replay Review\n\n**Status**: reproduced\n");
  write(project, `${evidence}/reproduce.test.js`, "// repro\n");
  write(project, "tests/review/reproductions/r1_f001_auth_bypass.test.js", "// formal repro\n");
  run(project, [
    "record-finding",
    "--id",
    "R1-F001-SEC",
    "--role",
    "SEC",
    "--original-id",
    "SEC-001",
    "--severity",
    "P1",
    "--decision",
    "accepted",
    "--reproduced",
    "true",
    "--reproduction-status",
    "reproduced",
    "--evidence-dir",
    evidence,
    "--challenge-required",
    "true",
    "--challenge-result",
    "supports",
    "--change-origin",
    "pre-existing",
  ]);

  run(project, ["advance", "--to", "repair"]);
  write(project, `${evidence}/implementation-result.md`, "# Implementation Result\n\n## RED Phase\nconfirmed\n\n## GREEN Phase\npass\n");
  write(project, "src/app.js", "module.exports = 1;\n");
  write(project, "tests/app.test.js", "// R1-F001-SEC\n");
  execFileSync("git", ["add", "src/app.js", "tests/app.test.js"], { cwd: project });
  testPolicyFixtures.writeGreenEvidence(
    project,
    evidence,
    testPolicyFixtures.git(project, ["write-tree"])
  );
  run(project, [
    "guard-commit",
    "--finding",
    "R1-F001-SEC",
    "--test",
    "tests/app.test.js",
  ]);
  execFileSync("git", ["commit", "-qm", "fix(review): R1-F001-SEC test"], {
    cwd: project,
  });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: project,
    encoding: "utf8",
  }).trim();
  run(project, [
    "record-implementation",
    "--id",
    "R1-F001-SEC",
    "--status",
    "fixed",
    "--commit",
    commit,
    "--test",
    "tests/app.test.js",
  ]);
  run(project, ["advance", "--to", "verification"]);
  write(project, `${evidence}/verification-result.md`, "# Verification Result\n\n**Final Verdict**: fail\n");
  write(project, "tests/review/verifications/r1_f001_auth_adjacent.test.js", "// adjacent\n");
  write(project, "tests/review/verifications/r1_f001_auth_adjacent_edge.test.js", "// adjacent edge\n");
  run(project, [
    "record-verification",
    "--id",
    "R1-F001-SEC",
    "--status",
    "pass",
    "--adjacent-test",
    "tests/review/verifications/r1_f001_auth_adjacent.test.js",
    "--adjacent-test",
    "tests/review/verifications/r1_f001_auth_adjacent_edge.test.js",
  ], { expectFail: true });

  write(project, `${evidence}/verification-result.md`, "# Verification Result\n\n**Final Verdict**: pass\n");
  run(project, [
    "record-verification",
    "--id",
    "R1-F001-SEC",
    "--status",
    "pass",
    "--adjacent-test",
    "tests/review/verifications/r1_f001_auth_adjacent.test.js",
    "--adjacent-test",
    "tests/review/verifications/r1_f001_auth_adjacent_edge.test.js",
  ], { expectFail: true });
  run(project, [
    "record-verification",
    "--id",
    "R1-F001-SEC",
    "--status",
    "pass",
    "--adjacent-test",
    "tests/review/verifications/r1_f001_auth_adjacent.test.js",
    "--adjacent-test",
    "tests/review/verifications/r1_f001_auth_adjacent_edge.test.js",
  ]);
  run(project, ["advance", "--to", "round_decision"]);

  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 2);
  run(project, [
    "record-round",
    "--round",
    "2",
    "--raw",
    "0",
    "--duplicates",
    "0",
    "--screened",
    "0",
    "--new-p0p1p2",
    "0",
  ]);
  run(project, ["advance", "--to", "adjudication"]);
  run(project, ["advance", "--to", "round_decision"]);
  run(project, ["advance", "--to", "review"], { expectFail: true });
  const missingAggregate = run(project, ["advance", "--to", "final_audit"], { expectFail: true });
  assert.match(String(missingAggregate.stderr), /全历史相邻测试/);
  assert.equal(JSON.parse(run(project, ["adjacent-plan", "--scope", "round"])).test_paths.length, 0);
  assert.equal(JSON.parse(run(project, ["adjacent-plan", "--scope", "all"])).test_paths.length, 2);
  // Isolated synthetic lifecycle evidence: a failed aggregate reopens this round.
  const aggregatePlan = JSON.parse(run(project, ["adjacent-plan", "--scope", "all"]));
  const aggregateLog = ".review-evidence/aggregate-failed.log";
  write(project, aggregateLog, `COMMAND=${aggregatePlan.command}\nEXIT_CODE=1\n`);
  run(project, ["record-final-adjacent-batch", "--attempt", "1", "--status", "fail",
    "--command", aggregatePlan.command, "--exit-status", "1", "--tree-hash", testPolicy.gitTree(project, "HEAD"),
    "--tested-commit", testPolicyFixtures.git(project, ["rev-parse", "HEAD"]), "--log", aggregateLog,
    "--test-count", "2", "--failed-count", "1", "--failed-finding", "R1-F001-SEC"]);
  const failedAggregate = run(project, ["advance", "--to", "final_audit"], { expectFail: true });
  assert.match(String(failedAggregate.stderr), /全历史相邻测试/);
  run(project, ["advance", "--to", "adjudication"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, ".review-evidence/state.json"))).final_audit_attempt, 0);
  run(project, ["record-round", "--round", "2", "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
  run(project, ["advance", "--to", "round_decision"]);
  // Later rounds may change HEAD without invalidating historical verification.
  write(project, "README.md", "later round documentation\n");
  execFileSync("git", ["add", "README.md"], { cwd: project });
  execFileSync("git", ["commit", "-qm", "later round change"], { cwd: project });
  run(project, ["validate"]);
  run(project, ["advance", "--to", "final_audit"]);

  assert.match(fs.readFileSync(path.join(project, ".review-evidence/round-2/final-audit/attempt-1/adjacent-batch-attempt-1.md"), "utf8"), /"status": "fail"/);

  const audit = ".review-evidence/round-2/final-audit/attempt-1";
  write(project, `${audit}/blind-scan.md`, "# Blind Scan\n");
  write(project, `${audit}/targeted-review.md`, "# Targeted Review\n");
  run(project, [
    "record-audit",
    "--attempt",
    "1",
    "--status",
    "complete",
    "--new-issues",
    "0",
    "--auditor",
    "test-auditor",
  ]);
  run(project, ["advance", "--to", "report"]);
  run(project, ["finalize", "--status", "converged"]);

  const state = JSON.parse(
    fs.readFileSync(path.join(project, ".review-evidence/state.json"), "utf8")
  );
  assert.equal(state.overall_status, "converged");
  assert.equal(state.current_phase, "report");
  assert.ok(
    fs.existsSync(path.join(project, ".review-evidence/final-report.md"))
  );
  const reportPath = path.join(project, ".review-evidence/final-report.md");
  fs.appendFileSync(reportPath, "\nUSER NARRATIVE\n");
  run(project, ["finalize", "--status", "converged"]);
  assert.match(fs.readFileSync(reportPath, "utf8"), /USER NARRATIVE/);
  run(project, ["validate"]);
  // OPS-002: completed cleanup must remain auditable from durable evidence.
  fs.rmSync(path.join(project, "tests/review"), { recursive: true });
  run(project, ["validate"]);
  run(project, ["normalize"]);
  run(project, ["finalize", "--status", "converged"]);
  const formalTest = path.join(project, "tests/app.test.js");
  const formalContent = fs.readFileSync(formalTest);
  fs.unlinkSync(formalTest);
  run(project, ["validate"], { expectFail: true });
  fs.writeFileSync(formalTest, formalContent);
  fs.unlinkSync(path.join(project, evidence, "reproduce.test.js"));
  run(project, ["validate"], { expectFail: true });
});

test("final audit rejected issue at max_rounds can still converge", () => {
  const project = makeProject();
  init(project, 2);
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
  run(project, ["record-round", "--round", "1", "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
  run(project, ["advance", "--to", "adjudication"]);
  run(project, ["advance", "--to", "round_decision"]);
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 2);
  run(project, ["record-round", "--round", "2", "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
  run(project, ["advance", "--to", "adjudication"]);
  run(project, ["advance", "--to", "round_decision"]);
  run(project, ["advance", "--to", "final_audit"]);

  const audit = ".review-evidence/round-2/final-audit/attempt-1";
  write(project, `${audit}/blind-scan.md`, "# Blind Scan\n");
  write(project, `${audit}/targeted-review.md`, "# Targeted Review\n");
  run(project, [
    "record-audit",
    "--attempt",
    "1",
    "--status",
    "complete",
    "--new-issues",
    "1",
    "--auditor",
    "test-auditor",
  ]);
  run(project, [
    "record-audit",
    "--attempt",
    "1",
    "--status",
    "complete",
    "--new-issues",
    "1",
    "--auditor",
    "test-auditor",
  ], { expectFail: true });
  run(project, ["advance", "--to", "report"], { expectFail: true });
  run(project, ["advance", "--to", "adjudication"]);

  const evidence = ".review-evidence/round-2/R2-F001-FUNC";
  write(project, `${evidence}/counterexample.md`, "# Counterexample\n");
  write(project, `${evidence}/adjudication.md`, "# Adjudication\n\n## Decision\n**Status**: rejected\n");
  write(project, `${evidence}/replay-review.md`, "# Replay Review\n\n**Status**: not-reproduced\n");
  write(project, `${evidence}/reproduce.test.js`, "// repro\n");
  run(project, [
    "record-finding",
    "--id",
    "R2-F001-FUNC",
    "--role",
    "FUNC",
    "--original-id",
    "FA-001",
    "--severity",
    "P2",
    "--decision",
    "rejected",
    "--reproduced",
    "false",
    "--reproduction-status",
    "not-reproduced",
    "--evidence-dir",
    evidence,
    "--change-origin",
    "pre-existing",
    "--source",
    "final-audit",
    "--audit-attempt",
    "1",
  ]);
  run(project, ["advance", "--to", "round_decision"]);
  run(project, ["advance", "--to", "report"]);
  run(project, ["finalize", "--status", "converged"]);
  const state = JSON.parse(
    fs.readFileSync(path.join(project, ".review-evidence/state.json"), "utf8")
  );
  assert.equal(state.overall_status, "converged");
});

test("blocked finding can advance to the next finding", () => {
  const project = makeProject();
  init(project, 2);
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
  addCandidate(project, 1, "SEC-001", "P1");
  addCandidate(project, 1, "FUNC-001");
  run(project, ["record-round", "--round", "1", "--raw", "2", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "2"]);
  run(project, ["advance", "--to", "adjudication"]);

  function addFinding({ id, role, original, severity, slug, challenge }) {
    const evidence = `.review-evidence/round-1/${id}`;
    write(project, `${evidence}/counterexample.md`, "# Counterexample\n");
    write(project, `${evidence}/adjudication.md`, "# Adjudication\n\n## Decision\n**Status**: accepted\n");
    write(project, `${evidence}/replay-review.md`, "# Replay Review\n\n**Status**: reproduced\n");
    write(project, `${evidence}/reproduce.test.js`, "// repro\n");
    write(project, `tests/review/reproductions/${slug}.test.js`, "// formal repro\n");
    const args = [
      "record-finding", "--id", id, "--role", role, "--original-id", original,
      "--severity", severity, "--decision", "accepted", "--reproduced", "true",
      "--reproduction-status", "reproduced", "--evidence-dir", evidence,
      "--change-origin", "pre-existing",
    ];
    if (challenge) args.push("--challenge-required", "true", "--challenge-result", "supports");
    run(project, args);
  }

  addFinding({ id: "R1-F001-SEC", role: "SEC", original: "SEC-001", severity: "P1", slug: "r1_f001_auth", challenge: true });
  addFinding({ id: "R1-F002-FUNC", role: "FUNC", original: "FUNC-001", severity: "P2", slug: "r1_f002_func", challenge: false });
  run(project, ["advance", "--to", "repair"]);
  write(project, ".review-evidence/round-1/R1-F001-SEC/implementation-result.md", "# Implementation Result\n\n## RED Phase\nconfirmed\n\n## GREEN Phase\npass\n\n## Manual Merge Guidance\nconflict\n");
  run(project, [
    "record-implementation", "--id", "R1-F001-SEC", "--status", "prepared",
    "--reason", "user changes conflict",
  ]);
  run(project, [
    "record-verification", "--id", "R1-F001-SEC", "--status", "blocked_by_user_changes",
  ]);
  run(project, ["next-finding"]);
  const state = JSON.parse(
    fs.readFileSync(path.join(project, ".review-evidence/state.json"), "utf8")
  );
  assert.equal(state.active_finding, "R1-F002-FUNC");
  run(project, ["validate"]);

  write(project, ".review-evidence/round-1/R1-F002-FUNC/implementation-result.md", "# Implementation Result\n\ncannot fix\n");
  run(project, [
    "record-implementation", "--id", "R1-F002-FUNC", "--status", "cannot_fix",
    "--reason", "requires architecture change",
  ]);
  run(project, ["validate"]);
  run(project, ["advance", "--to", "adjudication"]);
  write(project, ".review-evidence/round-1/R1-F002-FUNC/adjudication.md", "# Adjudication\n\n## Decision\n**Status**: deferred\n");
  run(project, [
    "record-finding", "--id", "R1-F002-FUNC", "--role", "FUNC", "--original-id", "FUNC-001",
    "--severity", "P2", "--decision", "deferred", "--reproduced", "true",
    "--reproduction-status", "reproduced", "--evidence-dir", ".review-evidence/round-1/R1-F002-FUNC",
    "--change-origin", "pre-existing", "--deferred-reason", "needs architecture",
    "--disposition-plan", "next release",
  ]);
  run(project, ["validate"]);
  run(project, ["advance", "--to", "round_decision"]);
  const stateAfter = JSON.parse(
    fs.readFileSync(path.join(project, ".review-evidence/state.json"), "utf8")
  );
  assert.equal(stateAfter.current_phase, "round_decision");
  const findingAfter = JSON.parse(
    fs.readFileSync(path.join(project, ".review-evidence/findings.json"), "utf8")
  ).findings.find((finding) => finding.id === "R1-F002-FUNC");
  assert.equal(findingAfter.implementation_status, "none");
  assert.equal(findingAfter.verification, "pending");
  assert.equal(findingAfter.unresolved, false);
});

test("manual finding can be repaired and verified without an automated test", () => {
  const project = makeProject();
  init(project, 2);
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
  addCandidate(project, 1, "FUNC-001");
  run(project, ["record-round", "--round", "1", "--raw", "1", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "1"]);
  run(project, ["advance", "--to", "adjudication"]);

  const evidence = ".review-evidence/round-1/R1-F001-FUNC";
  write(project, `${evidence}/counterexample.md`, "# Counterexample\n");
  write(project, `${evidence}/adjudication.md`, "# Adjudication\n\n## Decision\n**Status**: accepted\n");
  write(project, `${evidence}/replay-review.md`, "# Replay Review\n\n**Status**: reproduced\n");
  write(project, `${evidence}/manual-steps.md`, "# Manual Steps\n\n1. click the button\n");
  run(project, [
    "record-finding", "--id", "R1-F001-FUNC", "--role", "FUNC", "--original-id", "FUNC-001",
    "--severity", "P2", "--decision", "accepted", "--reproduced", "true",
    "--reproduction-status", "reproduced", "--evidence-dir", evidence,
    "--change-origin", "pre-existing",
  ]);
  run(project, ["advance", "--to", "repair"]);

  write(project, `${evidence}/implementation-result.md`, "# Implementation Result\n\n## Manual\n\nfixed the flow\n");
  write(project, "src/manual.js", "module.exports = 1;\n");
  execFileSync("git", ["add", "src/manual.js"], { cwd: project });
  execFileSync("git", ["commit", "-qm", "fix(review): R1-F001-FUNC manual"], { cwd: project });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" }).trim();
  run(project, [
    "record-implementation", "--id", "R1-F001-FUNC", "--status", "fixed",
    "--commit", commit, "--manual",
  ]);
  run(project, ["advance", "--to", "verification"]);

  write(project, `${evidence}/verification-result.md`, "# Verification Result\n\n## Manual\n\nindependently re-tested\n\n**Final Verdict**: pass\n");
  run(project, [
    "record-verification", "--id", "R1-F001-FUNC", "--status", "pass",
    "--adjacent-reason", "manual UI flow has no stable automated adjacent path",
  ]);
  run(project, ["validate"]);
  run(project, ["advance", "--to", "round_decision"]);
});

test("max_rounds cannot be changed after init", () => {
  const project = makeProject();
  init(project, 2);
  const configPath = path.join(project, ".review-evidence/review-config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.max_rounds = 3;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  run(project, ["validate"], { expectFail: true });
});

test("progressive mode requires a current-HEAD full regression gate before leaving round decision", () => {
  const project = makeProject();
  init(project, 2);
  const baseline = path.join(project, ".review-evidence/baseline.md");
  let baselineText = fs.readFileSync(baseline, "utf8").replace("Tiering mode: default", "Tiering mode: progressive");
  fs.writeFileSync(baseline, baselineText);
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
  run(project, ["record-round", "--round", "1", "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
  run(project, ["advance", "--to", "adjudication"]);
  run(project, ["advance", "--to", "round_decision"]);
  const missing = run(project, ["advance", "--to", "review"], { expectFail: true });
  assert.match(String(missing.stderr), /regression gate/);

  const commit = testPolicyFixtures.git(project, ["rev-parse", "HEAD"]);
  const tree = testPolicy.gitTree(project, commit);
  const log = ".review-evidence/round-1/full-suite.log";
  write(project, log, "COMMAND=node --test\nEXIT_CODE=0\n");
  write(project, ".review-evidence/round-1/full-suite.json", JSON.stringify({ full_suite: {
    status: "pass", command: "node --test", exit_status: 0,
    tree_hash_before: tree, tree_hash_after: tree, tested_commit: commit,
    run_location: "main-workspace", workspace_clean_before: true, workspace_clean_after: true,
    test_counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    expected_test_count_delta: 0, expected_skipped_count_delta: 0, log,
  } }));
  run(project, ["record-round-regression", "--status", "pass", "--evidence", ".review-evidence/round-1/full-suite.json"]);
  run(project, ["advance", "--to", "review"]);
  const state = JSON.parse(fs.readFileSync(path.join(project, ".review-evidence/state.json"), "utf8"));
  assert.equal(state.current_phase, "review");
  assert.equal(state.rounds[0].regression_gate.status, "pass");
});

test("progressive GREEN accepts fast evidence only for normal-risk P2/P3 findings", () => {
  const project = makeProject();
  testPolicyFixtures.writeBaseline(project);
  const baseline = path.join(project, ".review-evidence/baseline.md");
  fs.writeFileSync(baseline, fs.readFileSync(baseline, "utf8")
    .replace("Tiering mode: default", "Tiering mode: progressive"));
  const tree = testPolicy.gitTree(project, "HEAD");
  const dir = ".review-evidence/round-1/R1-F001-FUNC";
  const log = `${dir}/output-fast-suite.log`;
  write(project, log, "COMMAND=node --test --test-name-pattern=fast\nEXIT_CODE=0\n");
  write(project, `${dir}/implementation-result.md`, `# Implementation Result\n\n## RED Phase\nconfirmed\n\n## GREEN Phase\npass\n\n## Reviewctl GREEN Evidence\n\n\`\`\`json\n${JSON.stringify({
    risk_assessment: "normal",
    quality_checks: {
      status: "not_applicable",
      command: "not_applicable: no formatter or linter applies to synthetic fixture",
      reason: "no formatter or linter applies to synthetic fixture",
    },
    fast_suite: {
      status: "pass", command: "node --test --test-name-pattern=fast", exit_status: 0,
      fast_profile: "none",
      tree_hash_before: tree, tree_hash_after: tree, run_location: "main-workspace",
      workspace_clean_before: true, workspace_clean_after: true,
      test_counts: { total: 1, passed: 1, failed: 0, skipped: 0 }, log,
    },
  }, null, 2)}\n\`\`\`\n`);
  const filename = path.join(project, dir, "implementation-result.md");
  const normal = testPolicy.parseImplementationEvidence(project, filename, tree, { finding: { severity: "P2" } });
  assert.deepEqual(normal.errors, []);
  const critical = testPolicy.parseImplementationEvidence(project, filename, tree, { finding: { severity: "P1" } });
  assert.match(critical.errors.join("; "), /P0\/P1/);
});

test("scaled fast profiles require retained and uncovered semantics", () => {
  const project = makeProject();
  testPolicyFixtures.writeBaseline(project);
  const baseline = path.join(project, ".review-evidence/baseline.md");
  fs.writeFileSync(baseline, fs.readFileSync(baseline, "utf8")
    .replace("Tiering mode: default", "Tiering mode: progressive")
    .replace("Fast test profile: none", "Fast test profile: accelerated-time"));
  const tree = testPolicy.gitTree(project, "HEAD");
  const dir = ".review-evidence/round-1/R1-F001-FUNC";
  const log = `${dir}/output-fast-suite.log`;
  write(project, log, "COMMAND=node --test --test-name-pattern=fast\nEXIT_CODE=0\n");
  const evidence = {
    risk_assessment: "normal",
    quality_checks: {
      status: "not_applicable",
      command: "not_applicable: no formatter or linter applies to synthetic fixture",
      reason: "no formatter or linter applies to synthetic fixture",
    },
    fast_suite: {
      status: "pass", command: "node --test --test-name-pattern=fast", exit_status: 0,
      fast_profile: "accelerated-time", tree_hash_before: tree, tree_hash_after: tree,
      run_location: "main-workspace", workspace_clean_before: true, workspace_clean_after: true,
      test_counts: { total: 1, passed: 1, failed: 0, skipped: 0 }, log,
    },
  };
  const report = `${dir}/implementation-result.md`;
  const reportPath = path.join(project, report);
  write(project, report, `## Reviewctl GREEN Evidence\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n`);
  let parsed = testPolicy.parseImplementationEvidence(project, reportPath, tree, { finding: { severity: "P2" } });
  assert.match(parsed.errors.join("; "), /scaling_notes/);
  evidence.fast_suite.scaling_notes = "600s logical interval driven by injected clock; full retains 10-minute wall-clock soak";
  parsed = testPolicy.parseImplementationEvidence(project, reportPath, tree, { finding: { severity: "P2" } });
  assert.match(parsed.errors.join("; "), /Fast profile semantics/);
  fs.writeFileSync(baseline, fs.readFileSync(baseline, "utf8")
    .replace("Fast profile semantics: not_applicable", "Fast profile semantics: 10-minute schedule asserted; real-time scheduler jitter not represented"));
  parsed = testPolicy.parseImplementationEvidence(project, reportPath, tree, { finding: { severity: "P2" } });
  assert.match(parsed.errors.join("; "), /retained_contracts/);
  evidence.fast_suite.retained_contracts = "poll interval and retry limit";
  evidence.fast_suite.uncovered_semantics = "wall-clock scheduler jitter and two-hour resource accumulation";
  write(project, report, `## Reviewctl GREEN Evidence\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n`);
  parsed = testPolicy.parseImplementationEvidence(project, reportPath, tree, { finding: { severity: "P2" } });
  assert.deepEqual(parsed.errors, []);
});

test("all tiers require long-test inventory and full runs bind original runtime scale", () => {
  const project = makeProject();
  testPolicyFixtures.writeBaseline(project);
  const baseline = path.join(project, ".review-evidence/baseline.md");
  let baselineText = fs.readFileSync(baseline, "utf8");
  fs.writeFileSync(baseline, baselineText.replace("- Long-running test inventory: none\n", ""));
  assert.match(testPolicy.parseBaselinePolicy(project).errors.join("; "), /Long-running test inventory/);
  baselineText = baselineText
    .replace("Long-running test inventory: none", "Long-running test inventory:巡查周期稳定性")
    .replace("Full runtime scale: not_applicable", "Full runtime scale:巡查间隔10分钟；持续运行2小时；本地真实文件系统");
  fs.writeFileSync(baseline, baselineText);
  write(project, ".review-evidence/baseline-full.log", [
    "COMMAND=node --test", "RUNTIME_PROFILE=original",
    "LONG_RUNNING_TESTS=巡查周期稳定性",
    "FULL_RUNTIME_SCALE=巡查间隔10分钟；持续运行2小时；本地真实文件系统", "EXIT_CODE=0", "",
  ].join("\n"));
  let parsedPolicy = testPolicy.parseBaselinePolicy(project);
  assert.equal(parsedPolicy.errors.length, 0, parsedPolicy.errors.join("; "));

  const tree = testPolicy.gitTree(project, "HEAD");
  const log = ".review-evidence/round-1/R1-F001-FUNC/full.log";
  write(project, log, "COMMAND=node --test\nEXIT_CODE=0\n");
  const run = {
    status: "pass", command: "node --test", exit_status: 0,
    tree_hash_before: tree, tree_hash_after: tree,
    run_location: "main-workspace", workspace_clean_before: true, workspace_clean_after: true,
    test_counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    expected_test_count_delta: 0, expected_skipped_count_delta: 0,
    long_running_test_ids: ["巡查周期稳定性"], runtime_profile: "original",
    runtime_scale: parsedPolicy.policy.fullScale,
    runtime_scale_evidence: "src/config.js default and captured run log", log,
  };
  let errors = testPolicy.validateFullRun(project, run, parsedPolicy.policy);
  assert.match(errors.join("; "), /RUNTIME_PROFILE=original/);

  fs.writeFileSync(path.join(project, run.log), [
    "COMMAND=node --test", "RUNTIME_PROFILE=original",
    "LONG_RUNNING_TESTS=巡查周期稳定性",
    `FULL_RUNTIME_SCALE=${parsedPolicy.policy.fullScale}`, "EXIT_CODE=0", "",
  ].join("\n"));
  errors = testPolicy.validateFullRun(project, run, parsedPolicy.policy);
  assert.deepEqual(errors, []);
  run.runtime_scale = "30-second巡查";
  errors = testPolicy.validateFullRun(project, run, parsedPolicy.policy);
  assert.match(errors.join("; "), /runtime_scale 必须与 baseline/);
  run.runtime_scale = parsedPolicy.policy.fullScale;

  fs.writeFileSync(path.join(project, ".review-evidence/baseline-full.log"), [
    "COMMAND=node --test", "RUNTIME_PROFILE=original",
    "LONG_RUNNING_TESTS=巡查周期稳定性",
    `FULL_RUNTIME_SCALE=${parsedPolicy.policy.fullScale}`, "EXIT_CODE=0", "",
  ].join("\n"));
  assert.deepEqual(testPolicy.parseBaselinePolicy(project).errors, []);

  fs.writeFileSync(baseline, baselineText.replace("Long-running test inventory:巡查周期稳定性", "Long-running test inventory: [TODO]"));
  parsedPolicy = testPolicy.parseBaselinePolicy(project);
  assert.match(parsedPolicy.errors.join("; "), /Long-running test inventory/);
});

test("a failed progressive full gate reopens adjudication and preserves its attempt", () => {
  const project = makeProject();
  init(project, 2);
  const baseline = path.join(project, ".review-evidence/baseline.md");
  fs.writeFileSync(baseline, fs.readFileSync(baseline, "utf8")
    .replace("Tiering mode: default", "Tiering mode: progressive"));
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
  run(project, ["record-round", "--round", "1", "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
  run(project, ["advance", "--to", "adjudication"]);
  run(project, ["advance", "--to", "round_decision"]);
  const commit = testPolicyFixtures.git(project, ["rev-parse", "HEAD"]);
  const tree = testPolicy.gitTree(project, commit);
  const log = ".review-evidence/round-1/full-suite-failed.log";
  write(project, log, "COMMAND=node --test\nEXIT_CODE=1\n");
  write(project, ".review-evidence/round-1/full-suite-failed.json", JSON.stringify({ full_suite: {
    status: "fail", command: "node --test", exit_status: 1,
    tree_hash_before: tree, tree_hash_after: tree, tested_commit: commit,
    run_location: "main-workspace", workspace_clean_before: true, workspace_clean_after: true,
    test_counts: { total: 1, passed: 0, failed: 1, skipped: 0 },
    expected_test_count_delta: 0, expected_skipped_count_delta: 0, log,
  } }));
  run(project, ["record-round-regression", "--status", "fail", "--evidence", ".review-evidence/round-1/full-suite-failed.json"]);
  run(project, ["advance", "--to", "adjudication"]);
  const state = JSON.parse(fs.readFileSync(path.join(project, ".review-evidence/state.json"), "utf8"));
  assert.equal(state.current_phase, "adjudication");
  assert.equal(state.rounds[0].regression_gate, null);
  assert.equal(state.rounds[0].regression_gate_attempts.length, 1);
});

test("authorize records the user decision", () => {
  const project = makeProject();
  init(project);
  run(project, [
    "authorize",
    "--action",
    "parallel",
    "--decision",
    "authorized",
    "--scope",
    "test scope",
  ]);
  const state = JSON.parse(
    fs.readFileSync(path.join(project, ".review-evidence/state.json"), "utf8")
  );
  assert.equal(state.authorizations.length, 1);
  assert.match(state.blockers[0], /authorized/);
});

test("validate detects manual edits to generated views", () => {
  const project = makeProject();
  init(project);
  const runState = path.join(project, ".review-evidence/run-state.md");
  fs.appendFileSync(runState, "\nmanual edit\n");
  run(project, ["validate"], { expectFail: true });
});

test("coverage reports adjusted counterexample coverage", () => {
  const project = makeProject();
  init(project);
  run(project, ["coverage"]);
  const output = run(project, ["coverage"]);
  assert.match(output, /coverage/i);
});

test("test file naming supports final audit and multiple languages", () => {
  assert.ok(isCandidateTestFile("r1_sec_001.test.js"));
  assert.ok(isCandidateTestFile("r1_finalaudit_fa-001.test.js"));
  assert.ok(isCandidateTestFile("r1_perf_001_test.py"));
  assert.ok(isCandidateTestFile("r1_sec_001_test.go"));
  assert.ok(isCandidateTestFile("r1_sec_001_spec.rb"));
  assert.ok(isCandidateTestFile("r1_sec_001Test.java"));
  assert.ok(isCandidateTestFile("r1_sec_001Test.cs"));
  assert.ok(isCandidateTestFile("r1_sec_001.rs"));
  assert.ok(!isCandidateTestFile("r1_performance_001.test.js"));
  assert.ok(isReproductionTestFile("r1_f001_auth_test.go"));
  assert.ok(isReproductionTestFile("r1_f001_auth.test.js"));
  assert.ok(isAdjacentTestFile("r1_f001_auth_adjacent_test.py"));
  assert.ok(isAdjacentTestFile("r1_f001_auth_adjacent.test.js"));
  assert.ok(isFormalTestFile("tests/app.test.js"));
  assert.ok(!isFormalTestFile("../outside-merged.txt"));
  assert.ok(!isFormalTestFile("tests/review/verifications/r1_f001_auth_adjacent.test.js"));
  assert.ok(!isFormalTestFile(".review-evidence/merged.test.js"));
  assert.ok(!isFormalTestFile("./.review-evidence/merged.test.js"));
  assert.ok(!isFormalTestFile("./tests/review/verifications/r1_f001_auth_adjacent.test.js"));
  assert.ok(!isFormalTestFile("src/app.js"));
});

test("validate rejects missing RED/GREEN evidence", () => {
  const project = makeProject();
  init(project, 2);
  const evidence = setupAcceptedFinding(project, {
    id: "R1-F001-SEC", role: "SEC", original: "SEC-001", severity: "P1",
    slug: "r1_f001_auth",
  });
  run(project, ["advance", "--to", "repair"]);
  write(project, `${evidence}/implementation-result.md`, `# Implementation Result\n\nDetails omitted.\n\n## Reviewctl GREEN Evidence\n\n\`\`\`json\n${JSON.stringify({
    quality_checks: {
      status: "not_applicable",
      command: "not_applicable: no formatter or linter applies to synthetic fixture",
      reason: "no formatter or linter applies to synthetic fixture",
    },
  }, null, 2)}\n\`\`\`\n`);
  write(project, "src/fix.js", "module.exports = 1;\n");
  write(project, "tests/fix.test.js", "// R1-F001-SEC\n");
  execFileSync("git", ["add", "src/fix.js", "tests/fix.test.js"], { cwd: project });
  execFileSync("git", ["commit", "-qm", "fix(review): R1-F001-SEC"], { cwd: project });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" }).trim();
  run(project, [
    "record-implementation", "--id", "R1-F001-SEC", "--status", "fixed",
    "--commit", commit, "--test", "tests/fix.test.js",
  ]);
  const validation = run(project, ["validate"], { expectFail: true });
  assert.notEqual(validation.status, 0);
});

test("already_fixed requires a tracked test file", () => {
  const project = makeProject();
  init(project, 2);
  const evidence = setupAcceptedFinding(project, {
    id: "R1-F001-FUNC", role: "FUNC", original: "FUNC-001", severity: "P2",
    slug: "r1_f001_func",
  });
  run(project, ["advance", "--to", "repair"]);
  write(project, `${evidence}/implementation-result.md`, "# Implementation Result\n\n## RED Phase\nr\n\n## GREEN Phase\ng\n");
  write(project, "tests/untracked.test.js", "// R1-F001-FUNC\n");
  run(project, [
    "record-implementation", "--id", "R1-F001-FUNC", "--status", "already_fixed",
    "--test", "tests/untracked.test.js",
  ], { expectFail: true });
});

test("already_fixed requires the formal test content to be committed in HEAD", () => {
  const project = makeProject();
  init(project, 2);
  const evidence = setupAcceptedFinding(project, {
    id: "R1-F001-FUNC", role: "FUNC", original: "FUNC-001", severity: "P2",
    slug: "r1_f001_func",
  });
  run(project, ["advance", "--to", "repair"]);
  write(project, `${evidence}/implementation-result.md`, "# Implementation Result\n\n## RED Phase\nr\n\n## GREEN Phase\ng\n");
  write(project, "tests/fix.test.js", "// R1-F001-FUNC\n");
  execFileSync("git", ["add", "tests/fix.test.js"], { cwd: project });
  execFileSync("git", ["commit", "-qm", "test(review): R1-F001-FUNC"], { cwd: project });
  write(project, "tests/fix.test.js", "// R1-F001-FUNC\n// uncommitted adjacent change\n");
  run(project, [
    "record-implementation", "--id", "R1-F001-FUNC", "--status", "already_fixed",
    "--test", "tests/fix.test.js",
  ], { expectFail: true });
});

test("already_fixed baseline exception cannot bypass mandatory verification full", () => {
  const cases = [
    { name: "P1", severity: "P1", risk: "normal" },
    { name: "high risk", severity: "P2", risk: "high" },
    { name: "full-everywhere", severity: "P2", risk: "normal", tiering: "full-everywhere" },
    { name: "ordinary default", severity: "P2", risk: "normal", expectExceptionPass: true },
  ];
  for (const scenario of cases) {
    const project = makeProject();
    init(project, 2);
    const evidence = ".review-evidence/round-1/R1-F001-SEC";
    const head = testPolicyFixtures.git(project, ["rev-parse", "HEAD"]);
    const finding = {
      id: "R1-F001-SEC",
      severity: scenario.severity,
      implementation_status: "already_fixed",
      commit: head,
      evidence_dir: evidence,
    };
    testPolicyFixtures.writeVerificationEvidence(project, evidence, finding, scenario.risk);
    if (scenario.tiering) {
      const baselinePath = path.join(project, ".review-evidence/baseline.md");
      const baseline = fs.readFileSync(baselinePath, "utf8").replace(
        "- Tiering mode: default",
        "- Tiering mode: " + scenario.tiering
      );
      write(project, ".review-evidence/baseline.md", baseline);
    }
    const reportPath = path.join(project, evidence, "verification-result.md");
    const evidenceObject = testPolicy.parseJsonSection(
      fs.readFileSync(reportPath, "utf8"),
      "Reviewctl Verification Evidence",
      "Reviewctl Verification Evidence"
    ).value;
    delete evidenceObject.full_test_suite;
    evidenceObject.regression.scope = "impacted";
    evidenceObject.already_fixed_baseline_exception = {
      baseline_head_ancestor: true,
      baseline_full_pass: true,
    };
    const json = JSON.stringify(evidenceObject, null, 2);
    const fence = String.fromCharCode(96).repeat(3);
    write(
      project,
      evidence + "/verification-result.md",
      "# Verification Result\n\n**Final Verdict**: pass\n\n## Reviewctl Verification Evidence\n" +
        fence + "json\n" + json + "\n" + fence + "\n"
    );
    const errors = testPolicy.validateVerificationEvidence(
      project,
      finding,
      { baseline_head: head },
      reportPath
    );
    if (scenario.expectExceptionPass) {
      assert.deepEqual(errors, [], scenario.name + ": " + errors.join("; "));
    } else {
      assert.ok(
        errors.some((error) => /必须由验证阶段重跑 full/.test(error)),
        scenario.name + ": expected mandatory full rerun error, received: " + errors.join("; ")
      );
    }
  }
});

test("repair commits must be reachable from HEAD", () => {
  const project = makeProject();
  init(project, 2);
  const evidence = setupAcceptedFinding(project, {
    id: "R1-F001-SEC", role: "SEC", original: "SEC-001", severity: "P1",
    slug: "r1_f001_auth",
  });
  run(project, ["advance", "--to", "repair"]);
  write(project, `${evidence}/implementation-result.md`, "# Implementation Result\n\n## RED Phase\nreproduced\n\n## GREEN Phase\nfixed\n");
  write(project, "tests/fix.test.js", "// R1-F001-SEC baseline test\n");
  execFileSync("git", ["add", "tests/fix.test.js"], { cwd: project });
  execFileSync("git", ["commit", "-qm", "test(review): baseline R1-F001-SEC"], { cwd: project });

  const worktree = path.join(os.tmpdir(), `reviewctl-external-${path.basename(project)}`);
  try {
  execFileSync("git", ["worktree", "add", "-q", "-b", "reviewctl-external-repair", worktree, "HEAD"], {
    cwd: project,
  });
  write(worktree, "src/fix.js", "module.exports = 1;\n");
  write(worktree, "tests/fix.test.js", "// R1-F001-SEC repair regression\n");
  execFileSync("git", ["add", "src/fix.js", "tests/fix.test.js"], { cwd: worktree });
  execFileSync("git", ["commit", "-qm", "fix(review): R1-F001-SEC external worktree"], { cwd: worktree });
  const externalCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: worktree,
    encoding: "utf8",
  }).trim();

  const fixed = run(project, [
    "record-implementation", "--id", "R1-F001-SEC", "--status", "fixed",
    "--commit", externalCommit, "--test", "tests/fix.test.js",
  ], { expectFail: true });
  assert.match(String(fixed.stderr), /HEAD|祖先/i);

  const alreadyFixed = run(project, [
    "record-implementation", "--id", "R1-F001-SEC", "--status", "already_fixed",
    "--commit", externalCommit, "--test", "tests/fix.test.js",
  ], { expectFail: true });
  assert.match(String(alreadyFixed.stderr), /HEAD|祖先/i);

  const findingsPath = path.join(project, ".review-evidence/findings.json");
  const findings = JSON.parse(fs.readFileSync(findingsPath, "utf8"));
  const finding = findings.findings.find((entry) => entry.id === "R1-F001-SEC");
  finding.implementation_status = "fixed";
  finding.test_files = ["tests/fix.test.js"];
  finding.commit = externalCommit;
  writeJson(project, ".review-evidence/findings.json", findings);
  run(project, ["render"]);
  const validation = run(project, ["validate"], { expectFail: true });
  assert.match(String(validation.stderr), /HEAD|祖先/i);
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: project });
    } catch {}
  }
});

test("verdict parsing requires an exact final pass", () => {
  assert.equal(verdictIsPass("**Final Verdict**: pass\n"), true);
  assert.equal(verdictIsPass("## Verdict\npass\n"), true);
  assert.equal(verdictIsPass("**Final Verdict**: pass with caveats\n"), false);
  assert.equal(verdictIsPass("**Final Verdict**: passable\n"), false);
  assert.equal(verdictIsPass("**Final Verdict**: fail\n"), false);
  assert.equal(
    verdictIsPass("**Final Verdict**: pass\n\n**Final Verdict**: fail\n"),
    false
  );
});

test("structured evidence parser accepts both Markdown JSON fence styles", () => {
  const fence = String.fromCharCode(96).repeat(3);
  const backtick = testPolicy.parseJsonSection(
    ["## Evidence", fence + "json", "{\"ok\":true}", fence].join("\n"),
    "Evidence",
    "Evidence"
  );
  const tilde = testPolicy.parseJsonSection(
    ["## Evidence", "~~~json", "{\"ok\":true}", "~~~"].join("\n"),
    "Evidence",
    "Evidence"
  );
  assert.deepEqual(backtick.value, { ok: true });
  assert.deepEqual(tilde.value, { ok: true });
  assert.deepEqual(backtick.errors, []);
  assert.deepEqual(tilde.errors, []);
});

test("record-verification requires the finding regression test to exist in HEAD", () => {
  const project = makeProject();
  init(project, 2);
  const evidence = setupAcceptedFinding(project, {
    id: "R1-F001-SEC", role: "SEC", original: "SEC-001", severity: "P1",
    slug: "r1_f001_auth",
  });
  run(project, ["advance", "--to", "repair"]);
  write(project, `${evidence}/implementation-result.md`, "# Implementation Result\n\n## RED Phase\nreproduced\n\n## GREEN Phase\nfixed\n");
  write(project, "src/app.js", "module.exports = 1;\n");
  write(project, "tests/app.test.js", "// existing formal repair test\n");
  execFileSync("git", ["add", "src/app.js", "tests/app.test.js"], { cwd: project });
  execFileSync("git", ["commit", "-qm", "fix(review): R1-F001-SEC"], { cwd: project });
  const repairCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" }).trim();
  run(project, [
    "record-implementation", "--id", "R1-F001-SEC", "--status", "fixed",
    "--commit", repairCommit, "--test", "tests/app.test.js",
  ]);
  run(project, ["advance", "--to", "verification"]);
  write(project, `${evidence}/verification-result.md`, "# Verification Result\n\n**Final Verdict**: pass\n");
  const adjacentTests = [
    "tests/review/verifications/r1_f001_auth_adjacent.test.js",
    "tests/review/verifications/r1_f001_auth_adjacent_edge.test.js",
  ];
  write(project, adjacentTests[0], "// adjacent regression\n");
  write(project, adjacentTests[1], "// adjacent edge regression\n");
  write(project, "tests/app.test.js", "// existing formal repair test\n// R1-F001-SEC merged adjacent assertion\n");

  const verificationArgs = [
    "record-verification", "--id", "R1-F001-SEC", "--status", "pass",
    "--adjacent-test", adjacentTests[0], "--adjacent-test", adjacentTests[1],
  ];
  run(project, verificationArgs);
  run(project, ["validate"]);
});

test("normalize repairs derived state fields", () => {
  const project = makeProject();
  init(project, 2);
  const statePath = path.join(project, ".review-evidence/state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.can_trigger_new_round = false;
  state.rounds_consumed = 99;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  run(project, ["normalize"]);
  const repaired = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(repaired.rounds_consumed, 0);
  assert.equal(repaired.can_trigger_new_round, true);
  run(project, ["validate"]);
});

test("invalid rounds fail validation and normalize without changing state", () => {
  const project = makeProject();
  init(project, 2);
  const statePath = path.join(project, ".review-evidence/state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.rounds = null;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  const originalState = fs.readFileSync(statePath, "utf8");

  const validation = run(project, ["validate"], { expectFail: true });
  assert.match(String(validation.stderr), /rounds 必须是数组/);
  assert.doesNotMatch(String(validation.stderr), /TypeError/);

  const normalization = run(project, ["normalize"], { expectFail: true });
  assert.match(String(normalization.stderr), /为避免丢失轮次历史，未修改文件/);
  assert.equal(fs.readFileSync(statePath, "utf8"), originalState);
});

test("help lists the full advanced parameter set", () => {
  const output = run(makeProject(), ["help"]);
  assert.match(output, /--change-origin/);
  assert.doesNotMatch(output, /--merged-test/);
  assert.match(output, /normalize/);
  assert.match(output, /--audit-attempt/);
});

test("guard-commit rejects user changes that were already staged", () => {
  const project = makeProject();
  init(project, 2);
  const evidence = setupAcceptedFinding(project, {
    id: "R1-F001-SEC", role: "SEC", original: "SEC-001", severity: "P1",
    slug: "r1_f001_auth",
  });
  write(project, "user.txt", "user change\n");
  execFileSync("git", ["add", "user.txt"], { cwd: project });
  run(project, ["advance", "--to", "repair"]);
  write(project, `${evidence}/implementation-result.md`, "# Implementation Result\n\n## RED Phase\nr\n\n## GREEN Phase\ng\n");
  write(project, "src/fix.js", "module.exports = 1;\n");
  write(project, "tests/fix.test.js", "// R1-F001-SEC\n");
  execFileSync("git", ["add", "src/fix.js", "tests/fix.test.js"], { cwd: project });
  testPolicyFixtures.writeGreenEvidence(
    project,
    evidence,
    testPolicyFixtures.git(project, ["write-tree"])
  );
  run(project, ["guard-commit", "--finding", "R1-F001-SEC", "--test", "tests/fix.test.js"], { expectFail: true });
  execFileSync("git", ["restore", "--staged", "user.txt"], { cwd: project });
  testPolicyFixtures.writeGreenEvidence(
    project,
    evidence,
    testPolicyFixtures.git(project, ["write-tree"])
  );
  run(project, ["guard-commit", "--finding", "R1-F001-SEC", "--test", "tests/fix.test.js"]);
});

test("quoted non-ASCII evidence paths cannot bypass repair commit guards", () => {
  const project = makeProject();
  execFileSync("git", ["config", "core.quotePath", "true"], { cwd: project });
  init(project, 2);
  const evidence = setupAcceptedFinding(project, {
    id: "R1-F001-SEC", role: "SEC", original: "SEC-001", severity: "P1",
    slug: "r1_f001_auth",
  });
  run(project, ["advance", "--to", "repair"]);
  write(project, `${evidence}/implementation-result.md`, "# Implementation Result\n\n## RED Phase\nreproduced\n\n## GREEN Phase\nfixed\n");
  write(project, `${evidence}/截图.txt`, "evidence\n");
  write(project, "src/fix.js", "module.exports = 1;\n");
  write(project, "tests/fix.test.js", "// R1-F001-SEC\n");
  execFileSync("git", ["add", "src/fix.js", "tests/fix.test.js", `${evidence}/截图.txt`], { cwd: project });

  const guarded = run(project, [
    "guard-commit", "--finding", "R1-F001-SEC", "--test", "tests/fix.test.js",
  ], { expectFail: true });
  assert.match(String(guarded.stderr), /不能包含.*\.review-evidence/i);

  execFileSync("git", ["commit", "-qm", "fix(review): quoted evidence path"], { cwd: project });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" }).trim();
  const implementation = run(project, [
    "record-implementation", "--id", "R1-F001-SEC", "--status", "fixed",
    "--commit", commit, "--test", "tests/fix.test.js",
  ], { expectFail: true });
  assert.match(String(implementation.stderr), /不能包含.*\.review-evidence/i);
});

test("P3 unclear_claim and rejected final-audit findings do not block convergence", () => {
  const config = { max_rounds: 2 };
  const state = {
    current_phase: "report",
    rounds_consumed: 2,
    final_audit_attempt: 1,
    final_audit: { attempts: [{ attempt: 1, status: "complete", new_issues: 1 }], reentry_pending: false },
  };
  const data = {
    findings: [
      {
        id: "R1-F001-SEC", role: "SEC", severity: "P3", decision: "needs-evidence",
        verification: "pending", reproduced: false, reproduction_status: "blocked",
        needs_evidence_clarity: "unclear_claim", change_origin: "undetermined",
        original_ids: ["SEC-001"], evidence_dir: ".review-evidence/round-1/R1-F001-SEC",
        source: "review",
      },
      {
        id: "R2-F001-FUNC", role: "FUNC", severity: "P2", decision: "rejected",
        verification: "pending", reproduced: false, reproduction_status: "not-reproduced",
        change_origin: "pre-existing", original_ids: ["FA-001"],
        evidence_dir: ".review-evidence/round-2/R2-F001-FUNC",
        source: "final-audit", audit_attempt: 1,
      },
    ],
  };
  const reasons = convergenceReasons(state, config, data, "converged", { ackEmptyCoverage: true });
  assert.equal(reasons.length, 0);

  const acceptedAuditData = {
    findings: [
      {
        id: "R1-F001-SEC", role: "SEC", severity: "P1", decision: "accepted",
        verification: "pass", implementation_status: "fixed", commit: "abcdef1",
        test_files: ["tests/app.test.js"], adjacent_tests: [],
        reproduced: true, reproduction_status: "reproduced", change_origin: "pre-existing",
        original_ids: ["SEC-001"], evidence_dir: ".review-evidence/round-1/R1-F001-SEC",
        source: "final-audit", audit_attempt: 1, manual: false,
      },
    ],
  };
  const acceptedReasons = convergenceReasons(state, config, acceptedAuditData, "converged");
  assert.ok(acceptedReasons.some((reason) => /accepted finding/.test(reason)));
  const mismatchState = {
    ...state,
    final_audit: { attempts: [{ attempt: 1, status: "complete", new_issues: 2 }], reentry_pending: false },
  };
  const mismatchReasons = convergenceReasons(mismatchState, config, acceptedAuditData, "converged");
  assert.ok(mismatchReasons.some((reason) => /报告了 2 个新问题/.test(reason)));

  const emptyState = {
    current_phase: "report",
    rounds_consumed: 2,
    final_audit_attempt: 1,
    final_audit: { attempts: [{ attempt: 1, status: "complete", new_issues: 0 }], reentry_pending: false },
  };
  const emptyReasons = convergenceReasons(emptyState, config, { findings: [] }, "converged", {
    ackEmptyCoverage: true,
  });
  assert.equal(emptyReasons.length, 0);
});

test("deferred P0/P1 findings block both converged statuses", () => {
  const config = { max_rounds: 2 };
  const state = {
    current_phase: "report",
    rounds_consumed: 2,
    final_audit_attempt: 1,
    final_audit: { attempts: [{ attempt: 1, status: "complete", new_issues: 0 }], reentry_pending: false },
  };
  const data = {
    findings: [
      {
        id: "R1-F001-SEC", role: "SEC", severity: "P1", decision: "deferred",
        verification: "pending", reproduced: true, reproduction_status: "reproduced",
        deferred_reason: "needs architecture", disposition_plan: "next release",
        change_origin: "pre-existing", original_ids: ["SEC-001"],
        evidence_dir: ".review-evidence/round-1/R1-F001-SEC", source: "review",
      },
    ],
  };

  for (const target of ["converged", "converged_with_manual_merge"]) {
    const reasons = convergenceReasons(state, config, data, target, { ackEmptyCoverage: true });
    assert.ok(
      reasons.some((reason) => /deferred.*P1|P1.*deferred/.test(reason)),
      `${target} must be blocked by deferred P1`
    );
  }
});

test("a failed final audit can report INCOMPLETE", () => {
  const project = makeProject();
  setupTwoCleanRounds(project);
  run(project, [
    "record-audit", "--attempt", "1", "--status", "failed", "--new-issues", "0",
    "--auditor", "test-auditor",
  ]);
  run(project, ["advance", "--to", "report"]);
  run(project, ["finalize", "--status", "incomplete"]);
  const state = JSON.parse(
    fs.readFileSync(path.join(project, ".review-evidence/state.json"), "utf8")
  );
  assert.equal(state.overall_status, "incomplete");
});

test("re-entered final audit requires its own recorded result", () => {
  const project = makeProject();
  init(project, 3);
  for (const round of [1, 2]) {
    run(project, ["advance", "--to", "review"]);
    addRoundHandoffs(project, round);
    run(project, ["record-round", "--round", String(round), "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
    run(project, ["advance", "--to", "adjudication"]);
    run(project, ["advance", "--to", "round_decision"]);
  }
  run(project, ["advance", "--to", "final_audit"]);
  const audit1 = ".review-evidence/round-2/final-audit/attempt-1";
  write(project, `${audit1}/blind-scan.md`, "# Blind Scan\n");
  write(project, `${audit1}/targeted-review.md`, "# Targeted Review\n");
  run(project, ["record-audit", "--attempt", "1", "--status", "complete", "--new-issues", "1", "--auditor", "test-auditor"]);
  run(project, ["advance", "--to", "adjudication"]);

  const evidence = ".review-evidence/round-2/R2-F001-FUNC";
  write(project, `${evidence}/counterexample.md`, "# Counterexample\n");
  write(project, `${evidence}/adjudication.md`, "# Adjudication\n\n## Decision\n**Status**: rejected\n");
  write(project, `${evidence}/replay-review.md`, "# Replay Review\n\n**Status**: not-reproduced\n");
  write(project, `${evidence}/reproduce.test.js`, "// repro\n");
  run(project, [
    "record-finding", "--id", "R2-F001-FUNC", "--role", "FUNC", "--original-id", "FA-001",
    "--severity", "P2", "--decision", "rejected", "--reproduced", "false",
    "--reproduction-status", "not-reproduced", "--evidence-dir", evidence,
    "--change-origin", "pre-existing", "--source", "final-audit", "--audit-attempt", "1",
  ]);
  run(project, ["advance", "--to", "round_decision"]);
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 3);
  run(project, ["record-round", "--round", "3", "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
  run(project, ["advance", "--to", "adjudication"]);
  run(project, ["advance", "--to", "round_decision"]);
  run(project, ["advance", "--to", "final_audit"]);

  const statePath = path.join(project, ".review-evidence/state.json");
  const state = () => JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(state().final_audit_attempt, 2);
  assert.equal(state().final_audit.reentry_pending, true);
  assertCommandFails(project, ["advance", "--to", "adjudication"]);
  assertCommandFails(project, ["advance", "--to", "report"]);
  assert.equal(state().current_phase, "final_audit");
  const unrecordedAttempt2 = state();
  unrecordedAttempt2.current_phase = "report";
  writeJson(project, ".review-evidence/state.json", unrecordedAttempt2);
  assertCommandFails(project, ["finalize", "--status", "converged"]);
  unrecordedAttempt2.current_phase = "final_audit";
  writeJson(project, ".review-evidence/state.json", unrecordedAttempt2);

  const audit2 = ".review-evidence/round-3/final-audit/attempt-2";
  write(project, `${audit2}/blind-scan.md`, "# Blind Scan\n");
  write(project, `${audit2}/targeted-review.md`, "# Targeted Review\n");
  run(project, ["record-audit", "--attempt", "2", "--status", "complete", "--new-issues", "0", "--auditor", "test-auditor"]);
  run(project, ["advance", "--to", "report"]);
  run(project, ["finalize", "--status", "converged"]);

  const initialAudit = makeProject();
  setupTwoCleanRounds(initialAudit);
  assertCommandFails(initialAudit, ["advance", "--to", "report"]);
  const initialState = JSON.parse(fs.readFileSync(path.join(initialAudit, ".review-evidence/state.json"), "utf8"));
  assert.equal(initialState.final_audit.reentry_pending, false);
  assert.equal(initialState.current_phase, "final_audit");
});

test("accepted final-audit finding can trigger a new round and re-audit", () => {
  const project = makeProject();
  init(project, 3);
  for (const round of [1, 2]) {
    run(project, ["advance", "--to", "review"]);
    addRoundHandoffs(project, round);
    run(project, ["record-round", "--round", String(round), "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
    run(project, ["advance", "--to", "adjudication"]);
    run(project, ["advance", "--to", "round_decision"]);
  }
  run(project, ["advance", "--to", "final_audit"]);
  const audit1 = ".review-evidence/round-2/final-audit/attempt-1";
  write(project, `${audit1}/blind-scan.md`, "# Blind Scan\n");
  write(project, `${audit1}/targeted-review.md`, "# Targeted Review\n");
  run(project, ["record-audit", "--attempt", "1", "--status", "complete", "--new-issues", "1", "--auditor", "test-auditor"]);
  run(project, ["advance", "--to", "adjudication"]);

  const evidence = ".review-evidence/round-2/R2-F001-FUNC";
  write(project, `${evidence}/counterexample.md`, "# Counterexample\n");
  write(project, `${evidence}/adjudication.md`, "# Adjudication\n\n## Decision\n**Status**: accepted\n");
  write(project, `${evidence}/replay-review.md`, "# Replay Review\n\n**Status**: reproduced\n");
  write(project, `${evidence}/reproduce.test.js`, "// repro\n");
  write(project, "tests/review/reproductions/r2_f001_audit.test.js", "// formal repro\n");
  run(project, [
    "record-finding", "--id", "R2-F001-FUNC", "--role", "FUNC", "--original-id", "FA-001",
    "--severity", "P2", "--decision", "accepted", "--reproduced", "true",
    "--reproduction-status", "reproduced", "--evidence-dir", evidence,
    "--change-origin", "pre-existing", "--source", "final-audit", "--audit-attempt", "1",
  ]);
  run(project, ["advance", "--to", "repair"]);
  write(project, `${evidence}/implementation-result.md`, "# Implementation Result\n\n## RED Phase\nr\n\n## GREEN Phase\ng\n");
  write(project, "src/audit-fix.js", "module.exports = 1;\n");
  write(project, "tests/audit-fix.test.js", "// R2-F001-FUNC\n");
  execFileSync("git", ["add", "src/audit-fix.js", "tests/audit-fix.test.js"], { cwd: project });
  execFileSync("git", ["commit", "-qm", "fix(review): R2-F001-FUNC"], { cwd: project });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" }).trim();
  run(project, [
    "record-implementation", "--id", "R2-F001-FUNC", "--status", "fixed",
    "--commit", commit, "--test", "tests/audit-fix.test.js",
  ]);
  run(project, ["advance", "--to", "verification"]);
  write(project, `${evidence}/verification-result.md`, "# Verification Result\n\n**Final Verdict**: pass\n");
  write(project, "tests/review/verifications/r2_f001_audit_adjacent.test.js", "// adjacent\n");
  write(project, "tests/review/verifications/r2_f001_audit_adjacent_edge.test.js", "// adjacent edge\n");
  run(project, [
    "record-verification", "--id", "R2-F001-FUNC", "--status", "pass",
    "--adjacent-test", "tests/review/verifications/r2_f001_audit_adjacent.test.js",
    "--adjacent-test", "tests/review/verifications/r2_f001_audit_adjacent_edge.test.js",
  ]);
  run(project, ["advance", "--to", "round_decision"]);
  run(project, ["advance", "--to", "review"]);

  addRoundHandoffs(project, 3);
  run(project, ["record-round", "--round", "3", "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
  run(project, ["advance", "--to", "adjudication"]);
  run(project, ["advance", "--to", "round_decision"]);
  const missingReentryBatch = run(project, ["advance", "--to", "final_audit"], { expectFail: true });
  assert.match(String(missingReentryBatch.stderr), /全历史相邻测试/);
  run(project, ["advance", "--to", "final_audit"]);

  const audit2 = ".review-evidence/round-3/final-audit/attempt-2";
  write(project, `${audit2}/blind-scan.md`, "# Blind Scan\n");
  write(project, `${audit2}/targeted-review.md`, "# Targeted Review\n");
  run(project, ["record-audit", "--attempt", "2", "--status", "complete", "--new-issues", "0", "--auditor", "test-auditor"]);
  run(project, ["advance", "--to", "report"]);
  run(project, ["finalize", "--status", "converged"]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
