#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { captureStagedBaseline, clearStagedBaseline } = require("./lib/staged-baseline");
const { guardCommit } = require("./lib/validate");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "reviewctl-staged-guard-"));
let passed = 0;
const id = "R1-F001-SEC";
const evidenceDir = ".review-evidence/round-1/R1-F001-SEC";
const data = { findings: [{ id, decision: "accepted", evidence_dir: evidenceDir }] };
const original = ["function user() { return 1; }", ...Array.from({ length: 14 }, (_, i) => `// spacer ${i}`),
  "function repair() { return 1; }", ""].join("\n");
const user = original.replace("user() { return 1", "user() { return 2");
const repair = original.replace("repair() { return 1", "repair() { return 2");
const both = user.replace("repair() { return 1", "repair() { return 2");
function git(dir, args) {
  return execFileSync("git", ["--literal-pathspecs", ...args], {
    cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}
function write(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}
function test(name, run) {
  const dir = path.join(root, String(passed));
  fs.mkdirSync(dir);
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.name", "Guard Test"]);
  git(dir, ["config", "user.email", "guard@example.com"]);
  git(dir, ["config", "core.autocrlf", "false"]);
  write(dir, "source.js", original);
  write(dir, "other.js", "module.exports = 1;\n");
  git(dir, ["add", "source.js", "other.js"]);
  git(dir, ["commit", "-qm", "base"]);
  write(dir, `${evidenceDir}/implementation-result.md`, "Fixed\n");
  write(dir, "source.js", user);
  git(dir, ["add", "source.js"]);
  const state = {};
  captureStagedBaseline(dir, state);
  run(dir, state);
  passed++;
  console.log(`PASS ${name}`);
}
function stageRepair(dir) {
  git(dir, ["restore", "--staged", "source.js"]);
  write(dir, "source.js", repair);
  git(dir, ["add", "source.js"]);
  write(dir, "source.js", both);
}
function guard(dir, state) {
  const indexBefore = fs.readFileSync(path.join(dir, ".git/index"));
  const workingBefore = fs.readFileSync(path.join(dir, "source.js"));
  const errors = guardCommit(dir, id, [], data, state);
  assert.deepEqual(fs.readFileSync(path.join(dir, ".git/index")), indexBefore, "guard must not write index");
  assert.deepEqual(fs.readFileSync(path.join(dir, "source.js")), workingBefore, "guard must preserve user changes");
  return errors;
}
function blocked(dir, state, reason) {
  assert.match(guard(dir, state).join("\n"), reason);
}
try {
  test("independent repair hunk passes; unstaged user hunk and index stay unchanged", (dir, state) => {
    stageRepair(dir);
    assert.deepEqual(guard(dir, state), []);
    assert.equal(git(dir, ["show", ":source.js"]), repair);
    assert.equal(fs.readFileSync(path.join(dir, "source.js"), "utf8"), both);
  });
  test("original user hunk still staged is rejected", (dir, state) => blocked(dir, state, /用户改动/));
  test("both user and repair hunks staged are rejected", (dir, state) => {
    write(dir, "source.js", both);
    git(dir, ["add", "source.js"]);
    blocked(dir, state, /用户改动/);
  });
  test("different repair on the user's original lines is rejected", (dir, state) => {
    write(dir, "source.js", original.replace("user() { return 1", "user() { return 3"));
    git(dir, ["add", "source.js"]);
    blocked(dir, state, /用户改动/);
  });
  test("unrelated source file passes while user change remains unstaged", (dir, state) => {
    git(dir, ["restore", "--staged", "source.js"]);
    write(dir, "other.js", "module.exports = 2;\n");
    git(dir, ["add", "other.js"]);
    assert.deepEqual(guard(dir, state), []);
    assert.equal(fs.readFileSync(path.join(dir, "source.js"), "utf8"), user);
  });
  test("legacy path-only baseline rejects same path without pretending unstage fixes it", (dir, state) => {
    delete state.repair_baseline_index;
    stageRepair(dir);
    blocked(dir, state, /旧状态缺少暂存内容基线/);
  });
  test("changed HEAD rejects stale coordinates", (dir, state) => {
    git(dir, ["restore", "--staged", "source.js"]);
    write(dir, "other.js", "module.exports = 2;\n");
    git(dir, ["add", "other.js"]);
    git(dir, ["commit", "-qm", "other change"]);
    stageRepair(dir);
    blocked(dir, state, /HEAD 已变化/);
  });
  test("binary content is conservatively rejected", (dir, state) => {
    write(dir, "source.js", Buffer.from("binary\0user"));
    git(dir, ["add", "source.js"]);
    captureStagedBaseline(dir, state);
    write(dir, "source.js", Buffer.from("binary\0repair"));
    git(dir, ["add", "source.js"]);
    blocked(dir, state, /无法安全分离/);
  });
  test("rename cannot hide original user hunk", (dir, state) => {
    git(dir, ["mv", "source.js", "renamed.js"]);
    // Keep an unstaged copy so the read-only assertion also checks the old path.
    write(dir, "source.js", user);
    blocked(dir, state, /无法安全分离/);
  });
  test("insertion touching the user's replacement is ambiguous", (dir, state) => {
    write(dir, "source.js", original.replace("function user()", "// nearby repair\nfunction user()"));
    git(dir, ["add", "source.js"]);
    blocked(dir, state, /用户改动/);
  });
  test("repeated removed lines are conservatively rejected even with disjoint diff ranges", (dir, state) => {
    const repeated = [...Array(20).fill("// repeated"), "// separator", "function repair() { return 1; }", ""].join("\n");
    git(dir, ["restore", "--staged", "source.js"]);
    write(dir, "source.js", repeated);
    git(dir, ["add", "source.js"]);
    git(dir, ["commit", "-qm", "repeated base"]);
    // Git anchors the deletion at the end of the repeated run; the three-line
    // context then includes the nearby repair, so ownership is ambiguous.
    write(dir, "source.js", repeated.replace("// repeated\n", ""));
    git(dir, ["add", "source.js"]);
    captureStagedBaseline(dir, state);
    write(dir, "source.js", repeated.replace("repair() { return 1", "repair() { return 2"));
    git(dir, ["add", "source.js"]);
    blocked(dir, state, /重复文本/);
  });
  test("duplicate return statements can be separated using restored unique function context", (dir, state) => {
    const multi = ["function user() {", "  return 1;", "}", ...Array(14).fill("// spacer"),
      "function repair() {", "  return 1;", "}", ""].join("\n");
    git(dir, ["restore", "--staged", "source.js"]);
    write(dir, "source.js", multi);
    git(dir, ["add", "source.js"]);
    git(dir, ["commit", "-qm", "multiline base"]);
    write(dir, "source.js", multi.replace("user() {\n  return 1", "user() {\n  return 2"));
    git(dir, ["add", "source.js"]);
    captureStagedBaseline(dir, state);
    const fix = multi.replace("repair() {\n  return 1", "repair() {\n  return 2");
    write(dir, "source.js", fix);
    git(dir, ["add", "source.js"]);
    write(dir, "source.js", fix.replace("user() {\n  return 1", "user() {\n  return 2"));
    assert.deepEqual(guard(dir, state), []);
  });
  test("original counterexample: opposite boolean return changes in independent functions", (dir, state) => {
    const base = ["function calculateFixture() {", "  return true;", "}", ...Array(14).fill(""),
      "function userPreference() {", "  return false;", "}", ""].join("\n");
    git(dir, ["restore", "--staged", "source.js"]);
    write(dir, "source.js", base);
    git(dir, ["add", "source.js"]);
    git(dir, ["commit", "-qm", "original counterexample base"]);
    const userEdit = base.replace("userPreference() {\n  return false", "userPreference() {\n  return true");
    write(dir, "source.js", userEdit);
    git(dir, ["add", "source.js"]);
    captureStagedBaseline(dir, state);
    blocked(dir, state, /用户改动/);
    const fix = base.replace("calculateFixture() {\n  return true", "calculateFixture() {\n  return false");
    const combined = userEdit.replace("calculateFixture() {\n  return true", "calculateFixture() {\n  return false");
    git(dir, ["restore", "--staged", "source.js"]);
    write(dir, "source.js", fix);
    git(dir, ["add", "source.js"]);
    write(dir, "source.js", combined);
    assert.deepEqual(guard(dir, state), []);
    assert.equal(git(dir, ["show", ":source.js"]), fix);
    assert.equal(fs.readFileSync(path.join(dir, "source.js"), "utf8"), combined);
    git(dir, ["add", "source.js"]);
    blocked(dir, state, /用户改动/);
  });
  test("clearing baseline clears both paths and content", (dir, state) => {
    clearStagedBaseline(state);
    assert.deepEqual(state.repair_baseline_staged, []);
    assert.equal(state.repair_baseline_index, null);
  });
  console.log(`${passed} staged guard tests passed`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
