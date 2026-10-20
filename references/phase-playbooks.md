# 阶段操作手册

本文件是 `SKILL.md` 的阶段展开。进入某个阶段前，只读取对应章节；规则冲突时，以 `SKILL.md` 的硬门禁和收敛判定为准。

## 0. baseline

**主代理执行**，不委派评审。

1. 确认 MVP 范围、明确排除项、验收标准及来源、技术栈、入口和关键数据流、外部服务与认证边界、部署方式。
2. 记录仓库路径、分支、`baseline_head`、初始 `git status`、已有用户改动。
3. 确认测试/构建/类型检查/lint/安全扫描命令，并运行基线；完整日志路径写入 `baseline.md`。
4. 与用户确认 `max_rounds`：默认 5，用户可指定，最小 2；小于 2 时按 2 处理并记录。
5. 创建 `.review-evidence/`，初始化 `baseline.md`、`run-state.md`、`findings-index.md`、`screening-log.md`。
6. 确保项目测试配置忽略 `tests/review/`（或使用 `ADVERSARIAL_REVIEW` 等开关），把方式和结束时如何还原写入 `baseline.md`；无法确保时记录阻塞。
7. 部署恢复指南（幂等，可重复运行）：
   - 目标是项目根目录的 `AGENTS.md`；若项目以 `CLAUDE.md` 为项目级指令文件（存在 `CLAUDE.md` 且无 `AGENTS.md`），以 `CLAUDE.md` 为目标。
   - 目标文件已含标记 `mvp-adversarial-review-loop-recovery-guide` 或标题 `Main Agent Recovery Guide - MVP Adversarial Review Loop` 时跳过。
   - 目标文件不存在：复制技能目录的 `AGENTS.md`，并在前后加 `<!-- BEGIN mvp-adversarial-review-loop-recovery-guide -->` / `<!-- END mvp-adversarial-review-loop-recovery-guide -->`。
   - 目标文件已存在：先把原内容备份到 `.review-evidence/baseline-project-instructions.bak`，再把带标记的恢复指南追加到末尾。
   - 把目标文件、模式（created / appended / skipped）、标记和备份路径写入 `baseline.md` 的 "Recovery Guide Deployment"。
8. 更新 `run-state.md`：`overall_status: in_progress`、`current_phase: review`、`current_round: 1`、`max_rounds`、`rounds_consumed: 0`、`can_trigger_new_round: true`、`final_audit_attempt: 0`、`baseline_head`、`current_head`、`last_completed_event: "baseline complete"`、`active_finding: none`、`next_action: "启动第 1 轮评审角色"`、`blockers: none`、`updated_at`（ISO 8601）。

启动部署对项目级指令文件的改动属于本流程引入的临时改动，不提交，结束时还原。

## 1. review

**必须委派**：每个角色一个独立、只读的评审子代理。

- 每轮至少 3 个不同角色，最多 6 个；角色表见 `SKILL.md`。
- 默认串行；每个角色使用独立 inbox 目录。临时 ID 只需在角色目录内唯一，例如 SEC-001、FUNC-001。
- 评审代理不得修改源代码、测试、配置，不得安装依赖或提交；不得查看其他角色的 findings，也不要把个人偏好当缺陷。
- 临时测试写入 `tests/review/candidates/r{round}_{role}_{temp_id}.test.{ext}`；若发现临时测试会被日常测试收集，停止并报告阻塞，不要自行修改项目配置。
- 从项目根目录运行，使用项目自身的测试框架和依赖；需要隔离数据时放在 `.review-evidence/round-[N]/_testdata/[role-slug]/`。
- 证据写入 `.review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/`，完整命令输出写 `output.log`，不要粘贴到回复。
- 使用 `agent-prompts.md` 的"评审代理"模板；回复必须是固定 YAML 摘要。
- 轮次策略、最后两轮回归检查和角色选择见 `SKILL.md` 的轮次策略表。
- 被判定为回归检查的轮次只提供待检查的修复提交/变更路径，不提供历史 finding、裁决或预期结论。
- 要求代理记录 `uncovered_paths` 和 `blockers`；没有发现时返回 `findings: []`，不要用偏好凑数。

