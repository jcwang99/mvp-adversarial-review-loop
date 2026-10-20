const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  EVIDENCE,
  writeTextAtomic,
  writeJsonAtomic,
  coverage,
} = require("./state");

const GENERATED = "<!-- GENERATED FILE - DO NOT EDIT. Run reviewctl render to regenerate. -->";

function hash(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function cell(value) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value).replace(/\|/g, "\\|");
}

function renderRunState(state, config, data) {
  const cov = coverage(data);
  const lines = [
    "# Review Run State",
    "",
    GENERATED,
    "",
    `- overall_status: ${state.overall_status}`,
    `- current_phase: ${state.current_phase}`,
    `- current_round: ${state.current_round}`,
    `- max_rounds: ${config.max_rounds}`,
    `- max_rounds_at_init: ${state.max_rounds_at_init}`,
    `- rounds_consumed: ${state.rounds_consumed}`,
    `- can_trigger_new_round: ${state.can_trigger_new_round}`,
    `- final_audit_attempt: ${state.final_audit_attempt}`,
    `- baseline_head: ${state.baseline_head}`,
    `- current_head: ${state.current_head}`,
    `- last_completed_event: ${state.last_completed_event}`,
    `- active_finding: ${state.active_finding || "none"}`,
    `- next_action: ${state.next_action}`,
    `- blockers: ${state.blockers.length ? state.blockers.join("; ") : "none"}`,
    `- updated_at: ${state.updated_at}`,
    "",
    "## Rounds",
    "",
    "| Round | Status | Roles | Raw | Duplicates | Screened | Replay-eligible | New in-scope P0/P1/P2 |",
    "|-------|--------|-------|-----|------------|----------|-----------------|-----------------------|",
  ];

  for (const round of state.rounds) {
    lines.push(
      `| ${round.round} | ${round.status} | ${Array.isArray(round.roles) && round.roles.length ? round.roles.join(", ") : "-"} | ${cell(round.raw_candidates)} | ${cell(round.duplicates)} | ${cell(round.screened_out)} | ${cell(round.replay_eligible)} | ${cell(round.new_in_scope_p0p1p2)} |`
    );
  }
  if (state.rounds.length === 0) {
    lines.push("| - | - | - | - | - | - | - | - |");
  }

  lines.push(
    "",
    "## Counts",
    "",
    `- findings: ${data.findings.length}`,
    `- accepted: ${data.findings.filter((finding) => finding.decision === "accepted").length}`,
    `- deferred: ${data.findings.filter((finding) => finding.decision === "deferred").length}`,
    `- rejected: ${data.findings.filter((finding) => finding.decision === "rejected").length}`,
    `- needs-evidence: ${data.findings.filter((finding) => finding.decision === "needs-evidence").length}`,
    `- coverage_raw: ${cov.raw_percent === null ? "N/A" : `${cov.raw_percent}%`}`,
    `- coverage_adjusted: ${cov.adjusted_percent === null ? "N/A" : `${cov.adjusted_percent}%`}`,
    "",
    "## Final Audit",
    ""
  );
  if (!state.final_audit.attempts.length) {
    lines.push("- none");
  } else {
    for (const attempt of state.final_audit.attempts) {
      lines.push(
        `- attempt ${attempt.attempt}: status=${attempt.status}, new_issues=${attempt.new_issues}, auditor=${attempt.auditor || "unspecified"}, at=${attempt.at}`
      );
    }
  }

  lines.push("", "## Workflow Reminder", "");
  lines.push("- 所有状态变更必须通过 `reviewctl`；不要手改本文件或 `findings.json`。");
  lines.push("- 进入下一阶段前运行 `reviewctl validate`。");
  lines.push("- 最少 2 轮常规评审，最多 `max_rounds` 轮；最终审计不计入轮次。");
  lines.push("");

  return lines.join("\n");
}

function renderFindingsIndex(data) {
  const lines = [
    "# Findings Index",
    "",
    GENERATED,
    "",
    "| Finding ID | Role | Severity | Decision | Verification | Evidence | Commit |",
    "|------------|------|----------|----------|--------------|----------|--------|",
  ];
  for (const finding of data.findings) {
    lines.push(
      `| ${cell(finding.id)} | ${cell(finding.role)} | ${cell(finding.severity)} | ${cell(finding.decision)} | ${cell(finding.verification)} | ${cell(finding.evidence_dir)} | ${cell(finding.commit)} |`
    );
  }
  if (data.findings.length === 0) {
    lines.push("| - | - | - | - | - | - | - |");
  }
  lines.push("");
  return lines.join("\n");
}

function writeViews(project, state, config, data) {
  const runState = renderRunState(state, config, data);
  const findingsIndex = renderFindingsIndex(data);
  const root = path.join(project, EVIDENCE);
  writeTextAtomic(path.join(root, "run-state.md"), runState);
  writeTextAtomic(path.join(root, "findings-index.md"), findingsIndex);
  writeJsonAtomic(path.join(root, "render.json"), {
    "run-state.md": hash(runState),
    "findings-index.md": hash(findingsIndex),
  });
}

function verifyViews(project, state, config, data) {
  const errors = [];
  const root = path.join(project, EVIDENCE);
  const expectedRunState = renderRunState(state, config, data);
  const expectedFindingsIndex = renderFindingsIndex(data);
  const runStatePath = path.join(root, "run-state.md");
  const findingsPath = path.join(root, "findings-index.md");
  const renderPath = path.join(root, "render.json");

  for (const [file, expected] of [
    [runStatePath, expectedRunState],
    [findingsPath, expectedFindingsIndex],
  ]) {
    if (!fs.existsSync(file)) {
      errors.push(`缺少生成文件：${path.relative(project, file)}`);
      continue;
    }
    if (fs.readFileSync(file, "utf8") !== expected) {
      errors.push(`生成文件被手改或已过期：${path.relative(project, file)}`);
    }
  }

  if (!fs.existsSync(renderPath)) {
    errors.push("缺少 render.json");
  } else {
    try {
      const hashes = JSON.parse(fs.readFileSync(renderPath, "utf8"));
      if (hashes["run-state.md"] !== hash(expectedRunState)) {
        errors.push("run-state.md 的 hash 与 state.json 不一致");
      }
      if (hashes["findings-index.md"] !== hash(expectedFindingsIndex)) {
        errors.push("findings-index.md 的 hash 与 findings.json 不一致");
      }
    } catch (error) {
      errors.push(`render.json 无法解析：${error.message}`);
    }
  }

  return errors;
}

module.exports = { renderRunState, renderFindingsIndex, writeViews, verifyViews, hash };
