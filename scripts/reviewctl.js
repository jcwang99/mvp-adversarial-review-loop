#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { execFileSync } = require("node:child_process");

const {
  EVIDENCE,
  PHASES,
  TRANSITIONS,
  DECISIONS,
  VERIFICATIONS,
  SEVERITIES,
  CHANGE_ORIGINS,
  NEEDS_CLARITY,
  ROLES,
  FINDING_ID,
  TEMP_ID,
  now,
  ensureDir,
  writeTextAtomic,
  readText,
  gitHead,
  roleSlug,
  isRole,
  defaultConfig,
  defaultState,
  defaultFindings,
  loadConfig,
  loadState,
  loadFindings,
  saveConfig,
  saveState,
  saveFindings,
  canTriggerNewRound,
  roundEntry,
  ensureRound,
  completedRounds,
  lastAudit,
  validateConfig,
  validateState,
  validateFindings,
  isTerminal,
  coverage,
  convergenceReasons,
} = require("./lib/state");
const { writeViews } = require("./lib/render");
const { validateProject, validateInbox, guardCommit } = require("./lib/validate");

const REPEATABLE = new Set(["test", "original-id", "adjacent-test"]);

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    let key = arg.slice(2);
    let value = true;
    const equal = key.indexOf("=");
    if (equal >= 0) {
      value = key.slice(equal + 1);
      key = key.slice(0, equal);
    } else if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
      value = argv[index + 1];
      index += 1;
    }
    if (REPEATABLE.has(key)) {
      if (!Array.isArray(flags[key])) flags[key] = [];
      flags[key].push(value);
    } else {
      flags[key] = value;
    }
  }
  return { flags, positionals };
}

function fail(message) {
  const error = new Error(message);
  error.userFacing = true;
  throw error;
}

function boolFlag(value, name, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  fail(`${name} 必须是 true 或 false`);
}

function intFlag(value, name) {
  if (value === undefined || value === true || !/^\d+$/.test(String(value))) {
    fail(`${name} 必须是非负整数`);
  }
  return Number(value);
}

function stringFlag(flags, name, { required = false, fallback = null } = {}) {
  const value = flags[name];
  if (value === undefined || value === true || String(value).trim() === "") {
    if (required) fail(`缺少 --${name}`);
    return fallback;
  }
  return String(value);
}

function projectRoot(flags) {
  return path.resolve(stringFlag(flags, "project", { fallback: process.cwd() }));
}

function loadAll(project) {
  const config = loadConfig(project);
  const state = loadState(project);
  const data = loadFindings(project);
  return { config, state, data };
}

function persist(project, config, state, data) {
  state.can_trigger_new_round = state.rounds_consumed < config.max_rounds;
  state.current_head = gitHead(project);
  saveState(project, state);
  saveFindings(project, data);
  writeViews(project, state, config, data);
}

function event(state, phase, nextAction) {
  state.current_phase = phase;
  state.last_completed_event = `entered ${phase}`;
  state.next_action = nextAction;
}

function initTemplates(project) {
  const baseline = path.join(project, EVIDENCE, "baseline.md");
  if (!fs.existsSync(baseline)) {
    writeTextAtomic(
      baseline,
      [
        "# Review Baseline",
        "",
        "## MVP Scope",
        "- Included: [TODO]",
        "- Explicitly excluded: [TODO]",
        "- Acceptance criteria and source: [TODO]",
        "",
        "## Repository",
        "- Baseline HEAD: [TODO]",
        "- Initial git status: [TODO]",
        "",
        "## Verification",
        "- Unit/integration/E2E commands: [TODO]",
        "- Build/type-check/lint/security commands: [TODO]",
        "- Baseline results: [TODO]",
        "",
        "## Review",
        "- max_rounds: [见 review-config.json]",
        "",
        "## Recovery Guide Deployment",
        "- Target file: [TODO]",
        "- Mode: [TODO]",
        "- Backup: [TODO]",
        "",
      ].join("\n")
    );
  }
  const screening = path.join(project, EVIDENCE, "screening-log.md");
  if (!fs.existsSync(screening)) {
    writeTextAtomic(
      screening,
      "# Screening Log\n\n按轮次记录 raw_candidates、duplicates、screened_out 和处理理由。\n"
    );
  }
}

async function commandInit(flags) {
  const project = projectRoot(flags);
  const evidence = path.join(project, EVIDENCE);
  if (fs.existsSync(path.join(evidence, "review-config.json"))) {
    fail("review-config.json 已存在；不能重复 init");
  }

  let maxRounds;
  let mode;
  if (flags.interactive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("常规评审轮上限 max_rounds（默认 5，最小 2）: ");
    rl.close();
    maxRounds = answer.trim() === "" ? 5 : Number(answer.trim());
    mode = "interactive";
  } else {
    if (flags["max-rounds"] === undefined) fail("缺少 --max-rounds（或使用 --interactive）");
    if (!flags["user-confirmed"]) fail("缺少 --user-confirmed：必须先向用户确认 max_rounds");
    maxRounds = intFlag(flags["max-rounds"], "max-rounds");
    mode = "agent_declared";
  }
  if (!Number.isInteger(maxRounds) || maxRounds < 2) fail("max_rounds 必须是 >= 2 的整数");

  ensureDir(evidence);
  const config = defaultConfig(project, maxRounds, mode);
  const state = defaultState(config);
  const data = defaultFindings();
  saveConfig(project, config);
  saveState(project, state);
  saveFindings(project, data);
  initTemplates(project);
  writeViews(project, state, config, data);
  console.log(`initialized review run with max_rounds=${maxRounds} (${mode})`);
}

