const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const EVIDENCE = ".review-evidence";

function section(markdown, title) {
  const lines = String(markdown).replace(/\r/g, "").split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${title}`.toLowerCase());
  if (start < 0) return "";
  const result = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) break;
    result.push(lines[index]);
  }
  return result.join("\n");
}

function bullet(sectionText, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sectionText.match(new RegExp(`^\\s*-\\s*${escaped}:\\s*(.*?)\\s*$`, "im"));
  return match ? match[1].trim().replace(/^`|`$/g, "") : "";
}

function parseBaselinePolicy(project) {
  const errors = [];
  const filename = path.join(project, EVIDENCE, "baseline.md");
  if (!fs.existsSync(filename)) {
    return { policy: null, errors: ["缺少 .review-evidence/baseline.md"] };
  }
  const text = fs.readFileSync(filename, "utf8");
  const scope = section(text, "Test Scope / Regression Policy");
  if (!scope) return { policy: null, errors: ["baseline.md 缺少 Test Scope / Regression Policy 小节"] };

  const policy = {
    tieringMode: bullet(scope, "Tiering mode").toLowerCase(),
    baselineResult: bullet(scope, "Baseline full result").toLowerCase(),
    baselineLog: bullet(scope, "Baseline full log"),
    expectedTestCount: Number((bullet(scope, "Expected test count").match(/\d+/) || [])[0]),
    focusedCommand: bullet(scope, "Focused test command"),
    impactedCommand: bullet(scope, "Impacted test command"),
    fastCommand: bullet(scope, "Fast test command"),
    fastProfile: bullet(scope, "Fast test profile").toLowerCase(),
    longRunningPolicy: bullet(scope, "Long-running test policy"),
    longRunningTests: bullet(scope, "Long-running test inventory"),
    fullScale: bullet(scope, "Full runtime scale"),
    fastProfileSemantics: bullet(scope, "Fast profile semantics"),
    scalingEvidence: bullet(scope, "Time/volume scaling evidence"),
    qualityCommand: bullet(scope, "Code quality command"),
    qualityPolicy: bullet(scope, "Code quality policy"),
    qualityResult: bullet(scope, "Baseline code quality result").toLowerCase(),
    qualityLog: bullet(scope, "Baseline code quality log"),
    optimisticRepairPolicy: (/^\[/.test(bullet(scope, "Optimistic repair policy")) ? "off" : (bullet(scope, "Optimistic repair policy") || "off")).toLowerCase(),
    optimisticMaxWorktrees: Number.parseInt(/^\[/.test(bullet(scope, "Optimistic max active worktrees")) ? "1" : (bullet(scope, "Optimistic max active worktrees") || "1"), 10),
    optimisticEligibleSeverities: (/^\[/.test(bullet(scope, "Optimistic eligible severities")) ? "P2,P3" : (bullet(scope, "Optimistic eligible severities") || "P2,P3"))
      .split(",").map((value) => value.trim()).filter(Boolean),
    fullCommand: bullet(scope, "Full test command"),
    adjacentCommand: bullet(scope, "Adjacent test command"),
  };
  const baselineTestValues = bullet(scope, "Expected test count").split(" / ").map((value) => Number.parseInt(value.trim(), 10));
  policy.baselineTestCounts = {
    total: baselineTestValues[0],
    passed: baselineTestValues[1],
    failed: baselineTestValues[2],
    skipped: baselineTestValues[3],
  };
  policy.expectedTestCount = policy.baselineTestCounts.total;
  if (!["default", "full-everywhere", "progressive"].includes(policy.tieringMode)) {
    errors.push("baseline.md 的 Tiering mode 必须是 default、full-everywhere 或 progressive");
  }
  if (policy.baselineResult !== "pass") {
    errors.push("baseline full result 必须为 pass 才能进入 review");
  }
  if (!policy.longRunningTests || /\[|\]|TODO/i.test(policy.longRunningTests)) {
    errors.push("baseline.md 必须登记 Long-running test inventory；无长测时填写 none");
  }
  const hasLongRunningTests = policy.longRunningTests && policy.longRunningTests.toLowerCase() !== "none";
  if (hasLongRunningTests) {
    const ids = policy.longRunningTests.split(",").map((value) => value.trim());
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) errors.push("Long-running test inventory 必须是无空项、无重复项的稳定测试 ID 清单");
  }
  if (hasLongRunningTests && (!policy.fullScale || /\[|\]|TODO|not_applicable/i.test(policy.fullScale))) {
    errors.push("存在长时测试时必须填写 Full runtime scale 的原始时间、数据量和关键资源条件");
  }
  if (!hasLongRunningTests && (!policy.fullScale || /\[|\]|TODO/i.test(policy.fullScale))) {
    errors.push("无长时测试时 Full runtime scale 必须填写 not_applicable 或说明完整套件尺度");
  }
  if (baselineTestValues.length < 4 || !Object.values(policy.baselineTestCounts).every((value) => Number.isSafeInteger(value) && value >= 0) || policy.expectedTestCount < 1) {
    errors.push("baseline.md 的 Expected test count 必须依次记录 total / passed / failed / skipped");
  } else if (policy.baselineTestCounts.failed !== 0 || policy.baselineTestCounts.passed + policy.baselineTestCounts.failed + policy.baselineTestCounts.skipped !== policy.expectedTestCount) {
    errors.push("baseline.md 的测试计数必须满足 failed=0 且 passed + failed + skipped = total");
  }
  for (const [label, value] of [
    ["Focused test command", policy.focusedCommand],
    ["Impacted test command", policy.impactedCommand],
    ["Full test command", policy.fullCommand],
  ]) {
    if (!value || /\[|\]|TODO|<[^>]+>/i.test(value)) errors.push(`baseline.md 的 ${label} 未填写有效命令`);
  }
  if (policy.baselineLog) {
    const logPath = resolveEvidencePath(project, policy.baselineLog, errors, "Baseline full log");
    if (logPath && !hasSuccessfulExit(logPath)) errors.push("baseline full log 缺少 EXIT_CODE=0");
    if (logPath && hasLongRunningTests) {
      const log = fs.readFileSync(logPath, "utf8");
      const ids = policy.longRunningTests.split(",").map((value) => value.trim()).filter(Boolean).sort().join(",");
      if (!log.replace(/\r/g, "").split("\n").includes("RUNTIME_PROFILE=original")) errors.push("baseline full log 必须记录 RUNTIME_PROFILE=original");
      if (!log.replace(/\r/g, "").split("\n").includes(`LONG_RUNNING_TESTS=${ids}`)) errors.push("baseline full log 必须记录完整的 LONG_RUNNING_TESTS 清单");
      if (!log.replace(/\r/g, "").split("\n").includes(`FULL_RUNTIME_SCALE=${policy.fullScale}`)) errors.push("baseline full log 必须记录与 baseline 一致的 FULL_RUNTIME_SCALE");
    }
  } else {
    errors.push("baseline.md 缺少 Baseline full log");
  }
  if (!policy.qualityCommand || /\[|\]|TODO|<[^>]+>/i.test(policy.qualityCommand)) {
    errors.push("baseline.md 必须填写 Code quality command；无适用工具时填写 not_applicable: 原因");
  }
  if (!policy.qualityPolicy || /\[|\]|TODO|<[^>]+>/i.test(policy.qualityPolicy)) {
    errors.push("baseline.md 必须填写 Code quality policy");
  }
  const qualityNotApplicable = /^not_applicable\s*:/i.test(policy.qualityCommand);
  if (!["pass", "not_applicable"].includes(policy.qualityResult)) {
    errors.push("Baseline code quality result 必须是 pass 或 not_applicable");
  } else if (qualityNotApplicable && policy.qualityResult !== "not_applicable") {
    errors.push("Code quality command 为 not_applicable 时，Baseline code quality result 必须为 not_applicable");
  } else if (!qualityNotApplicable && policy.qualityResult !== "pass") {
    errors.push("存在 Code quality command 时，Baseline code quality result 必须为 pass");
  }
  if (policy.qualityResult === "not_applicable" && !qualityNotApplicable) {
    errors.push("not_applicable 必须在 Code quality command 中写明原因");
  }
  if (policy.qualityResult === "pass") {
    if (!policy.qualityLog || /\[|\]|TODO|<[^>]+>/i.test(policy.qualityLog)) {
      errors.push("Baseline code quality result=pass 时必须填写 Baseline code quality log");
    } else {
      const qualityLogPath = resolveEvidencePath(project, policy.qualityLog, errors, "Baseline code quality log");
      if (qualityLogPath) {
        const qualityLog = fs.readFileSync(qualityLogPath, "utf8");
        if (!hasSuccessfulExit(qualityLogPath)) errors.push("baseline code quality log 缺少 EXIT_CODE=0");
        if (!qualityLog.replace(/\r/g, "").split("\n").includes(`QUALITY_COMMAND=${policy.qualityCommand}`)) errors.push("baseline code quality log QUALITY_COMMAND 必须与 baseline Code quality command 完全一致");
      }
    }
  }
  if (!["off", "bounded"].includes(policy.optimisticRepairPolicy)) {
    errors.push("Optimistic repair policy 必须是 off 或 bounded");
  }
  if (!Number.isSafeInteger(policy.optimisticMaxWorktrees) || policy.optimisticMaxWorktrees < 1 || policy.optimisticMaxWorktrees > 2) {
    errors.push("Optimistic max active worktrees 必须是 1 或 2");
  }
  if (!policy.optimisticEligibleSeverities.length || policy.optimisticEligibleSeverities.some((value) => !["P2", "P3"].includes(value))) {
    errors.push("Optimistic eligible severities 只能包含 P2、P3");
  }
  if (/\|\|\s*true|--passWithNoTests/i.test(policy.fullCommand)) {
    errors.push("baseline Full test command 不得吞掉失败或允许零测试通过");
  }
  if (policy.tieringMode === "progressive") {
    if (!policy.fastCommand || /\[|\]|TODO|<[^>]+>/i.test(policy.fastCommand)) {
      errors.push("progressive 模式必须填写有效的 Fast test command");
    } else if (policy.fastCommand.trim() === policy.fullCommand.trim() || /\|\|\s*true|--passWithNoTests/i.test(policy.fastCommand)) {
      errors.push("Fast test command 必须与 Full test command 不同，且不得吞掉失败或允许零测试通过");
    }
    if (!["none", "reduced-data", "accelerated-time", "virtual-clock", "tmpfs", "mixed"].includes(policy.fastProfile)) {
      errors.push("progressive 模式必须填写有效的 Fast test profile");
    }
    if (!policy.longRunningPolicy || /\[|\]|TODO/i.test(policy.longRunningPolicy)) {
      errors.push("progressive 模式必须填写 Long-running test policy");
    }
    if (!policy.scalingEvidence || /\[|\]|TODO/i.test(policy.scalingEvidence)) {
      errors.push("progressive 模式必须填写 Time/volume scaling evidence");
    }
    if (policy.fastProfile !== "none" && (!policy.fastProfileSemantics || /\[|\]|TODO|not_applicable/i.test(policy.fastProfileSemantics))) {
      errors.push("缩放 fast profile 必须填写 Fast profile semantics，说明保留契约和未覆盖语义");
    }
  }
  if (policy.adjacentCommand && policy.adjacentCommand.trim() === policy.fullCommand.trim()) {
    errors.push("Adjacent test command 必须与 Full test command 分开配置");
  }
  if (policy.adjacentCommand && (policy.adjacentCommand.match(/\{test_paths\}/g) || []).length !== 1) {
    errors.push("Adjacent test command 必须且只能包含一个 {test_paths} 占位符");
  }
  if (policy.adjacentCommand && (!/\{test_paths\}$/.test(policy.adjacentCommand.trim()) || /[|;&<>`]/.test(policy.adjacentCommand) || /\|\|\s*true|--passWithNoTests/i.test(policy.adjacentCommand))) {
    errors.push("Adjacent test command 必须以 {test_paths} 结尾，且不得附加其他路径、shell 操作符或吞掉失败的选项");
  }
  if (/tests[/\\]review[/\\]verifications|[*?]/i.test(policy.adjacentCommand)) errors.push("Adjacent test command 不得扫描相邻测试目录或使用通配符；仅使用 {test_paths} 清单");
  return { policy, errors };
}

