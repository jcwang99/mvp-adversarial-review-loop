const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  EVIDENCE,
  FINDING_ID,
  TEMP_ID,
  ROLES,
  isRole,
  roleSlug,
  roundEntry,
  completedRounds,
  coverage,
  validateConfig,
  validateState,
  validateFindings,
} = require("./state");
const { verifyViews } = require("./render");

const TEST_SUFFIX =
  /(?:\.test\.[a-z0-9]+|\.spec\.[a-z0-9]+|_test\.[a-z0-9]+|_spec\.[a-z0-9]+|Test\.[a-z0-9]+|\.rs)$/i;
const CANDIDATE_PREFIX =
  /^r(\d+)_(sec|func|rel|api|perf|ux|ops|prod|finalaudit)_[a-z0-9][a-z0-9_-]*/i;
const REPRODUCTION_PREFIX =
  /^r(\d+)_f(\d{3})_[a-z0-9][a-z0-9_-]*/i;
const ADJACENT_PREFIX =
  /^r(\d+)_f(\d{3})_([a-z0-9_]+?)_adjacent(?:[_-][a-z0-9]+)*/i;

function isCandidateTestFile(name) {
  return CANDIDATE_PREFIX.test(name) && TEST_SUFFIX.test(name);
}

function isReproductionTestFile(name) {
  return REPRODUCTION_PREFIX.test(name) && TEST_SUFFIX.test(name);
}

function isAdjacentTestFile(name) {
  return ADJACENT_PREFIX.test(name) && TEST_SUFFIX.test(name);
}

function isFormalTestFile(name) {
  let normalized = String(name).replace(/\\/g, "/");
  normalized = path.posix.normalize(normalized).replace(/^\.\//, "");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return false;
  }
  if (normalized.startsWith("tests/review/") || normalized.startsWith(`${EVIDENCE}/`)) {
    return false;
  }
  return TEST_SUFFIX.test(path.basename(normalized));
}