**完成后**：`current_phase: adjudication`，`next_action: "筛选、去重并裁决候选 findings"`。

## 2. adjudication

**主代理执行筛查和裁决，但复现、挑战、补强必须委派。**

### 2.1 筛查与去重

1. 把纯偏好、措辞建议、明确不在 MVP 范围内的功能请求筛到 `screening-log.md`，写明依据；不分配标准 ID，不进入覆盖率分母，也无需运行反例。
2. 对其余候选去重；重复项指向 canonical ID，保留原始 inbox。
3. 进入生命周期的候选分配标准 ID（`R[N]-F[XXX]-[CAT]`），把 inbox 移到 `.review-evidence/round-[N]/[标准 ID]/`，并把候选复现文件复制为 `reproduce.*`；`tests/review/` 中的原文件保留运行用。
4. 标准 ID 一旦分配，永久计入覆盖率分母，即使后来 rejected 或 deferred。

筛查决策流程：

```text
候选 finding
  ↓
[1] 仅为偏好或措辞建议？(kind: preference)
  ├─ 是 → screened_out_preference（不分配标准 ID）
  └─ 否 → [2]
  ↓
[2] 仅要求新增明确不在 MVP 承诺内的功能？
  ├─ 是 → screened_out_scope（不分配标准 ID）
  └─ 否 → [3]
  ↓
[3] 针对当前已存在的行为？
  ├─ 否 → screened_out_scope（功能不存在）
  └─ 是 → [4]
  ↓
[4] 当前行为是否可能影响已承诺边界、数据、权限或用户？
  ├─ 否 → screened_out_scope（无实际影响）
  └─ 是 → [5]
  ↓
[5] 期望行为有验收标准/契约支持？
  ├─ 无依据 → 是否指出当前行为的具体损害？
  │   ├─ 否 → screened_out_contract（仅为无依据的偏好）
  │   └─ 是 → [6]
  └─ 有依据 → [6]
  ↓
[6] 前提可能成立且证据可验证？
  ├─ 前提不成立 → needs-evidence（补前提）
  ├─ 证据不可验证 → needs-evidence（补证据）
  └─ 可验证 → 进入复现阶段
```

关键边界：

- 纯偏好/措辞：`screened_out_preference`；汇总后在收敛或轮次上限时交给用户。
- 仅要求未承诺功能：`screened_out_scope`。示例："应该支持 OAuth2 登录"（MVP 只承诺密码登录）。
- 针对现有行为但仅在承诺范围外触发、且不影响已承诺边界/数据/权限/用户：`screened_out_scope`。示例："XML 导出未转义"（MVP 只承诺 JSON）。
- 无契约但指出具体损害：不得直接筛除。示例："删除无确认提示，可能误删"。
- 当前行为即使触发场景不在 MVP 内，只要违反安全、数据完整性、隐私等隐含契约，也不得筛除。

### 2.2 严重性

| 级别 | 判定 |
|------|------|
| P0 | 数据丢失/泄露、认证绕过、权限提升、完全不可用、公开 API 破坏性变更 |
| P1 | 部分功能失效、非完全绕过的安全漏洞、数据不一致、明显性能问题、可访问性阻断 |
| P2 | 边界条件失败、错误消息不清晰、日志缺失、次要功能缺陷 |
| P3 | 优化建议、测试覆盖改进、文档缺失、代码风格 |

### 2.3 独立复现

- 每个可复现 finding 由未提出该候选的独立复现审查员运行；提出者不能自己决定。
- 挑战代理的独立重放可以满足复现要求；原评审员的运行结果只能作线索。
- 一个复现审查代理一次处理 3-5 个 findings，依次执行；默认不并行，除非用户明确授权且有独立 worktree。
- 记录精确命令/操作、环境、退出状态、观察结果和证据路径；主代理必须检查证据与 claim 相符，并在 `adjudication.md` 注明执行者和证据路径。不要求主代理重复每条常规命令，但证据必须与 claim 相符。
- 手工步骤仅在确认无法自动化时使用，并在 `manual-steps.md` 记录无法自动化的原因、前提、精确操作和观察点。
- P0/P1、权限/数据完整性/公开 API、高影响或证据异常项：主代理必须亲自加验或再委派第二个独立审查。
- 没有未参与该 finding 的独立代理可用（所有可用代理都提交过相关候选，或没有代理可用）时，主代理经用户明确授权后才能亲自复现；在 `adjudication.md` 标为高风险，最终报告单独披露。有独立代理可用时不得使用兜底。