function expandAdjacentCommand(template, paths) {
  if (!Array.isArray(paths) || paths.some((file) => !/^tests\/review\/verifications\/[A-Za-z0-9_./-]+$/.test(file) || file.split("/").some((part) => !part || part === "." || part === ".."))) {
    throw new Error("相邻测试必须是 tests/review/verifications/ 内的规范相对路径，使用字母、数字、点、下划线、斜杠或连字符");
  }
  return String(template).replace("{test_paths}", paths.join(" "));
}

function hasExactCommand(log, command) {
  return String(log).replace(/\r/g, "").split("\n").includes(`COMMAND=${command}`);
}

function adjacentRound(finding) {
  return finding.adjacent_round || Number(String(finding.id).match(/^R(\d+)-/)?.[1]);
}

function adjacentRegistry(state, data) {
  const registry = new Map((Array.isArray(state.adjacent_registry) ? state.adjacent_registry : []).filter((entry) => entry && typeof entry.test_path === "string").map((entry) => [entry.test_path, entry]));
  for (const finding of data.findings || []) {
    if (finding.verification !== "pass") continue;
    for (const file of finding.adjacent_tests || []) {
      if (!registry.has(file)) registry.set(file, { test_path: file, finding_id: finding.id, round: adjacentRound(finding) });
    }
  }
  return [...registry.values()];
}

function roundAdjacentPaths(state, data, round) {
  return adjacentRegistry(state, data).filter((entry) => entry.round === round).map((entry) => entry.test_path).sort();
}

function validateAdjacentLog(project, batch) {
  const errors = [];
  const logPath = resolveEvidencePath(project, batch.log, errors, "adjacent batch log");
  if (logPath) {
    if (!hasExactCommand(fs.readFileSync(logPath, "utf8"), batch.command)) errors.push("adjacent batch log COMMAND 必须与展开后的命令完全一致");
    if (batch.status !== "inconclusive" && (batch.exit_status === 0 ? !hasSuccessfulExit(logPath) : !hasNonzeroExit(logPath))) errors.push("adjacent batch log EXIT_CODE 与状态不一致");
  }
  return errors;
}

