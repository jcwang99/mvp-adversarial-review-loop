# 子代理提示模板与输出格式

委派前按 `SKILL.md` §0 用 `model-for` 解析角色，在 harness 调度参数中应用已指定的模型。所有模板中的 `[skill-dir]` 必须在委派时替换为当前 harness 的实际技能目录绝对路径，并提供 `node "[skill-dir]/scripts/reviewctl.js"` 的可执行形式；子代理只读使用脚本，不得修改状态或推进阶段。

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

为每个代理替换 round、role-slug、范围和验收标准。按轮次策略执行回归检查时还需提供待检查的修复提交/变更路径，但不提供历史 finding 或预期结论。

````text
你是 [role-slug] 评审员。只读检查 [MVP 范围]，依据 [验收标准/契约] 和当前 HEAD。
本轮变更范围：[常规评审填 none；回归评审列出待检查的提交/文件路径，不提供历史 finding 或预期结论]
不要修改项目源代码、测试、配置，不要安装依赖或提交。只用临时 fixture/数据库执行验证；若命令会改写持久数据、调用真实外部服务或无法确认副作用，停止运行并报告阻塞。

## 文件组织与运行约定

**临时测试文件**（写入项目测试目录，供后续阶段复用）：
- 存放位置：`tests/review/candidates/`
- 命名：`r{round}_{role-token}_{seq}{suffix}`；`role-token` 是 `sec/func/rel/api/perf/ux/ops/prod`，后缀按语言选择：`.test.js` / `.spec.ts`、`_test.py`、`_test.go`、`_spec.rb`、`Test.java`、`Test.cs`、`.rs`
  - 示例：`tests/review/candidates/r1_sec_001.test.js`、`r1_perf_002_test.py`
  - 使用项目测试格式，可以复用项目的测试环境、fixtures、辅助函数
- **测试框架忽略此目录**：主代理已在 baseline 阶段确保项目测试配置忽略 `tests/review/`（或使用 ADVERSARIAL_REVIEW 开关）；若运行中发现临时测试会被日常测试收集，停止并报告阻塞，不要自行修改项目配置
- 完整命令输出保存在：`.review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/output.log`
- **测试输出必须先落盘**：运行测试/复现命令前，先把完整输出重定向到该 finding 的 `output.log` 并记录退出码（POSIX：`{ <command>; echo "EXIT_CODE=$?"; } > <output.log> 2>&1`；PowerShell：`<command> *> <output.log>; Add-Content <output.log> "EXIT_CODE=$LASTEXITCODE"`）。需要查看时用 `tail`/`grep` 或 PowerShell `Get-Content -Tail`/`Select-String` 读日志；对话通常只保留最后几行，输出被截断时**不要重复运行命令**。多个命令可按步骤写成 `output-<step>.log`

**证据文档**（仍在 .review-evidence/ 中）：
- counterexample.md：`.review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/counterexample.md`
- output.log：完整命令输出，不要粘贴到回复或 counterexample.md 中
- handoff.json：把下方 YAML 的等价 JSON 写入同一 inbox；这是 `reviewctl validate` 读取的结构化交接
- 主代理会用 `reviewctl new-inbox` 预先创建目录；不要自行创建其他路径
- **技能脚本（如需）**：`node "[skill-dir]/scripts/reviewctl.js"`；`[skill-dir]` 由主代理替换为当前 harness 的实际绝对路径，只读使用，不要修改状态或推进阶段

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
- 不要为每个 finding 创建独立的依赖/编译环境；在 baseline 记录的磁盘预算内复用预热缓存（Rust 如 `CARGO_TARGET_DIR`），不要为每个 finding 新建 target 目录。缓存超预算时按主代理指示在轮次边界集中清理（如 `cargo clean`），不要每个 finding 都清理重建

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
    reproduction_file: "tests/review/candidates/r{round}_{role-token}_{seq}{suffix} | manual-steps.md | none"
    reproduction_command: "<command | manual | not_run>"
    reproduction_exit_status: "<exit code | manual | not_run>"
    reproduction_status: "observed | not_observed | blocked | not_run"
blockers: []
uncovered_paths: []
~~~

