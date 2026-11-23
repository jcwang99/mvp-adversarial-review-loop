const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { hasRunMarkers } = require("./lib/test-policy");

const cli = path.join(__dirname, "reviewctl.js");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reviewctl-logged-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, "evidence directory", "run.log");
  const run = (command, ...flags) => spawnSync(process.execPath,
    [cli, "run-logged", "--project", dir, "--command", command, "--log", log, ...flags], { encoding: "utf8" });
  return { dir, log, run };
}

test("captures both streams directly to one file and returns the real exit code", t => {
  const { dir, log, run } = fixture(t);
  fs.writeFileSync(path.join(dir, "run once.js"), [
    'const fs = require("node:fs");',
    'fs.appendFileSync("executions", "1");',
    'fs.writeSync(1, "开始\\n" + "x".repeat(2 * 1024 * 1024) + "\\n");',
    'fs.writeSync(2, "failed test near the middle\\n");',
    'fs.writeSync(1, "end without newline");',
    'process.exitCode = 17;',
  ].join("\n"));
  const command = 'node "run once.js"';
  const result = run(command);
  assert.equal(result.status, 17, result.stderr);
  const text = fs.readFileSync(log, "utf8");
  assert.ok(text.includes("开始\n" + "x".repeat(2 * 1024 * 1024) + "\nfailed test near the middle\nend without newline\nEXIT_CODE=17\n"));
  assert.ok(hasRunMarkers(log, command, 17));
  assert.ok(result.stdout.includes(log) && result.stdout.includes("EXIT_CODE=17"));
  assert.ok(result.stdout.length + result.stderr.length < 1024);
  assert.notEqual(run(command).status, 0);
  assert.equal(fs.readFileSync(log, "utf8"), text);
  assert.equal(fs.readFileSync(path.join(dir, "executions"), "utf8"), "1");
});

test("quality logs use the exact declared compound command and its status", t => {
  const { dir, log, run } = fixture(t);
  fs.writeFileSync(path.join(dir, "check.js"), 'console.log(process.argv[2]);\n');
  const command = 'node check.js first && node check.js "second part"';
  assert.equal(run(command, "--quality").status, 0);
  assert.ok(hasRunMarkers(log, command, 0, "QUALITY_COMMAND"));
  assert.match(fs.readFileSync(log, "utf8"), /first\r?\nsecond part/);
});

test("candidate quality evidence refers to the assigned worktree's tree", t => {
  const { dir, log, run } = fixture(t);
  function git(...args) {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git("init", "-q");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@example.org", "commit", "--allow-empty", "-qm", "initial");
  const tree = git("rev-parse", "HEAD^{tree}");
  const command = 'node --version';
  assert.equal(run(command, "--quality", "--candidate").status, 0);
  assert.ok(hasRunMarkers(log, command, 0, "QUALITY_COMMAND"));
  assert.ok(fs.readFileSync(log, "utf8").split("\n").includes("QUALITY_TREE_HASH=" + tree));
});

test("shell launch failure preserves the log without a terminal exit marker", t => {
  const { dir, log, run } = fixture(t);
  const result = run("node --version", "--shell", path.join(dir, "missing-shell"));
  assert.notEqual(result.status, 0);
  const text = fs.readFileSync(log, "utf8");
  assert.match(text, /RUN_ERROR=.*ENOENT/);
  assert.doesNotMatch(text, /^EXIT_CODE=/m);
});

test("PowerShell commands preserve native failures and quoted arguments", { skip: process.platform !== "win32" }, t => {
  const { dir, log, run } = fixture(t);
  fs.writeFileSync(path.join(dir, "tool.js"), 'console.log(process.argv[2]); process.exitCode = 19;');
  const command = '$message = "two words"; node tool.js $message';
  const result = run(command, "--shell", "powershell");
  assert.equal(result.status, 19, result.stderr);
  assert.ok(hasRunMarkers(log, command, 19));
  assert.match(fs.readFileSync(log, "utf8"), /^two words\r?$/m);
});

test("an unquoted command fragment is rejected before the test starts", t => {
  const { log, run } = fixture(t);
  for (const fragment of ["extra-argument", "--extra-option"]) {
    assert.notEqual(run("node --version", fragment).status, 0);
    assert.equal(fs.existsSync(log), false);
  }
});