function validateAdjacentPromotions(project, state, data, errors) {
  const seen = new Set();
  for (const promotion of Array.isArray(state.adjacent_promotions) ? state.adjacent_promotions : []) {
    if (!promotion || typeof promotion.test_path !== "string") {
      errors.push("相邻测试升级记录缺少 test_path");
      continue;
    }
    const owner = adjacentRegistry(state, data).find((item) => item.test_path === promotion.test_path);
    const target = data.findings.find((item) => item.id === promotion.finding_id);
    if (seen.has(promotion.test_path)) errors.push(`相邻测试重复升级：${promotion.test_path}`);
    seen.add(promotion.test_path);
    if (!owner || !target || target.decision !== "accepted" || target.verification !== "pass" || !(target.test_files || []).includes(promotion.formal_test)) {
      errors.push(`相邻测试升级缺少已验证 finding 的正式回归测试：${promotion.test_path}`);
      continue;
    }
    if (!promotion.reason || !/^[0-9a-f]{64}$/i.test(promotion.test_sha256 || "")) errors.push(`相邻测试升级缺少覆盖理由或源测试哈希：${promotion.test_path}`);
    const source = path.resolve(project, promotion.test_path);
    if (fs.existsSync(source) && sha256File(source) !== promotion.test_sha256) errors.push(`相邻测试升级源文件哈希不匹配：${promotion.test_path}`);
    try {
      require("node:child_process").execFileSync("git", ["merge-base", "--is-ancestor", promotion.commit, "HEAD"], { cwd: project, stdio: "ignore" });
      if (sha256GitFile(project, promotion.commit, promotion.formal_test) !== promotion.formal_sha256) errors.push(`相邻测试升级正式文件哈希不匹配：${promotion.test_path}`);
      if (!fs.existsSync(path.resolve(project, promotion.formal_test))) errors.push(`相邻测试升级正式测试缺失：${promotion.formal_test}`);
    } catch (error) {
      errors.push(`相邻测试升级提交无效：${error.message}`);
    }
  }
}

function resolveEvidencePath(project, filename, errors, label) {
  const normalized = String(filename || "").replace(/\\/g, "/");
  const absolute = path.resolve(project, normalized);
  const relative = path.relative(path.resolve(project), absolute).replace(/\\/g, "/");
  if (relative !== EVIDENCE && !relative.startsWith(`${EVIDENCE}/`)) {
    errors.push(`${label} 必须位于 ${EVIDENCE}/ 内`);
    return null;
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    errors.push(`${label} 不存在或不是普通文件：${filename}`);
    return null;
  }
  try {
    const evidenceRoot = fs.realpathSync(path.join(project, EVIDENCE));
    const realFile = fs.realpathSync(absolute);
    const realRelative = path.relative(evidenceRoot, realFile);
    if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      errors.push(`${label} 的真实路径越出 ${EVIDENCE}/`);
      return null;
    }
  } catch {
    errors.push(`${label} 无法解析真实路径：${filename}`);
    return null;
  }
  return absolute;
}

function hasSuccessfulExit(logPath) {
  try {
    return /(?:^|\n)\s*EXIT_CODE\s*=\s*0\s*(?:\r?$|\n)/m.test(fs.readFileSync(logPath, "utf8"));
  } catch {
    return false;
  }
}

function hasNonzeroExit(logPath) {
  try {
    return /(?:^|\n)\s*EXIT_CODE\s*=\s*[1-9]\d*\s*(?:\r?$|\n)/m.test(fs.readFileSync(logPath, "utf8"));
  } catch {
    return false;
  }
}

function parseJsonSection(markdown, heading, label) {
  const errors = [];
  const content = section(markdown, heading);
  if (!content) return { value: null, errors: [`缺少 ${label} 小节`] };
  const fence = String.fromCharCode(96).repeat(3);
  const slash = String.fromCharCode(92);
  const body = "[" + slash + "s" + slash + "S]*?";
  const blocks = [...content.matchAll(new RegExp(
    fence + "json" + slash + "s*(" + body + ")" + fence +
      "|~~~json" + slash + "s*(" + body + ")~~~",
    "gi"
  ))];
  if (blocks.length !== 1) return { value: null, errors: [`${label} 必须恰有一个 JSON 代码块`] };
  try {
    const value = JSON.parse(blocks[0][1] ?? blocks[0][2]);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON 根值必须是对象");
    return { value, errors };
  } catch (error) {
    return { value: null, errors: [`${label} JSON 无效：${error.message}`] };
  }
}

function isTreeHash(value) {
  return typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}

function sha256File(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

function sha256GitFile(project, commit, filename) {
  const { execFileSync } = require("node:child_process");
  return crypto.createHash("sha256").update(execFileSync("git", ["show", `${commit}:${filename.replace(/\\/g, "/")}`], { cwd: project })).digest("hex");
}

function validateFullRun(project, run, policy, label, expectedTreeHash = null) {
  const errors = [];
  if (!run || typeof run !== "object" || Array.isArray(run)) return [`${label} 缺少结构化 full 测试证据`];
  if (run.status !== "pass") errors.push(`${label} status 必须为 pass`);
  if (typeof run.command !== "string" || run.command.trim() !== policy.fullCommand.trim()) {
    errors.push(`${label} command 必须与 baseline Full test command 完全一致`);
  }
  if (/\|\|\s*true|--passWithNoTests/i.test(String(run.command || ""))) {
    errors.push(`${label} command 不得吞掉失败或允许零测试通过`);
  }
  if (run.exit_status !== 0) errors.push(`${label} exit_status 必须为数值 0`);

  if (policy.longRunningTests && policy.longRunningTests.toLowerCase() !== "none") {
    const expectedIds = policy.longRunningTests.split(",").map((value) => value.trim()).filter(Boolean).sort();
    const actualIds = Array.isArray(run.long_running_test_ids) ? run.long_running_test_ids.slice().sort() : [];
    if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) errors.push(`${label} long_running_test_ids 必须与 baseline inventory 完全一致`);
    if (run.runtime_profile !== "original") errors.push(`${label} runtime_profile 必须为 original`);
    if (run.runtime_scale !== policy.fullScale) errors.push(`${label} runtime_scale 必须与 baseline Full runtime scale 完全一致`);
    if (!(typeof run.runtime_scale_evidence === "string" && run.runtime_scale_evidence.trim())) errors.push(`${label} 必须提供 runtime_scale_evidence`);
  }

  if (!isTreeHash(run.tree_hash_before) || !isTreeHash(run.tree_hash_after)) {
    errors.push(`${label} 必须记录有效的 tree_hash_before 和 tree_hash_after`);
  } else {
    if (run.tree_hash_before.toLowerCase() !== run.tree_hash_after.toLowerCase()) errors.push(`${label} 测试前后 tree hash 不一致`);
    if (expectedTreeHash !== null && run.tree_hash_after.toLowerCase() !== String(expectedTreeHash).toLowerCase()) {
      errors.push(`${label} tree hash 与被验证的 index/commit tree 不一致`);
    }
  }

  if (!(run.run_location === "main-workspace" || (typeof run.run_location === "string" && /^worktree:.+/.test(run.run_location.trim())))) {
    errors.push(`${label} run_location 必须是 main-workspace 或 worktree:<path>`);
  }
  if (run.workspace_clean_before !== true || run.workspace_clean_after !== true) {
    errors.push(`${label} 必须证明测试前后被测工作区均 clean`);
  }

  const counts = run.test_counts;
  if (!counts || !["total", "passed", "failed", "skipped"].every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) {
    errors.push(`${label} test_counts 必须包含非负整数 total/passed/failed/skipped`);
  } else {
    if (counts.total < 1) errors.push(`${label} total 必须大于 0`);
    if (counts.failed !== 0) errors.push(`${label} failed 必须为 0`);
    if (counts.passed + counts.failed + counts.skipped !== counts.total) {
      errors.push(`${label} passed + failed + skipped 必须等于 total`);
    }
    const delta = run.expected_test_count_delta;
    if (!Number.isSafeInteger(delta)) {
      errors.push(`${label} expected_test_count_delta 必须是整数`);
    } else if (counts.total !== policy.expectedTestCount + delta) {
      errors.push(`${label} total 必须等于 baseline 预期数量加 expected_test_count_delta`);
    }
    if (delta !== 0 && !(typeof run.expected_test_count_delta_reason === "string" && run.expected_test_count_delta_reason.trim())) {
      errors.push(`${label} 新增测试数量变化必须说明 expected_test_count_delta_reason`);
    }
    const skippedDelta = run.expected_skipped_count_delta;
    if (!Number.isSafeInteger(skippedDelta) || counts.skipped !== policy.baselineTestCounts.skipped + skippedDelta) {
      errors.push(`${label} skipped 必须等于 baseline skipped 加 expected_skipped_count_delta`);
    } else if (skippedDelta !== 0 && !(typeof run.expected_skipped_count_delta_reason === "string" && run.expected_skipped_count_delta_reason.trim())) {
      errors.push(`${label} skipped 数量变化必须说明 expected_skipped_count_delta_reason`);
    }
  }

  const logPath = resolveEvidencePath(project, run.log, errors, `${label} log`);
  if (logPath && !hasSuccessfulExit(logPath)) errors.push(`${label} log 缺少 EXIT_CODE=0`);
  if (logPath && policy.longRunningTests && policy.longRunningTests.toLowerCase() !== "none") {
    const log = fs.readFileSync(logPath, "utf8").replace(/\r/g, "").split("\n");
    const ids = policy.longRunningTests.split(",").map((value) => value.trim()).filter(Boolean).sort().join(",");
    if (!log.includes("RUNTIME_PROFILE=original")) errors.push(`${label} log 必须记录 RUNTIME_PROFILE=original`);
    if (!log.includes(`LONG_RUNNING_TESTS=${ids}`)) errors.push(`${label} log 必须记录完整的 LONG_RUNNING_TESTS 清单`);
    if (!log.includes(`FULL_RUNTIME_SCALE=${policy.fullScale}`)) errors.push(`${label} log 必须记录与 baseline 一致的 FULL_RUNTIME_SCALE`);
  }
  return errors;
}