`reproduction_status` 只描述该候选的复现结果：`observed` 表示观察到 claim；`not_observed` 表示复现完整运行但未观察到 claim；`blocked` 表示无法判断；`not_run` 表示未尝试。`reproduction_exit_status` 只记录进程退出码；是否观察到 claim 以 `reproduction_status` 和证据为准。没有运行通用检查命令时，`commands` 写 `[]`。主代理记录 finding 时映射为：`observed → reproduced`，`not_observed → not-reproduced`，`blocked/not_run` 不变。

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
- **测试输出先落盘**：运行复现命令前，把完整输出重定向到 .review-evidence/round-[N]/[标准 ID]/output.log 并记录退出码（POSIX：`{ <command>; echo "EXIT_CODE=$?"; } > <output.log> 2>&1`；PowerShell：`<command> *> <output.log>; Add-Content <output.log> "EXIT_CODE=$LASTEXITCODE"`）。输出被截断时读取该日志（`tail`/`grep` 或 `Get-Content -Tail`/`Select-String`），不要重复运行；多个命令可用 `output-<step>.log`
- **技能脚本（如需）**：`node "[skill-dir]/scripts/reviewctl.js"`；`[skill-dir]` 由主代理替换为当前 harness 的实际绝对路径，只读使用，不要修改状态或推进阶段
- **编译缓存复用（按磁盘预算）**：在 baseline 记录的磁盘预算内复用预热缓存（Rust 如 `CARGO_TARGET_DIR`）；不要为每个 finding 新建 target/依赖目录。缓存超预算时按主代理指示在轮次边界集中清理（如 `cargo clean`），不要每个 finding 都清理重建
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

`exit_status` 填实测的数值。断言触发时可以非零，须在报告中保存对应断言和实际观察。运行器、依赖或环境故障按 `blocked` 处理。

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
- **Executor**: [子代理名称/ID]
- **Independence**: 未参与该候选的提出

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

每份 `replay-review.md` 还必须包含以下结构化证据，供 `reviewctl` 校验：

~~~markdown
## Reviewctl Replay Evidence
```json
{
  "schema_version": 1,
  "tested_commit": "<完整 commit SHA>",
  "tested_tree_hash": "<commit 对应 tree hash>",
  "test_path": "<复现测试或 manual-steps.md>",
  "test_sha256": "<文件 SHA-256>",
  "command": "<实际命令>",
  "exit_status": 0
}
```
~~~

`tested_commit` / `tested_tree_hash` 标识复现时被测代码状态；`test_path` 指向保存的正式复现文件或 `manual-steps.md`，`test_sha256` 对该证据文件的实际内容计算。验证时须核对 commit/tree 与路径内文件哈希，后续工作区修改不能替代原证据文件。

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
- **测试输出先落盘**：运行测试/重放命令前，把完整输出重定向到 .review-evidence/round-[N]/[标准 ID]/output.log 并记录退出码（POSIX：`{ <command>; echo "EXIT_CODE=$?"; } > <output.log> 2>&1`；PowerShell：`<command> *> <output.log>; Add-Content <output.log> "EXIT_CODE=$LASTEXITCODE"`）。输出被截断时读取该日志（`tail`/`grep` 或 `Get-Content -Tail`/`Select-String`），不要重复运行；多个命令可用 `output-<step>.log`
- **技能脚本（如需）**：`node "[skill-dir]/scripts/reviewctl.js"`；`[skill-dir]` 由主代理替换为当前 harness 的实际绝对路径，只读使用，不要修改状态或推进阶段
- **编译缓存复用（按磁盘预算）**：在 baseline 记录的磁盘预算内复用预热缓存（Rust 如 `CARGO_TARGET_DIR`）；不要为每个 finding 新建 target/依赖目录。缓存超预算时按主代理指示在轮次边界集中清理（如 `cargo clean`），不要每个 finding 都清理重建
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
- **测试输出先落盘**：运行测试/重放命令前，把完整输出重定向到 .review-evidence/round-[N]/[标准 ID]/output.log 并记录退出码（POSIX：`{ <command>; echo "EXIT_CODE=$?"; } > <output.log> 2>&1`；PowerShell：`<command> *> <output.log>; Add-Content <output.log> "EXIT_CODE=$LASTEXITCODE"`）。输出被截断时读取该日志（`tail`/`grep` 或 `Get-Content -Tail`/`Select-String`），不要重复运行；多个命令可用 `output-<step>.log`
- **技能脚本（如需）**：`node "[skill-dir]/scripts/reviewctl.js"`；`[skill-dir]` 由主代理替换为当前 harness 的实际绝对路径，只读使用，不要修改状态或推进阶段
- **编译缓存复用（按磁盘预算）**：在 baseline 记录的磁盘预算内复用预热缓存（Rust 如 `CARGO_TARGET_DIR`）；不要为每个 finding 新建 target/依赖目录。缓存超预算时按主代理指示在轮次边界集中清理（如 `cargo clean`），不要每个 finding 都清理重建
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

发送 `tdd-and-commit.md` 的“实现代理任务模板”，附上本 finding 的反例、baseline 测试策略和工作目录。若为 bounded 乐观候选，限定在指定 worktree 修改，返回候选 commit、变更路径、测试与质量检查日志。主代理负责正式提升。

正式实现报告写入 finding 目录的 `implementation-result.md`。记录 RED、GREEN、正式测试路径和提交；按 `evidence-structure.md` 的 `Reviewctl GREEN Evidence` 格式保存机器证据。手工复现写明 Manual 步骤。与用户改动无法安全分离时，报告 `prepared` 并提供 `Manual Merge Guidance`（冲突文件、补丁、合并步骤、验证命令和风险）。

