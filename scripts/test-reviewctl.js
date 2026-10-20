#!/usr/bin/env node

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

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
  try {
    const output = execFileSync(
      process.execPath,
      [CLI, ...args, "--project", project],
      { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    if (expectFail) throw new Error(`expected failure: ${args.join(" ")}`);
    return output;
  } catch (error) {
    if (expectFail) return error;
    const stderr = error.stderr ? String(error.stderr) : "";
    const stdout = error.stdout ? String(error.stdout) : "";
    throw new Error(
      `command failed: reviewctl ${args.join(" ")}\n${stdout}${stderr}`
    );
  }
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
});

test("init refuses missing user confirmation or invalid max_rounds", () => {
  const project = makeProject();
  run(project, ["init", "--max-rounds", "3"], { expectFail: true });
  run(project, ["init", "--max-rounds", "1", "--user-confirmed"], {
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
  run(project, findingArgs);
  run(project, ["advance", "--to", "repair"]);
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
  write(project, `${evidence}/verification-result.md`, "# Verification Result\n\n**Final Verdict**: pass\n");
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
  run(project, ["validate"]);
});

test("final audit new issue at max_rounds reports incomplete", () => {
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
  ]);
  run(project, ["advance", "--to", "report"], { expectFail: true });
  run(project, ["advance", "--to", "adjudication"]);

  const evidence = ".review-evidence/round-2/R2-F001-FUNC";
  write(project, `${evidence}/counterexample.md`, "# Counterexample\n");
  write(project, `${evidence}/adjudication.md`, "# Adjudication\n\n## Decision\n**Status**: rejected\n");
  write(project, `${evidence}/reproduce.test.js`, "// repro\n");
  run(project, [
    "record-finding",
    "--id",
    "R2-F001-FUNC",
    "--role",
    "FUNC",
    "--original-id",
    "FUNC-002",
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
  ]);
  run(project, ["advance", "--to", "round_decision"]);
  run(project, ["advance", "--to", "report"]);
  run(project, ["finalize", "--status", "incomplete"]);
  const state = JSON.parse(
    fs.readFileSync(path.join(project, ".review-evidence/state.json"), "utf8")
  );
  assert.equal(state.overall_status, "incomplete");
});

test("blocked finding can advance to the next finding", () => {
  const project = makeProject();
  init(project, 2);
  run(project, ["advance", "--to", "review"]);
  addRoundHandoffs(project, 1);
  run(project, ["record-round", "--round", "1", "--raw", "2", "--duplicates", "0", "--screened", "0", "--new-p0p1p2", "1"]);
  run(project, ["advance", "--to", "adjudication"]);

  function addFinding({ id, role, original, severity, slug, challenge }) {
    const evidence = `.review-evidence/round-1/${id}`;
    write(project, `${evidence}/counterexample.md`, "# Counterexample\n");
    write(project, `${evidence}/adjudication.md`, "# Adjudication\n\n## Decision\n**Status**: accepted\n");
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
    "record-verification", "--id", "R1-F001-SEC", "--status", "blocked_by_user_changes",
  ]);
  run(project, ["next-finding"]);
  const state = JSON.parse(
    fs.readFileSync(path.join(project, ".review-evidence/state.json"), "utf8")
  );
  assert.equal(state.active_finding, "R1-F002-FUNC");
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