function validateQualityRun(project, run, policy, label, expectedTreeHash = null) {
  const errors = [];
  if (!run || typeof run !== "object" || Array.isArray(run)) return [`${label} 缺少结构化代码质量证据`];
  if (policy.qualityResult === "not_applicable") {
    if (run.status !== "not_applicable") errors.push(`${label} status 必须为 not_applicable`);
    if (run.command !== policy.qualityCommand) errors.push(`${label} command 必须与 baseline Code quality command 完全一致`);
    if (!(typeof run.reason === "string" && run.reason.trim())) errors.push(`${label} not_applicable 必须说明原因`);
    return errors;
  }
  if (run.status !== "pass") errors.push(`${label} status 必须为 pass`);
  if (typeof run.command !== "string" || run.command.trim() !== policy.qualityCommand.trim()) {
    errors.push(`${label} command 必须与 baseline Code quality command 完全一致`);
  }
  if (run.exit_status !== 0) errors.push(`${label} exit_status 必须为数值 0`);
  if (!isTreeHash(run.tree_hash_before) || !isTreeHash(run.tree_hash_after) || run.tree_hash_before.toLowerCase() !== run.tree_hash_after.toLowerCase()) {
    errors.push(`${label} tree hash 必须在检查前后稳定`);
  } else if (expectedTreeHash !== null && run.tree_hash_after.toLowerCase() !== String(expectedTreeHash).toLowerCase()) {
    errors.push(`${label} tree hash 必须匹配被验证的 index/commit tree`);
  }
  if (!(run.run_location === "main-workspace" || (typeof run.run_location === "string" && /^worktree:.+/.test(run.run_location.trim())))) {
    errors.push(`${label} run_location 必须是 main-workspace 或 worktree:<path>`);
  }
  if (run.workspace_clean_before !== true || run.workspace_clean_after !== true) {
    errors.push(`${label} 必须证明检查前后工作区均 clean`);
  }
  const logPath = resolveEvidencePath(project, run.log, errors, `${label} log`);
  if (logPath) {
    const log = fs.readFileSync(logPath, "utf8");
    if (!hasSuccessfulExit(logPath)) errors.push(`${label} log 缺少 EXIT_CODE=0`);
    if (!log.replace(/\r/g, "").split("\n").includes(`QUALITY_COMMAND=${policy.qualityCommand}`)) errors.push(`${label} log QUALITY_COMMAND 必须与 baseline Code quality command 完全一致`);
  }
  return errors;
}

function validateFastRun(project, run, policy, label, expectedTreeHash = null) {
  const errors = [];
  if (!run || typeof run !== "object" || Array.isArray(run)) return [`${label} 缺少结构化快速测试证据`];
  if (run.status !== "pass") errors.push(`${label} status 必须为 pass`);
  if (typeof run.command !== "string" || run.command.trim() !== policy.fastCommand.trim()) errors.push(`${label} command 必须与 baseline Fast test command 完全一致`);
  if (run.fast_profile !== policy.fastProfile) errors.push(`${label} fast_profile 必须与 baseline Fast test profile 一致`);
  if (policy.fastProfile !== "none") {
    if (!(typeof run.scaling_notes === "string" && run.scaling_notes.trim())) errors.push(`${label} 使用缩放 profile 时必须记录 scaling_notes`);
    if (!(typeof run.retained_contracts === "string" && run.retained_contracts.trim())) errors.push(`${label} 必须记录 retained_contracts`);
    if (!(typeof run.uncovered_semantics === "string" && run.uncovered_semantics.trim())) errors.push(`${label} 必须记录 uncovered_semantics`);
  }
  if (/\|\|\s*true|--passWithNoTests/i.test(String(run.command || ""))) errors.push(`${label} command 不得吞掉失败或允许零测试通过`);
  if (run.exit_status !== 0) errors.push(`${label} exit_status 必须为数值 0`);
  if (!isTreeHash(run.tree_hash_before) || !isTreeHash(run.tree_hash_after) || run.tree_hash_before.toLowerCase() !== run.tree_hash_after.toLowerCase()) {
    errors.push(`${label} 必须记录一致且有效的 tree hash`);
  } else if (expectedTreeHash && run.tree_hash_after.toLowerCase() !== String(expectedTreeHash).toLowerCase()) {
    errors.push(`${label} tree hash 与被验证的 index/commit tree 不一致`);
  }
  if (!(run.run_location === "main-workspace" || (typeof run.run_location === "string" && /^worktree:.+/.test(run.run_location.trim())))) errors.push(`${label} run_location 无效`);
  if (run.workspace_clean_before !== true || run.workspace_clean_after !== true) errors.push(`${label} 必须证明测试前后被测工作区均 clean`);
  const counts = run.test_counts;
  if (!counts || !["total", "passed", "failed", "skipped"].every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0) || counts.total < 1 || counts.failed !== 0 || counts.passed + counts.failed + counts.skipped !== counts.total) {
    errors.push(`${label} test_counts 必须有效、至少运行一个测试且零失败`);
  }
  const logPath = resolveEvidencePath(project, run.log, errors, `${label} log`);
  if (logPath && (!hasSuccessfulExit(logPath) || !hasExactCommand(fs.readFileSync(logPath, "utf8"), run.command))) errors.push(`${label} log 必须记录精确命令和 EXIT_CODE=0`);
  return errors;
}

function gitTree(project, ref) {
  const { execFileSync } = require("node:child_process");
  return execFileSync("git", ["rev-parse", `${ref}^{tree}`], { cwd: project, encoding: "utf8" }).trim();
}

function indexTree(project) {
  const { execFileSync } = require("node:child_process");
  return execFileSync("git", ["write-tree"], { cwd: project, encoding: "utf8" }).trim();
}

