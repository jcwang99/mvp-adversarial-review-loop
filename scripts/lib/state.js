const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCHEMA_VERSION = 1;

const PHASES = [
  "baseline",
  "review",
  "adjudication",
  "repair",
  "verification",
  "round_decision",
  "final_audit",
  "report",
];

const TRANSITIONS = {
  baseline: ["review"],
  review: ["adjudication"],
  adjudication: ["repair", "round_decision"],
  repair: ["verification", "round_decision"],
  verification: ["repair", "round_decision"],
  round_decision: ["review", "final_audit", "report"],
  final_audit: ["adjudication", "report"],
  report: [],
};

const STATUSES = [
  "in_progress",
  "waiting_on_evidence",
  "incomplete",
  "converged",
  "converged_with_manual_merge",
];

const DECISIONS = ["accepted", "deferred", "rejected", "needs-evidence"];
const VERIFICATIONS = [
  "pending",
  "pass",
  "fail",
  "inconclusive",
  "blocked_by_user_changes",
];
const SEVERITIES = ["P0", "P1", "P2", "P3"];
const CHANGE_ORIGINS = ["regression", "pre-existing", "undetermined"];
const NEEDS_CLARITY = ["clear_claim_lacking_env", "unclear_claim"];
const ROLES = {
  SEC: "security",
  FUNC: "functionality",
  REL: "reliability",
  API: "api",
  PERF: "performance",
  UX: "accessibility",
  OPS: "operations",
  PROD: "product",
};
const FINDING_ID = /^R(\d+)-F(\d{3})-(SEC|FUNC|REL|API|PERF|UX|OPS|PROD)$/;
const TEMP_ID = /^(SEC|FUNC|REL|API|PERF|UX|OPS|PROD)-\d{3}$/;

const EVIDENCE = ".review-evidence";

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeTextAtomic(file, content) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function writeJsonAtomic(file, value) {
  writeTextAtomic(file, JSON.stringify(value, null, 2) + "\n");
}

function readJson(file, label = file) {
  if (!fs.existsSync(file)) {
    throw new Error(`missing ${label}: ${file}`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`invalid JSON in ${label}: ${error.message}`);
  }
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function gitHead(project) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: project,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unavailable";
  }
}

function roleSlug(role) {
  return ROLES[role] || null;
}

function isRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, role);
}