function gitTracks(project, file) {
  try {
    const normalized = String(file).replace(/\\/g, "/");
    execFileSync("git", ["cat-file", "-e", `HEAD:${normalized}`], {
      cwd: project,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function verdictIsPass(markdown) {
  const lines = String(markdown).replace(/\r/g, "").split("\n");
  let value = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const heading = line.match(/^##\s+(?:final\s+)?verdict\b/i);
    if (heading) {
      const next = lines.slice(index + 1).find((candidate) => candidate.trim());
      value = next ? next.trim() : "";
      continue;
    }
    const inline = line.match(/(?:final\s+verdict|verdict)\s*\*{0,2}\s*:\s*(.*)$/i);
    if (inline) value = inline[1];
  }
  return value.replace(/[*_`]/g, "").replace(/[.\s]+$/, "").trim().toLowerCase() === "pass";
}

function extractSection(markdown, heading) {
  const lines = String(markdown).replace(/\r/g, "").split("\n");
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${heading}`, "i").test(line.trim()));
  if (start < 0) return "";
  const collected = [];
  for (let index = start; index < lines.length; index += 1) {
    if (index > start && /^##\s+/.test(lines[index])) break;
    collected.push(lines[index]);
  }
  return collected.join("\n").trim();
}

function stagedFiles(project) {
  try {
    return execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: project,
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function rel(project, target) {
  return path.relative(project, target).split(path.sep).join("/");
}

function exists(file) {
  return fs.existsSync(file);
}

function inside(base, target) {
  const root = path.resolve(base);
  const resolved = path.resolve(target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function listDirs(dir) {
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function validateHandoff(project, file, round, roleSlugName, errors) {
  const handoff = readJsonSafe(file);
  const label = rel(project, file);
  if (!handoff) {
    errors.push(`${label}: handoff.json 无法解析`);
    return;
  }
  if (!["complete", "partial", "blocked"].includes(handoff.review_status)) {
    errors.push(`${label}: review_status 非法`);
  }
  if (String(handoff.round) !== String(round)) errors.push(`${label}: round 与目录不一致`);
  if (handoff.role_slug !== roleSlugName) errors.push(`${label}: role_slug 与目录不一致`);
  if (typeof handoff.scope_checked !== "string" || !handoff.scope_checked.trim()) {
    errors.push(`${label}: scope_checked 为空`);
  }
  for (const key of ["commands", "findings", "blockers", "uncovered_paths"]) {
    if (!Array.isArray(handoff[key])) errors.push(`${label}: ${key} 必须是数组`);
  }
  if (!Array.isArray(handoff.findings)) return;
  for (const finding of handoff.findings) {
    const id = finding.finding_id || "(missing id)";
    if (!TEMP_ID.test(String(finding.finding_id))) errors.push(`${label}: ${id} 临时 ID 非法`);
    if (!["P0", "P1", "P2", "P3"].includes(finding.severity)) errors.push(`${label}: ${id} severity 非法`);
    if (!["defect", "spec-gap", "risk", "preference"].includes(finding.kind)) {
      errors.push(`${label}: ${id} kind 非法`);
    }
    if (!["high", "medium", "low"].includes(finding.confidence)) {
      errors.push(`${label}: ${id} confidence 非法`);
    }
    if (!["observed", "not_observed", "blocked", "not_run"].includes(finding.reproduction_status)) {
      errors.push(`${label}: ${id} reproduction_status 非法`);
    }
    if (!finding.evidence_dir) {
      errors.push(`${label}: ${id} 缺少 evidence_dir`);
    } else {
      const dir = path.resolve(project, finding.evidence_dir);
      if (!inside(path.join(project, EVIDENCE), dir)) {
        errors.push(`${label}: ${id} evidence_dir 越界`);
      } else if (!exists(dir)) {
        errors.push(`${label}: ${id} evidence_dir 不存在`);
      }
    }
    if (finding.counterexample_file && !exists(path.resolve(project, finding.counterexample_file))) {
      errors.push(`${label}: ${id} counterexample_file 不存在`);
    }
    if (finding.reproduction_file && finding.reproduction_file !== "none" && finding.reproduction_file !== "manual-steps.md") {
      if (!isCandidateTestFile(path.basename(finding.reproduction_file))) {
        errors.push(`${label}: ${id} 候选测试命名非法`);
      }
      if (!exists(path.resolve(project, finding.reproduction_file))) {
        errors.push(`${label}: ${id} reproduction_file 不存在`);
      }
    }
  }
}

function validateInbox(project, errors) {
  const root = path.join(project, EVIDENCE);
  for (const roundName of listDirs(root)) {
    const roundMatch = roundName.match(/^round-(\d+)$/);
    if (!roundMatch) continue;
    const round = Number(roundMatch[1]);
    const inbox = path.join(root, roundName, "inbox");
    if (!exists(inbox)) continue;
    for (const roleName of listDirs(inbox)) {
      if (!Object.values(ROLES).includes(roleName)) {
        errors.push(`${rel(project, path.join(inbox, roleName))}: 未知角色目录`);
        continue;
      }
      for (const tempId of listDirs(path.join(inbox, roleName))) {
        const dir = path.join(inbox, roleName, tempId);
        const prefix = TEMP_ID.test(tempId) ? tempId.split("-")[0] : null;
        if (!prefix) {
          errors.push(`${rel(project, dir)}: 临时 ID 目录非法`);
        } else if (roleSlug(prefix) !== roleName) {
          errors.push(`${rel(project, dir)}: 临时 ID 前缀与角色目录不一致`);
        }
        const metaPath = path.join(dir, "meta.json");
        if (!exists(metaPath)) {
          errors.push(`${rel(project, dir)}: 缺少 meta.json`);
        } else {
          const meta = readJsonSafe(metaPath);
          if (!meta) {
            errors.push(`${rel(project, metaPath)}: meta.json 无法解析`);
          } else {
            if (Number(meta.round) !== round) errors.push(`${rel(project, metaPath)}: round 不一致`);
            if (meta.role !== prefix) errors.push(`${rel(project, metaPath)}: role 不一致`);
            if (meta.temp_id !== tempId) errors.push(`${rel(project, metaPath)}: temp_id 不一致`);
          }
        }
        const handoffPath = path.join(dir, "handoff.json");
        if (!exists(handoffPath)) {
          errors.push(`${rel(project, dir)}: 缺少 handoff.json`);
        } else {
          validateHandoff(project, handoffPath, round, roleName, errors);
        }
      }
    }
  }
}

function validateTestDirectories(project, errors) {
  const candidates = path.join(project, "tests/review/candidates");
  if (exists(candidates)) {
    for (const file of fs.readdirSync(candidates)) {
      if (!isCandidateTestFile(file)) {
        errors.push(`tests/review/candidates/${file}: 候选测试命名非法`);
      }
    }
  }
  const reproductions = path.join(project, "tests/review/reproductions");
  if (exists(reproductions)) {
    for (const file of fs.readdirSync(reproductions)) {
      if (!isReproductionTestFile(file)) {
        errors.push(`tests/review/reproductions/${file}: 复现测试命名非法`);
      }
    }
  }
  const verifications = path.join(project, "tests/review/verifications");
  if (exists(verifications)) {
    for (const file of fs.readdirSync(verifications)) {
      if (!isAdjacentTestFile(file)) {
        errors.push(`tests/review/verifications/${file}: 相邻测试命名非法`);
      }
    }
  }
}

function hasReproduction(evidenceDir) {
  if (!exists(evidenceDir)) return false;
  if (exists(path.join(evidenceDir, "manual-steps.md"))) return true;
  return fs
    .readdirSync(evidenceDir)
    .some((file) => /^reproduce\..+$/i.test(file));
}

function hasFormalReproduction(project, round, number) {
  const dir = path.join(project, "tests/review/reproductions");
  if (!exists(dir)) return false;
  const prefix = `r${round}_f${number}_`;
  return fs.readdirSync(dir).some((file) => file.startsWith(prefix));
}

function validateFindingFiles(project, finding, errors) {
  const label = finding.id;
  const evidenceDir = path.resolve(project, finding.evidence_dir || "");
  if (!inside(path.join(project, EVIDENCE), evidenceDir)) {
    errors.push(`${label}: evidence_dir 不在 .review-evidence/ 内`);
    return;
  }
  if (!exists(evidenceDir)) {
    errors.push(`${label}: evidence_dir 不存在`);
    return;
  }
  const match = String(finding.id).match(FINDING_ID);
  if (!match) return;
  const expectedDir = path.join(project, EVIDENCE, `round-${match[1]}`, finding.id);
  if (path.resolve(evidenceDir) !== path.resolve(expectedDir)) {
    errors.push(`${label}: evidence_dir 必须是 ${rel(project, expectedDir)}`);
  }
  if (!exists(path.join(evidenceDir, "counterexample.md"))) {
    errors.push(`${label}: 缺少 counterexample.md`);
  }
  if (!exists(path.join(evidenceDir, "adjudication.md"))) {
    errors.push(`${label}: 缺少 adjudication.md`);
  } else {
    const adjudication = fs.readFileSync(path.join(evidenceDir, "adjudication.md"), "utf8");
    const status = adjudication.match(/\*\*Status\*\*\s*:\s*(accepted|deferred|rejected|needs-evidence)/i);
    if (!/##\s+Decision/i.test(adjudication) && !status) {
      errors.push(`${label}: adjudication.md 缺少 Decision/Status`);
    } else if (status && status[1].toLowerCase() !== finding.decision) {
      errors.push(`${label}: adjudication.md 的 Status 与 findings.json 的 decision 不一致`);
    }
  }
  if (finding.decision !== "needs-evidence" && !hasReproduction(evidenceDir)) {
    errors.push(`${label}: 缺少 reproduce.* 或 manual-steps.md`);
  }
  if (finding.decision !== "needs-evidence" && !exists(path.join(evidenceDir, "replay-review.md"))) {
    errors.push(`${label}: 缺少 replay-review.md（独立复现审查）`);
  }
  if (
    finding.decision === "accepted" &&
    !hasFormalReproduction(project, match[1], match[2]) &&
    !exists(path.join(evidenceDir, "manual-steps.md"))
  ) {
    errors.push(`${label}: 缺少 tests/review/reproductions/r${match[1]}_f${match[2]}_* 复现测试或 manual-steps.md`);
  }
  if (["fixed", "already_fixed"].includes(finding.implementation_status)) {
    const implementationPath = path.join(evidenceDir, "implementation-result.md");
    if (!exists(implementationPath)) {
      errors.push(`${label}: 缺少 implementation-result.md`);
    } else {
      const implementation = fs.readFileSync(implementationPath, "utf8");
      const needsGreen = finding.verification !== "blocked_by_user_changes";
      if (
        finding.manual !== true &&
        (!/RED/i.test(implementation) || (needsGreen && !/GREEN/i.test(implementation)))
      ) {
        errors.push(`${label}: implementation-result.md 缺少 ${needsGreen ? "RED/GREEN" : "RED"} 记录`);
      }
      if (finding.manual === true && !/manual/i.test(implementation)) {
        errors.push(`${label}: manual findings 的 implementation-result.md 缺少 Manual 说明`);
      }
    }
  }
  if (finding.implementation_status === "prepared") {
    const implementationPath = path.join(evidenceDir, "implementation-result.md");
    if (!exists(implementationPath)) {
      errors.push(`${label}: prepared 缺少 implementation-result.md`);
    } else {
      const implementation = fs.readFileSync(implementationPath, "utf8");
      if (!/RED/i.test(implementation) || !/Manual Merge Guidance/i.test(implementation)) {
        errors.push(`${label}: prepared 缺少 RED 或 Manual Merge Guidance`);
      }
    }
  }
  if (["blocked", "cannot_fix"].includes(finding.implementation_status)) {
    if (!exists(path.join(evidenceDir, "implementation-result.md"))) {
      errors.push(`${label}: ${finding.implementation_status} 缺少 implementation-result.md`);
    }
    if (!finding.unresolved || !finding.unresolved_reason) {
      errors.push(`${label}: ${finding.implementation_status} 必须登记 unresolved 和原因`);
    }
  }
  if (["pass", "fail", "inconclusive"].includes(finding.verification)) {
    const verificationPath = path.join(evidenceDir, "verification-result.md");
    if (!exists(verificationPath)) {
      errors.push(`${label}: 缺少 verification-result.md`);
    } else {
      const verification = fs.readFileSync(verificationPath, "utf8");
      if (!/Final Verdict|##\s+Verdict/i.test(verification)) {
        errors.push(`${label}: verification-result.md 缺少 Verdict`);
      } else if (finding.verification === "pass" && !verdictIsPass(verification)) {
        errors.push(`${label}: verification-result.md 的 Final Verdict 不是 pass`);
      }
      if (finding.manual === true && !/manual/i.test(verification)) {
        errors.push(`${label}: manual findings 的 verification-result.md 缺少人工复测记录`);
      }
    }
  }
  if (finding.verification === "blocked_by_user_changes") {
    if (!["fixed", "already_fixed", "prepared"].includes(finding.implementation_status)) {
      errors.push(`${label}: blocked_by_user_changes 缺少 prepared/fixed/already_fixed 实现状态`);
    }
    const implementationPath = path.join(evidenceDir, "implementation-result.md");
    if (!exists(implementationPath)) {
      errors.push(`${label}: blocked_by_user_changes 缺少 implementation-result.md`);
    } else {
      const implementation = fs.readFileSync(implementationPath, "utf8");
      if (!/RED/i.test(implementation)) {
        errors.push(`${label}: blocked_by_user_changes 缺少 RED 复现证据`);
      }
      if (!/Manual Merge Guidance/i.test(implementation)) {
        errors.push(`${label}: blocked_by_user_changes 缺少 Manual Merge Guidance`);
      }
    }
  }
  if (finding.verification === "pass") {
    const adjacent = finding.adjacent_tests || [];
    const merged = finding.merged_tests || [];
    if (adjacent.length < 2 && !finding.adjacent_reason) {
      errors.push(`${label}: pass 需要至少 2 个相邻测试或 adjacent_reason`);
    }
    for (const adjacentTest of adjacent) {
      const normalized = String(adjacentTest).replace(/\\/g, "/");
      if (!normalized.startsWith("tests/review/verifications/")) {
        errors.push(`${label}: 相邻测试必须位于 tests/review/verifications/：${adjacentTest}`);
      } else if (!exists(path.resolve(project, adjacentTest))) {
        errors.push(`${label}: 相邻测试不存在：${adjacentTest}`);
      } else if (!isAdjacentTestFile(path.basename(adjacentTest)) || !testMatchesFinding(adjacentTest, finding.id)) {
        errors.push(`${label}: 相邻测试命名非法或不属于该 finding：${adjacentTest}`);
      }
    }
    if (adjacent.length > 0 && merged.length === 0) {
      errors.push(`${label}: 相邻测试尚未合并到正式测试文件（缺少 merged_tests）`);
    }
    for (const mergedTest of merged) {
      const normalized = String(mergedTest).replace(/\\/g, "/");
      if (!inside(project, path.resolve(project, mergedTest))) {
        errors.push(`${label}: merged_tests 越界：${mergedTest}`);
        continue;
      }
      if (normalized.startsWith("tests/review/")) {
        errors.push(`${label}: merged_tests 不能位于 tests/review/：${mergedTest}`);
        continue;
      }
      if (!isFormalTestFile(normalized)) {
        errors.push(`${label}: merged_tests 不是正式测试文件：${mergedTest}`);
        continue;
      }
      const absolute = path.resolve(project, mergedTest);
      if (!exists(absolute)) {
        errors.push(`${label}: merged_tests 不存在：${mergedTest}`);
      } else if (!gitTracks(project, normalized)) {
        errors.push(`${label}: merged_tests 未提交到 git：${mergedTest}`);
      } else if (!fs.readFileSync(absolute, "utf8").toUpperCase().includes(finding.id)) {
        errors.push(`${label}: merged_tests 内容缺少 finding ID：${mergedTest}`);
      }
    }
  }
  for (const testFile of finding.test_files || []) {
    const normalized = String(testFile).replace(/\\/g, "/");
    if (!inside(project, path.resolve(project, testFile))) {
      errors.push(`${label}: 测试路径越界：${testFile}`);
    } else if (!exists(path.resolve(project, testFile))) {
      errors.push(`${label}: 测试文件不存在：${testFile}`);
    } else if (!isFormalTestFile(normalized)) {
      errors.push(`${label}: 不是正式测试文件：${testFile}`);
    } else if (!gitTracks(project, normalized)) {
      errors.push(`${label}: 测试文件未提交到 git：${testFile}`);
    }
  }
  if (finding.commit && !["none", "unavailable"].includes(finding.commit)) {
    if (!/^[0-9a-f]{7,40}$/i.test(finding.commit)) {
      errors.push(`${label}: commit 不是合法 SHA`);
    } else {
      try {
        execFileSync("git", ["cat-file", "-e", `${finding.commit}^{commit}`], {
          cwd: project,
          stdio: "ignore",
        });
      } catch {
        errors.push(`${label}: commit 不存在：${finding.commit}`);
      }
    }
  }
}

function testMatchesFinding(file, id) {
  const match = String(id).match(FINDING_ID);
  if (!match) return false;
  const name = path.basename(String(file));
  const target = name.match(/^r(\d+)_f(\d{3})_/i);
  return Boolean(target && target[1] === match[1] && target[2] === match[2]);
}

function validateFindingDirectories(project, data, errors) {
  const ids = new Set((data.findings || []).map((finding) => finding.id));
  const root = path.join(project, EVIDENCE);
  for (const roundName of listDirs(root)) {
    const roundMatch = roundName.match(/^round-(\d+)$/);
    if (!roundMatch) continue;
    const roundDir = path.join(root, roundName);
    for (const name of listDirs(roundDir)) {
      if (name === "inbox" || name === "final-audit" || name === "_testdata") continue;
      if (FINDING_ID.test(name) && !ids.has(name)) {
        errors.push(`${rel(project, path.join(roundDir, name))}: 目录存在但 findings.json 没有对应条目`);
      }
    }
  }
}

function validateRounds(state, errors) {
  for (const round of state.rounds) {
    if (!Number.isInteger(round.round) || round.round < 1) {
      errors.push(`rounds: round 非法：${round.round}`);
      continue;
    }
    if (!["pending", "in_progress", "completed"].includes(round.status)) {
      errors.push(`round ${round.round}: status 非法`);
    }
    if (!Array.isArray(round.roles)) {
      errors.push(`round ${round.round}: roles 必须是数组`);
    }
    for (const key of ["raw_candidates", "duplicates", "screened_out", "new_in_scope_p0p1p2"]) {
      if (round[key] !== null && (!Number.isInteger(round[key]) || round[key] < 0)) {
        errors.push(`round ${round.round}: ${key} 必须是非负整数`);
      }
    }
    if (round.status === "completed") {
      for (const key of ["raw_candidates", "duplicates", "screened_out", "new_in_scope_p0p1p2"]) {
        if (round[key] === null) errors.push(`round ${round.round}: completed 但 ${key} 未记录`);
      }
      if (Number.isInteger(round.raw_candidates) && Number.isInteger(round.duplicates) && Number.isInteger(round.screened_out)) {
        if (round.raw_candidates < round.duplicates + round.screened_out) {
          errors.push(`round ${round.round}: raw_candidates 小于 duplicates + screened_out`);
        }
        if (round.replay_eligible !== round.raw_candidates - round.duplicates - round.screened_out) {
          errors.push(`round ${round.round}: replay_eligible 与计数不一致`);
        }
      }
    }
  }
  const completed = completedRounds(state);
  if (state.rounds_consumed !== completed.length) {
    errors.push("rounds_consumed 与已完成轮数不一致");
  }
}

function validateAudits(project, state, errors) {
  for (const attempt of state.final_audit.attempts) {
    const dir = path.join(
      project,
      EVIDENCE,
      `round-${attempt.round || state.current_round}`,
      "final-audit",
      `attempt-${attempt.attempt}`
    );
    const required = attempt.status === "complete" ? ["blind-scan.md", "targeted-review.md"] : [];
    for (const name of required) {
      if (!exists(path.join(dir, name))) {
        errors.push(`audit attempt ${attempt.attempt}: 缺少 ${name}`);
      }
    }
    if (!["complete", "failed"].includes(attempt.status)) {
      errors.push(`audit attempt ${attempt.attempt}: status 非法`);
    }
    if (!Number.isInteger(attempt.new_issues) || attempt.new_issues < 0) {
      errors.push(`audit attempt ${attempt.attempt}: new_issues 非法`);
    }
  }
}

function validateProject(project, config, state, data) {
  const errors = [];
  const warnings = [];
  errors.push(...validateConfig(config));
  errors.push(...validateState(state, config));
  errors.push(...validateFindings(data));
  errors.push(...verifyViews(project, state, config, data));
  validateInbox(project, errors);
  validateFindingDirectories(project, data, errors);
  validateTestDirectories(project, errors);
  validateRounds(state, errors);
  validateAudits(project, state, errors);

  const baselinePath = path.join(project, EVIDENCE, "baseline.md");
  if (!exists(baselinePath)) {
    errors.push("缺少 .review-evidence/baseline.md");
  } else if (/\[TODO\]/.test(fs.readFileSync(baselinePath, "utf8"))) {
    warnings.push("baseline.md 仍有 [TODO]");
  }
  for (const finding of data.findings) {
    validateFindingFiles(project, finding, errors);
    if (
      finding.source === "final-audit" &&
      !state.final_audit.attempts.some((attempt) => attempt.attempt === finding.audit_attempt)
    ) {
      errors.push(`${finding.id}: final-audit audit_attempt ${finding.audit_attempt} 不存在`);
    }
    if (
      finding.decision === "accepted" &&
      ["P0", "P1"].includes(finding.severity) &&
      finding.challenge_required !== true
    ) {
      errors.push(`${finding.id}: accepted ${finding.severity} 未标记必须挑战`);
    }
    if (finding.challenge_result === "skipped") {
      const authorized = state.authorizations.some(
        (authorization) =>
          authorization.action === "skip-mandatory-challenge" &&
          authorization.decision === "authorized" &&
          (!authorization.scope || authorization.scope === finding.id)
      );
      if (!authorized) errors.push(`${finding.id}: 跳过挑战缺少用户授权记录`);
    }
    if (finding.reproduced_by === "main-agent") {
      const authorized = state.authorizations.some(
        (authorization) =>
          authorization.action === "main-agent-reproduction" &&
          authorization.decision === "authorized" &&
          (!authorization.scope || authorization.scope === finding.id)
      );
      if (!authorized) errors.push(`${finding.id}: 主代理复现缺少该 finding 的用户授权记录`);
      const adjudicationPath = path.join(
        path.resolve(project, finding.evidence_dir),
        "adjudication.md"
      );
      if (exists(adjudicationPath) && !/main-agent|高风险/i.test(fs.readFileSync(adjudicationPath, "utf8"))) {
        errors.push(`${finding.id}: 主代理复现的 adjudication.md 未标注高风险`);
      }
    }
    if (finding.verified_by === "main-agent") {
      const authorized = state.authorizations.some(
        (authorization) =>
          authorization.action === "main-agent-verification" &&
          authorization.decision === "authorized" &&
          (!authorization.scope || authorization.scope === finding.id)
      );
      if (!authorized) errors.push(`${finding.id}: 主代理验证缺少该 finding 的用户授权记录`);
      const verificationPath = path.join(
        path.resolve(project, finding.evidence_dir),
        "verification-result.md"
      );
      if (exists(verificationPath) && !/main-agent/i.test(fs.readFileSync(verificationPath, "utf8"))) {
        errors.push(`${finding.id}: 主代理验证的 verification-result.md 未标注 main-agent`);
      }
      const adjudicationPath = path.join(
        path.resolve(project, finding.evidence_dir),
        "adjudication.md"
      );
      if (exists(adjudicationPath) && !/main-agent|高风险/i.test(fs.readFileSync(adjudicationPath, "utf8"))) {
        errors.push(`${finding.id}: 主代理验证的 adjudication.md 未标注高风险`);
      }
    }
  }

  if (state.rounds_consumed < 2) {
    warnings.push("常规评审轮少于 2 轮");
  }
  const cov = coverage(data);
  if (cov.adjusted !== null && cov.adjusted < 0.8) {
    warnings.push(`调整后覆盖率 ${cov.adjusted_percent}% < 80%`);
  }
  return { errors, warnings, coverage: cov };
}

function guardCommit(project, findingId, testPaths, data, state) {
  const errors = [];
  let staged = [];
  try {
    staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: project,
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    return [`无法读取 git 暂存区：${error.message}`];
  }
  if (staged.length === 0) errors.push("暂存区为空");
  const baselineStaged = new Set((state && state.repair_baseline_staged) || []);
  for (const file of staged) {
    if (baselineStaged.has(file)) {
      errors.push(`暂存区包含开始修复前就存在的用户暂存改动：${file}；先运行 git restore --staged ${file}`);
    }
    if (file.startsWith(`${EVIDENCE}/`) || file === EVIDENCE) {
      errors.push(`修复提交不能包含 ${EVIDENCE}/：${file}`);
    }
    if (file.startsWith("tests/review/")) {
      errors.push(`修复提交不能包含 tests/review/：${file}`);
    }
  }
  const finding = (data.findings || []).find((item) => item.id === findingId);
  if (!finding) {
    errors.push(`finding 不存在：${findingId}`);
  } else {
    if (finding.decision !== "accepted") errors.push(`${findingId} 不是 accepted`);
    const evidenceDir = path.resolve(project, finding.evidence_dir);
    if (!exists(path.join(evidenceDir, "implementation-result.md"))) {
      errors.push(`${findingId}: 缺少 implementation-result.md`);
    }
  }
  const normalizedTests = (testPaths || []).map((file) => file.replace(/\\/g, "/"));
  for (const testFile of normalizedTests) {
    if (!staged.includes(testFile)) errors.push(`测试文件未暂存：${testFile}`);
  }
  const sourceFiles = staged.filter(
    (file) =>
      !file.startsWith("tests/") &&
      !file.startsWith("test/") &&
      !file.endsWith(".md") &&
      !file.startsWith(EVIDENCE)
  );
  if (sourceFiles.length === 0) errors.push("暂存区没有源代码改动");
  return errors;
}

module.exports = {
  validateProject,
  validateInbox,
  validateTestDirectories,
  validateFindingFiles,
  validateRounds,
  validateAudits,
  guardCommit,
  isCandidateTestFile,
  isReproductionTestFile,
  isAdjacentTestFile,
  isFormalTestFile,
  gitTracks,
  verdictIsPass,
  extractSection,
  stagedFiles,
  testMatchesFinding,
  inside,
  rel,
};