function safeIndexTree(project) {
  try {
    return indexTree(project);
  } catch {
    return null;
  }
}

function validateTestedCommit(project, testedCommit, expectedTree, label, errors) {
  if (typeof testedCommit !== "string" || !testedCommit.trim()) {
    errors.push(label + " 必须记录 tested_commit");
    return;
  }
  try {
    if (expectedTree && gitTree(project, testedCommit).toLowerCase() !== String(expectedTree).toLowerCase()) {
      errors.push(label + " tree hash 与 tested_commit 不一致");
    }
    require("node:child_process").execFileSync("git", ["merge-base", "--is-ancestor", testedCommit, "HEAD"], { cwd: project, stdio: "ignore" });
  } catch (error) {
    errors.push(label + " tested_commit 无效或不在 HEAD 历史中：" + error.message);
  }
}

function validateAdjacentBatch(project, round, state, data, errors) {
  const batch = round?.adjacent_batch;
  const expectedPaths = roundAdjacentPaths(state, data, round.round);
  if (!expectedPaths.length) return;
  if (!parseBaselinePolicy(project).policy?.adjacentCommand) {
    errors.push(`round ${round.round}: baseline.md 缺少 Adjacent test command`);
    return;
  }
  const evidencePath = path.join(project, EVIDENCE, `round-${round.round}`, "adjacent-batch.md");
  if (!fs.existsSync(evidencePath)) {
    errors.push(`round ${round.round}: 缺少 adjacent-batch.md`);
    return;
  }
  const parsed = parseJsonSection(fs.readFileSync(evidencePath, "utf8"), "Reviewctl Adjacent Batch Evidence", "Reviewctl Adjacent Batch Evidence");
  errors.push(...parsed.errors.map((error) => `round ${round.round}: ${error}`));
  if (parsed.value && JSON.stringify(parsed.value) !== JSON.stringify(batch)) {
    errors.push(`round ${round.round}: adjacent-batch.md 与 state.json 证据不一致`);
  }
  if (!batch || !["pass", "fail", "inconclusive"].includes(batch.status)) {
    errors.push(`round ${round.round}: 相邻测试批测尚未记录`);
    return;
  }
  if (!Array.isArray(batch.test_paths) || JSON.stringify([...batch.test_paths].sort()) !== JSON.stringify(expectedPaths)) {
    errors.push(`round ${round.round}: adjacent_batch.test_paths 必须精确覆盖本轮所有相邻测试`);
  }
  if (!batch.command || batch.command !== expandAdjacentCommand(parseBaselinePolicy(project).policy?.adjacentCommand || "", expectedPaths)) {
    errors.push(`round ${round.round}: adjacent batch command 必须精确运行本轮登记路径`);
  }
  if (!isTreeHash(batch.tree_hash)) {
    errors.push(`round ${round.round}: adjacent batch tree hash 无效`);
  } else {
    try {
      if (!batch.tested_commit || gitTree(project, batch.tested_commit).toLowerCase() !== batch.tree_hash.toLowerCase()) {
        errors.push(`round ${round.round}: adjacent batch tree hash 与 tested_commit 不一致`);
      }
      require("node:child_process").execFileSync("git", ["merge-base", "--is-ancestor", batch.tested_commit, "HEAD"], { cwd: project, stdio: "ignore" });
    } catch (error) {
      errors.push(`round ${round.round}: adjacent batch tested_commit 无效或不在 HEAD 历史中：${error.message}`);
    }
  }
  const reviewTestsCleaned = state.current_phase === "report" || ["converged", "converged_with_manual_merge", "incomplete"].includes(state.overall_status);
  for (const filename of expectedPaths) {
    const absolute = path.resolve(project, filename);
    if (!fs.existsSync(absolute)) {
      if (!reviewTestsCleaned) errors.push(`round ${round.round}: adjacent test 不存在：${filename}`);
    } else if (testSha256(absolute).toLowerCase() !== String(batch.test_hashes?.[filename] || "").toLowerCase()) {
      errors.push(`round ${round.round}: adjacent test hash 不匹配：${filename}`);
    }
  }
  if (batch.status === "pass") {
    if (batch.exit_status !== 0 || !isTreeHash(batch.tree_hash)) {
      errors.push(`round ${round.round}: adjacent batch 退出码或 tree hash 无效`);
    }
    const batchLog = resolveEvidencePath(project, batch.log, errors, `round ${round.round} adjacent batch log`);
    if (batchLog && !hasSuccessfulExit(batchLog)) errors.push(`round ${round.round}: adjacent batch log 缺少 EXIT_CODE=0`);
    if (!Number.isSafeInteger(batch.test_count) || batch.test_count < 2 || !Number.isSafeInteger(batch.failed_count) || batch.failed_count !== 0) {
      errors.push(`round ${round.round}: adjacent batch 通过时必须记录至少 2 个测试和 failed_count=0`);
    }
  }
  if (batch.status === "fail" && !(batch.failures?.length)) {
    errors.push(`round ${round.round}: 批测 fail 必须列出失败用例并登记为正式 finding`);
  }
  if (batch.status === "fail" && (batch.exit_status === 0 || !Array.isArray(batch.failures) || !batch.failures.length)) {
    errors.push(`round ${round.round}: fail 状态必须有非零退出码和失败用例`);
  }
  if (batch.status === "fail" && (!Number.isSafeInteger(batch.test_count) || batch.test_count < 1 || !Number.isSafeInteger(batch.failed_count) || batch.failed_count < 1)) {
    errors.push(`round ${round.round}: fail 状态必须记录有效的 test_count 和 failed_count`);
  }
  if (batch.status !== "inconclusive") {
    const logPath = resolveEvidencePath(project, batch.log, errors, `round ${round.round} adjacent batch log`);
    if (logPath) {
      const log = fs.readFileSync(logPath, "utf8");
      if (batch.log_sha256 && sha256File(logPath).toLowerCase() !== batch.log_sha256.toLowerCase()) errors.push(`round ${round.round}: adjacent batch 原始日志哈希不匹配`);
      if (!hasExactCommand(log, batch.command)) errors.push(`round ${round.round}: adjacent batch log COMMAND 与结构化命令不一致`);
      if (batch.exit_status === 0 ? !hasSuccessfulExit(logPath) : !hasNonzeroExit(logPath)) {
        errors.push(`round ${round.round}: adjacent batch log 的 EXIT_CODE 与结构化状态不一致`);
      }
    }
  }
  if (batch.status === "inconclusive" && !(typeof batch.reason === "string" && batch.reason.trim())) {
    errors.push(`round ${round.round}: inconclusive 批测必须说明阻塞原因`);
  }
}