返回 YAML 摘要，列出 `finding_id`、`implementation_status`、`commit_sha`、正式测试路径、报告路径和阻塞。机器证据只写一份。

## 6. 验证代理（Verification Agent）

~~~text
独立验证 [标准 finding ID]。输入为 [原始反例、复现记录、实现报告、修复提交、正式测试路径、当前 HEAD]，以及 [severity、changed files、baseline 测试策略和缓存]。使用主代理给出的技能绝对路径。只读使用 reviewctl，主代理负责登记。

1. 按 changed files 和 baseline 高风险路径独立判断风险，影响不明按 high。核对修复前证据的 commit、tree 和测试文件 SHA-256。P0/P1、高风险或证据无法核对时，在修复前提交的独立 worktree 重放。隔离失败则报告阻塞并保留用户工作区。
2. 在修复后的 HEAD 重放原始反例，检查断言是否覆盖 claim。手工 finding 独立执行 manual-steps.md。already_fixed 还要核对已提交的正式测试及历史修复提交。
3. 按 SKILL.md §1 的表运行 impacted 或 full。progressive 普通 P2/P3 核对 GREEN fast 后运行 impacted。高风险、P0/P1、full-everywhere 由你独立运行 full。already_fixed 的 baseline ancestor 例外见 tdd-and-commit.md。实现阶段应通过的门禁失败或证据无效时，将问题交回主代理。保存各次实跑的原始输出、精确命令和退出码。
4. 为相邻路径生成至少两个用例（正常和边界），写入 tests/review/verifications/r{round}_f{num}_{slug}_adjacent{suffix}，供轮末和终审前批测。无法生成时说明原因。
5. 在 finding 目录写 verification-result.md，包含 Final Verdict、修复前后结果、风险判断及 Reviewctl Verification Evidence JSON；精确字段见 evidence-structure.md。impacted 须说明传递反向依赖闭包，独立 full 须填写 full_test_suite 和实际 tested_commit。单次 full 使用独立日志，以便轮末核对同一次运行。
~~~

返回简短 YAML。详细命令、计数和哈希保存在上述报告。

~~~yaml
finding_id: "[标准 ID]"
verdict: "pass | fail | inconclusive"
risk_assessment: "normal | high"
regression_scope: "impacted | full"
adjacent_tests: []
adjacent_reason: ""
verification_evidence_path: "[报告路径]"
blockers: []
~~~

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
长时测试 full 约定：[仅提供稳定测试 ID、原始时间/数据规模、关键资源条件和 full 日志必须输出的 runtime 标记；不得提供历史 finding]
第一阶段可用 focused/impacted 探索；完整 full 测试在第二阶段运行，第一阶段结果不能替代第二阶段 full。
不要读取 .review-evidence/ 中任何已有内容（包括 baseline.md）、历史 finding、修复清单或以前的裁决；不要编辑项目文件或提交。

## 任务
1. 独立检查当前 HEAD 是否满足 MVP 承诺
2. 寻找新的缺陷、遗漏的边界情况、回归问题
3. 不要假设之前的评审已覆盖所有问题
4. 不要重复提交已在 .review-evidence/ 中存在的 finding（你不知道它们）

## 文件组织
- 临时测试文件：tests/review/candidates/r{round}_finalaudit_fa{n}{suffix}（如 r1_finalaudit_fa001.test.js 或 r1_finalaudit_fa-001.test.js）
- 证据文档：.review-evidence/round-[N]/final-audit/attempt-[K]/inbox/[临时_id]/counterexample.md
- 完整命令输出：.review-evidence/round-[N]/final-audit/attempt-[K]/inbox/[临时_id]/output.log
- 盲扫摘要：.review-evidence/round-[N]/final-audit/attempt-[K]/blind-scan.md

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架和依赖
- 若需要隔离数据，放在：.review-evidence/round-[N]/_testdata/final-audit/attempt-[K]/
- **测试输出先落盘**：运行测试/构建命令前，把完整输出重定向到 .review-evidence/round-[N]/final-audit/attempt-[K]/inbox/[临时_id]/output.log 并记录退出码（POSIX：`{ <command>; echo "EXIT_CODE=$?"; } > <output.log> 2>&1`；PowerShell：`<command> *> <output.log>; Add-Content <output.log> "EXIT_CODE=$LASTEXITCODE"`）。输出被截断时读取该日志（`tail`/`grep` 或 `Get-Content -Tail`/`Select-String`），不要重复运行；多个命令可用 `output-<step>.log`
- **技能脚本（如需）**：`node "[skill-dir]/scripts/reviewctl.js"`；`[skill-dir]` 由主代理替换为当前 harness 的实际绝对路径，只读使用，不要修改状态或推进阶段
- **编译缓存复用（按磁盘预算）**：在 baseline 记录的磁盘预算内复用预热缓存（Rust 如 `CARGO_TARGET_DIR`）；不要为每个 finding 新建 target/依赖目录。缓存超预算时按主代理指示在轮次边界集中清理（如 `cargo clean`），不要每个 finding 都清理重建
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
    reproduction_file: "tests/review/candidates/r{round}_finalaudit_fa001{suffix} | manual-steps.md | none"
    reproduction_command: "<command | manual | not_run>"
    reproduction_exit_status: "<exit code | manual | not_run>"
    reproduction_status: "observed | not_observed | blocked | not_run"