复现结果：

| 结果 | 含义 | 后续 |
|------|------|------|
| `reproduced` | 有效前提下观察到 claim 行为 | 由主代理判断是否违反范围/契约 |
| `not-reproduced` | 前提和断言有效、完整运行但明确不符合 claim | 记录反证，可 rejected |
| `blocked` | 环境、依赖、前提、脚本或观察点不完整 | 保留 needs-evidence，不得据此 rejected |

### 2.4 裁决

| Decision | 含义 |
|----------|------|
| `accepted` | 在本轮修复；必须验证，否则阻塞收敛 |
| `deferred` | 推迟修复；不阻塞本轮收敛，但必须记录原因和后续处置，并在最终报告披露 |
| `rejected` | 不修；必须有明确反证 |
| `needs-evidence` | 尚未决定；缺少复现证据或前提不明确 |

- reproduced 且范围/契约相符：accepted。P0/P1 优先；P2 默认本轮 accepted，确因资源限制推迟时必须改为 deferred；P3 一般 deferred。
- reproduced 但范围不符或影响低于声称：修订 severity/claim 后 deferred，或降级后 accepted。
- not-reproduced 且有明确反证：rejected，写明理由和反证路径。
- blocked 或证据不足：needs-evidence，列出所需证据；可派补强代理修正小瑕疵。
- 补强失败不能证明 finding 不存在；不能仅因补强失败而 rejected。
- deferred 必须记录原因（如资源限制、优先级排序、等待外部依赖、需要架构重构）和后续处置建议（如下一轮修复、建议在 vX.Y 修复、等待依赖升级），并在最终报告披露。

### 2.5 挑战（必须挑战范围）

**必须挑战**：拟 accepted 的 P0、涉及安全/权限/数据完整性/公开 API 的 P1，以及复现结果矛盾或不寻常的证据。其余 accepted 按轮次和资源优先挑战最高严重性项。

- 一个挑战代理一次处理 2-4 个 findings，依次执行；默认串行。
- 挑战代理只读，不得修改项目代码、测试或原始 reproduction。
- 结果：
  - `supports`：有效重放且未找到推翻证据；主代理确认后可 accepted。
  - `disputes`：必须附具体反证；主代理审查双方证据后 rejected、降级/修订后 accepted，或争议未解决时 needs-evidence。
  - `inconclusive`：重放失败、环境不可用或观察不确定；不是自动接受，也不是 disputes。主代理基于已有重放证据裁决；证据仍不足则 needs-evidence。
- 确因资源限制无法挑战必须范围项时，必须获得用户明确授权，在 `adjudication.md` 记录，并在最终报告列出。

### 2.6 补强

仅在反例思路合理但有小的执行瑕疵时使用。

- 一个补强代理一次处理 2-3 个 findings，依次执行；默认串行。
- 只修改标准 ID 目录内的 reproduction 或 `counterexample.md`，不改项目文件。
- 结果：`fixed` 后主代理重新检查并重放；补强成功本身不等于 finding 成立。`cannot-fix` 保留 needs-evidence；不能仅因补强失败而 rejected。若补强结果证明原假设错误，主代理可基于该证据裁决 rejected。

### 2.7 临时测试文件

所有 decision 确定后，主代理批量处理：

- accepted：移到 `tests/review/reproductions/`。
- rejected / needs-evidence / deferred：删除临时测试文件。

**完成后**：有 accepted → `current_phase: repair`，`next_action: "修复第一个 accepted finding: [ID]"`；无 accepted → `current_phase: round_decision`。

## 3. repair

**必须委派实现代理**，一次一个 accepted finding，按 `tdd-and-commit.md` 执行 RED-GREEN-REFACTOR 并提交。

