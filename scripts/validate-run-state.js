#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const target = process.argv[2] || ".review-evidence/run-state.md";
const absolute = path.resolve(target);
const errors = [];
const warnings = [];

const phases = new Set([
  "baseline",
  "review",
  "adjudication",
  "repair",
  "verification",
  "round_decision",
  "final_audit",
  "report",
]);

const statuses = new Set([
  "in_progress",
  "waiting_on_evidence",
  "incomplete",
  "converged",
  "converged_with_manual_merge",
]);

const required = [
  "overall_status",
  "current_phase",
  "current_round",
  "max_rounds",
  "rounds_consumed",
  "can_trigger_new_round",
  "final_audit_attempt",
  "baseline_head",
  "current_head",
  "last_completed_event",
  "active_finding",
  "next_action",
  "blockers",
  "updated_at",
];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function stripComment(value) {
  return value.replace(/\s+\([^)]*\)\s*$/, "").trim();
}

function isPlaceholder(value) {
  return /^\[.*\]$/.test(value);
}

function parseInteger(name, value, min, max) {
  if (!/^\d+$/.test(value)) {
    fail(`${name} 必须是整数，当前值：${value || "(empty)"}`);
    return null;
  }
  const number = Number(value);
  if (number < min || number > max) {
    fail(`${name} 必须在 ${min}..${max}，当前值：${number}`);
    return null;
  }
  return number;
}

if (!fs.existsSync(absolute)) {
  console.error(`ERROR: 找不到 run-state 文件：${absolute}`);
  process.exit(1);
}

const content = fs.readFileSync(absolute, "utf8");
const fields = {};

for (const line of content.split(/\r?\n/)) {
  const match = line.match(/^[-*]\s*(?:\*\*)?([a-z_]+)(?:\*\*)?\s*:\s*(.*)$/i);
  if (match) {
    fields[match[1].toLowerCase()] = stripComment(match[2]);
  }
}

for (const name of required) {
  if (!(name in fields)) {
    fail(`缺少必填字段：${name}`);
  } else if (isPlaceholder(fields[name])) {
    fail(`${name} 仍是模板占位符：${fields[name]}`);
  }
}

const status = fields.overall_status;
if (status && !statuses.has(status)) {
  fail(`overall_status 非法：${status}`);
}

const phase = fields.current_phase;
if (phase && !phases.has(phase)) {
  fail(`current_phase 非法：${phase}`);
}

const maxRounds = parseInteger("max_rounds", fields.max_rounds || "", 2, 1000);
const currentRound = parseInteger(
  "current_round",
  fields.current_round || "",
  1,
  maxRounds === null ? 1000 : maxRounds
);
const consumed = parseInteger(
  "rounds_consumed",
  fields.rounds_consumed || "",
  0,
  maxRounds === null ? 1000 : maxRounds
);
parseInteger("final_audit_attempt", fields.final_audit_attempt || "", 0, 3);

if (fields.can_trigger_new_round !== undefined) {
  if (!/^(true|false)$/.test(fields.can_trigger_new_round)) {
    fail(`can_trigger_new_round 必须是 true 或 false，当前值：${fields.can_trigger_new_round}`);
  } else if (consumed !== null && maxRounds !== null) {
    const expected = consumed < maxRounds;
    if ((fields.can_trigger_new_round === "true") !== expected) {
      fail(
        `can_trigger_new_round 与 rounds_consumed/max_rounds 不一致：应为 ${expected}`
      );
    }
  }
}

if (consumed !== null && currentRound !== null && consumed > currentRound) {
  fail(`rounds_consumed (${consumed}) 不能大于 current_round (${currentRound})`);
}

if (phase === "round_decision" && consumed !== null && currentRound !== null) {
  if (consumed !== currentRound) {
    fail(
      `round_decision 阶段必须设置 rounds_consumed = current_round，当前为 ${consumed} / ${currentRound}`
    );
  }
}

if (phase === "repair" || phase === "verification") {
  if (!fields.active_finding || fields.active_finding === "none" || isPlaceholder(fields.active_finding)) {
    fail(`${phase} 阶段必须设置 active_finding 为标准 ID`);
  }
}

if (phase === "final_audit") {
  const attempt = Number(fields.final_audit_attempt);
  if (!Number.isInteger(attempt) || attempt < 1) {
    fail("final_audit 阶段必须设置 final_audit_attempt >= 1");
  }
}

if (phase === "report" && (status === "in_progress" || status === "waiting_on_evidence")) {
  warn("report 阶段建议使用 final 状态：converged / converged_with_manual_merge / incomplete");
}

if (
  (status === "converged" || status === "converged_with_manual_merge") &&
  phase !== "report"
) {
  warn("最终状态通常应在 report 阶段写入");
}

if (fields.updated_at && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(fields.updated_at)) {
  warn(`updated_at 不是 ISO 8601 时间：${fields.updated_at}`);
}

if (fields.next_action && fields.next_action.trim().length === 0) {
  fail("next_action 不能为空");
}

if (warnings.length > 0) {
  for (const message of warnings) {
    console.warn(`WARN: ${message}`);
  }
}

if (errors.length > 0) {
  for (const message of errors) {
    console.error(`ERROR: ${message}`);
  }
  console.error(`校验失败：${absolute}（${errors.length} 个错误）`);
  process.exit(1);
}

console.log(`OK: ${absolute}`);