blockers: []
uncovered_paths: []
~~~

若没有发现新问题，返回 `review_status: complete`、`findings: []`。
主代理记录终审 finding 时使用 `record-finding --source final-audit --audit-attempt K --original-id FA-XXX`；记录审计结果时使用 `record-audit --auditor NAME`。
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
5. 独立运行一次完整测试套件，原始日志单独写入本 attempt 的 `output-full-suite.log`，记录唯一的 `COMMAND=<完整命令>` 和 `EXIT_CODE=<实际退出码>`；运行适用的静态检查。提交前声明的代码质量命令必须在最终 HEAD 上运行并记录日志。Rust 至少执行 `cargo fmt --all -- --check` 与 `cargo clippy --workspace --all-targets --all-features -- -D warnings`，其它语言执行 baseline 中声明的 formatter/linter/type-check 命令。有长测时必须按提供的原始尺度运行，并在完整日志中记录 `RUNTIME_PROFILE=original`、`LONG_RUNNING_TESTS=<ID,...>`、`FULL_RUNTIME_SCALE=<baseline 原始尺度>`

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架和依赖
- 若需要隔离数据，放在：.review-evidence/round-[N]/_testdata/final-audit/attempt-[K]/
- **测试输出先落盘**：运行测试/构建/静态检查命令前，把完整输出重定向到 .review-evidence/round-[N]/final-audit/attempt-[K]/output.log 并记录退出码（POSIX：`{ <command>; echo "EXIT_CODE=$?"; } > <output.log> 2>&1`；PowerShell：`<command> *> <output.log>; Add-Content <output.log> "EXIT_CODE=$LASTEXITCODE"`）。输出被截断时读取该日志（`tail`/`grep` 或 `Get-Content -Tail`/`Select-String`），不要重复运行；多个命令可用 `output-<step>.log`
- **技能脚本（如需）**：`node "[skill-dir]/scripts/reviewctl.js"`；`[skill-dir]` 由主代理替换为当前 harness 的实际绝对路径，只读使用，不要修改状态或推进阶段
- **编译缓存复用（按磁盘预算）**：在 baseline 记录的磁盘预算内复用预热缓存（Rust 如 `CARGO_TARGET_DIR`）；不要为每个 finding 新建 target/依赖目录。缓存超预算时按主代理指示在轮次边界集中清理（如 `cargo clean`），不要每个 finding 都清理重建
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

## Reviewctl Audit Evidence
在此放一个 JSON 代码块，顶层为 full_suite。字段与轮末 full 一致，包含实测 tested_commit，log 指向本 attempt 的 output-full-suite.log（见 evidence-structure.md）。

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
- `[role-slug]`（inbox 目录）: security、functionality、reliability、api、performance、accessibility、operations、product；`final-audit` 是保留的审计专用值，不是普通 review 角色目录
- `[role-token]`（测试文件名）: sec、func、rel、api、perf、ux、ops、prod（终审用 finalaudit）
- `[round number]`: 当前轮次（1 至 max_rounds，默认 1-5）
- `[标准 finding ID]`: R1-F001-SEC 格式
- `[临时_id]`: SEC-001 格式（role-local）；终审用 FA-001
- `[skill-dir]`: 当前技能安装目录的绝对路径（按当前 harness 动态解析，不能写死；路径含空格时给命令加引号）。委派时同时提供 `node "[skill-dir]/scripts/reviewctl.js"` 的可执行形式；子代理只读使用，不得修改状态或推进阶段

`[skill-dir]` 必须每次委派时动态解析：使用当前 harness 加载本技能时返回的目录（或 `scripts/reviewctl.js` 的实际所在目录）；无法确定时先询问用户，不要猜测路径。不要把本文件示例中的路径或主代理本机路径写进模板。

### 交接与日志

按角色模板返回简短摘要，完整报告写入指定目录。每次实跑先把命令、原始输出和退出码保存到对应日志。对话输出截断时读取日志。阻塞时具体记录受影响的检查和原因，继续能独立完成的检查。委派时机与身份独立性见 `SKILL.md` §2–§3。