- 实现代理只处理当前 finding；RED 必须先确认，测试必须合并到项目正式测试文件。
- 提交只包含当前 finding 的源代码、正式测试和必要配置；不包含 `.review-evidence/` 或 `tests/review/` 临时文件。
- `already_fixed`：确认现有提交覆盖后进入验证。
- `cannot_fix`：主代理重新裁决（deferred/rejected，或保留 accepted 并登记未解决），更新 `findings-index.md` 和 `run-state.md`，不得静默跳过。
- `blocked_by_user_changes`：按 `tdd-and-commit.md` 处理，提供手工合并建议；可能导致 `CONVERGED_WITH_MANUAL_MERGE`。

**完成后**：`current_phase: verification`，`active_finding: [ID]`。

## 4. verification

**必须委派验证代理**，且不能是实现该 finding 的代理。

- 一个验证代理一次处理 3-5 个已修复 findings，依次验证；默认串行。
- 使用 `agent-prompts.md` 的验证代理模板，并按其 YAML 结构回收摘要；提供原始 counterexample、reproduction、修复 commit、当前 HEAD、正式测试路径和运行入口。
- 检查 RED 证据、在修复前 commit 重放原始反例（默认独立 worktree；兜底 stash + checkout 必须经主代理批准）、在修复后验证、生成至少 2 个相邻测试（正常 + 边界）、运行完整回归。不得把实现代理的结论当作验证结果。
- 验证代理不得强制清理或以任何方式覆盖用户改动；兜底流程必须记录原 HEAD 并验证恢复结果。
- 无法生成有意义的相邻测试时，必须说明理由才能 pass。
- 若所有可用代理都已参与该 finding 的实现，先获得用户明确授权后由主代理执行验证；在 `verification-result.md` 标注 `verified_by: main-agent`，在 `adjudication.md` 标为高风险，并在最终报告列明。
- 验证开始前对照 `baseline_head` 运行 `git status --short`；发现与被验 finding 相关的新外部改动时，记为 `inconclusive`，在 `blockers` 说明并列出冲突文件。不要使用 `blocked_by_user_changes`（该状态只用于 repair 无法提交）。
- 结果：
  - `pass`：完成所有检查，主代理确认证据后 finding 可标 verified。
  - `fail`：保持未 verified，回到 repair；同一 finding 最多 2 次修复-验证循环，第 2 次仍 fail 时创建更高优先级回归 finding 并登记原 finding 未解决。
  - `inconclusive`：保持 accepted 但未 verified；最多重新委派 1 次，仍无法判定则登记未解决并继续其他项；不得当作 pass 或 CONVERGED 依据。

**完成后**：更新 `findings-index.md` 的 verification 状态；处理下一个 finding，或在本轮所有 accepted findings 终结后进入 `round_decision`。

## 5. round_decision

### 5.1 轮次完成

轮次开始：`current_round = N`、`current_phase = review`。修复验证期间 `current_round` 不变。所有 accepted findings 终结（verified / blocked_by_user_changes / 已登记未解决）后，`current_phase = round_decision`。

### 5.2 决策

1. 确认本轮所有 accepted findings 已终结。
2. 设置 `rounds_consumed = current_round`，重算 `can_trigger_new_round = (rounds_consumed < max_rounds)`。
3. 检查进入最终审计的条件：
   - 提前收敛：从第 2 轮起，最近连续两轮都没有新找到的、范围内的 P0/P1/P2。
   - 达到上限：完成 `max_rounds` 轮。
4. 分支：
   - 不满足且 `can_trigger_new_round = true`：进入下一轮常规评审（`current_round` 递增 1，`current_phase: review`）。
   - 满足：进入 `final_audit`。首次进入设 `final_audit_attempt: 1`；终审发现新问题并完成新的常规评审轮后重新进入时递增，最多 3 次。
5. 未解决的验证阻塞（inconclusive，不含 blocked_by_user_changes）不阻止最终审计执行，但使最终结论只能为 INCOMPLETE。

提前收敛判定口径：被筛除或去重的候选、最终 rejected 的 finding 不算；P3 不算。