function validateRoundRegression(project, round, errors, { requireCurrentHead = true } = {}) {
  const gate = round?.regression_gate;
  if (!gate) {
    errors.push(`round ${round?.round}: 缺少 progressive full regression gate`);
    return;
  }
  if (!gate.run || !["pass", "fail", "inconclusive"].includes(gate.status)) {
    errors.push(`round ${round.round}: progressive regression gate 证据无效`);
    return;
  }
  if (gate.status === "pass" && gate.run.status !== "pass") errors.push(`round ${round.round}: pass gate 必须对应 status=pass 的 full 运行`);
  if (gate.status === "fail" && gate.run.status !== "fail") errors.push(`round ${round.round}: fail gate 必须对应 status=fail 的 full 运行`);
  if (gate.status === "inconclusive" && !["inconclusive", "not_run"].includes(gate.run.status)) errors.push(`round ${round.round}: inconclusive gate 的 full status 必须是 inconclusive 或 not_run`);
  if (gate.evidence_file) {
    const evidenceErrors = [];
    const evidencePath = resolveEvidencePath(project, gate.evidence_file, evidenceErrors, `round ${round.round} regression evidence`);
    errors.push(...evidenceErrors);
    if (evidencePath && sha256File(evidencePath).toLowerCase() !== String(gate.evidence_sha256 || "").toLowerCase()) {
      errors.push(`round ${round.round}: regression evidence 文件哈希不匹配`);
    }
  } else if (gate.status !== "inconclusive" || gate.evidence_sha256 !== null) {
    errors.push(`round ${round.round}: 只有无运行结果的 inconclusive gate 可省略证据文件`);
  }
  const baseline = parseBaselinePolicy(project);
  errors.push(...baseline.errors);
  if (!baseline.policy) return;
  if (gate.command !== baseline.policy.fullCommand) errors.push(`round ${round.round}: regression gate 命令必须匹配 baseline full command`);
  if (gate.run.command !== baseline.policy.fullCommand) errors.push(`round ${round.round}: regression gate run.command 必须匹配 baseline full command`);
  if (gate.status !== "inconclusive" && (!isTreeHash(gate.tree_hash) || gate.tree_hash !== gate.run.tree_hash_after || gate.run.tree_hash_before !== gate.tree_hash)) {
    errors.push(`round ${round.round}: regression gate tree hash 不一致`);
  }
  if (gate.run.tested_commit && gate.run.tested_commit !== gate.tested_commit) errors.push(`round ${round.round}: regression gate tested_commit 不一致`);
  if (gate.status !== "inconclusive" || gate.run.tested_commit) {
    try {
      if (gitTree(project, gate.tested_commit).toLowerCase() !== String(gate.tree_hash || "").toLowerCase()) errors.push(`round ${round.round}: regression gate tree hash 与 tested_commit 不一致`);
      if (requireCurrentHead) {
        const head = require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" }).trim();
        if (head !== gate.tested_commit) errors.push(`round ${round.round}: regression gate 已过期，必须在当前 HEAD 重跑`);
      }
    } catch (error) {
      errors.push(`round ${round.round}: regression gate tested_commit 无效：${error.message}`);
    }
  }
  if (gate.status === "pass") errors.push(...validateFullRun(project, gate.run, baseline.policy, `round ${round.round} full regression`, gate.tree_hash));
  else if (gate.status === "fail") {
    if (!Number.isSafeInteger(gate.run.exit_status) || gate.run.exit_status === 0) errors.push(`round ${round.round}: fail regression gate 必须记录非零退出码`);
    const logPath = resolveEvidencePath(project, gate.run.log, errors, `round ${round.round} regression log`);
    if (logPath && (!hasNonzeroExit(logPath) || !hasExactCommand(fs.readFileSync(logPath, "utf8"), gate.command))) errors.push(`round ${round.round}: fail regression log 必须记录精确命令和非零退出码`);
    if (logPath && sha256File(logPath).toLowerCase() !== String(gate.log_sha256 || "").toLowerCase()) errors.push(`round ${round.round}: fail regression log hash 不匹配`);
  } else {
    if (!(typeof gate.reason === "string" && gate.reason.trim())) errors.push(`round ${round.round}: inconclusive regression gate 必须说明原因`);
    if (gate.run.log) {
      const logPath = resolveEvidencePath(project, gate.run.log, errors, `round ${round.round} regression log`);
      if (logPath && !hasExactCommand(fs.readFileSync(logPath, "utf8"), gate.command)) errors.push(`round ${round.round}: inconclusive regression log 命令不匹配`);
      if (logPath && gate.log_sha256 && sha256File(logPath).toLowerCase() !== gate.log_sha256.toLowerCase()) errors.push(`round ${round.round}: inconclusive regression log hash 不匹配`);
    }
  }
}

function adjacentTestPaths(data, throughRound = Infinity, promotions = [], state = {}) {
  const promoted = new Set((Array.isArray(promotions) ? promotions : []).filter(Boolean).map((item) => item.test_path));
  return adjacentRegistry(state, data).filter((entry) => entry.round <= throughRound && !promoted.has(entry.test_path)).map((entry) => entry.test_path).sort();
}

function validateFinalAdjacentBatch(project, state, data, errors, attempt = state.final_audit_attempt + 1) {
  const batches = state.final_audit?.preflight_batches;
  const batch = (Array.isArray(batches) ? batches : []).find((item) => item?.attempt === attempt);
  const paths = adjacentTestPaths(data, state.current_round, state.adjacent_promotions || [], state);
  if (!paths.length) return;
  if (!batch) {
    errors.push(`final audit attempt ${attempt}: 缺少终审前全历史相邻测试批测`);
    return;
  }
  if (batch.round !== state.current_round) errors.push(`final audit attempt ${attempt}: 必须在当前轮结束后执行聚合批测`);
  const evidencePath = path.join(project, EVIDENCE, `round-${batch.round}`, "final-audit", `attempt-${attempt}`, "adjacent-batch.md");
  if (!fs.existsSync(evidencePath)) errors.push(`final audit attempt ${attempt}: 缺少 adjacent-batch.md`);
  else {
    const parsed = parseJsonSection(fs.readFileSync(evidencePath, "utf8"), "Reviewctl Final Adjacent Batch Evidence", "Reviewctl Final Adjacent Batch Evidence");
    errors.push(...parsed.errors);
    if (JSON.stringify(parsed.value) !== JSON.stringify(batch)) errors.push(`final audit attempt ${attempt}: adjacent-batch.md 与 state.json 不一致`);
  }
  if (!Array.isArray(batch.test_paths) || JSON.stringify([...batch.test_paths].sort()) !== JSON.stringify(paths)) {
    errors.push(`final audit attempt ${attempt}: test_paths 必须覆盖所有已完成轮次的相邻测试`);
  }
  const policy = parseBaselinePolicy(project).policy;
  if (!policy?.adjacentCommand || batch.command !== expandAdjacentCommand(policy.adjacentCommand, paths)) {
    errors.push(`final audit attempt ${attempt}: command 必须精确运行所有历史相邻测试`);
  }
  try {
    const head = require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" }).trim();
    if (batch.tested_commit !== head) errors.push(`final audit attempt ${attempt}: 聚合批测已过期，tested_commit 必须是当前 HEAD`);
    if (!batch.tested_commit || gitTree(project, batch.tested_commit).toLowerCase() !== String(batch.tree_hash || "").toLowerCase()) {
      errors.push(`final audit attempt ${attempt}: tree_hash 与 tested_commit 不一致`);
    }
    require("node:child_process").execFileSync("git", ["merge-base", "--is-ancestor", batch.tested_commit, "HEAD"], { cwd: project, stdio: "ignore" });
  } catch (error) {
    errors.push(`final audit attempt ${attempt}: tested_commit 无效或不在 HEAD 历史中：${error.message}`);
  }
  for (const filename of paths) {
    if (!fs.existsSync(path.resolve(project, filename))) {
      if (!["converged", "converged_with_manual_merge", "incomplete"].includes(state.overall_status)) errors.push(`final audit attempt ${attempt}: adjacent test 不存在：${filename}`);
    }
    else if (sha256File(path.resolve(project, filename)).toLowerCase() !== String(batch.test_hashes?.[filename] || "").toLowerCase()) {
      errors.push(`final audit attempt ${attempt}: adjacent test hash 不匹配：${filename}`);
    }
  }
  if (!["pass", "fail", "inconclusive"].includes(batch.status)) errors.push(`final audit attempt ${attempt}: status 非法`);
  if (!Number.isSafeInteger(batch.test_count) || !Number.isSafeInteger(batch.failed_count) || batch.test_count < 0 || batch.failed_count < 0 || batch.failed_count > batch.test_count) errors.push(`final audit attempt ${attempt}: 测试计数非法`);
  if (batch.status === "pass" && (batch.exit_status !== 0 || batch.failed_count !== 0 || batch.test_count < paths.length)) {
    errors.push(`final audit attempt ${attempt}: pass 必须退出码为 0、零失败且覆盖全部测试文件`);
  }
  const logPath = resolveEvidencePath(project, batch.log, errors, `final audit attempt ${attempt} adjacent batch log`);
  if (logPath && sha256File(logPath) !== batch.log_sha256) errors.push(`final audit attempt ${attempt}: 原始日志哈希不匹配`);
  if (logPath && batch.status !== "inconclusive") {
    const log = fs.readFileSync(logPath, "utf8");
    if (!hasExactCommand(log, batch.command)) errors.push(`final audit attempt ${attempt}: 日志 COMMAND 与结构化命令不一致`);
    if (batch.status === "pass" ? !hasSuccessfulExit(logPath) : !hasNonzeroExit(logPath)) {
      errors.push(`final audit attempt ${attempt}: 日志退出码与状态不一致`);
    }
  }
  if (batch.status === "inconclusive" && !(typeof batch.reason === "string" && batch.reason.trim())) {
    errors.push(`final audit attempt ${attempt}: inconclusive 必须说明原因`);
  }
  if (batch.status !== "pass") errors.push(`final audit attempt ${attempt}: 全历史相邻测试批测尚未通过（${batch.status}）`);
}

