# 子代理提示模板与输出格式

本文件是所有子代理提示模板和输出格式的唯一来源。委派子代理时，从此文件获取完整的提示模板。

## 目录

1. [评审代理（Review Agent）](#1-评审代理review-agent)
2. [独立复现审查代理（Replay Reviewer Agent）](#2-独立复现审查代理replay-reviewer-agent)
3. [挑战代理（Challenge Agent）](#3-挑战代理challenge-agent)
4. [补强代理（Reinforce Agent）](#4-补强代理reinforce-agent)
5. [实现代理（Implementation Agent）](#5-实现代理implementation-agent)
6. [验证代理（Verification Agent）](#6-验证代理verification-agent)
7. [最终审计代理（Final Audit Agent）](#7-最终审计代理final-audit-agent)

---

## 1. 评审代理（Review Agent）

### 提示模板

为每个代理替换 round、role-slug、范围和验收标准。倒数第 2 轮及以后（最后两轮回归检查轮）还需提供待检查的修复提交/变更路径，但不提供历史 finding 或预期结论。

````text
你是 [role-slug] 评审员。只读检查 [MVP 范围]，依据 [验收标准/契约] 和当前 HEAD。
本轮变更范围：[常规评审填 none；回归评审列出待检查的提交/文件路径，不提供历史 finding 或预期结论]
不要修改项目源代码、测试、配置，不要安装依赖或提交。只用临时 fixture/数据库执行验证；若命令会改写持久数据、调用真实外部服务或无法确认副作用，停止运行并报告阻塞。

## 文件组织与运行约定

**临时测试文件**（写入项目测试目录，供后续阶段复用）：
- 存放位置：`tests/review/candidates/r{round}_{role}_{temp_id}.test.{ext}`
  - 示例：`tests/review/candidates/r1_sec_001.test.js`
  - 使用项目测试格式，可以复用项目的测试环境、fixtures、辅助函数
- **测试框架忽略此目录**：主代理已在 baseline 阶段确保项目测试配置忽略 `tests/review/`（或使用 ADVERSARIAL_REVIEW 开关）；若运行中发现临时测试会被日常测试收集，停止并报告阻塞，不要自行修改项目配置
- 完整命令输出保存在：`.review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/output.log`

**证据文档**（仍在 .review-evidence/ 中）：
- counterexample.md：`.review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/counterexample.md`
- output.log：完整命令输出，不要粘贴到回复或 counterexample.md 中
- handoff.json：把下方 YAML 的等价 JSON 写入同一 inbox；这是 `reviewctl validate` 读取的结构化交接
- 主代理会用 `reviewctl new-inbox` 预先创建目录；不要自行创建其他路径

**运行 reproduction**：
- 从项目根目录运行，使用项目自身的测试框架、依赖、构建环境
- 测试文件就是普通项目测试，调用项目代码和测试工具
- 示例：
  ```bash
  # 显式运行单个临时测试
  ADVERSARIAL_REVIEW=true npm test tests/review/candidates/r1_sec_001.test.js
  
  # 或使用项目的测试命令
  pnpm vitest run tests/review/candidates/r1_sec_001.test.js
  ```
- 不要为每个 finding 创建独立的依赖/编译环境

**隔离数据文件**（仅在需要避免冲突时）：
- 测试数据库、fixture、临时输出可放在：`.review-evidence/round-[N]/_testdata/[role-slug]/`
- 通过环境变量传递路径：`TEST_DB_PATH=.review-evidence/round-1/_testdata/security/test.db`
- 若项目测试本身已支持临时数据库（如 SQLite `:memory:`、Jest 自动隔离），直接使用
- 默认串行运行，避免端口/进程冲突；需要并发时在阻塞项中说明原因

不要查看其他角色的 findings，也不要把个人偏好作为缺陷。

每条 finding 的 counterexample.md 按上方字段 schema 填写；完整 reproduction 测试写入 `tests/review/candidates/`，经确认无法自动化时的 manual-steps.md 放在 `.review-evidence/` inbox 目录。按以下固定 YAML 结构交接，保留所有字段；无内容使用 [] 或 none，不省略字段。没有发现时 findings 写 []；未覆盖的路径及原因写入 uncovered_paths；无法完成检查的部分写入 blockers。
不要在回复中粘贴 reproduction 源码或完整命令输出。回复中的命令仅给命令、退出状态和必要的短输出摘要，详细记录放在证据文件。回复中的 YAML 同时写入 `handoff.json`；两者内容必须一致。

~~~yaml
review_status: "complete | partial | blocked"
round: "<round number>"
role_slug: "<role-slug>"
scope_checked: "<scope summary>"
commands:
  - command: "<command>"
    exit_status: "<exit code or not_run>"
findings:
  - finding_id: "<role-local temporary ID>"
    severity: "P0 | P1 | P2 | P3"
    claim: "<observable behavior>"
    kind: "defect | spec-gap | risk | preference"
    confidence: "high | medium | low"
    evidence_dir: ".review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/"
    counterexample_file: ".review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/counterexample.md"
    reproduction_file: "tests/review/candidates/r{round}_{role}_{temp_id}.test.{ext} | manual-steps.md | none"
    reproduction_command: "<command | manual | not_run>"
    reproduction_exit_status: "<exit code | manual | not_run>"
    reproduction_status: "observed | not_observed | blocked | not_run"
blockers: []
uncovered_paths: []
~~~

`reproduction_status` 只描述该候选的复现结果：`observed` 表示观察到 claim；`not_observed` 表示复现完整运行但未观察到 claim；`blocked` 表示无法判断；`not_run` 表示未尝试。`reproduction_exit_status` 只记录进程退出码；是否观察到 claim 以 `reproduction_status` 和证据为准。没有运行通用检查命令时，`commands` 写 `[]`。

示例（假设项目有项目详情 API；仅示范交接格式，实际路径、命令和结果必须来自当前项目）：

~~~yaml
review_status: complete
round: 1
role_slug: security
scope_checked: "GET /api/projects/{projectId} 的访问授权"
commands: []
findings:
  - finding_id: SEC-001
    severity: P1
    claim: "已登录用户可读取其无权访问的项目详情"
    kind: defect
    confidence: high
    evidence_dir: ".review-evidence/round-1/inbox/security/SEC-001/"
    counterexample_file: ".review-evidence/round-1/inbox/security/SEC-001/counterexample.md"
    reproduction_file: "tests/review/candidates/r1_sec_001.test.js"
    reproduction_command: "ADVERSARIAL_REVIEW=true npm test tests/review/candidates/r1_sec_001.test.js"
    reproduction_exit_status: 1
    reproduction_status: observed
blockers: []
uncovered_paths: []
~~~

对应的 `counterexample.md` 示例：

~~~text
finding_id: SEC-001
severity: P1
claim: 已登录用户可读取其无权访问的项目详情
location: src/routes/projects.ts:getProject
preconditions: Alice 已登录；project-42 存在；Alice 不是该项目成员
counterexample: 以 Alice 的会话请求 GET /api/projects/project-42
expected_vs_actual: 预期 HTTP 403；实际 HTTP 200 并返回项目详情
reproduction_path: tests/review/candidates/r1_sec_001.test.js
impact: 登录用户可读取其他项目的名称和配置，造成跨项目信息泄露
confidence: high
kind: defect
~~~

若没有发现，仍返回相同结构，设置 `review_status: complete`、`findings: []`；只有部分范围未检查时使用 `partial`，完全无法开展检查时使用 `blocked`。每个命令和 finding 的证据路径必须可定位到实际记录。
````

### 输出格式说明

代理返回属于交接摘要，不是第二份证据副本。主代理只在裁决当前 finding 时读取其完整证据。

---

## 2. 独立复现审查代理（Replay Reviewer Agent）

### 提示模板

主代理完成去重、范围/契约初筛并分配标准 ID 后，对可复现候选指派一名未提交该候选的独立复现审查员。

~~~text
你是独立复现审查员。只检查 [标准 finding ID] 的 counterexample.md 与指定复现文件、当前 HEAD，以及主代理提供的相关基线/契约。不要读取其他 finding、原评审结论、adjudication.md、challenge-result.md 或 verification-result.md。
复现材料：[该 finding 目录内 reproduce.* 或 manual-steps.md 的准确路径]
只读项目文件和测试；不要修改源代码、测试、配置或提交。

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架和依赖
- 若需要隔离测试数据库/fixture，放在：.review-evidence/round-[N]/_testdata/replay-[finding-id]/
- 通过环境变量传递数据路径，或使用项目测试框架的临时数据机制
- 若命令会改写持久数据、调用真实外部服务或无法确认副作用，停止运行并报告 blocked

## 输出约定
- 完整复现报告写入：.review-evidence/round-[N]/[标准 ID]/replay-review.md
- 必要的完整命令输出写入：.review-evidence/round-[N]/[标准 ID]/output.log
- 只返回 reproduced、not-reproduced 或 blocked，附证据路径、命令/退出状态摘要和阻塞项
- 不要判断 scope、severity 或最终 decision，不要在回复中粘贴完整日志
~~~

### 输出格式（简短摘要）

~~~yaml
finding_id: "<标准 ID>"
replay_status: "reproduced | not-reproduced | blocked"
replay_evidence_path: ".review-evidence/round-[N]/[标准 ID]/replay-review.md"
output_log_path: ".review-evidence/round-[N]/[标准 ID]/output.log"
commands_summary:
  - command: "<command>"
    exit_status: "<exit code>"
blockers: []  # 仅在 blocked 时填写
notes: "<简短说明，例如与原始证据的一致性>"
~~~

### 结果解释

- `reproduced`：有效前提下观察到 claim 所述行为；是否违反承诺范围由主代理另行裁决。
- `not-reproduced`：前提和断言有效、复现完整运行，但观察结果明确不符合 claim；记录具体反证。仅仅没有得到输出或结果模糊不算。
- `blocked`：环境、依赖、前提、脚本或观察点不完整，无法判断 claim；保留 `needs-evidence`，不得据此 rejected。

### 完整复现报告（replay-review.md）

~~~markdown
# Replay Review: [标准 finding ID]

## Finding Summary
- **Claim**: [claim 原文]
- **Reproduction Path**: [文件路径]
- **Review Date**: [ISO 8601]

## Reproduction Attempt
### Commands Run
```bash
[实际运行的命令，包含环境变量]
```

### Exit Status
[退出码和状态]

### Observed Behavior
[详细描述观察到的行为]

## Comparison with Claim
[观察结果是否与 claim 一致，如有差异详细说明]

## Verdict
**Status**: reproduced | not-reproduced | blocked

**Reasoning**: [简要说明判断依据]

## Blockers (if any)
[阻塞项列表]
~~~

---

## 3. 挑战代理（Challenge Agent）

### 提示模板

~~~text
你是挑战代理。检查 [标准 finding ID]，质疑其前提、严重性、范围或证据，找出可使其不成立或降级的理由。
提供材料：[counterexample.md 路径、reproduction 路径、adjudication.md 路径]
只读项目文件和测试；不要修改源代码、测试、配置或提交。

## 任务
1. 独立重放 reproduction（如果可运行）
2. 检查前提是否必然成立
3. 检查 claim 是否被夸大或误解
4. 检查 severity 是否与实际影响相符
5. 检查是否有替代解释或缓解因素

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架和依赖
- 若需要隔离数据，放在：.review-evidence/round-[N]/_testdata/challenge-[finding-id]/
- 若命令会改写持久数据、调用真实外部服务或无法确认副作用，停止运行并报告 blocked

## 输出约定
- 完整挑战报告写入：.review-evidence/round-[N]/[标准 ID]/challenge-result.md
- 必要的命令输出写入：.review-evidence/round-[N]/[标准 ID]/output.log（如果有新的运行）
- 返回 YAML 摘要：challenge_status、challenge_verdict、reproduction_replay_status、challenges、suggested_decision
- 不要在回复中粘贴完整日志或 reproduction 源码
~~~

### 输出格式（简短摘要）

~~~yaml
finding_id: "<标准 ID>"
challenge_status: "complete | blocked"
challenge_verdict: "supports | disputes | inconclusive"
reproduction_replay_status: "reproduced | not-reproduced | blocked | not_run"
challenges:
  - aspect: "precondition | claim | severity | scope | evidence"
    argument: "<挑战论据>"
    confidence: "high | medium | low"
suggested_decision: "rejected | downgrade-to-[P2/P3] | needs-evidence | accept-as-is"
challenge_evidence_path: ".review-evidence/round-[N]/[标准 ID]/challenge-result.md"
blockers: []
~~~

### 完整挑战报告（challenge-result.md）

~~~markdown
# Challenge Report: [标准 finding ID]

## Finding Summary
- **Claim**: [claim 原文]
- **Original Severity**: [P0/P1/P2/P3]
- **Challenge Date**: [ISO 8601]

## Reproduction Replay
### Commands Run
```bash
[实际运行的命令]
```

### Observed Behavior
[观察到的行为]

### Replay Status
**Status**: reproduced | not-reproduced | blocked | not_run

**Notes**: [与原始证据的一致性]

## Challenges

### Challenge 1: [aspect]
**Argument**: [具体论据]

**Evidence**: [支持论据的证据]

**Confidence**: high | medium | low

---

### Challenge 2: [aspect]
[重复上述结构]

## Suggested Decision
**Recommendation**: rejected | downgrade-to-[P2/P3] | needs-evidence | accept-as-is

**Reasoning**: [综合判断依据]

## Blockers (if any)
[阻塞项列表]
~~~

---

## 4. 补强代理（Reinforce Agent）

### 提示模板

~~~text
你是补强代理。为 [标准 finding ID] 修正反例的执行瑕疵（若有），并补充支持 finding 成立的证据。
提供材料：[counterexample.md 路径、reproduction 路径、adjudication.md 路径、challenge-result.md 路径（如果有）]
可以修改标准 ID 目录内的 reproduction 或 counterexample.md；不要修改项目源代码、测试、配置或提交。

## 任务
1. 独立重放 reproduction；若复现失败或材料有瑕疵，直接修正标准 ID 目录内的 reproduction 或 counterexample.md
2. 寻找类似或相关的缺陷模式
3. 评估在不同条件下的影响范围
4. 提供支持 severity 判断的额外证据
5. 回应挑战代理的论据（如果有）

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架和依赖
- 若需要隔离数据，放在：.review-evidence/round-[N]/_testdata/reinforce-[finding-id]/
- 若命令会改写持久数据、调用真实外部服务或无法确认副作用，停止运行并报告 blocked

## 输出约定
- 完整补强报告写入：.review-evidence/round-[N]/[标准 ID]/reinforce-result.md
- 必要的命令输出写入：.review-evidence/round-[N]/[标准 ID]/output.log（如果有新的运行）
- 返回 YAML 摘要：reinforce_status、reproduction_replay_status、reinforcements、suggested_decision
- 不要在回复中粘贴完整日志或 reproduction 源码
~~~

### 输出格式（简短摘要）

~~~yaml
finding_id: "<标准 ID>"
reinforce_status: "fixed | cannot-fix | blocked"
reproduction_replay_status: "reproduced | not-reproduced | blocked | not_run"
reinforcements:
  - aspect: "impact | scope | related-issues | severity-justification"
    argument: "<补强论据>"
    confidence: "high | medium | low"
suggested_decision: "accept-as-[P0/P1/P2] | upgrade-to-[P0/P1] | needs-evidence"
reinforce_evidence_path: ".review-evidence/round-[N]/[标准 ID]/reinforce-result.md"
blockers: []
~~~

### 完整补强报告（reinforce-result.md）

~~~markdown
# Reinforce Report: [标准 finding ID]

## Finding Summary
- **Claim**: [claim 原文]
- **Original Severity**: [P0/P1/P2/P3]
- **Reinforce Date**: [ISO 8601]

## Reproduction Replay
### Commands Run
```bash
[实际运行的命令]
```

### Observed Behavior
[观察到的行为]

### Replay Status
**Status**: reproduced | not-reproduced | blocked | not_run

**Notes**: [与原始证据的一致性]

## Reinforcements

### Reinforcement 1: [aspect]
**Argument**: [具体论据]

**Evidence**: [支持论据的证据]

**Confidence**: high | medium | low

---

### Reinforcement 2: [aspect]
[重复上述结构]

## Response to Challenges (if any)
[逐条回应挑战代理的论据，提供反驳或澄清]

## Suggested Decision
**Recommendation**: accept-as-[P0/P1/P2] | upgrade-to-[P0/P1] | needs-evidence

**Reasoning**: [综合判断依据]

## Blockers (if any)
[阻塞项列表]
~~~

---

## 5. 实现代理（Implementation Agent）

### 提示模板

见 `tdd-and-commit.md` 中的"实现代理任务模板"与"RED-GREEN 循环与测试合并"章节。

实现代理的任务是按照 TDD 流程（RED-GREEN-REFACTOR）修复已 accepted 的 finding。

**前置条件**：主代理已将 accepted findings 的临时测试文件从 `tests/review/candidates/` 移动到 `tests/review/reproductions/`。实现代理只处理已在 reproductions/ 目录中的测试文件。

### 关键要求

1. **RED 阶段**：
   - 读取 `tests/review/reproductions/r{round}_f{num}_{slug}.test.{ext}`（主代理已移动到此）
   - 将其测试用例复制到项目正式测试文件（如 `tests/auth.test.js`）
   - 运行正式测试文件中新合并的测试，确认失败（RED）
   - 如果测试通过，说明 finding 已被其他修复解决，报告 already_fixed

2. **GREEN 阶段**：
   - 实现最小修复，使测试通过
   - 运行完整测试套件，确保无回归
   - 不要过度工程或添加 finding 范围外的功能

3. **REFACTOR 阶段**（可选）：
   - 仅在必要时进行代码清理
   - 保持测试通过
   - 不要引入新的抽象或模式，除非修复本身需要

4. **提交**（提交规范以 tdd-and-commit.md 为准）：
   - 每个 finding 一个独立提交
   - 提交消息格式：`fix(review): [ID] concise behavior being corrected`
   - 提交体包含：finding ID、影响、修复说明、测试路径

### 输出格式（简短摘要）

~~~yaml
finding_id: "<标准 ID>"
implementation_status: "fixed | already_fixed | blocked | cannot_fix"
test_status:
  red: "confirmed | not_confirmed"
  green: "pass | fail"
  full_suite: "pass | fail | not_run"
commit_sha: "<commit hash | none>"
commit_message: "<first line>"
modified_files: []
test_files: []
blockers: []
~~~

### 完整实现报告（implementation-result.md）

~~~markdown
# Implementation Result: [标准 finding ID]

## Finding Summary
- **Claim**: [claim 原文]
- **Severity**: [P0/P1/P2/P3]
- **Implementation Date**: [ISO 8601]

## RED Phase
### Test File
**Path**: [测试文件路径]

### RED Confirmation
```bash
[运行测试的命令]
```

**Exit Status**: [退出码]

**Result**: confirmed | not_confirmed

**Notes**: [如果 not_confirmed，说明原因，可能是 already_fixed]

## already_fixed 处理（仅在 RED 阶段测试通过时填写）
**如果 RED 阶段测试直接通过，说明 finding 已被历史修复解决，填写以下信息：**

### Evidence Test File
**Path**: [证明修复的测试文件路径，从 tests/review/reproductions/ 移动到项目正式测试文件的路径]

**Test Output**:
```bash
[运行测试的命令和输出]
```

**Exit Status**: [退出码，应该是 0]

### Analysis
[简要说明为什么测试通过，是否能确认 finding 确实被修复（而不是测试本身有问题）]

**提供给验证代理的信息**：
- **Test Path**: [测试文件路径]
- **Test Command**: [运行测试的命令]
- **Counterexample Reference**: [原始 counterexample.md 路径]

**注意**：already_fixed 情况下，不需要找历史修复 commit，验证代理会检查测试覆盖度。

---

## GREEN Phase（仅在 RED confirmed 时填写）
### Implementation Approach
[简要描述修复方法]

### Modified Files
- [文件路径 1]
- [文件路径 2]

### GREEN Confirmation
```bash
[运行测试的命令]
```

**Exit Status**: [退出码]

**Result**: pass | fail

### Full Test Suite
```bash
[运行完整测试套件的命令]
```

**Exit Status**: [退出码]

**Result**: pass | fail | not_run

## REFACTOR Phase (if any)
[描述重构内容，如果没有则省略此节]

## Commit
**SHA**: [commit hash]

**Message**:
```
[完整的 commit message]
```

## Blockers (if any)
[阻塞项列表，例如：
- 与用户代码冲突（blocked_by_user_changes）
- 依赖项缺失
- 测试环境问题
]

## Manual Merge Guidance (required if blocked_by_user_changes)
**仅在 implementation_status 为 blocked 且 blockers 包含 user_changes_conflict 时填写此节，否则省略**

### Conflict Files
- [文件路径 1]
- [文件路径 2]

### Fix Diff Patch
```diff
[git diff 输出，仅包含修复改动，不含用户改动]
```

或者，如果 diff 不清晰，提供代码片段：

```[language]
// 修复代码片段
```

### Suggested Steps
1. 打开 [文件路径]
2. 找到第 [行号] 行（或搜索 [关键字]）
3. 插入/修改以下代码：
   ```[language]
   [代码片段]
   ```
4. 运行测试验证：`[测试命令]`

### Verification
- **测试路径**：[修复测试的文件路径]
- **预期结果**：[测试应该通过的描述]
- **验证命令**：`[运行测试的命令]`

### Risks
[如果用户改动可能与修复冲突，明确说明冲突点和注意事项]
~~~

### 工作区冲突处理

当发现修复目标文件含有用户未提交的改动时：

1. 检查是否可以安全分块（见 `tdd-and-commit.md` 的"工作区冲突处理"章节）
2. 如果不能安全分块，将 finding 标记为 `blocked_by_user_changes`
3. **必须在 implementation-result.md 的 "Manual Merge Guidance" 章节提供详细的手工合并建议**（见上方模板）
4. 输出格式中增加字段：

~~~yaml
implementation_status: "blocked"
blockers:
  - type: "user_changes_conflict"
    affected_files: []
    can_chunk: false
    notes: "<说明冲突的性质>"
    manual_merge_guidance_provided: true
~~~

---

## 6. 验证代理（Verification Agent）

### 提示模板

~~~text
你是验证代理。检查 [标准 finding ID] 的修复是否有效、完整、无回归。你未参与该 finding 的实现，必须独立验证。
提供材料：
- 原始 counterexample.md 和 reproduction 路径
- 实现代理的修复提交 SHA 和实现报告路径（如果是 already_fixed，则没有新的修复提交）
- 当前 HEAD（应该包含修复提交，或在 already_fixed 情况下已经包含历史修复）

## 任务

### 正常修复流程（implementation_status: fixed）
1. **复现原始缺陷**（在修复前的 commit）：确认 finding 确实存在
2. **验证修复**（在修复后的 commit / HEAD）：确认 finding 已解决
3. **生成相邻测试**（Adjacent Tests）：为相邻功能、边界情况、异常路径生成至少 2 个新测试用例
4. **验证相邻测试**：对生成的新测试用例进行验证
5. **合并测试**：若新测试用例通过，将新测试用例与原先的测试用例合并
6. **运行完整测试套件**：确认无回归
7. **检查修复完整性**：是否遗漏相关场景
8. **提交合并改动**：提交格式：`add(adjacent): [ID] concise new test cases' description`

### already_fixed 流程（implementation_status: already_fixed）
当实现代理发现测试已经通过（finding 在评审前已被修复）时：
1. **验证测试覆盖**：读取实现代理提供的测试文件，确认测试确实覆盖了 finding 的 claim（检查 counterexample.md 和测试代码的对应关系）
2. **重新运行测试**：在当前 HEAD 确认测试通过，验证测试确实有效
3. **生成相邻测试**：与正常流程相同，生成至少 2 个相邻测试用例
4. **验证相邻测试**：对生成的新测试用例进行验证
5. **合并测试**：若新测试用例通过，将新测试用例与原先的测试用例合并
6. **运行完整测试套件**：确认无回归
7. **提交合并改动**：提交格式：`add(adjacent): [ID] concise new test cases' description`

**already_fixed 的关键区别**：
- **不需要找历史修复 commit**：修复已经在代码库中，无需定位是哪个 commit 修掉的
- **不需要复现修复前状态**：无需 worktree 或 checkout，因为测试通过就是证据
- **重点在测试覆盖度检查**：确保测试真的覆盖了 finding，而不是偶然通过

## 相邻测试要求

**最低标准**：
- 最少 2 个用例：正常情况 + 边界情况
- 必须覆盖原 finding 未直接测试的相邻路径
- 必须可运行并通过

**示例**（假设原 finding 是"未登录用户可访问受保护资源"）：
- Adjacent Test 1: 已登录但无权限的用户访问（边界情况）
- Adjacent Test 2: 已登录且有权限的用户访问（正常情况）
- Adjacent Test 3: Token 过期的用户访问（异常情况）

**失败处理**：
- 如果无法生成有意义的相邻测试（例如：finding 的修复已覆盖所有相关路径），说明理由，verification 仍可 pass
- 如果生成的相邻测试失败，分析失败原因：
  - **修复不完整**（相邻路径仍有问题）：verification 状态为 fail，不合并测试文件，回到 repair 阶段
  - **测试本身有问题**（断言错误、fixture 问题、环境问题）：重新生成测试或标记为 inconclusive，说明原因
  - **发现无关的新问题**（与当前 finding 不相关的独立缺陷）：标记为新 finding（在 verification-result.md 中记录并建议主代理创建新 finding），当前 verification 仍可 pass（不合并失败的测试）

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架和依赖
- 若需要隔离数据，放在：.review-evidence/round-[N]/_testdata/verify-[finding-id]/
- 相邻测试写入：tests/review/verifications/r{round}_f{num}_{slug}_adjacent.test.{ext}
- 若命令会改写持久数据、调用真实外部服务或无法确认副作用，停止运行并报告 blocked


## 工作区保护（强制）

**默认方案（worktree）**：
- 不得在共享工作区直接 `git checkout` 修复前 commit
- 用独立 worktree 复现修复前状态：
  ```bash
  # 创建临时 worktree
  git worktree add <系统临时目录或仓库同级目录>/verify-[finding-id] [修复前 commit]
  
  # 在 worktree 中运行复现命令
  cd <worktree-path>
  [运行 reproduction 命令]
  
  # 完成后清理
  cd <原工作区>
  git worktree remove <worktree-path>
  ```

**兜底方案（stash + checkout）**：
- **平台说明（Windows）**：下方命令为 POSIX shell 示例，Windows PowerShell 下需改写为等价形式：`/tmp/...` → 系统临时目录（如 `$env:TEMP\verify-...`），`var=$(...)` → `$var = ...`，`diff` → `git diff --no-index`（或 `Compare-Object`），含 `{}` 的参数如 `stash@{0}` 需加引号（`'stash@{0}'`）。
- **触发条件**：`git worktree add` 失败（如 Git 版本不支持、文件系统限制）
- **需要主代理批准**：验证代理遇到 worktree 失败时，必须报告 blocked，由主代理决定是否授权使用兜底方案
- **执行步骤**：
  1. 记录原始状态：
     ```bash
     original_head=$(git rev-parse HEAD)
     original_branch=$(git rev-parse --abbrev-ref HEAD)
     git status --short > /tmp/verify-[finding-id]-original-status.txt
     ```
  2. 保存工作区改动：
     ```bash
     git stash push --include-untracked -m "verify-[finding-id]-backup"
     stash_ref=$(git rev-parse stash@{0})  # 记录 stash 引用
     ```
  3. 切换到修复前 commit：
     ```bash
     git checkout [修复前 commit]  # detached HEAD
     ```
  4. 运行复现命令并记录结果
  5. 恢复原始状态：
     ```bash
     git checkout $original_branch  # 或 $original_head
     git stash pop $stash_ref
     ```
  6. **错误恢复**：
     - 若 `git stash pop` 产生冲突：
       ```bash
       git stash drop  # 放弃 stash（工作区改动已在 original-status.txt 中记录）
       ```
       报告 blocked，附原始状态文件路径和冲突详情，不要强制合并
     - 若验证代理在步骤 3-4 之间崩溃：主代理检测到 detached HEAD，执行：
       ```bash
       git checkout <baseline_head 或 original_branch>
       git stash list  # 查找 verify-[finding-id]-backup
       git stash pop <stash-ref>  # 若失败，保留 stash 并报告
       ```
  7. 验证恢复结果：
     ```bash
     git status --short > /tmp/verify-[finding-id]-restored-status.txt
     diff /tmp/verify-[finding-id]-original-status.txt /tmp/verify-[finding-id]-restored-status.txt
     ```
     若有差异且不能确认为预期变化，报告 blocked

**禁止操作**：
- 禁止 `git checkout --force`、`git reset --hard`、`git clean`
- 修复后状态直接在当前 HEAD 工作区验证，不要移动 HEAD
- 除上述受控兜底流程外，验证代理不得以任何方式移动 HEAD

## 输出约定
- 完整验证报告写入：.review-evidence/round-[N]/[标准 ID]/verification-result.md
- 必要的命令输出写入：.review-evidence/round-[N]/[标准 ID]/output.log
- 返回 YAML 摘要：verification_status、reproduction_status（before/after）、adjacent_tests、verdict
- 不要在回复中粘贴完整日志或测试源码
~~~

### 输出格式（简短摘要）

~~~yaml
finding_id: "<标准 ID>"
verification_status: "complete | blocked"
reproduction_before_fix:
  commit: "<修复前的 commit SHA>"
  status: "observed | not_observed | blocked"
  notes: "<简短说明>"
reproduction_after_fix:
  commit: "<修复后的 commit SHA / HEAD>"
  status: "not_observed | still_observed | blocked"
  notes: "<简短说明>"
adjacent_tests:
  generated: true | false
  count: <数量>
  file_path: "tests/review/verifications/r{round}_f{num}_{slug}_adjacent.test.{ext} | none"
  status: "pass | fail | not_run"
  notes: "<如果未生成或失败，说明理由>"
full_test_suite:
  status: "pass | fail | not_run"
  exit_status: "<退出码>"
verdict: "pass | fail | inconclusive | blocked"
verification_evidence_path: ".review-evidence/round-[N]/[标准 ID]/verification-result.md"
blockers: []
~~~

### 完整验证报告（verification-result.md）

~~~markdown
# Verification Result: [标准 finding ID]

## Finding Summary
- **Claim**: [claim 原文]
- **Severity**: [P0/P1/P2/P3]
- **Implementation Status**: [fixed | already_fixed]（来自实现代理报告）
- **Fix Commit**: [SHA]（如果是 already_fixed，填写 "N/A - already fixed in codebase"）
- **Verification Date**: [ISO 8601]

## Verification Flow

### 正常修复验证（implementation_status: fixed）

#### Step 1: Reproduce Before Fix
**Commit SHA**: [修复前的 commit]

**Commands Run**:
```bash
git worktree add <临时目录>/verify-[finding-id] [修复前 commit SHA]
（在 worktree 中运行）[reproduction 命令]
git worktree remove <临时目录>/verify-[finding-id]
```

**Observed Behavior**: [观察到的行为]

**Result**: observed | not_observed | blocked

**Notes**: [如果 not_observed，说明原始 finding 可能无效或已被其他修复解决]

#### Step 2: Verify After Fix
**Commit SHA**: [修复后的 commit / HEAD]

**Commands Run**:
```bash
# 当前 HEAD 工作区已包含修复提交，不要移动 HEAD
[reproduction 命令]
```

**Observed Behavior**: [观察到的行为]

**Result**: not_observed | still_observed | blocked

**Notes**: [如果 still_observed，说明修复无效或不完整]

### already_fixed 验证（implementation_status: already_fixed）

#### Step 1: Test Coverage Check
**Test File**: [实现代理提供的测试文件路径]

**Coverage Analysis**:
- **Counterexample Claim**: [从 counterexample.md 提取的 claim]
- **Test Assertion**: [测试中的关键断言]
- **Coverage Assessment**: [测试是否确实覆盖了 claim 的逻辑]

**Result**: covers_claim | insufficient_coverage | unclear

**Notes**: [如果 insufficient_coverage，说明测试可能偶然通过，建议重新裁决]

#### Step 2: Re-run Test
**Commands Run**:
```bash
[运行测试的命令]
```

**Exit Status**: [退出码]

**Result**: pass | fail

**Notes**: [如果 fail，说明测试不稳定或环境问题]

### Step 3: Adjacent Tests（两种流程共用）
### Generated Tests
**File Path**: [测试文件路径 | none]

**Test Cases**:
1. [测试用例 1 描述]
2. [测试用例 2 描述]
3. [测试用例 3 描述（可选）]

### Execution
```bash
[运行相邻测试的命令]
```

**Exit Status**: [退出码]

**Result**: pass | fail | not_run

**Notes**: [如果未生成或失败，详细说明理由]

## Step 4: Full Test Suite
```bash
[运行完整测试套件的命令]
```

**Exit Status**: [退出码]

**Result**: pass | fail | not_run

## Step 5: Completeness Check
[检查修复是否遗漏相关场景，例如：
- 是否只修复了一个路径，遗漏了其他类似路径？
- 是否只处理了正常情况，遗漏了异常情况？
- 是否引入了新的边界问题？
]

## Verdict
**Final Verdict**: pass | fail | inconclusive | blocked

**Reasoning**: [综合判断依据]

## Blockers (if any)
[阻塞项列表]
~~~

### Verdict 判断规则

- **pass**: reproduction_before_fix = observed，reproduction_after_fix = not_observed，full_test_suite = pass，adjacent_tests = pass 或有合理理由未生成
- **fail**: reproduction_after_fix = still_observed，或 full_test_suite = fail，或 adjacent_tests = fail
- **inconclusive**: reproduction_before_fix = not_observed（原始 finding 无法复现），需要重新评估
- **blocked**: 任一步骤 = blocked

---

## 7. 最终审计代理（Final Audit Agent）

最终审计由未参与本流程任何阶段（评审、复现审查、挑战、补强、实现、验证）的新代理完成，分两阶段：盲扫、定向复核。

### 第一阶段提示模板（盲扫）

主代理从 baseline.md 中提取 MVP 范围和验收标准，直接在提示中提供给审计代理。审计代理不读取任何 .review-evidence/ 内容（包括 baseline.md）。第一阶段代理可以把本阶段结果写入主代理指定的证据文件路径；完整候选证据写在 inbox，摘要只在 blind-scan.md 记录一次。

~~~text
你是独立最终审计员。检查以下 MVP 范围和验收标准在当前 HEAD 的整体行为。

## MVP 范围和验收标准
[主代理从 baseline.md 中提取并提供，包括：
- MVP 包含功能、明确排除功能
- 验收标准和来源
- 设计负载或兼容性承诺
]

可运行的验证命令：[测试/构建/静态检查命令]
不要读取 .review-evidence/ 中任何已有内容（包括 baseline.md）、历史 finding、修复清单或以前的裁决；不要编辑项目文件或提交。

## 任务
1. 独立检查当前 HEAD 是否满足 MVP 承诺
2. 寻找新的缺陷、遗漏的边界情况、回归问题
3. 不要假设之前的评审已覆盖所有问题
4. 不要重复提交已在 .review-evidence/ 中存在的 finding（你不知道它们）

## 文件组织
- 临时测试文件：tests/review/candidates/r{round}_finalaudit_{temp_id}.test.{ext}
- 证据文档：.review-evidence/round-[N]/final-audit/attempt-[K]/inbox/[临时_id]/counterexample.md
- 完整命令输出：.review-evidence/round-[N]/final-audit/attempt-[K]/inbox/[临时_id]/output.log
- 盲扫摘要：.review-evidence/round-[N]/final-audit/attempt-[K]/blind-scan.md

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架和依赖
- 若需要隔离数据，放在：.review-evidence/round-[N]/_testdata/final-audit/attempt-[K]/
- 若命令会改写持久数据、调用真实外部服务或无法确认副作用，停止运行并报告 blocked

## 输出约定
按与常规评审代理相同的 YAML 格式返回，但 role_slug 使用 "final-audit"：

~~~yaml
review_status: "complete | partial | blocked"
round: "[N]"
role_slug: "final-audit"
scope_checked: "<scope summary>"
commands: []
findings:
  - finding_id: "FA-001"  # 使用 FA- 前缀
    severity: "P0 | P1 | P2 | P3"
    claim: "<observable behavior>"
    kind: "defect | spec-gap | risk | regression"
    confidence: "high | medium | low"
    evidence_dir: ".review-evidence/round-[N]/final-audit/attempt-[K]/inbox/FA-001/"
    counterexample_file: ".review-evidence/round-[N]/final-audit/attempt-[K]/inbox/FA-001/counterexample.md"
    reproduction_file: "tests/review/candidates/r{round}_finalaudit_fa001.test.{ext} | manual-steps.md | none"
    reproduction_command: "<command | manual | not_run>"
    reproduction_exit_status: "<exit code | manual | not_run>"
    reproduction_status: "observed | not_observed | blocked | not_run"
blockers: []
uncovered_paths: []
~~~

若没有发现新问题，返回 `review_status: complete`、`findings: []`。
~~~

### 第二阶段提示模板（定向复核）

扫描结果已保存后，再提供所有 accepted finding、原始证据路径、修复测试路径和提交，要求逐项复核。

~~~text
你是最终审计员（第二阶段）。已完成盲扫，现在定向复核已修复的 findings。
提供材料：
- 所有 accepted finding 的列表、原始证据路径、修复提交 SHA
- 修复测试路径和验证结果路径
- 当前 HEAD

## 任务
1. 逐项检查已修复的 findings，确认修复有效
2. 检查修复是否引入新问题或回归
3. 检查测试覆盖是否充分
4. 检查是否有遗留风险或边界情况未处理
5. 运行完整测试套件和适用的静态检查

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架和依赖
- 若需要隔离数据，放在：.review-evidence/round-[N]/_testdata/final-audit/attempt-[K]/
- 若命令会改写持久数据、调用真实外部服务或无法确认副作用，停止运行并报告 blocked

## 输出约定
- 完整复核报告写入：.review-evidence/round-[N]/final-audit/attempt-[K]/targeted-review.md
- 必要的命令输出写入：.review-evidence/round-[N]/final-audit/attempt-[K]/output.log
- 返回 YAML 摘要：review_status、findings_reviewed、new_issues、overall_assessment

~~~yaml
review_status: "complete | partial | blocked"
round: "[N]"
attempt: "[K]"
findings_reviewed:
  - finding_id: "<标准 ID>"
    fix_effective: true | false
    regression_detected: true | false
    test_coverage_adequate: true | false
    notes: "<简短说明>"
new_issues:  # 复核中发现的新问题（应该很少）
  - finding_id: "FA-00X"
    severity: "P0 | P1 | P2 | P3"
    claim: "<observable behavior>"
    evidence_dir: ".review-evidence/round-[N]/final-audit/attempt-[K]/inbox/FA-00X/"
overall_assessment:
  status: "pass | fail"
  summary: "<overall summary>"
  residual_risks: []  # 残余风险列表
  recommendations: []  # 建议（可选）
blockers: []
~~~
~~~

### 完整复核报告（targeted-review.md）

~~~markdown
# Final Audit: Targeted Review (Attempt [K])

## Review Summary
- **Round**: [N]
- **Attempt**: [K]
- **Review Date**: [ISO 8601]
- **Findings Reviewed**: [数量]

## Findings Review

### [标准 Finding ID 1]
**Original Claim**: [claim 原文]

**Fix Commit**: [SHA]

**Fix Effectiveness**: effective | ineffective | partial

**Test Coverage**: adequate | inadequate

**Regression Detected**: yes | no

**Notes**: [详细说明]

---

### [标准 Finding ID 2]
[重复上述结构]

---

## New Issues (if any)

### FA-00X: [claim]
**Severity**: [P0/P1/P2/P3]

**Evidence**: [证据路径]

**Notes**: [说明这是复核中发现的新问题]

---

## Overall Assessment

### Test Suite
```bash
[运行完整测试套件的命令]
```

**Exit Status**: [退出码]

**Result**: pass | fail

### Static Checks (if applicable)
```bash
[运行静态检查的命令]
```

**Result**: [结果摘要]

### Build Verification
```bash
[构建命令]
```

**Result**: pass | fail

### Overall Status
**Status**: pass | fail

**Summary**: [综合评估]

### Residual Risks
[列出任何已知但未修复的残余风险，例如：
- 手工 findings 无法自动化验证
- 外部依赖问题
- 性能问题（P3）已 deferred
]

### Recommendations (optional)
[可选的改进建议]

## Blockers (if any)
[阻塞项列表]
~~~

---

## 提示模板使用指南

### 1. 模板参数替换

所有提示模板中的 `[...]` 占位符都必须在委派时替换为实际值：

- `[MVP 范围]`: 从 baseline.md 中提取
- `[验收标准/契约]`: 从 baseline.md 中提取
- `[role-slug]`: security、functionality、reliability、api、performance、ux、ops、product
- `[round number]`: 当前轮次（1 至 max_rounds，默认 1-5）
- `[标准 finding ID]`: R1-F001-SEC 格式
- `[临时_id]`: SEC-001 格式（role-local）

### 2. 委派时机

- **评审代理**: review phase 开始时，委派至少 3 个角色
- **复现审查代理**: adjudication phase，主代理筛查并分配标准 ID 后
- **挑战代理**: adjudication phase，必须挑战范围内的项必须委派（见 SKILL.md “委派硬门禁”和 `phase-playbooks.md` §2.5），其余按资源选择
- **补强代理**: adjudication phase，仅当反例思路合理但有执行瑕疵时
- **实现代理**: repair phase，逐个修复 accepted findings
- **验证代理**: verification phase，每个修复完成后
- **最终审计代理**: final_audit phase，满足进入最终审计条件时

### 3. 输出处理

所有子代理的输出分为两部分：

1. **简短摘要（YAML）**: 返回给主代理的对话中，用于决策和状态流转
2. **完整报告（Markdown）**: 写入证据目录，用于审计和恢复

主代理只在需要时读取完整报告（例如裁决时读取 counterexample.md），而不是让子代理在回复中粘贴完整内容。

### 4. 证据路径规范

所有证据文件路径都必须遵循 `evidence-structure.md` 中定义的结构：

- 候选阶段: `.review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/`
- 标准阶段: `.review-evidence/round-[N]/[标准 ID]/`
- 最终审计: `.review-evidence/round-[N]/final-audit/attempt-[K]/`

### 5. 命令输出管理

所有完整命令输出都必须保存到 `output.log`，而不是粘贴到回复或其他 Markdown 文件中。这样可以：

- 减少对话上下文占用
- 保持证据文件的可读性
- 允许独立查看和分析命令输出

### 6. 阻塞处理

所有子代理在遇到无法继续的情况时，必须：

1. 设置状态为 `blocked`
2. 在 `blockers` 字段中列出具体阻塞项
3. 不要猜测或假设结果
4. 不要因为阻塞而跳过其他可以完成的工作

### 7. 独立性要求

以下代理必须独立于原始评审员：

- 复现审查代理：不能是提交该候选的评审员
- 验证代理：不能是实现该修复的代理
- 最终审计代理：不能参与过本流程任何阶段（评审、复现审查、挑战、补强、实现、验证）

主代理在委派时必须检查并确保独立性。