### 5.3 轮次上限与扫描范围

- 最多 `max_rounds` 轮常规评审，每轮最多 6 个角色。
- 轮次范围、角色选择和冲突优先级以 `SKILL.md` 的轮次策略表为准。
- 上述扫描限制不取消此前已 accepted finding 的修复，也不屏蔽终审发现的问题；后者仍须进入普通裁决和修复流程。
- 终审触发的新轮次不受"倒数第 N 轮"限制，按问题性质决定扫描范围，但仍计入 `max_rounds`。
- 已证实的 deferred 风险应披露，但不阻止收敛；达到上限仍有未解决范围内 P0/P1、未解决 inconclusive 或覆盖率不足时，标记 INCOMPLETE。不要为了达到轮数而继续提交低优先级改动。

### 5.4 反例覆盖率

- 分母：所有获得标准 ID 的独立 finding（screened_out 和 duplicate 不算）。
- 分子：accepted（必须有 reproduced 证据）、rejected（必须有 not-reproduced 反证）、deferred（已复现）算分子；needs-evidence 缺少证据不算。
- 每轮分别报告 raw_candidates、duplicates、screened_out 和 replay-eligible 独立 finding 数；被筛除/重复项不进入分母，但必须单独计数并写入 `screening-log.md`。
- 进入 finding 生命周期的候选（包括 needs-evidence 及之后 rejected/deferred 的）必须获得标准 ID 和 `findings-index.md` 索引行。
- 原始覆盖率 = 分子 / 分母；自动化与手工复现分别报告；分母为 0 时报告 N/A，不视为自动通过，并确认每个原始候选都已处理且要求的评审与终审已完成。
- 调整后覆盖率 = 分子 / (分母 - 豁免项)；豁免项为 `clear_claim_lacking_env` 的 P2/P3 needs-evidence。
- 调整后覆盖率低于 80% 时不得声称评审充分或收敛。
- decision 或分类变更不得用于缩小分母。

### 5.5 回归与 needs-evidence

- 每条新 finding 在 `adjudication.md` 标记 `change_origin: regression | pre-existing | undetermined`。只有证据表明由本轮修复引入时才标 regression；无法确定时保持 undetermined 并将 decision 设为 needs-evidence。回归 finding 按实际影响评估严重性，不自动升一级。
- needs-evidence：
  - P0/P1 必须解决（升级 accepted 并验证，或有反证后 rejected），否则阻止收敛。
  - P2 必须标记 `needs_evidence_clarity`：`clear_claim_lacking_env` 可作为残余风险；`unclear_claim` 阻止收敛。
  - P3 可作为残余风险披露，不阻止收敛。

### 5.6 轮次证据

每轮 accepted findings 验证完成后，可把 `.review-evidence/` 变更作为独立提交（如 `chore(review): round-[N] evidence`），不夹带产品代码或测试；用户不希望提交或无法安全区分时跳过并记录。

## 6. final_audit

**必须使用未参与本流程任何阶段的新代理**，并记录其身份。同一代理分两阶段；第一阶段结果保存后，主代理才发送第二阶段材料。每次审计使用新目录 `.review-evidence/round-[N]/final-audit/attempt-[K]/`，不得覆盖旧结果。

### 6.1 第一阶段：盲扫

- 主代理从 `baseline.md` 提取 MVP 范围、验收标准、当前 HEAD、测试/构建命令，直接写在提示中。
- 不提供 finding、adjudication、历史评审结论或修复清单。
- 审计代理不得读取 `.review-evidence/` 中任何历史内容；完整候选证据写入 `inbox/`，摘要只在 `blind-scan.md` 记录一次。
- 使用 `agent-prompts.md` 的最终审计第一阶段模板；没有发现时返回 `findings: []`。

### 6.2 第二阶段：定向复核

- 第一阶段保存后，提供所有 accepted finding、未结的范围内 needs-evidence P0/P1、原始证据路径、修复测试路径和提交。
- 要求逐项复核修复有效性、回归、测试覆盖、遗留风险，并运行完整测试、构建和适用静态检查。
- 结果写入 `targeted-review.md`；不得改写第一阶段结论。