function recordAdjacentBatch(project, round, data, fields) {
  const findings = (data.findings || []).filter((finding) =>
    adjacentRound(finding) === round.round &&
    finding.verification === "pass" && (finding.adjacent_tests || []).length > 0
  );
  const paths = [...new Set(findings.flatMap((finding) => finding.adjacent_tests))].sort();
  if (!paths.length) return { status: "not_required", test_paths: [], recorded_at: new Date().toISOString() };
  const hashes = Object.fromEntries(paths.map((filename) => [filename, sha256File(path.resolve(project, filename))]));
  return { ...fields, test_paths: paths, test_hashes: hashes, recorded_at: new Date().toISOString() };
}

function testSha256(filename) {
  return require("node:crypto").createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

function parseImplementationEvidence(project, filename, expectedTreeHash = null, { finding = null } = {}) {
  const errors = [];
  if (!fs.existsSync(filename)) return { run: null, policy: null, errors: ["缺少 implementation-result.md"] };
  const baseline = parseBaselinePolicy(project);
  errors.push(...baseline.errors);
  if (!baseline.policy) return { run: null, policy: null, errors };
  const report = fs.readFileSync(filename, "utf8");
  const parsed = parseJsonSection(report, "Reviewctl GREEN Evidence", "Reviewctl GREEN Evidence");
  errors.push(...parsed.errors);
  const evidence = parsed.value;
  const run = evidence?.full_suite || null;
  const fastRun = evidence?.fast_suite || null;
  const qualityRun = evidence?.quality_checks || null;
  errors.push(...validateQualityRun(project, qualityRun, baseline.policy, "GREEN quality evidence", expectedTreeHash));
  if (baseline.policy.tieringMode === "progressive") {
    if (!["normal", "high"].includes(evidence?.risk_assessment)) errors.push("progressive GREEN evidence 必须记录 risk_assessment=normal|high");
    const requireFull = evidence?.risk_assessment === "high" || ["P0", "P1"].includes(finding?.severity);
    if (run) errors.push(...validateFullRun(project, run, baseline.policy, "GREEN full evidence", expectedTreeHash));
    else if (requireFull) errors.push("P0/P1 或高风险 finding 必须提供 GREEN full_suite");
    else errors.push(...validateFastRun(project, fastRun, baseline.policy, "GREEN fast evidence", expectedTreeHash));
  } else {
    if (run) errors.push(...validateFullRun(project, run, baseline.policy, "GREEN full evidence", expectedTreeHash));
    else errors.push("Reviewctl GREEN Evidence 缺少 full_suite 对象");
  }
  return { run, fastRun, qualityRun, evidence, policy: baseline.policy, errors };
}

function validateVerificationEvidence(project, finding, config, filename, expectedHeadTree = null, { historical = false } = {}) {
  const errors = [];
  const baseline = parseBaselinePolicy(project);
  errors.push(...baseline.errors);
  if (!baseline.policy) return errors;
  if (!fs.existsSync(filename)) return [...errors, "缺少 verification-result.md"];

  const report = fs.readFileSync(filename, "utf8");
  const parsed = parseJsonSection(report, "Reviewctl Verification Evidence", "Reviewctl Verification Evidence");
  errors.push(...parsed.errors);
  const evidence = parsed.value;
  if (!evidence) return errors;
  if (!expectedHeadTree) {
    const ref = historical ? (evidence.regression?.scope === "full" ? evidence.full_test_suite?.tested_commit : evidence.regression?.tested_commit) : "HEAD";
    try {
      if (!ref) throw new Error("缺少 tested_commit");
      expectedHeadTree = gitTree(project, ref);
    } catch (error) {
      errors.push("无法读取被验证 commit tree：" + error.message);
    }
  }
  if (evidence.schema_version !== 1) errors.push("Reviewctl Verification Evidence schema_version 必须为 1");
  if (evidence.verdict !== "pass") errors.push("Reviewctl Verification Evidence verdict 必须为 pass");
  const regression = evidence.regression;
  if (historical && finding.commit && !["none", "unavailable"].includes(finding.commit)) {
    const verifiedCommit = regression?.scope === "full" ? evidence.full_test_suite?.tested_commit : regression?.tested_commit;
    try {
      if (!verifiedCommit) throw new Error("缺少 tested_commit");
      require("node:child_process").execFileSync("git", ["merge-base", "--is-ancestor", finding.commit, verifiedCommit], { cwd: project, stdio: "ignore" });
    } catch {
      errors.push("历史验证 tested_commit 必须包含 finding 的修复 commit");
    }
  }
  if (!regression || !["impacted", "full"].includes(regression.scope)) {
    errors.push("regression.scope 必须是 impacted 或 full");
  }
  if (!regression || regression.status !== "pass") errors.push("regression.status 必须为 pass");
  if (!regression || typeof regression.command !== "string" || !regression.command.trim()) {
    errors.push("regression.command 不能为空");
  }
  if (regression) {
    if (regression.exit_status !== 0) errors.push("regression.exit_status 必须为数值 0");
    const regressionCommand = String(regression.command || "").toLowerCase();
    if (regressionCommand.includes("|| true") || regressionCommand.includes("--passwithnotests")) {
      errors.push("regression.command 不得吞掉失败或允许零测试通过");
    }
    if (regression.scope === "impacted") {
      if (regression.command?.trim() !== baseline.policy.impactedCommand.trim()) {
        errors.push("impacted regression.command 必须与 baseline Impacted test command 一致");
      }
      if (regression.dependency_closure !== "transitive_reverse") {
        errors.push("impacted 必须声明已覆盖直接依赖方的传递反向依赖闭包");
      }
      if (!Array.isArray(regression.changed_paths) || regression.changed_paths.length === 0 ||
          !Array.isArray(regression.impacted_targets) || regression.impacted_targets.length === 0 ||
          typeof regression.impact_basis !== "string" || !regression.impact_basis.trim()) {
        errors.push("impacted evidence 必须记录 changed_paths、impacted_targets 和 impact_basis");
      }
      if (![...(regression.changed_paths || []), ...(regression.impacted_targets || [])].every((value) => typeof value === "string" && value.trim())) {
        errors.push("changed_paths 和 impacted_targets 必须是非空字符串列表");
      }
      if (!isTreeHash(regression.tree_hash_before) || regression.tree_hash_before !== regression.tree_hash_after ||
          regression.tree_hash_after.toLowerCase() !== String(expectedHeadTree || "").toLowerCase()) {
        errors.push("impacted regression tree hash 必须在测试前后稳定并匹配当前 HEAD");
      }
      validateTestedCommit(project, regression.tested_commit, expectedHeadTree, "impacted regression", errors);
      const counts = regression.test_counts;
      if (!counts || !["total", "passed", "failed", "skipped"].every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0) ||
          counts.total < 1 || counts.failed !== 0 || counts.passed + counts.failed + counts.skipped !== counts.total) {
        errors.push("impacted test_counts 无效或包含失败/零测试");
      }
      const regressionLog = resolveEvidencePath(project, regression.log, errors, "impacted regression log");
      if (regressionLog && !hasSuccessfulExit(regressionLog)) errors.push("impacted regression log 缺少 EXIT_CODE=0");
    }
    if (regression.scope === "full" && regression.command?.trim() !== baseline.policy.fullCommand.trim()) {
      errors.push("full regression.command 必须与 baseline Full test command 一致");
    }
  }
  if (!['normal', 'high'].includes(evidence.risk_assessment)) {
    errors.push("risk_assessment 必须是 normal 或 high");
  }
  if (evidence.risk_assessment === "high" && !(typeof evidence.risk_reason === "string" && evidence.risk_reason.trim())) {
    errors.push("high risk_assessment 必须填写 risk_reason");
  }

  const verificationFull = evidence.full_test_suite;
  if (verificationFull) {
    errors.push(...validateFullRun(project, verificationFull, baseline.policy, "verification full evidence", expectedHeadTree));
    if (typeof verificationFull.tested_commit !== "string" || !verificationFull.tested_commit.trim()) {
      errors.push("verification full evidence 必须记录 tested_commit");
    } else {
      try {
        if (gitTree(project, verificationFull.tested_commit).toLowerCase() !== String(verificationFull.tree_hash_after || "").toLowerCase()) {
          errors.push("verification full evidence tree hash 与 tested_commit 不一致");
        }
        require("node:child_process").execFileSync("git", ["merge-base", "--is-ancestor", verificationFull.tested_commit, "HEAD"], { cwd: project, stdio: "ignore" });
      } catch (error) {
        errors.push(`verification full tested_commit 无效或不在 HEAD 历史中：${error.message}`);
      }
    }
    if (regression?.log !== verificationFull.log) errors.push("regression.log 必须与 verification full log 一致");
  }
  if (baseline.policy.tieringMode === "full-everywhere" && regression?.scope !== "full") {
    errors.push("full-everywhere 要求 verification regression.scope=full");
  }
  if (regression?.scope === "full") {
    if (!verificationFull || regression.command?.trim() !== verificationFull.command?.trim()) {
      errors.push("regression.scope=full 时必须提供同一命令的 verification full evidence");
    }
  }
  if (verificationFull && regression?.scope !== "full") {
    errors.push("提供 verification full evidence 时 regression.scope 必须为 full");
  }

  const implementationPath = path.join(path.dirname(filename), "implementation-result.md");
  const impl = parseImplementationEvidence(project, implementationPath, null, { finding });
  const implStatus = evidence.implementation_full_suite_status;
  if (finding.implementation_status === "fixed") {
    if (!finding.commit || finding.commit === "none") errors.push("fixed finding 缺少修复 commit，无法核对 GREEN tree");
    else {
      try {
        const fixTree = gitTree(project, finding.commit);
        if (baseline.policy.tieringMode === "progressive" && !impl.run) {
          if (!["P2", "P3"].includes(finding.severity) || evidence.risk_assessment !== "normal") {
            errors.push("progressive 模式只有普通风险 P2/P3 finding 可延後 GREEN full 至轮末");
          }
          if (implStatus !== "not_run" || evidence.implementation_fast_suite_status !== "pass") {
            errors.push("延後 GREEN full 时必须记录 implementation_full_suite_status=not_run 和 implementation_fast_suite_status=pass");
          }
          errors.push(...validateFastRun(project, impl.fastRun, impl.policy || baseline.policy, "GREEN fast evidence", fixTree));
        } else {
          if (impl.run?.status === "fail") errors.push("实现阶段 GREEN full 为 fail，必须重新修复并通过 GREEN full");
          errors.push(...validateFullRun(project, impl.run, impl.policy || baseline.policy, "GREEN full evidence", fixTree));
          if (implStatus !== "pass") errors.push("implementation_full_suite_status 必须为 pass");
        }
      } catch (error) {
        errors.push(`无法读取修复 commit tree：${error.message}`);
      }
    }
    errors.push(...impl.errors);
  }

  const severityRequiresFull = ["P0", "P1"].includes(finding.severity) || evidence.risk_assessment === "high";
  const tieringRequiresFull = baseline.policy.tieringMode === "full-everywhere";
  if (finding.implementation_status === "already_fixed" && !verificationFull) {
    const fullRequired = severityRequiresFull || tieringRequiresFull;
    const exception = evidence.already_fixed_baseline_exception;
    let validException = false;
    if (!fullRequired && exception && finding.commit && finding.commit !== "none" &&
        baseline.policy.baselineResult === "pass" && config?.baseline_head) {
      try {
        const { execFileSync } = require("node:child_process");
        execFileSync("git", ["merge-base", "--is-ancestor", finding.commit, config.baseline_head], {
          cwd: project,
          stdio: "ignore",
        });
        validException = true;
      } catch {}
    }
    if (fullRequired) {
      errors.push("P0/P1、高风险或 full-everywhere finding 必须由验证阶段重跑 full");
    } else if (validException) {
      if (exception.baseline_head_ancestor !== true || exception.baseline_full_pass !== true) {
        errors.push("already_fixed baseline exception 必须记录 ancestry 与 baseline full pass 两项事实");
      }
    } else {
      errors.push("already_fixed 默认必须运行 verification full；仅普通风险的 baseline ancestor finding 可例外");
    }
  } else if (finding.implementation_status === "fixed") {
    if ((severityRequiresFull || tieringRequiresFull) && !verificationFull) {
      errors.push("P0/P1、高风险或 full-everywhere finding 必须由验证阶段重跑 full");
    }
  }

  if ((finding.implementation_status === "fixed" || finding.implementation_status === "already_fixed") &&
      evidence.verdict !== "pass") errors.push("只有完整证据满足条件时才能记录 pass");
  return errors;
}

module.exports = {
  parseBaselinePolicy,
  resolveEvidencePath,
  parseJsonSection,
  parseImplementationEvidence,
  validateFullRun,
  validateQualityRun,
  validateFastRun,
  validateVerificationEvidence,
  validateAdjacentBatch,
  validateRoundRegression,
  validateFinalAdjacentBatch,
  adjacentTestPaths,
  expandAdjacentCommand,
  adjacentRound,
  adjacentRegistry,
  roundAdjacentPaths,
  hasExactCommand,
  validateAdjacentLog,
  validateAdjacentPromotions,
  recordAdjacentBatch,
  sha256File,
  sha256GitFile,
  gitTree,
  indexTree,
  safeIndexTree,
};