function commandStatus(flags) {
  const project = projectRoot(flags);
  const { config, state, data } = loadAll(project);
  if (flags.json) {
    console.log(JSON.stringify({ config, state, findings: data.findings }, null, 2));
    return;
  }
  const cov = coverage(data);
  console.log(`phase=${state.current_phase} round=${state.current_round}/${config.max_rounds} consumed=${state.rounds_consumed} status=${state.overall_status}`);
  console.log(`next_action=${state.next_action}`);
  console.log(`findings=${data.findings.length} coverage=${cov.adjusted_percent === null ? "N/A" : `${cov.adjusted_percent}%`}`);
}

function commandNewInbox(flags) {
  const project = projectRoot(flags);
  const { state } = loadAll(project);
  if (state.current_phase !== "review") fail("new-inbox 只能在 review 阶段使用");
  const round = intFlag(flags.round, "round");
  if (round !== state.current_round) fail(`round 必须是当前轮 ${state.current_round}`);
  const role = String(stringFlag(flags, "role", { required: true })).toUpperCase();
  const tempId = String(stringFlag(flags, "temp-id", { required: true })).toUpperCase();
  if (!isRole(role)) fail(`未知角色：${role}`);
  if (!TEMP_ID.test(tempId)) fail(`临时 ID 非法：${tempId}`);
  if (tempId.split("-")[0] !== role) fail(`临时 ID 前缀必须是 ${role}-`);
  const dir = path.join(project, EVIDENCE, `round-${round}`, "inbox", roleSlug(role), tempId);
  ensureDir(dir);
  const metaPath = path.join(dir, "meta.json");
  if (fs.existsSync(metaPath)) {
    console.log(path.relative(project, dir).split(path.sep).join("/"));
    return;
  }
  const meta = {
    round,
    role,
    role_slug: roleSlug(role),
    temp_id: tempId,
    created_at: now(),
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
  console.log(path.relative(project, dir).split(path.sep).join("/"));
}

function commandRecordRound(flags) {
  const project = projectRoot(flags);
  const { config, state, data } = loadAll(project);
  if (state.current_phase !== "review") fail("record-round 只能在 review 阶段使用");
  const roundNumber = intFlag(flags.round, "round");
  if (roundNumber !== state.current_round) fail(`round 必须是当前轮 ${state.current_round}`);
  const raw = intFlag(flags.raw, "raw");
  const duplicates = intFlag(flags.duplicates, "duplicates");
  const screened = intFlag(flags.screened, "screened");
  const newInScope = intFlag(flags["new-p0p1p2"], "new-p0p1p2");
  if (raw < duplicates + screened) fail("raw 不能小于 duplicates + screened");
  const entry = ensureRound(state, roundNumber);
  entry.raw_candidates = raw;
  entry.duplicates = duplicates;
  entry.screened_out = screened;
  entry.replay_eligible = raw - duplicates - screened;
  entry.new_in_scope_p0p1p2 = newInScope;
  entry.status = "in_progress";
  persist(project, config, state, data);
  console.log(`recorded round ${roundNumber}: raw=${raw} duplicates=${duplicates} screened=${screened}`);
}

function findingById(data, id) {
  return data.findings.find((finding) => finding.id === id) || null;
}

function hasAuthorization(state, action) {
  return state.authorizations.some(
    (authorization) =>
      authorization.action === action && authorization.decision === "authorized"
  );
}

function hasFormalReproduction(project, round, number) {
  const dir = path.join(project, "tests/review/reproductions");
  if (!fs.existsSync(dir)) return false;
  const prefix = `r${round}_f${number}_`;
  return fs.readdirSync(dir).some((file) => file.startsWith(prefix));
}

function commandRecordFinding(flags) {
  const project = projectRoot(flags);
  const { config, state, data } = loadAll(project);
  if (state.current_phase !== "adjudication") fail("record-finding 只能在 adjudication 阶段使用");
  const id = String(stringFlag(flags, "id", { required: true })).toUpperCase();
  const match = id.match(FINDING_ID);
  if (!match) fail(`finding ID 非法：${id}`);
  if (Number(match[1]) !== state.current_round) fail(`finding ID 的轮次必须是当前轮 ${state.current_round}`);
  const role = String(stringFlag(flags, "role", { required: true })).toUpperCase();
  if (!isRole(role)) fail(`未知角色：${role}`);
  if (match[3] !== role) fail(`finding ID 的类别 ${match[3]} 与 role ${role} 不一致`);

  const severity = String(stringFlag(flags, "severity", { required: true })).toUpperCase();
  if (!SEVERITIES.includes(severity)) fail(`severity 非法：${severity}`);
  const decision = stringFlag(flags, "decision", { required: true });
  if (!DECISIONS.includes(decision)) fail(`decision 非法：${decision}`);
  const reproduced = boolFlag(flags.reproduced, "reproduced");
  const reproductionStatus = stringFlag(flags, "reproduction-status", { required: true });
  const changeOrigin = stringFlag(flags, "change-origin", { fallback: "undetermined" });
  if (!CHANGE_ORIGINS.includes(changeOrigin)) fail(`change-origin 非法：${changeOrigin}`);

  const canonical = path.join(project, EVIDENCE, `round-${match[1]}`, id);
  const evidenceDir = path.resolve(project, stringFlag(flags, "evidence-dir", { fallback: path.relative(project, canonical) }));
  if (path.resolve(canonical) !== evidenceDir) {
    fail(`evidence-dir 必须是 ${path.relative(project, canonical).split(path.sep).join("/")}`);
  }
  if (!fs.existsSync(evidenceDir)) fail(`evidence-dir 不存在：${path.relative(project, evidenceDir)}`);
  for (const required of ["counterexample.md", "adjudication.md"]) {
    if (!fs.existsSync(path.join(evidenceDir, required))) fail(`缺少 ${required}`);
  }
  const hasReproduction =
    fs.existsSync(path.join(evidenceDir, "manual-steps.md")) ||
    fs.readdirSync(evidenceDir).some((file) => /^reproduce\..+$/i.test(file));
  if (decision !== "needs-evidence" && !hasReproduction) {
    fail("缺少 reproduce.* 或 manual-steps.md");
  }

  if (reproduced && reproductionStatus !== "reproduced") fail("reproduced=true 时 reproduction-status 必须是 reproduced");
  if (!reproduced && reproductionStatus === "reproduced") fail("reproduced=false 时 reproduction-status 不能是 reproduced");
  if (decision === "accepted" && (!reproduced || reproductionStatus !== "reproduced")) {
    fail("accepted 必须有 reproduced=true 和 reproduction-status=reproduced");
  }
  if (decision === "rejected" && (reproduced || reproductionStatus !== "not-reproduced")) {
    fail("rejected 必须有 reproduced=false 和 reproduction-status=not-reproduced");
  }
  if (decision === "deferred" && (!reproduced || reproductionStatus !== "reproduced")) {
    fail("deferred 必须已复现");
  }

  const needsClarity = stringFlag(flags, "needs-evidence-clarity", { fallback: null });
  if (decision === "needs-evidence" && ["P2", "P3"].includes(severity)) {
    if (!NEEDS_CLARITY.includes(needsClarity)) fail("P2/P3 needs-evidence 必须提供 --needs-evidence-clarity");
  }
  if (decision === "needs-evidence" && !["blocked", "not_run"].includes(reproductionStatus)) {
    fail("needs-evidence 的 reproduction-status 必须是 blocked 或 not_run");
  }
  const deferredReason = stringFlag(flags, "deferred-reason", { fallback: null });
  const dispositionPlan = stringFlag(flags, "disposition-plan", { fallback: null });
  if (decision === "deferred" && (!deferredReason || !dispositionPlan)) {
    fail("deferred 必须提供 --deferred-reason 和 --disposition-plan");
  }

  const challengeFlag = boolFlag(flags["challenge-required"], "challenge-required");
  const challengeRequired =
    challengeFlag ||
    (decision === "accepted" && (severity === "P0" || (severity === "P1" && role === "SEC")));
  const challengeResult = stringFlag(flags, "challenge-result", { fallback: "none" });
  const reproducedBy = stringFlag(flags, "reproduced-by", { fallback: "agent" });
  if (!["agent", "main-agent"].includes(reproducedBy)) {
    fail("reproduced-by 必须是 agent 或 main-agent");
  }
  if (reproducedBy === "main-agent" && !hasAuthorization(state, "main-agent-reproduction")) {
    fail("主代理复现前必须先用 reviewctl authorize 记录用户授权");
  }
  if (challengeRequired && !["supports", "disputes", "inconclusive"].includes(challengeResult)) {
    fail("必须挑战项需要 --challenge-result supports|disputes|inconclusive");
  }

  const originalIds = Array.isArray(flags["original-id"])
    ? flags["original-id"]
    : flags["original-id"]
      ? [flags["original-id"]]
      : [];
  if (originalIds.length === 0) fail("缺少 --original-id");
  for (const original of originalIds) {
    const normalized = String(original).toUpperCase();
    if (!TEMP_ID.test(normalized)) fail(`original-id 非法：${original}`);
    if (normalized.split("-")[0] !== role) fail(`original-id 前缀必须是 ${role}-`);
  }

  let finding = findingById(data, id);
  const isNew = !finding;
  if (!finding) {
    finding = {
      id,
      verification: "pending",
      implementation_status: "none",
      commit: null,
      test_files: [],
      verification_attempts: 0,
      unresolved: false,
      unresolved_reason: null,
      verified_at: null,
      created_at: now(),
    };
    data.findings.push(finding);
  }
  Object.assign(finding, {
    original_ids: originalIds.map((value) => String(value).toUpperCase()),
    role,
    severity,
    decision,
    reproduced,
    reproduction_status: reproductionStatus,
    evidence_dir: path.relative(project, evidenceDir).split(path.sep).join("/"),
    challenge_required: challengeRequired,
    challenge_result: challengeResult,
    reproduced_by: reproducedBy,
    change_origin: changeOrigin,
    needs_evidence_clarity: needsClarity,
    deferred_reason: deferredReason,
    disposition_plan: dispositionPlan,
    merge_conflict: boolFlag(flags["merge-conflict"], "merge-conflict", false),
    updated_at: now(),
  });
  persist(project, config, state, data);
  console.log(`${isNew ? "recorded" : "updated"} ${id}: ${decision}/${severity}`);
}

function commitExists(project, commit) {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
      cwd: project,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function commandRecordImplementation(flags) {
  const project = projectRoot(flags);
  const { config, state, data } = loadAll(project);
  if (state.current_phase !== "repair") fail("record-implementation 只能在 repair 阶段使用");
  const id = String(stringFlag(flags, "id", { required: true })).toUpperCase();
  const finding = findingById(data, id);
  if (!finding) fail(`finding 不存在：${id}`);
  if (finding.decision !== "accepted") fail(`${id} 不是 accepted`);
  if (state.active_finding !== id) fail(`active_finding 是 ${state.active_finding}，不是 ${id}`);
  const status = stringFlag(flags, "status", { required: true });
  if (!["fixed", "already_fixed"].includes(status)) fail("status 必须是 fixed 或 already_fixed");
  const evidenceDir = path.resolve(project, finding.evidence_dir);
  if (!fs.existsSync(path.join(evidenceDir, "implementation-result.md"))) {
    fail(`${id}: 缺少 implementation-result.md`);
  }
  const tests = Array.isArray(flags.test) ? flags.test : flags.test ? [flags.test] : [];
  if (tests.length === 0) fail("缺少 --test");
  for (const testFile of tests) {
    const normalized = String(testFile).replace(/\\/g, "/");
    if (normalized.startsWith("tests/review/")) fail(`正式测试不能位于 tests/review/：${testFile}`);
    if (!fs.existsSync(path.resolve(project, testFile))) fail(`测试文件不存在：${testFile}`);
  }
  const commit = stringFlag(flags, "commit", { fallback: "none" });
  if (status === "fixed") {
    if (!/^[0-9a-f]{7,40}$/i.test(commit)) fail("fixed 必须提供合法 --commit");
    if (!commitExists(project, commit)) fail(`commit 不存在：${commit}`);
    const changed = execFileSync(
      "git",
      ["show", "--name-only", "--pretty=format:", commit],
      { cwd: project, encoding: "utf8" }
    )
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const file of changed) {
      if (file.startsWith(`${EVIDENCE}/`) || file.startsWith("tests/review/")) {
        fail(`修复 commit 不能包含 ${file}`);
      }
    }
    for (const testFile of tests.map((file) => String(file).replace(/\\/g, "/"))) {
      if (!changed.includes(testFile)) fail(`测试文件不在 commit 中：${testFile}`);
    }
    const sourceFiles = changed.filter(
      (file) =>
        !file.startsWith("tests/") &&
        !file.startsWith("test/") &&
        !file.endsWith(".md")
    );
    if (sourceFiles.length === 0) fail("修复 commit 没有源代码改动");
  }
  finding.implementation_status = status;
  finding.commit = status === "fixed" ? commit : "none";
  finding.test_files = tests.map((file) => String(file).replace(/\\/g, "/"));
  finding.updated_at = now();
  persist(project, config, state, data);
  console.log(`recorded implementation for ${id}: ${status}`);
}

function commandRecordVerification(flags) {
  const project = projectRoot(flags);
  const { config, state, data } = loadAll(project);
  const status = stringFlag(flags, "status", { required: true });
  if (!VERIFICATIONS.includes(status) || status === "pending") fail(`verification status 非法：${status}`);
  const allowedPhase =
    state.current_phase === "verification" ||
    (state.current_phase === "repair" && status === "blocked_by_user_changes");
  if (!allowedPhase) {
    fail("record-verification 只能在 verification 阶段使用；blocked_by_user_changes 可在 repair 阶段记录");
  }
  const id = String(stringFlag(flags, "id", { required: true })).toUpperCase();
  const finding = findingById(data, id);
  if (!finding) fail(`finding 不存在：${id}`);
  if (finding.decision !== "accepted") fail(`${id} 不是 accepted`);
  if (state.active_finding !== id) fail(`active_finding 是 ${state.active_finding}，不是 ${id}`);
  const evidenceDir = path.resolve(project, finding.evidence_dir);
  if (status !== "blocked_by_user_changes" && !fs.existsSync(path.join(evidenceDir, "verification-result.md"))) {
    fail(`${id}: 缺少 verification-result.md`);
  }
  const adjacentTests = Array.isArray(flags["adjacent-test"])
    ? flags["adjacent-test"]
    : flags["adjacent-test"]
      ? [flags["adjacent-test"]]
      : [];
  const adjacentReason = stringFlag(flags, "adjacent-reason", { fallback: null });
  const verifiedBy = stringFlag(flags, "verified-by", { fallback: "agent" });
  if (!["agent", "main-agent"].includes(verifiedBy)) {
    fail("verified-by 必须是 agent 或 main-agent");
  }
  if (verifiedBy === "main-agent" && !hasAuthorization(state, "main-agent-verification")) {
    fail("主代理验证前必须先用 reviewctl authorize 记录用户授权");
  }
  if (status === "pass") {
    if (!["fixed", "already_fixed"].includes(finding.implementation_status)) {
      fail(`${id}: pass 前必须有 implementation_status`);
    }
    if (!finding.test_files || finding.test_files.length === 0) fail(`${id}: pass 前必须有测试文件`);
    if (adjacentTests.length < 2 && !adjacentReason) {
      fail(`${id}: pass 前必须有至少 2 个相邻测试，或用 --adjacent-reason 说明无法生成的理由`);
    }
    for (const file of adjacentTests) {
      const normalized = String(file).replace(/\\/g, "/");
      if (!normalized.startsWith("tests/review/verifications/")) {
        fail(`相邻测试必须位于 tests/review/verifications/：${file}`);
      }
      if (!/^r\d+_f\d{3}_[a-z0-9_]+_adjacent(?:_[a-z0-9_]+)?\.test\.[a-z0-9]+$/.test(path.basename(normalized))) {
        fail(`相邻测试命名非法：${file}`);
      }
      if (!fs.existsSync(path.resolve(project, file))) fail(`相邻测试不存在：${file}`);
    }
    finding.verified_at = now();
    finding.unresolved = false;
    finding.unresolved_reason = null;
  } else if (status === "blocked_by_user_changes") {
    finding.merge_conflict = true;
    const implementationPath = path.join(evidenceDir, "implementation-result.md");
    if (!fs.existsSync(implementationPath)) fail(`${id}: 缺少 implementation-result.md`);
    const implementation = readText(implementationPath);
    if (!/Manual Merge Guidance/i.test(implementation)) {
      fail(`${id}: blocked_by_user_changes 的 implementation-result.md 必须包含 Manual Merge Guidance`);
    }
    finding.verified_at = null;
  } else {
    finding.verification_attempts = (finding.verification_attempts || 0) + 1;
    finding.verified_at = null;
    const unresolvedReason = stringFlag(flags, "unresolved-reason", { fallback: null });
    finding.unresolved = Boolean(unresolvedReason);
    finding.unresolved_reason = unresolvedReason;
  }
  finding.verification = status;
  finding.verified_by = verifiedBy;
  finding.adjacent_tests = adjacentTests.map((file) => String(file).replace(/\\/g, "/"));
  finding.adjacent_reason = adjacentReason;
  finding.updated_at = now();
  persist(project, config, state, data);
  console.log(`recorded verification for ${id}: ${status}`);
}

function commandNextFinding(flags) {
  const project = projectRoot(flags);
  const { config, state, data } = loadAll(project);
  if (state.current_phase !== "repair") fail("next-finding 只能在 repair 阶段使用");
  const active = findingById(data, state.active_finding);
  if (!active) fail("active_finding 不存在");
  if (!isTerminal(active)) fail(`${active.id} 还未终结，不能切到下一个 finding`);
  const pending = pendingAccepted(data).filter((finding) => finding.id !== active.id);
  if (!pending.length) fail("没有其他待修复的 accepted finding；运行 advance --to round_decision");
  state.active_finding = pending[0].id;
  event(state, "repair", `修复 ${pending[0].id}`);
  persist(project, config, state, data);
  console.log(`next finding: ${pending[0].id}`);
}

function commandMarkUnresolved(flags) {
  const project = projectRoot(flags);
  const { config, state, data } = loadAll(project);
  if (!["verification", "round_decision"].includes(state.current_phase)) {
    fail("mark-unresolved 只能在 verification 或 round_decision 阶段使用");
  }
  const id = String(stringFlag(flags, "id", { required: true })).toUpperCase();
  const finding = findingById(data, id);
  if (!finding) fail(`finding 不存在：${id}`);
  if (finding.decision !== "accepted") fail(`${id} 不是 accepted`);
  if (!["fail", "inconclusive"].includes(finding.verification)) {
    fail(`${id}: 只有 fail/inconclusive 可以标记未解决`);
  }
  const reason = stringFlag(flags, "reason", { required: true });
  finding.unresolved = true;
  finding.unresolved_reason = reason;
  finding.updated_at = now();
  persist(project, config, state, data);
  console.log(`marked ${id} unresolved: ${reason}`);
}

function commandRecordAudit(flags) {
  const project = projectRoot(flags);
  const { config, state, data } = loadAll(project);
  if (state.current_phase !== "final_audit") fail("record-audit 只能在 final_audit 阶段使用");
  const attempt = intFlag(flags.attempt, "attempt");
  if (attempt !== state.final_audit_attempt) fail(`attempt 必须是当前尝试 ${state.final_audit_attempt}`);
  const status = stringFlag(flags, "status", { required: true });
  if (!["complete", "failed"].includes(status)) fail("status 必须是 complete 或 failed");
  const newIssues = intFlag(flags["new-issues"], "new-issues");
  const dir = path.join(project, EVIDENCE, `round-${state.current_round}`, "final-audit", `attempt-${attempt}`);
  for (const required of ["blind-scan.md", "targeted-review.md"]) {
    if (!fs.existsSync(path.join(dir, required))) fail(`attempt ${attempt}: 缺少 ${required}`);
  }
  const entry = {
    attempt,
    round: state.current_round,
    status,
    new_issues: newIssues,
    at: now(),
  };
  const existing = state.final_audit.attempts.findIndex((item) => item.attempt === attempt);
  if (existing >= 0) state.final_audit.attempts[existing] = entry;
  else state.final_audit.attempts.push(entry);
  persist(project, config, state, data);
  console.log(`recorded final audit attempt ${attempt}: ${status}, new_issues=${newIssues}`);
}

function countHandoffRoles(project, round) {
  const inbox = path.join(project, EVIDENCE, `round-${round}`, "inbox");
  if (!fs.existsSync(inbox)) return [];
  const roles = [];
  for (const roleName of fs.readdirSync(inbox, { withFileTypes: true })) {
    if (!roleName.isDirectory()) continue;
    const roleDir = path.join(inbox, roleName.name);
    const hasHandoff = fs
      .readdirSync(roleDir, { withFileTypes: true })
      .some(
        (entry) =>
          entry.isDirectory() &&
          fs.existsSync(path.join(roleDir, entry.name, "meta.json")) &&
          fs.existsSync(path.join(roleDir, entry.name, "handoff.json"))
      );
    if (hasHandoff) {
      const entry = Object.entries(ROLES).find(([, slug]) => slug === roleName.name);
      if (entry) roles.push(entry[0]);
    }
  }
  return roles.sort();
}

function pendingAccepted(data) {
  return data.findings.filter(
    (finding) => finding.decision === "accepted" && !isTerminal(finding)
  );
}

function markRoundCompleted(state, round) {
  const entry = ensureRound(state, round);
  entry.status = "completed";
  entry.completed_at = now();
  state.rounds_consumed = round;
  state.active_finding = null;
}

function earlyConvergence(state) {
  const completed = completedRounds(state);
  if (completed.length < 2) return false;
  return completed
    .slice(-2)
    .every((round) => round.new_in_scope_p0p1p2 === 0);
}

function commandAdvance(flags) {
  const project = projectRoot(flags);
  const { config, state, data } = loadAll(project);
  const target = stringFlag(flags, "to", { required: true });
  if (!PHASES.includes(target)) fail(`目标阶段非法：${target}`);
  const stateErrors = [...validateConfig(config), ...validateState(state, config), ...validateFindings(data)];
  if (stateErrors.length) fail(`状态校验失败：${stateErrors.join("; ")}`);
  if (!TRANSITIONS[state.current_phase].includes(target)) {
    fail(`非法状态转移：${state.current_phase} -> ${target}`);
  }
  const from = state.current_phase;

  if (from === "baseline" && target === "review") {
    const errors = validateConfig(config);
    if (errors.length) fail(errors.join("; "));
    const baselinePath = path.join(project, EVIDENCE, "baseline.md");
    if (!fs.existsSync(baselinePath)) fail("缺少 .review-evidence/baseline.md");
    if (/\[TODO\]/.test(readText(baselinePath))) fail("baseline.md 仍有 [TODO]，先补全 baseline");
    state.current_round = 1;
    state.rounds_consumed = 0;
    const round = ensureRound(state, 1);
    round.status = "in_progress";
    event(state, "review", "启动第 1 轮评审角色，并用 reviewctl new-inbox 创建 inbox");
  } else if (from === "review" && target === "adjudication") {
    const round = roundEntry(state, state.current_round);
    if (!round || round.raw_candidates === null) fail("先运行 reviewctl record-round 记录本轮计数");
    const inboxErrors = [];
    validateInbox(project, inboxErrors);
    if (inboxErrors.length) fail(`inbox 校验失败：${inboxErrors.join("; ")}`);
    const roles = countHandoffRoles(project, state.current_round);
    if (roles.length < 3) fail(`本轮只有 ${roles.length} 个角色提交 handoff.json，至少需要 3 个`);
    round.roles = roles;
    round.status = "in_progress";
    event(state, "adjudication", "筛查、去重并裁决候选 findings");
  } else if (from === "adjudication" && target === "repair") {
    const pending = pendingAccepted(data);
    const requested = stringFlag(flags, "finding", { fallback: null });
    let finding;
    if (requested) {
      finding = pending.find((item) => item.id === requested);
      if (!finding) fail(`${requested} 不是待修复的 accepted finding`);
    } else {
      finding = pending[0];
    }
    if (!finding) fail("没有待修复的 accepted finding");
    const match = finding.id.match(FINDING_ID);
    if (!match || !hasFormalReproduction(project, match[1], match[2])) {
      fail(`${finding.id}: 先把复现测试移到 tests/review/reproductions/`);
    }
    state.active_finding = finding.id;
    event(state, "repair", `修复 ${finding.id}`);
  } else if (from === "adjudication" && target === "round_decision") {
    if (pendingAccepted(data).length > 0) fail("仍有待修复的 accepted finding，不能进入 round_decision");
    const round = roundEntry(state, state.current_round);
    if (!round || round.raw_candidates === null) fail("先运行 record-round 记录本轮计数");
    markRoundCompleted(state, state.current_round);
    event(state, "round_decision", "检查提前收敛/轮次上限");
  } else if (from === "repair" && target === "verification") {
    const finding = findingById(data, state.active_finding);
    if (!finding) fail("active_finding 不存在");
    if (!["fixed", "already_fixed"].includes(finding.implementation_status)) {
      fail(`${finding.id}: 先运行 reviewctl record-implementation`);
    }
    const evidenceDir = path.resolve(project, finding.evidence_dir);
    if (!fs.existsSync(path.join(evidenceDir, "implementation-result.md"))) {
      fail(`${finding.id}: 缺少 implementation-result.md`);
    }
    if (!finding.test_files || finding.test_files.length === 0) fail(`${finding.id}: 缺少测试文件`);
    event(state, "verification", `验证 ${finding.id}`);
  } else if (from === "repair" && target === "round_decision") {
    const active = findingById(data, state.active_finding);
    if (!active) fail("active_finding 不存在");
    if (!isTerminal(active)) fail(`${active.id} 还未终结`);
    const pending = pendingAccepted(data).filter((finding) => finding.id !== active.id);
    if (pending.length) fail(`还有待修复 finding：${pending.map((finding) => finding.id).join(", ")}；先运行 next-finding`);
    const round = roundEntry(state, state.current_round);
    if (!round || round.raw_candidates === null) fail("先运行 record-round 记录本轮计数");
    markRoundCompleted(state, state.current_round);
    event(state, "round_decision", "检查提前收敛/轮次上限");
  } else if (from === "verification" && target === "repair") {
    const finding = findingById(data, state.active_finding);
    if (!finding) fail("active_finding 不存在");
    if (finding.verification === "fail" && finding.verification_attempts < 2) {
      event(state, "repair", `重新修复 ${finding.id}`);
    } else {
      const pending = pendingAccepted(data).filter((item) => item.id !== finding.id);
      if (!pending.length) fail("没有待修复的 accepted finding；应进入 round_decision");
      state.active_finding = pending[0].id;
      event(state, "repair", `修复 ${pending[0].id}`);
    }
  } else if (from === "verification" && target === "round_decision") {
    const unverified = data.findings.filter(
      (finding) => finding.decision === "accepted" && !isTerminal(finding)
    );
    if (unverified.length) {
      fail(`仍有未终结的 accepted finding：${unverified.map((item) => item.id).join(", ")}`);
    }
    const round = roundEntry(state, state.current_round);
    if (!round || round.raw_candidates === null) fail("先运行 record-round 记录本轮计数");
    markRoundCompleted(state, state.current_round);
    event(state, "round_decision", "检查提前收敛/轮次上限");
  } else if (from === "round_decision" && target === "review") {
    if (!canTriggerNewRound(state, config)) fail("已达到 max_rounds，不能再开常规评审轮");
    if (state.final_audit.reentry_pending && state.final_audit_attempt >= 3) {
      fail("最终审计已达 3 次，不能开新常规轮；应进入 report 并标记 INCOMPLETE");
    }
    state.current_round += 1;
    const round = ensureRound(state, state.current_round);
    round.status = "in_progress";
    event(state, "review", `启动第 ${state.current_round} 轮评审角色`);
  } else if (from === "round_decision" && target === "final_audit") {
    if (state.rounds_consumed < 2) fail("至少完成 2 轮常规评审才能进入最终审计");
    if (state.final_audit.reentry_pending) {
      if (state.rounds_consumed >= config.max_rounds) {
        fail("已达到 max_rounds，终审新问题不能再开轮；应进入 report 并标记 INCOMPLETE");
      }
      if (state.current_round <= state.final_audit.reentry_after_round) {
        fail("终审发现新问题后必须先完成新的常规评审轮，再重新终审");
      }
    } else if (!earlyConvergence(state) && state.rounds_consumed !== config.max_rounds) {
      fail("未满足提前收敛，也未达到 max_rounds");
    }
    const attempt = state.final_audit_attempt + 1;
    if (attempt > 3) fail("最终审计最多 3 次尝试");
    state.final_audit_attempt = attempt;
    ensureDir(
      path.join(project, EVIDENCE, `round-${state.current_round}`, "final-audit", `attempt-${attempt}`)
    );
    event(state, "final_audit", `启动最终审计 attempt ${attempt}（盲扫）`);
  } else if (from === "final_audit" && target === "adjudication") {
    const audit = lastAudit(state);
    if (!audit || audit.status !== "complete") fail("先运行 reviewctl record-audit");
    if (audit.new_issues <= 0) fail("终审没有新问题，不应回到 adjudication");
    state.final_audit.reentry_pending = true;
    state.final_audit.reentry_after_round = state.current_round;
    event(state, "adjudication", "裁决终审发现的新问题");
  } else if (from === "final_audit" && target === "report") {
    const audit = lastAudit(state);
    if (!audit || audit.status !== "complete") fail("最终审计未完成");
    if (audit.new_issues > 0) {
      fail("终审仍有新问题，必须先回到 adjudication 处理后再 report");
    }
    state.final_audit.reentry_pending = false;
    event(state, "report", "运行 reviewctl finalize --status ...");
  } else if (from === "round_decision" && target === "report") {
    if (!state.final_audit.reentry_pending) {
      fail("只有终审新问题后的收尾才能从 round_decision 进入 report");
    }
    if (state.final_audit_attempt < 3 && state.rounds_consumed < config.max_rounds) {
      fail("终审新问题修复后必须开新的常规评审轮，或达到审计尝试上限");
    }
    event(state, "report", "运行 reviewctl finalize --status incomplete");
  } else {
    fail(`未实现的转移：${from} -> ${target}`);
  }

  state.last_transition = { from, to: target, at: now() };
  persist(project, config, state, data);
  console.log(`advanced ${from} -> ${target}`);
}

function renderFinalReport(project, state, config, data, status, reasons) {
  const cov = coverage(data);
  const lines = [
    "# Final Review Report",
    "",
    "<!-- Generated by reviewctl finalize. Add narrative below if needed. -->",
    "",
    `- Status: ${status.toUpperCase()}`,
    `- Rounds: ${state.rounds_consumed}/${config.max_rounds}`,
    `- Final audit attempts: ${state.final_audit_attempt}`,
    `- Coverage raw: ${cov.raw_percent === null ? "N/A" : `${cov.raw_percent}%`} (${cov.numerator}/${cov.denominator})`,
    `- Coverage exemptions: ${cov.exemptions}`,
    `- Coverage adjusted: ${cov.adjusted_percent === null ? "N/A" : `${cov.adjusted_percent}%`} (${cov.numerator}/${cov.adjusted_denominator})`,
    "",
    "## Findings",
    "",
    "| Finding | Severity | Decision | Verification | Commit |",
    "|---------|----------|----------|--------------|--------|",
  ];
  for (const finding of data.findings) {
    lines.push(
      `| ${finding.id} | ${finding.severity} | ${finding.decision} | ${finding.verification} | ${finding.commit || "-"} |`
    );
  }
  if (data.findings.length === 0) lines.push("| - | - | - | - | - |");

  lines.push("", "## Residual Risks", "");
  const deferred = data.findings.filter((finding) => finding.decision === "deferred");
  const needs = data.findings.filter((finding) => finding.decision === "needs-evidence");
  if (!deferred.length && !needs.length) lines.push("- none");
  for (const finding of deferred) {
    lines.push(`- ${finding.id}: deferred — ${finding.deferred_reason || "no reason"}; ${finding.disposition_plan || "no plan"}`);
  }
  for (const finding of needs) {
    lines.push(`- ${finding.id}: needs-evidence — ${finding.needs_evidence_clarity || "no clarity"}`);
  }

  const blocked = data.findings.filter(
    (finding) => finding.verification === "blocked_by_user_changes"
  );
  if (blocked.length) {
    lines.push("", "## Manual Merge Required", "");
    lines.push("**Do not deploy until manual merge is complete.**");
    for (const finding of blocked) {
      lines.push(`- ${finding.id}: see ${finding.evidence_dir}/implementation-result.md`);
    }
  }

  if (status === "incomplete" && reasons.length) {
    lines.push("", "## Incomplete Reasons", "");
    for (const reason of reasons) lines.push(`- ${reason}`);
  }

  lines.push("");
  writeTextAtomic(path.join(project, EVIDENCE, "final-report.md"), lines.join("\n"));
}

function commandFinalize(flags) {
  const project = projectRoot(flags);
  const { config, state, data } = loadAll(project);
  if (state.current_phase !== "report") fail("finalize 只能在 report 阶段使用");
  const status = stringFlag(flags, "status", { required: true });
  if (!["converged", "converged_with_manual_merge", "incomplete"].includes(status)) {
    fail("status 必须是 converged、converged_with_manual_merge 或 incomplete");
  }
  const target = status === "converged_with_manual_merge" ? "converged_with_manual_merge" : "converged";
  const reasons = convergenceReasons(state, config, data, target);
  if (status !== "incomplete" && reasons.length) {
    fail(`不满足 ${status}：\n- ${reasons.join("\n- ")}`);
  }
  state.overall_status = status;
  state.last_completed_event = `finalized: ${status}`;
  state.next_action = "review complete";
  persist(project, config, state, data);
  renderFinalReport(project, state, config, data, status, reasons);
  console.log(`finalized: ${status}`);
  if (reasons.length) console.log(`reasons:\n- ${reasons.join("\n- ")}`);
}

function commandValidate(flags) {
  const project = projectRoot(flags);
  const { config, state, data } = loadAll(project);
  const result = validateProject(project, config, state, data);
  for (const warning of result.warnings) console.warn(`WARN: ${warning}`);
  for (const error of result.errors) console.error(`ERROR: ${error}`);
  if (result.errors.length) {
    console.error(`validation failed: ${result.errors.length} error(s)`);
    process.exitCode = 1;
    return;
  }
  console.log("validation OK");
}

function commandCoverage(flags) {
  const project = projectRoot(flags);
  const { data } = loadAll(project);
  const cov = coverage(data);
  console.log(
    `coverage: raw ${cov.numerator}/${cov.denominator} (${cov.raw_percent === null ? "N/A" : `${cov.raw_percent}%`}), adjusted ${cov.numerator}/${cov.adjusted_denominator} (${cov.adjusted_percent === null ? "N/A" : `${cov.adjusted_percent}%`}), exemptions ${cov.exemptions}`
  );
}

function commandGuardCommit(flags) {
  const project = projectRoot(flags);
  const { data } = loadAll(project);
  const id = String(stringFlag(flags, "finding", { required: true })).toUpperCase();
  const tests = Array.isArray(flags.test) ? flags.test : flags.test ? [flags.test] : [];
  const errors = guardCommit(project, id, tests, data);
  if (errors.length) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`guard-commit OK for ${id}`);
}

