#!/usr/bin/env node

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
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
}

function addRoundHandoffs(project, round) {
  writeHandoff(project, round, "SEC", `SEC-00${round}`);
  writeHandoff(project, round, "FUNC", `FUNC-00${round}`);
  writeHandoff(project, round, "REL", `REL-00${round}`);
}

function setupAcceptedFinding(project, { id, role, original, severity, slug }) {
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
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
  fs.unlinkSync(path.join(project, ".review-evidence/review-config.json"));
  run(project, ["init", "--max-rounds", "2", "--user-confirmed"], { expectFail: true });
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
    "--merged-test",
    "tests/app.test.js",
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
  run(project, ["record-round", "--round", "2", "--raw", "1", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
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
  write(project, `${evidence}/implementation-result.md`, "# Implementation Result\n\nDetails omitted.\n");
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
  assert.match(String(validation.stderr), /RED\/GREEN/);
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

test("record-verification requires the merged finding test to exist in HEAD", () => {
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
    "--merged-test", "tests/app.test.js",
  ];
  const uncommittedVerification = run(project, verificationArgs, { expectFail: true });
  assert.match(String(uncommittedVerification.stderr), /HEAD|提交|finding ID/i);

  const findingsPath = path.join(project, ".review-evidence/findings.json");
  const findings = JSON.parse(fs.readFileSync(findingsPath, "utf8"));
  const finding = findings.findings.find((entry) => entry.id === "R1-F001-SEC");
  const assertValidationRejectsUnmergedTest = () => {
    finding.verification = "pass";
    finding.adjacent_tests = adjacentTests;
    finding.merged_tests = ["tests/app.test.js"];
    writeJson(project, ".review-evidence/findings.json", findings);
    run(project, ["render"]);
    const validation = run(project, ["validate"], { expectFail: true });
    assert.match(String(validation.stderr), /merged_tests .*HEAD|merged_tests .*finding ID|内容不一致/);

    finding.verification = "pending";
    finding.adjacent_tests = [];
    finding.merged_tests = [];
    finding.verified_at = null;
    writeJson(project, ".review-evidence/findings.json", findings);
    run(project, ["render"]);
  };
  assertValidationRejectsUnmergedTest();

  const headTest = "// existing formal repair test\n// R1-F001-SEC repair assertion\n";
  write(project, "tests/app.test.js", headTest);
  execFileSync("git", ["add", "tests/app.test.js"], { cwd: project });
  execFileSync("git", ["commit", "-qm", "test(review): merge R1-F001-SEC adjacent tests"], { cwd: project });

  write(project, "tests/app.test.js", `${headTest}// merged adjacent assertion\n`);
  const uncommittedAssertion = run(project, verificationArgs, { expectFail: true });
  assert.match(String(uncommittedAssertion.stderr), /HEAD|提交|内容不一致/i);
  assertValidationRejectsUnmergedTest();

  execFileSync("git", ["add", "tests/app.test.js"], { cwd: project });
  const stagedAssertion = run(project, verificationArgs, { expectFail: true });
  assert.match(String(stagedAssertion.stderr), /HEAD|提交|内容不一致/i);
  assertValidationRejectsUnmergedTest();

  execFileSync("git", ["commit", "-qm", "test(review): commit R1-F001-SEC adjacent assertion"], { cwd: project });
  run(project, verificationArgs);
  run(project, ["validate"]);
});

test("record-verification rejects a symlink-mode merged formal test", () => {
  const project = makeProject();
  init(project, 2);
  const evidence = setupAcceptedFinding(project, {
    id: "R1-F001-SEC", role: "SEC", original: "SEC-001", severity: "P1",
    slug: "r1_f001_auth",
  });
  run(project, ["advance", "--to", "repair"]);
  write(project, `${evidence}/implementation-result.md`, "# Implementation Result\n\n## RED Phase\nreproduced\n\n## GREEN Phase\nfixed\n");
  write(project, "src/app.js", "module.exports = 1;\n");
  write(project, "tests/app.test.js", "// R1-F001-SEC repair assertion\n");
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
  write(project, "tests/app.test.js", "// R1-F001-SEC repair assertion\n// R1-F001-SEC merged assertion\n");
  execFileSync("git", ["add", "tests/app.test.js"], { cwd: project });
  execFileSync("git", ["commit", "-qm", "test(review): merge R1-F001-SEC adjacent tests"], { cwd: project });

  const blob = execFileSync("git", ["hash-object", "tests/app.test.js"], {
    cwd: project,
    encoding: "utf8",
  }).trim();
  execFileSync("git", [
    "update-index", "--add", "--cacheinfo", `120000,${blob},tests/app.test.js`,
  ], { cwd: project });
  execFileSync("git", ["commit", "-qm", "test(review): represent merged test as symlink"], { cwd: project });

  const verification = run(project, [
    "record-verification", "--id", "R1-F001-SEC", "--status", "pass",
    "--adjacent-test", adjacentTests[0], "--adjacent-test", adjacentTests[1],
    "--merged-test", "tests/app.test.js",
  ], { expectFail: true });
  assert.match(String(verification.stderr), /HEAD|普通文件/i);
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

test("help lists the full advanced parameter set", () => {
  const output = run(makeProject(), ["help"]);
  assert.match(output, /--change-origin/);
  assert.match(output, /--merged-test/);
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
  run(project, ["guard-commit", "--finding", "R1-F001-SEC", "--test", "tests/fix.test.js"], { expectFail: true });
  execFileSync("git", ["restore", "--staged", "user.txt"], { cwd: project });
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
        test_files: ["tests/app.test.js"], adjacent_tests: [], merged_tests: [],
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
    "--merged-test", "tests/audit-fix.test.js",
  ]);
  run(project, ["advance", "--to", "round_decision"]);
  run(project, ["advance", "--to", "review"]);

  addRoundHandoffs(project, 3);
  run(project, ["record-round", "--round", "3", "--raw", "0", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "0"]);
  run(project, ["advance", "--to", "adjudication"]);
  run(project, ["advance", "--to", "round_decision"]);
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
