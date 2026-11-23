const { stagedBaselineConflict } = require("./staged-baseline");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");

const {
  EVIDENCE,
  FINDING_ID,
  TEMP_ID,
  AUDIT_TEMP_ID,
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
const { wasAuthorized } = require("./authorization");
const testPolicy = require("./test-policy");

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

function readHeadFile(project, file) {
  const normalized = String(file).replace(/\\/g, "/");
  return execFileSync("git", ["show", `HEAD:${normalized}`], {
    cwd: project,
    encoding: "utf8",
  });
}

function gitCommitIsAncestor(project, commit, descendant = "HEAD") {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, descendant], {
      cwd: project,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

// Read decision fields in the report body. Quoted output and fenced examples
// can contain verdicts from other runs and must not decide this one.
function reportDecisions(markdown, label) {
  const heading = new RegExp(`^#{1,6}\\s+(?:${label})\\s*#*$`, "i");
  const inline = new RegExp(`^(?:[-*]\\s+)?(?:${label})\\s*:\\s*(.*)$`, "i");
  const decisions = [];
  let fence = "";
  let inComment = false;
  let inSection = false;
  let awaitingValue = false;
  for (const raw of String(markdown).split(/\r?\n/)) {
    const marker = raw.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1].startsWith(fence) && !marker[2].trim()) fence = "";
      continue;
    }
    if (marker && !inComment) {
      fence = marker[1];
      continue;
    }
    if (/^(?: {4}|\t| {0,3}>)/.test(raw)) continue;
    let body = raw;
    if (inComment) {
      const end = body.indexOf("-->");
      if (end < 0) continue;
      body = body.slice(end + 3);
      inComment = false;
    }
    body = body.replace(/<!--.*?(?:-->|$)/g, (comment) => {
      inComment = !comment.endsWith("-->");
      return "";
    });
    if (!body.trim()) continue;
    const line = body.trim().replace(/\*\*|__/g, "");
    if (/^#{1,6}\s/.test(line)) {
      if (awaitingValue) decisions.push("");
      inSection = heading.test(line);
      awaitingValue = inSection;
      if (inSection) continue;
    }
    const field = line.replace(/^#{1,6}\s+/, "").match(inline);
    const status = inSection && line.match(/^Status\s*:\s*(.*)$/i);
    if (field || status || awaitingValue || (inSection && /^(pass|fail)\.?$/i.test(line))) {
      const text = (field || status)?.[1] ?? line;
      decisions.push(text.trim().replace(/\.$/, "").replace(/^([*_`])(.+)\1$/, "$2").toLowerCase());
      awaitingValue = false;
    }
  }
  if (awaitingValue) decisions.push("");
  return decisions;
}

function verdictIsPass(markdown) {
  const verdicts = reportDecisions(markdown, "(?:final\\s+)?verdict");
  return verdicts.length > 0 && verdicts.every((value) => value === "pass");
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
    return gitNameOnlyPaths(project, ["diff", "--cached", "--name-only", "-z"]);
  } catch {
    return [];
  }
}

function gitNameOnlyPaths(project, args) {
  const output = execFileSync("git", args, {
    cwd: project,
    encoding: "buffer",
  });
  return output
    .toString("utf8")
    .split("\0")
    .filter((file) => file.length > 0);
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

function hasArchivedCandidate(project, candidate, round, data) {
  const dirs = [path.resolve(project, candidate.evidence_dir || "")];
  for (const finding of data?.findings || []) {
    const match = String(finding.id).match(FINDING_ID);
    if (finding.source !== "final-audit" && Number(match?.[1]) === Number(round) &&
        finding.original_ids?.includes(candidate.finding_id)) {
      dirs.push(path.join(project, EVIDENCE, `round-${round}`, finding.id));
    }
  }
  return dirs.some((dir) => inside(path.join(project, EVIDENCE), dir) &&
    exists(dir) && fs.statSync(dir).isDirectory() &&
    fs.readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isFile() && /^reproduce\..+$/i.test(entry.name)));
}

function validateHandoff(project, file, round, roleSlugName, errors, data) {
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
      if (!exists(path.resolve(project, finding.reproduction_file)) && !hasArchivedCandidate(project, finding, round, data)) {
        errors.push(`${label}: ${id} reproduction_file 不存在`);
      }
    }
  }
}

function validateInbox(project, errors, data) {
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
          validateHandoff(project, handoffPath, round, roleName, errors, data);
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
  return fs.readdirSync(evidenceDir, { withFileTypes: true }).some((entry) =>
    entry.isFile() && (entry.name === "manual-steps.md" || /^reproduce\..+$/i.test(entry.name)));
}

function hasFormalReproduction(project, round, number) {
  const dir = path.join(project, "tests/review/reproductions");
  if (!exists(dir)) return false;
  const prefix = `r${round}_f${number}_`;
  return fs.readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isFile() && entry.name.startsWith(prefix) && isReproductionTestFile(entry.name));
}

function validateReplayEvidence(project, evidenceDir, label, errors) {
  const filename = path.join(evidenceDir, "replay-review.md");
  if (!exists(filename)) {
    errors.push(label + ": 缺少 replay-review.md（独立复现审查）");
    return;
  }
  const parsed = testPolicy.parseJsonSection(fs.readFileSync(filename, "utf8"), "Reviewctl Replay Evidence", "Reviewctl Replay Evidence");
  errors.push(...parsed.errors.map((error) => label + ": " + error));
  const evidence = parsed.value;
  if (!evidence) return;
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(evidence.tested_commit) || !gitCommitIsAncestor(project, evidence.tested_commit)) {
    errors.push(label + ": replay tested_commit 无效或不在 HEAD 历史中");
  } else if (testPolicy.gitTree(project, evidence.tested_commit) !== evidence.tested_tree_hash) {
    errors.push(label + ": replay tested_tree_hash 与 tested_commit 不一致");
  }
  const testPath = path.resolve(project, String(evidence.test_path || ""));
  if (!inside(project, testPath) || !exists(testPath) || !fs.statSync(testPath).isFile() || !inside(fs.realpathSync(project), fs.realpathSync(testPath))) {
    errors.push(label + ": replay test_path 不存在或越出项目目录");
  } else if (testPolicy.sha256File(testPath) !== evidence.test_sha256) {
    errors.push(label + ": replay 测试文件 SHA-256 不匹配");
  }
  if (typeof evidence.command !== "string" || !evidence.command.trim() || !Number.isSafeInteger(evidence.exit_status)) {
    errors.push(label + ": replay evidence 必须记录实际命令及数值退出码");
  }
}

function validateFindingFiles(project, finding, errors, state) {
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
  // After finalization, verified findings retain their canonical reproduction
  // and committed tests; the documented temporary test cleanup is then safe.
  const cleanedFinalFinding = state?.current_phase === "report" &&
    ["converged", "converged_with_manual_merge", "incomplete"].includes(state.overall_status) &&
    finding.verification === "pass" && exists(path.join(project, EVIDENCE, "final-report.md"));
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
  if (finding.decision !== "needs-evidence") validateReplayEvidence(project, evidenceDir, label, errors);
  if (
    finding.decision === "accepted" &&
    !cleanedFinalFinding &&
    !hasFormalReproduction(project, match[1], match[2]) &&
    !fs.statSync(path.join(evidenceDir, "manual-steps.md"), { throwIfNoEntry: false })?.isFile()
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
    if (adjacent.length < 2 && !finding.adjacent_reason) {
      errors.push(`${label}: pass 需要至少 2 个相邻测试或 adjacent_reason`);
    }
    for (const adjacentTest of adjacent) {
      const normalized = String(adjacentTest).replace(/\\/g, "/");
      if (!normalized.startsWith("tests/review/verifications/")) {
        errors.push(`${label}: 相邻测试必须位于 tests/review/verifications/：${adjacentTest}`);
      } else if (!cleanedFinalFinding && !exists(path.resolve(project, adjacentTest))) {
        errors.push(`${label}: 相邻测试不存在：${adjacentTest}`);
      } else if (!isAdjacentTestFile(path.basename(adjacentTest)) || !testMatchesFinding(adjacentTest, finding.id)) {
        errors.push(`${label}: 相邻测试命名非法或不属于该 finding：${adjacentTest}`);
      }
    }
    if (adjacent.length > 0 && finding.adjacent_status === "not_required") {
      errors.push(`${label}: 有相邻测试但未登记轮末批测状态`);
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
      let exists = true;
      try {
        execFileSync("git", ["cat-file", "-e", `${finding.commit}^{commit}`], {
          cwd: project,
          stdio: "ignore",
        });
      } catch {
        exists = false;
        errors.push(`${label}: commit 不存在：${finding.commit}`);
      }
      if (exists && !gitCommitIsAncestor(project, finding.commit)) {
        errors.push(`${label}: commit 不在当前 HEAD 历史中：${finding.commit}`);
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
  const ids = new Set();
  for (const round of state.rounds) {
    if (ids.has(round.round) || round.round > state.current_round) errors.push(`轮次 ${round.round} 重复或晚于当前轮`);
    ids.add(round.round);
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
  if (completed.some((round, index) => round.round !== index + 1)) errors.push("已完成轮次必须从 1 起连续");
  if (state.rounds_consumed !== completed.length) {
    errors.push("rounds_consumed 与已完成轮数不一致");
  }
}

// Reconcile identities as well as totals: a plausible aggregate must never hide
// an omitted candidate or an invented canonical finding.
function validateRoundCandidates(project, round, data, errors) {
  const label = `round ${round.round}: candidate accounting`;
  const root = path.join(project, EVIDENCE, `round-${round.round}`);
  const candidates = new Map();
  const allFindings = new Map((data.findings || []).map((finding) => [finding.id, finding]));
  const findings = (data.findings || []).filter((finding) =>
    finding.source !== "final-audit" && Number(String(finding.id).match(FINDING_ID)?.[1]) === round.round);
  const handoffRoles = new Set();
  const reviewedRoles = new Set();
  const readHandoff = (file, role) => {
    if (!exists(file)) return;
    const handoff = readJsonSafe(file);
    validateHandoff(project, file, round.round, role, errors, data);
    if (!Array.isArray(handoff?.findings)) return;
    handoffRoles.add(role);
    if (["complete", "partial"].includes(handoff.review_status)) reviewedRoles.add(role);
    const seen = new Set();
    for (const candidate of handoff.findings) {
      const id = candidate.finding_id;
      if (!TEMP_ID.test(String(id)) || roleSlug(String(id).split("-")[0]) !== role) {
        errors.push(`${label}: ${id} 与 handoff 角色不一致`);
        continue;
      }
      if (seen.has(id)) errors.push(`${label}: ${id} 在 handoff 中重复`);
      seen.add(id);
      const previous = candidates.get(id);
      if (previous) {
        // A role may include the same submission in multiple batch handoffs.
        if (!isDeepStrictEqual(previous, candidate)) {
          errors.push(`${label}: ${id} 存在重复或矛盾的 handoff`);
        }
      } else {
        candidates.set(id, candidate);
      }
    }
  };
  const inbox = path.join(root, "inbox");
  for (const role of listDirs(inbox)) {
    for (const tempId of listDirs(path.join(inbox, role))) {
      readHandoff(path.join(inbox, role, tempId, "handoff.json"), role);
    }
  }
  if (Array.isArray(round.roles)) {
    const recorded = round.roles.map(roleSlug).sort();
    if (!isDeepStrictEqual(recorded, [...handoffRoles].sort()) || reviewedRoles.size < 3 || handoffRoles.size > 6) {
      errors.push(`${label}: 角色交接与登记不符，须有 3–6 个角色且至少 3 个实际开展评审`);
    }
  }
  const screeningPath = path.join(root, "screening.json");
  const screening = exists(screeningPath) ? readJsonSafe(screeningPath) : [];
  const dispositions = new Map();
  if (!Array.isArray(screening)) errors.push(`${label}: screening.json 必须是数组`);
  for (const item of Array.isArray(screening) ? screening : []) {
    if (!item || typeof item !== "object") {
      errors.push(`${label}: screening.json 条目必须是对象`);
      continue;
    }
    const id = item.original_id;
    if (!candidates.has(id)) errors.push(`${label}: screening original_id ${id} 没有原始候选`);
    if (dispositions.has(id)) errors.push(`${label}: ${id} 有重复的 screening 记录`);
    if (!["duplicate", "screened_out_preference", "screened_out_scope", "screened_out_contract"].includes(item.disposition)) {
      errors.push(`${label}: ${id} disposition 非法`);
    }
    if (typeof item.reason !== "string" || !item.reason.trim()) errors.push(`${label}: ${id} 缺少筛查理由`);
    if (item.disposition === "duplicate") {
      const canonical = allFindings.get(item.canonical_id);
      if (!canonical || Number(String(canonical.id).match(FINDING_ID)?.[1]) > round.round) {
        errors.push(`${label}: ${id} canonical_id ${item.canonical_id} 不存在或属于未来轮次`);
      }
    } else if (item.canonical_id) {
      errors.push(`${label}: ${id} screened_out 不能指定 canonical_id`);
    }
    dispositions.set(id, item);
  }

  const owners = new Map();
  let duplicates = 0;
  let screened = 0;
  for (const finding of findings) {
    const originals = Array.isArray(finding.original_ids) ? finding.original_ids : [];
    let primaryCount = 0;
    for (const id of originals) {
      if (!candidates.has(id)) errors.push(`${label}: ${finding.id} original_id ${id} 没有原始候选`);
      if (owners.has(id)) errors.push(`${label}: ${id} 同时属于 ${owners.get(id)} 和 ${finding.id}`);
      owners.set(id, finding.id);
      const disposition = dispositions.get(id);
      if (disposition && (disposition.disposition !== "duplicate" || disposition.canonical_id !== finding.id)) {
        errors.push(`${label}: ${id} 的 canonical/original mapping 与 ${finding.id} 矛盾`);
      }
      if (!disposition) primaryCount += 1;
    }
    if (!primaryCount) errors.push(`${label}: ${finding.id} 缺少独立的原始候选`);
    duplicates += Math.max(0, originals.length - 1);
  }
  for (const id of candidates.keys()) {
    if (owners.has(id)) continue;
    const disposition = dispositions.get(id);
    if (!disposition) errors.push(`${label}: ${id} 未登记 finding、筛除或去重结论`);
    else if (disposition.disposition === "duplicate") duplicates += 1;
    else if (String(disposition.disposition).startsWith("screened_out_")) screened += 1;
  }
  const expected = { raw_candidates: candidates.size, duplicates, screened_out: screened, replay_eligible: findings.length };
  for (const [key, value] of Object.entries(expected)) {
    if (round[key] !== value) errors.push(`${label}: ${key}=${round[key]}，实际应为 ${value}`);
  }
}

function auditEvidence(project, attempt, errors, requiredCommit) {
  const label = "audit attempt " + attempt.attempt;
  const dir = path.join(EVIDENCE, "round-" + attempt.round, "final-audit", "attempt-" + attempt.attempt);
  const file = (name) => {
    const filename = testPolicy.resolveEvidencePath(project, path.join(dir, name), errors, label + " " + name);
    if (filename && fs.realpathSync(filename) !== path.join(fs.realpathSync(path.join(project, EVIDENCE)), path.relative(EVIDENCE, dir), name)) {
      errors.push(label + ": 审计文件必须位于本次 attempt 目录");
      return null;
    }
    return filename;
  };
  const blind = file("blind-scan.md");
  const targeted = file("targeted-review.md");
  if (!blind || !targeted) return null;
  if (!fs.readFileSync(blind, "utf8").split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith("#"))) errors.push(label + ": blind-scan.md 缺少扫描结果");
  const inbox = path.join(project, dir, "inbox");
  const candidates = listDirs(inbox).filter((id) => AUDIT_TEMP_ID.test(id) &&
    fs.statSync(path.join(inbox, id, "counterexample.md"), { throwIfNoEntry: false })?.isFile());
  if (candidates.length > attempt.new_issues) {
    errors.push(`${label}: new_issues=${attempt.new_issues} 小于 inbox 候选数（${candidates.join(", ")}）`);
  }
  const report = fs.readFileSync(targeted, "utf8");
  const assessments = reportDecisions(report, "overall\\s+status");
  const validAssessment = assessments.length === 1 && ["pass", "fail"].includes(assessments[0]);
  if (!validAssessment) errors.push(`${label}: targeted-review.md 的 Overall Status 必须恰有一个明确的 pass 或 fail`);
  const parsed = testPolicy.parseJsonSection(report, "Reviewctl Audit Evidence", label + " full_suite");
  const baseline = testPolicy.parseBaselinePolicy(project);
  errors.push(...parsed.errors, ...baseline.errors);
  const run = parsed.value?.full_suite;
  if (!run || !baseline.policy) {
    errors.push(label + ": 缺少 full_suite 或 baseline 策略");
    return null;
  }
  const log = file("output-full-suite.log");
  if (!log) return null;
  if (typeof run.log !== "string" || path.resolve(project, run.log) !== log) errors.push(label + ": full 日志必须来自本次 attempt");
  if (!testPolicy.hasRunMarkers(log, baseline.policy.fullCommand, run.exit_status)) errors.push(label + ": 日志缺少唯一的精确 COMMAND 和 EXIT_CODE");
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(run.tested_commit) || !gitCommitIsAncestor(project, run.tested_commit) ||
      (requiredCommit && run.tested_commit !== requiredCommit)) {
    errors.push(label + ": tested_commit 无效或与被审计 HEAD 不符");
    return null;
  }
  const tree = testPolicy.gitTree(project, run.tested_commit);
  if (run.status === "pass") {
    errors.push(...testPolicy.validateFullRun(project, run, baseline.policy, label, tree));
  } else if (run.status !== "fail" || attempt.new_issues < 1 || !Number.isSafeInteger(run.exit_status) || run.exit_status === 0 ||
      run.tree_hash_before !== tree || run.tree_hash_after !== tree || run.command !== baseline.policy.fullCommand) {
    errors.push(label + ": 失败的 full 必须绑定提交、命令和非零退出码并登记新问题");
  }
  if (!validAssessment) return null;
  return {
    status: run.status,
    overall_status: assessments[0],
    tested_commit: run.tested_commit,
    candidate_ids: candidates,
    log_sha256: testPolicy.sha256File(log),
    blind_sha256: testPolicy.sha256File(blind),
    targeted_sha256: testPolicy.sha256File(targeted),
  };
}

function validateAudits(project, state, errors, data) {
  const auditors = new Set();
  for (const attempt of state.final_audit.attempts) {
    if (!attempt.auditor || auditors.has(attempt.auditor)) errors.push("每次终审必须登记独立的新审计代理");
    auditors.add(attempt.auditor);
    if (attempt.status === "complete") {
      const forReport = state.current_phase === "report" && attempt.attempt === state.final_audit_attempt;
      const evidence = auditEvidence(project, attempt, errors);
      if (evidence && data) {
        const findings = data.findings.filter((finding) => finding.source === "final-audit" && finding.audit_attempt === attempt.attempt);
        const recordedIds = new Set(findings.flatMap((finding) => finding.original_ids));
        const missing = evidence.candidate_ids.filter((id) => !recordedIds.has(id));
        const settled = forReport || state.current_round > attempt.round || state.final_audit_attempt > attempt.attempt;
        if (findings.length + missing.length > attempt.new_issues || (settled && findings.length !== attempt.new_issues)) {
          errors.push(`audit attempt ${attempt.attempt}: 已登记 ${findings.length} 个 finding，new_issues=${attempt.new_issues}，未裁决 inbox 候选：${missing.join(", ") || "无"}`);
        }
      }
      if (!isDeepStrictEqual(evidence, attempt.full_evidence)) {
        errors.push("audit attempt " + attempt.attempt + ": 与登记时的报告或日志摘要不一致");
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
  if (errors.length) {
    return { errors, warnings, coverage: coverage(data) };
  }
  errors.push(...verifyViews(project, state, config, data));
  validateInbox(project, errors, data);
  validateFindingDirectories(project, data, errors);
  validateTestDirectories(project, errors);
  validateRounds(state, errors);
  testPolicy.validateAdjacentPromotions(project, state, data, errors);
  const baselinePath = path.join(project, EVIDENCE, "baseline.md");
  const { policy: baselinePolicy, errors: policyErrors } = testPolicy.parseBaselinePolicy(project);
  const hasBaseline = exists(baselinePath);
  if (state.current_phase !== "baseline" || !hasBaseline) errors.push(...policyErrors);
  if (hasBaseline && /\[TODO\]/.test(fs.readFileSync(baselinePath, "utf8"))) {
    warnings.push("baseline.md 仍有 [TODO]");
  }
  for (const round of state.rounds) {
    if (round.status === "completed") {
      validateRoundCandidates(project, round, data, errors);
      const atDecision = round.round === state.current_round && state.current_phase === "round_decision";
      if (baselinePolicy?.tieringMode === "progressive" && (!atDecision || round.regression_gate)) {
        testPolicy.validateRoundRegression(project, round, errors, { requireCurrentHead: atDecision });
        if (!atDecision && round.regression_gate?.status !== "pass") errors.push(`round ${round.round}: 历史轮次缺少通过的 full regression gate`);
      }
      if (round.round !== state.current_round || !["verification", "round_decision"].includes(state.current_phase)) {
        testPolicy.validateAdjacentBatch(project, round, state, data, errors);
      }
    }
  }
  if (state.current_phase === "final_audit") {
    testPolicy.validateFinalAdjacentBatch(project, state, data, errors, state.final_audit_attempt);
  } else if (state.current_phase === "report" && state.final_audit_attempt > 0) {
    testPolicy.validateFinalAdjacentBatch(project, state, data, errors, state.final_audit_attempt);
  }
  validateAudits(project, state, errors, data);

  for (const finding of data.findings) {
    validateFindingFiles(project, finding, errors, state);
    if (finding.verification === "pass" && finding.adjacent_tests?.some((file) => !state.adjacent_registry.some((entry) =>
      entry.test_path === file && entry.finding_id === finding.id && entry.round === finding.adjacent_round))) {
      errors.push(`${finding.id}: 已验证的相邻测试缺少对应登记`);
    }
    if (finding.verification === "pass" && ["fixed", "already_fixed"].includes(finding.implementation_status)) {
      const verificationPath = path.join(path.resolve(project, finding.evidence_dir), "verification-result.md");
      errors.push(...testPolicy.validateVerificationEvidence(project, finding, config, verificationPath, null, { historical: true }));
    }
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
      const authorized = wasAuthorized(state, "skip-mandatory-challenge", finding.id, finding.authorization_receipts);
      if (!authorized) errors.push(`${finding.id}: 跳过挑战缺少用户授权记录`);
    }
    if (finding.reproduced_by === "main-agent") {
      const authorized = wasAuthorized(state, "main-agent-reproduction", finding.id, finding.authorization_receipts);
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
      const authorized = wasAuthorized(state, "main-agent-verification", finding.id, finding.authorization_receipts);
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
    staged = gitNameOnlyPaths(project, ["diff", "--cached", "--no-renames", "--name-only", "-z"]);
  } catch (error) {
    return [`无法读取 git 暂存区：${error.message}`];
  }
  if (staged.length === 0) errors.push("暂存区为空");
  const baselineFiles = state?.repair_baseline_index?.files;
  if (!baselineFiles || typeof baselineFiles !== "object" || Array.isArray(baselineFiles)) errors.push("缺少暂存内容基线");
  for (const file of staged) {
    if (baselineFiles && Object.hasOwn(baselineFiles, file)) {
      const conflict = stagedBaselineConflict(project, file, state);
      if (conflict) errors.push(`${file}：${conflict}；保留用户工作区改动，仅分块暂存独立修复；无法分离时登记 blocked_by_user_changes`);
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
    const stagedTree = testPolicy.safeIndexTree(project);
    if (!stagedTree) errors.push(findingId + ": 无法读取暂存区 tree hash");
    const greenEvidence = testPolicy.parseImplementationEvidence(
      project,
      path.join(evidenceDir, "implementation-result.md"),
      stagedTree,
      { finding }
    );
    errors.push(...greenEvidence.errors.map((error) => `${findingId}: ${error}`));
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
  validateReplayEvidence,
  validateRounds,
  validateRoundCandidates,
  validateAudits,
  auditEvidence,
  guardCommit,
  isCandidateTestFile,
  isReproductionTestFile,
  isAdjacentTestFile,
  isFormalTestFile,
  hasFormalReproduction,
  gitTracks,
  gitCommitIsAncestor,
  readHeadFile,
  verdictIsPass,
  extractSection,
  gitNameOnlyPaths,
  stagedFiles,
  testMatchesFinding,
  inside,
  rel,
};