function commandAuthorize(flags) {
  const project = projectRoot(flags);
  const { config, state, data } = loadAll(project);
  const action = stringFlag(flags, "action", { required: true });
  const decision = stringFlag(flags, "decision", { required: true });
  if (!["authorized", "declined"].includes(decision)) {
    fail("decision 必须是 authorized 或 declined");
  }
  const scope = stringFlag(flags, "scope", { fallback: "" });
  const at = now();
  state.authorizations.push({ action, decision, scope, at });
  state.blockers.push(`[${action}${scope ? `: ${scope}` : ""}] - user ${decision} on ${at}`);
  persist(project, config, state, data);
  console.log(`recorded authorization: ${action} ${decision}`);
}

function commandRender(flags) {
  const project = projectRoot(flags);
  const { config, state, data } = loadAll(project);
  writeViews(project, state, config, data);
  console.log("rendered run-state.md and findings-index.md");
}

function usage() {
  console.log(`reviewctl commands:
  init --max-rounds N --user-confirmed [--project DIR]
  init --interactive [--project DIR]
  status [--json]
  new-inbox --round N --role SEC --temp-id SEC-001
  record-round --round N --raw N --duplicates N --screened N --new-p0p1p2 N
  record-finding --id R1-F001-SEC --role SEC --original-id SEC-001 --severity P1 --decision accepted --reproduced true --reproduction-status reproduced --evidence-dir ... [--challenge-required true --challenge-result supports] [--reproduced-by agent|main-agent]
  record-implementation --id ID --status fixed --commit SHA --test PATH
  record-verification --id ID --status pass [--adjacent-test PATH ...] [--verified-by agent|main-agent]
  next-finding
  mark-unresolved --id ID --reason TEXT
  record-audit --attempt N --status complete --new-issues N
  advance --to PHASE [--finding ID]
  validate
  coverage
  finalize --status converged|converged_with_manual_merge|incomplete
  authorize --action NAME --decision authorized|declined [--scope TEXT]
  guard-commit --finding ID --test PATH
  render`);
}

async function main() {
  const command = process.argv[2];
  const { flags } = parseArgs(process.argv.slice(3));
  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }
  const commands = {
    init: commandInit,
    status: commandStatus,
    "new-inbox": commandNewInbox,
    "record-round": commandRecordRound,
    "record-finding": commandRecordFinding,
    "record-implementation": commandRecordImplementation,
    "record-verification": commandRecordVerification,
    "next-finding": commandNextFinding,
    "mark-unresolved": commandMarkUnresolved,
    "record-audit": commandRecordAudit,
    advance: commandAdvance,
    validate: commandValidate,
    coverage: commandCoverage,
    finalize: commandFinalize,
    authorize: commandAuthorize,
    "guard-commit": commandGuardCommit,
    render: commandRender,
  };
  const handler = commands[command];
  if (!handler) fail(`未知命令：${command}`);
  await handler(flags);
}

main().catch((error) => {
  if (error.userFacing) console.error(`ERROR: ${error.message}`);
  else console.error(`ERROR: ${error.stack || error.message}`);
  process.exitCode = 1;
});