### 6.3 发现新问题

1. 回到裁决流程（更新 `current_phase: adjudication`）；accepted 的问题修复并由验证代理验证。
2. 若 `rounds_consumed < max_rounds`：必须启动新的常规评审轮（`current_round` 递增 1，`current_phase: review`），按问题性质选择策略：
   - 新 P0/P1 或多个高风险区域问题 → 常规广扫（覆盖受影响区域）。
   - 仅回归或单个修复引入的问题 → 回归检查。
   - 不受"倒数第 N 轮"规则限制，但计入 `max_rounds`。
   随后重新审计，递增 attempt，最多共 3 次。
3. 若已达 `max_rounds`：不再启动常规评审轮，报告 INCOMPLETE，并标注"已修复验证、但缺少独立互补评审轮复核"的项及未修复项。
4. 第 3 次尝试仍发现需修复的问题：报告 INCOMPLETE；问题仍按裁决 → 修复 → 独立验证流程处理并标注，但不再进行第 4 次审计。

关键规则：所有 finding 必须写在指定证据文件；不得问"是否还有其他问题"或依赖对话记忆；第二阶段只复核，不重复第一阶段已列出的 finding。

## 7. report

### 7.1 收敛判定

按 `SKILL.md` §5 的收敛判定表逐项核对，确定 `CONVERGED`、`CONVERGED_WITH_MANUAL_MERGE` 或 `INCOMPLETE`。

- 范围内 P0/P1 不得停留在 `needs-evidence`：必须升级 accepted 并验证，或有反证后 rejected。
- 覆盖率按 §5.4 计算，并在报告中同时披露原始值、豁免项数量和调整后值。

### 7.2 报告内容

写入 `.review-evidence/final-report.md`，汇总轮次、状态、证据、测试、提交、风险和收敛结论，并把 run-state 的 `overall_status` 设为 `converged`、`converged_with_manual_merge` 或 `incomplete`。

必须包含：

1. 收敛状态与汇总。
2. 覆盖率透明披露：原始覆盖率、豁免项数量、调整后覆盖率。
3. 所有 findings 的最终状态：按优先级和 decision 分组。
4. `CONVERGED_WITH_MANUAL_MERGE` 专用章节（如适用）：blocked findings 列表、每个 finding 的手工合并指南（diff patch、冲突文件、建议步骤）、警告"完成手工合并前不要部署"。
5. 残余风险：`clear_claim_lacking_env` 的 P2/P3 needs-evidence、deferred findings 及后续处置。
6. `screened_out_preference` 建议汇总。
7. 对照基线列出评审期间未纳入本流程的用户改动。

### 7.3 清理

- 删除 `tests/review/` 整个目录；保留已合并到正式测试文件的用例。
- 保留 `.review-evidence/` 作为审计证据。
- 还原 baseline 阶段为隔离临时测试对项目测试配置做的临时改动；只还原自己引入的部分，不触碰用户改动；无法安全还原时记录。
- 按 `baseline.md` 的 "Recovery Guide Deployment" 还原项目级指令文件：
  - appended：删除标记分节，并对照备份确认用户内容未受损。
  - created：文件仍只含本指南时删除整个文件；否则只删除标记分节。
  - 无法安全还原时记录。
- 归档可选，见 `archival.md`；仅在评审循环完成后执行。

## 8. 恢复

压缩上下文后：

1. 立即读取 `.review-evidence/run-state.md`。
2. 运行 `node <skill-dir>/scripts/validate-run-state.js .review-evidence/run-state.md`（无 Node 时人工对照 `evidence-structure.md` 的模板）。
3. 确认 `current_phase`、`current_round`、`max_rounds`、`rounds_consumed`、`can_trigger_new_round`、`final_audit_attempt` 和 `next_action`。
4. 按 `next_action` 继续；不要跳过或重复已完成的阶段。
5. 这是多轮循环：最少 2 轮，最多 `max_rounds` 轮，不要在第 1 轮后就结束。
6. 若项目级指令文件既无恢复指南标记也无恢复指南标题，先按 §0 重新部署。
