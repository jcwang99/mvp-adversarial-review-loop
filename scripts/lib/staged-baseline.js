const { execFileSync } = require("node:child_process");

function git(project, args) {
  return execFileSync("git", ["--literal-pathspecs", ...args], {
    cwd: project, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function stagedChange(project, head, file) {
  const args = ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-renames"];
  return {
    raw: git(project, [...args, "--raw", "-z", head, "--", file]),
    patch: git(project, [...args, "--no-color", "--unified=0", "--inter-hunk-context=0",
      "--diff-algorithm=myers", "--no-indent-heuristic", head, "--", file]),
  };
}

// Record content, not just paths: both comparisons must use the same HEAD.
function captureStagedBaseline(project, state) {
  const head = git(project, ["rev-parse", "--verify", "HEAD"]).trim();
  const files = Object.create(null);
  const paths = git(project, ["diff", "--cached", "--no-renames", "--name-only", "-z", head])
    .split("\0").filter(Boolean);
  for (const file of paths) files[file] = stagedChange(project, head, file);
  state.repair_baseline_staged = paths;
  state.repair_baseline_index = { head, files };
}

function clearStagedBaseline(state) {
  state.repair_baseline_staged = [];
  state.repair_baseline_index = null;
}

function changedRanges(change) {
  if (!change || typeof change.raw !== "string" || typeof change.patch !== "string") return null;
  const records = change.raw.split("\0");
  const metadata = records[0].match(/^:(100644|100755) \1 [0-9a-f]+ [0-9a-f]+ M$/);
  // Add/delete/rename, permissions, binary and symlink changes are deliberately conservative.
  if (!metadata || records.length !== 3 || records[2] !== "" || change.patch.includes("\0")) return null;
  const ranges = [];
  for (const line of change.patch.split("\n")) {
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    // Coordinates are boundaries in HEAD. Include both boundaries so insertions
    // touching a replacement are treated as ambiguous, rather than silently allowed.
    ranges.push(count === 0 ? [start, start] : [start - 1, start + count - 1]);
  }
  return ranges.length ? ranges : null;
}

function changedBlocks(patch, prefix) {
  const blocks = [];
  let block = [];
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@ ")) inHunk = true;
    if (inHunk && line.startsWith(prefix)) block.push(line.slice(1));
    else if (block.length) {
      blocks.push(block.join("\n"));
      block = [];
    }
  }
  if (block.length) blocks.push(block.join("\n"));
  return blocks;
}

function countBlock(text, block) {
  const lines = text.split("\n");
  const match = block.split("\n");
  let count = 0;
  for (let i = 0; i <= lines.length - match.length; i++) {
    if (match.every((line, offset) => lines[i + offset] === line)) count++;
  }
  return count;
}

function stagedBaselineConflict(project, file, state) {
  const baseline = state && state.repair_baseline_index;
  if (!baseline || !baseline.files || !Object.prototype.hasOwnProperty.call(baseline.files, file)) {
    return "旧状态缺少暂存内容基线，无法证明同路径改动已安全分离";
  }
  try {
    if (git(project, ["rev-parse", "--verify", "HEAD"]).trim() !== baseline.head) {
      return "HEAD 已变化，无法使用开始修复时的暂存内容基线安全比较";
    }
    const beforeChange = baseline.files[file];
    const currentChange = stagedChange(project, baseline.head, file);
    const before = changedRanges(beforeChange);
    const current = changedRanges(currentChange);
    if (!before || !current) return "二进制、文件类型或模式变化等改动无法安全分离";
    if (before.some(([a, b]) => current.some(([c, d]) => a <= d && c <= b))) {
      return "暂存改动仍包含或触及开始修复前的用户改动";
    }
    const headText = git(project, ["cat-file", "blob", `${baseline.head}:${file}`]);
    const stagedText = git(project, ["cat-file", "blob", `:${file}`]);
    const removed = changedBlocks(beforeChange.patch, "-");
    const added = changedBlocks(beforeChange.patch, "+");
    // Repeated lines can cause Git to align an otherwise identical edit at a
    // different coordinate. Do not infer ownership from such ambiguous hunks.
    if (removed.some((block) => countBlock(headText, block) !== 1) ||
        added.some((block) => countBlock(headText, block) !== 0 || countBlock(stagedText, block) > 0)) {
      const lines = headText.split("\n");
      const restoredContexts = before.every(([start, end]) => {
        const left = Math.max(0, start - 3);
        const right = Math.min(lines.length, end + 3);
        const context = lines.slice(left, right).join("\n");
        return countBlock(headText, context) === 1 && countBlock(stagedText, context) === 1 &&
          !current.some(([a, b]) => left <= b && a <= right);
      });
      if (!restoredContexts) return "重复文本导致 diff 对齐存在歧义，无法安全分离用户改动";
    }
    return null;
  } catch (error) {
    return `无法比较暂存内容基线：${error.message}`;
  }
}

module.exports = { captureStagedBaseline, clearStagedBaseline, stagedBaselineConflict };