function isPlaceholder(value) {
  return typeof value === "string" && /^\[.*\]$/.test(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function defaultConfig(project, maxRounds, mode) {
  const at = now();
  return {
    schema_version: SCHEMA_VERSION,
    max_rounds: maxRounds,
    confirmed_by_user: true,
    confirmed_at: at,
    confirmation_mode: mode,
    baseline_head: gitHead(project),
    created_at: at,
  };
}

function defaultState(config) {
  const at = now();
  return {
    schema_version: SCHEMA_VERSION,
    overall_status: "in_progress",
    current_phase: "baseline",
    current_round: 1,
    max_rounds_at_init: config.max_rounds,
    rounds_consumed: 0,
    can_trigger_new_round: true,
    final_audit_attempt: 0,
    active_finding: null,
    baseline_head: config.baseline_head,
    current_head: config.baseline_head,
    last_completed_event: "initialized",
    next_action: "建立 baseline 并进入 review",
    blockers: [],
    authorizations: [],
    rounds: [],
    final_audit: { attempts: [], reentry_pending: false },
    created_at: at,
    updated_at: at,
    last_transition: { from: null, to: "baseline", at },
  };
}

function defaultFindings() {
  return { schema_version: SCHEMA_VERSION, findings: [] };
}

function loadConfig(project) {
  return readJson(path.join(project, EVIDENCE, "review-config.json"), "review-config.json");
}

function loadState(project) {
  return readJson(path.join(project, EVIDENCE, "state.json"), "state.json");
}

function loadFindings(project) {
  return readJson(path.join(project, EVIDENCE, "findings.json"), "findings.json");
}

function saveConfig(project, config) {
  writeJsonAtomic(path.join(project, EVIDENCE, "review-config.json"), config);
}

function saveState(project, state) {
  state.updated_at = now();
  writeJsonAtomic(path.join(project, EVIDENCE, "state.json"), state);
}

function saveFindings(project, data) {
  writeJsonAtomic(path.join(project, EVIDENCE, "findings.json"), data);
}

function canTriggerNewRound(state, config) {
  return state.rounds_consumed < config.max_rounds;
}

function roundEntry(state, round) {
  return state.rounds.find((item) => item.round === round) || null;
}

function ensureRound(state, round) {
  let entry = roundEntry(state, round);
  if (!entry) {
    entry = {
      round,
      status: "in_progress",
      roles: [],
      raw_candidates: null,
      duplicates: null,
      screened_out: null,
      replay_eligible: null,
      new_in_scope_p0p1p2: null,
      started_at: now(),
      completed_at: null,
    };
    state.rounds.push(entry);
  }
  return entry;
}

function completedRounds(state) {
  return state.rounds
    .filter((item) => item.status === "completed")
    .sort((a, b) => a.round - b.round);
}

function lastAudit(state) {
  const attempts = state.final_audit && state.final_audit.attempts;
  return attempts && attempts.length ? attempts[attempts.length - 1] : null;
}

function validateConfig(config) {
  const errors = [];
  if (config.schema_version !== SCHEMA_VERSION) errors.push("review-config.json schema_version 必须为 1");
  if (!Number.isInteger(config.max_rounds) || config.max_rounds < 2) {
    errors.push("max_rounds 必须是 >= 2 的整数");
  }
  if (config.confirmed_by_user !== true) errors.push("max_rounds 未记录用户确认");
  if (!["interactive", "agent_declared"].includes(config.confirmation_mode)) {
    errors.push("confirmation_mode 非法");
  }
  if (!config.confirmed_at || !/^\d{4}-\d{2}-\d{2}T/.test(config.confirmed_at)) {
    errors.push("confirmed_at 必须是 ISO 8601");
  }
  if (!config.baseline_head) errors.push("baseline_head 不能为空");
  return errors;
}

function validateState(state, config) {
  const errors = [];
  if (state.schema_version !== SCHEMA_VERSION) errors.push("state.json schema_version 必须为 1");
  if (!STATUSES.includes(state.overall_status)) errors.push(`overall_status 非法：${state.overall_status}`);
  if (!PHASES.includes(state.current_phase)) errors.push(`current_phase 非法：${state.current_phase}`);
  if (!Number.isInteger(state.current_round) || state.current_round < 1) {
    errors.push("current_round 必须是 >= 1 的整数");
  }
  if (config && Number.isInteger(config.max_rounds) && state.current_round > config.max_rounds) {
    errors.push("current_round 不能大于 max_rounds");
  }
  if (config && state.max_rounds_at_init !== config.max_rounds) {
    errors.push("review-config.json 的 max_rounds 与初始化记录不一致");
  }
  if (!Number.isInteger(state.rounds_consumed) || state.rounds_consumed < 0) {
    errors.push("rounds_consumed 必须是 >= 0 的整数");
  }
  if (config && state.rounds_consumed > config.max_rounds) {
    errors.push("rounds_consumed 不能大于 max_rounds");
  }
  if (typeof state.can_trigger_new_round !== "boolean") {
    errors.push("can_trigger_new_round 必须是布尔值");
  } else if (config && state.can_trigger_new_round !== canTriggerNewRound(state, config)) {
    errors.push("can_trigger_new_round 与 rounds_consumed/max_rounds 不一致");
  }
  if (!Number.isInteger(state.final_audit_attempt) || state.final_audit_attempt < 0 || state.final_audit_attempt > 3) {
    errors.push("final_audit_attempt 必须是 0..3 的整数");
  }
  if (state.active_finding !== null && !FINDING_ID.test(String(state.active_finding))) {
    errors.push(`active_finding 非法：${state.active_finding}`);
  }
  if (["repair", "verification"].includes(state.current_phase) && !state.active_finding) {
    errors.push(`${state.current_phase} 阶段必须设置 active_finding`);
  }
  if (state.current_phase === "round_decision" && state.rounds_consumed !== state.current_round) {
    errors.push("round_decision 阶段必须满足 rounds_consumed = current_round");
  }
  if (state.current_phase === "final_audit" && state.final_audit_attempt < 1) {
    errors.push("final_audit 阶段必须设置 final_audit_attempt >= 1");
  }
  if (["converged", "converged_with_manual_merge"].includes(state.overall_status) && state.current_phase !== "report") {
    errors.push("最终状态必须处于 report 阶段");
  }
  if (!Array.isArray(state.blockers)) errors.push("blockers 必须是数组");
  if (!Array.isArray(state.authorizations)) errors.push("authorizations 必须是数组");
  if (!Array.isArray(state.rounds)) errors.push("rounds 必须是数组");
  if (!state.final_audit || !Array.isArray(state.final_audit.attempts)) {
    errors.push("final_audit.attempts 必须是数组");
  }
  if (!state.last_transition || !PHASES.includes(state.last_transition.to)) {
    errors.push("last_transition 非法");
  }
  return errors;
}

function validateFindings(data) {
  const errors = [];
  if (data.schema_version !== SCHEMA_VERSION) errors.push("findings.json schema_version 必须为 1");
  if (!Array.isArray(data.findings)) {
    errors.push("findings 必须是数组");
    return errors;
  }
  const ids = new Set();
  for (const finding of data.findings) {
    const label = finding.id || "(missing id)";
    if (!FINDING_ID.test(String(finding.id))) errors.push(`${label}: finding ID 非法`);
    if (ids.has(finding.id)) errors.push(`${label}: finding ID 重复`);
    ids.add(finding.id);
    if (!isRole(finding.role)) errors.push(`${label}: role 非法`);
    if (!SEVERITIES.includes(finding.severity)) errors.push(`${label}: severity 非法`);
    if (!DECISIONS.includes(finding.decision)) errors.push(`${label}: decision 非法`);
    if (!VERIFICATIONS.includes(finding.verification)) errors.push(`${label}: verification 非法`);
    if (!CHANGE_ORIGINS.includes(finding.change_origin)) errors.push(`${label}: change_origin 非法`);
    for (const key of ["reproduced_by", "verified_by"]) {
      if (finding[key] !== undefined && !["agent", "main-agent"].includes(finding[key])) {
        errors.push(`${label}: ${key} 必须是 agent 或 main-agent`);
      }
    }
    if (!Array.isArray(finding.original_ids) || finding.original_ids.length === 0) {
      errors.push(`${label}: original_ids 不能为空`);
    }
    for (const original of finding.original_ids || []) {
      if (!TEMP_ID.test(String(original))) errors.push(`${label}: original_id 非法：${original}`);
    }
    if (finding.decision === "accepted") {
      if (finding.reproduced !== true) errors.push(`${label}: accepted 必须有 reproduced=true`);
      if (finding.reproduction_status !== "reproduced") errors.push(`${label}: accepted 的 reproduction_status 必须是 reproduced`);
    }
    if (finding.decision === "rejected") {
      if (finding.reproduced !== false) errors.push(`${label}: rejected 必须有 reproduced=false`);
      if (finding.reproduction_status !== "not-reproduced") errors.push(`${label}: rejected 必须有 not-reproduced 反证`);
    }
    if (finding.decision === "deferred") {
      if (finding.reproduced !== true) errors.push(`${label}: deferred 必须有 reproduced=true`);
      if (!finding.deferred_reason) errors.push(`${label}: deferred 必须记录 deferred_reason`);
      if (!finding.disposition_plan) errors.push(`${label}: deferred 必须记录 disposition_plan`);
    }
    if (finding.decision === "needs-evidence") {
      if (finding.reproduced !== false) errors.push(`${label}: needs-evidence 不能标记为已复现`);
      if (!["blocked", "not_run"].includes(finding.reproduction_status)) {
        errors.push(`${label}: needs-evidence 的 reproduction_status 必须是 blocked 或 not_run`);
      }
      if (["P2", "P3"].includes(finding.severity) && !NEEDS_CLARITY.includes(finding.needs_evidence_clarity)) {
        errors.push(`${label}: P2/P3 needs-evidence 必须标记 needs_evidence_clarity`);
      }
      if (["P0", "P1"].includes(finding.severity) && finding.needs_evidence_clarity === "unclear_claim") {
        errors.push(`${label}: P0/P1 needs-evidence 不能是 unclear_claim`);
      }
    }
    if (finding.challenge_required === true && !["supports", "disputes", "inconclusive"].includes(finding.challenge_result)) {
      errors.push(`${label}: 必须挑战项缺少 challenge_result`);
    }
    if (finding.verification === "pass" && finding.decision !== "accepted") {
      errors.push(`${label}: 只有 accepted 可以 verification=pass`);
    }
    if (finding.verification === "pass" && !["fixed", "already_fixed"].includes(finding.implementation_status)) {
      errors.push(`${label}: verification=pass 前必须记录 implementation_status`);
    }
    if (finding.verification === "blocked_by_user_changes") {
      if (finding.decision !== "accepted") errors.push(`${label}: blocked_by_user_changes 必须是 accepted`);
      if (finding.merge_conflict !== true) errors.push(`${label}: blocked_by_user_changes 必须 merge_conflict=true`);
    }
    if (finding.verification === "fail" && !Number.isInteger(finding.verification_attempts)) {
      errors.push(`${label}: verification_attempts 必须是整数`);
    }
    if (finding.unresolved === true && !finding.unresolved_reason) {
      errors.push(`${label}: unresolved 必须记录 unresolved_reason`);
    }
  }
  return errors;
}

function isTerminal(finding) {
  if (finding.verification === "pass" || finding.verification === "blocked_by_user_changes") return true;
  if (finding.unresolved === true) return true;
  if (finding.verification === "inconclusive" && finding.verification_attempts >= 2) return true;
  if (finding.verification === "fail" && finding.verification_attempts >= 2 && finding.unresolved === true) return true;
  return false;
}

function coverage(data) {
  const findings = data.findings || [];
  const denominator = findings.length;
  const exemptions = findings.filter(
    (finding) =>
      finding.decision === "needs-evidence" &&
      ["P2", "P3"].includes(finding.severity) &&
      finding.needs_evidence_clarity === "clear_claim_lacking_env"
  ).length;
  const numerator = findings.filter(
    (finding) =>
      (finding.decision === "accepted" && finding.reproduced === true) ||
      (finding.decision === "rejected" && finding.reproduction_status === "not-reproduced") ||
      (finding.decision === "deferred" && finding.reproduced === true)
  ).length;
  const adjustedDenominator = denominator - exemptions;
  const raw = denominator === 0 ? null : numerator / denominator;
  const adjusted = adjustedDenominator === 0 ? null : numerator / adjustedDenominator;
  return {
    numerator,
    denominator,
    exemptions,
    adjusted_denominator: adjustedDenominator,
    raw,
    adjusted,
    raw_percent: raw === null ? null : Math.round(raw * 1000) / 10,
    adjusted_percent: adjusted === null ? null : Math.round(adjusted * 1000) / 10,
  };
}

function convergenceReasons(state, config, data, target) {
  const reasons = [];
  const findings = data.findings || [];
  const accepted = findings.filter((finding) => finding.decision === "accepted");
  const blocked = accepted.filter((finding) => finding.verification === "blocked_by_user_changes");

  if (target === "converged") {
    for (const finding of accepted) {
      if (finding.verification !== "pass") reasons.push(`${finding.id} 未 verified（${finding.verification}）`);
    }
    if (blocked.length > 0) reasons.push("存在 blocked_by_user_changes，不能标 CONVERGED");
  } else {
    for (const finding of accepted) {
      if (!["pass", "blocked_by_user_changes"].includes(finding.verification)) {
        reasons.push(`${finding.id} 未 verified 或 blocked_by_user_changes（${finding.verification}）`);
      }
    }
    if (blocked.length === 0) reasons.push("CONVERGED_WITH_MANUAL_MERGE 需要至少一个 blocked_by_user_changes");
    for (const finding of blocked) {
      if (finding.merge_conflict !== true) reasons.push(`${finding.id} 缺少 merge_conflict=true`);
    }
  }

  for (const finding of findings) {
    if (["P0", "P1"].includes(finding.severity) && finding.decision === "needs-evidence") {
      reasons.push(`${finding.id} 是范围内 ${finding.severity} needs-evidence`);
    }
    if (finding.decision === "needs-evidence" && finding.needs_evidence_clarity === "unclear_claim") {
      reasons.push(`${finding.id} 的 needs-evidence 仍为 unclear_claim`);
    }
  }

  const cov = coverage(data);
  if (cov.adjusted === null) {
    reasons.push("调整后覆盖率不可计算（分母为 0）");
  } else if (cov.adjusted < 0.8) {
    reasons.push(`调整后覆盖率 ${cov.adjusted_percent}% < 80%`);
  }

  const audit = lastAudit(state);
  if (!audit || audit.status !== "complete") {
    reasons.push("最终审计未完成");
  } else if (Number(audit.new_issues) > 0) {
    reasons.push(`最终审计仍有 ${audit.new_issues} 个新问题`);
  }

  if (state.current_phase !== "report") reasons.push("当前不在 report 阶段");
  if (config && state.rounds_consumed < 2) reasons.push("常规评审轮不足 2 轮");

  return reasons;
}

module.exports = {
  SCHEMA_VERSION,
  PHASES,
  TRANSITIONS,
  STATUSES,
  DECISIONS,
  VERIFICATIONS,
  SEVERITIES,
  CHANGE_ORIGINS,
  NEEDS_CLARITY,
  ROLES,
  FINDING_ID,
  TEMP_ID,
  EVIDENCE,
  now,
  ensureDir,
  writeTextAtomic,
  writeJsonAtomic,
  readJson,
  readText,
  gitHead,
  roleSlug,
  isRole,
  isPlaceholder,
  assert,
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
};
