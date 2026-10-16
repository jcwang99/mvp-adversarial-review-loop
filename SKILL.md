---
name: mvp-adversarial-review-loop
description: 对已完成的 MVP 执行有证据、可审计的多代理评审与 TDD 修复循环。适用于用户要求检查并修复产品、功能、安全、可靠性、API、性能、可访问性或运维问题的场景；达到流程上限仍未满足收敛条件时，必须报告未完成。
---

# MVP 对抗式评审循环

## ⚠️ 执行检查清单（每次行动前检查）

**压缩上下文后恢复？** → 立即读取 `.review-evidence/run-state.md`，确认 `current_phase`、`current_round`、`next_action`

**当前在哪个阶段？** → 检查 run-state.md 中的 `current_phase`：
- `review` → 必须委派评审子代理（至少 3 个角色）
- `adjudication` → 复现审查、挑战必须委派子代理
- `repair` → 必须委派实现子代理
- `verification` → 必须委派验证子代理
- `round_decision` → 检查轮次迭代条件
- `final_audit` → 必须委派最终审计子代理

**这是多轮循环流程**：最少 2 轮，最多 5 轮常规评审，然后进行最终审计。不要在第 1 轮后就结束！

**每个阶段完成后**：更新 run-state.md 的 `current_phase`、`next_action`、`last_completed_event`

## 目标与资料路由

以可重放证据确认缺陷，以按统一标准的验证确认修复。主代理对 finding 和最终收敛负责；子代理提供独立评审、挑战、实现或验证结果，不替主代理作最终裁决。

- [references/review-protocol.md](references/review-protocol.md)：角色选择、评审输出、finding 裁决、挑战/补强、轮次边界和收敛规则。评审和裁决阶段按需读取。
- [references/evidence-structure.md](references/evidence-structure.md)：证据目录、状态检查点、索引和记录格式。初始化证据目录时读取。
- [references/tdd-and-commit.md](references/tdd-and-commit.md)：实现任务、RED-GREEN-REFACTOR、工作区隔离和提交验收。进入修复阶段时读取。
- [references/agent-prompts.md](references/agent-prompts.md)：子代理提示模板与标准输出格式。委派子代理时按需参考。

不要默认加载所有参考文件；只读取当前阶段需要的资料。详细规则以对应参考文件为准，不在本入口重复定义。

## 关键约束

1. **主代理保留判断权。** 子代理的结论是输入，不是事实。主代理负责范围、契约、状态与收敛裁决；常规复现可委派给独立代理，但主代理必须检查其证据。任何 finding 进入修复前都必须有主代理确认的失败证据。
2. **证据目录是持久事实来源。** 在 .review-evidence/ 中维护 baseline.md、run-state.md 和 findings-index.md。完整 reproduction、命令输出和阶段记录写入相应文件；敏感值先脱敏。对话只保留摘要和路径。
3. **每次交接都要压缩状态。** 子代理返回短摘要、finding ID、文件路径、命令/退出状态摘要和阻塞项，不要在回复中重复完整代码、日志或裁决历史。每个代理返回、finding 状态变化、提交、验证或轮次切换后，更新 run-state.md。下一阶段只读取该检查点和当前工作所需的 finding 文件。
4. **串行控制共享工作区。** 默认一次只运行一个子代理（评审角色串行，同类代理批量处理多个 findings）。每个评审角色使用独立的 inbox 子目录；不得依赖临时 ID 在不同角色之间唯一。未经用户明确授权，不并发评审或进行真实外部写入。
5. **先证明，再修复；提交必须隔离。** 每个 accepted finding 都须先确认失败，再按 TDD 修复、运行回归、检查差异并完成验证。修复提交只包含当前 finding 的实现和测试，不包含 .review-evidence/。不得覆盖基线中的用户改动。
6. **区分失败、未知和阻塞。** 环境不可用或证据不充分时不能标 rejected 或 verified。未完成的核验保持未完成，并记录阻塞原因。
7. **报告真实收敛状态。** 遵循评审协议的轮次上限、覆盖率和收敛条件。没有完成要求的验证时，报告 INCOMPLETE，不以测试绿灯或”未发现问题”代替证据。

## 强制执行规则

**你是主代理，每个阶段必须遵循以下规则。压缩上下文后恢复时，立即读取 `.review-evidence/run-state.md` 确认当前位置。**

1. **这是一个多轮循环流程**，最少 2 轮常规评审，最多 5 轮，然后进行最终审计。不要在第 1 轮后就结束。
2. **每个需要独立评估的任务必须使用子代理**：评审角色、复现审查、挑战、补强、修复实现、修复验证、最终审计都必须委派给子代理。**例外**：当所有可用独立代理都已提交过相关候选时，主代理可以亲自复现，但必须在 adjudication.md 中明确记录并标注为高风险项，并在最终报告中单独披露。
3. **每个阶段完成后，立即更新 run-state.md**，记录 current_phase、current_round、next_action 和 last_completed_event。
4. **每个轮次完成后，必须检查轮次迭代条件**（见下方"轮次迭代与最终审计"），决定是否进入下一轮常规评审或最终审计。
5. **修复实现必须按 TDD 流程**：委派给实现代理，按 tdd-and-commit.md 执行 RED-GREEN-REFACTOR。
6. **修复验证必须委派给独立验证代理**，不能由实现代理自己验证，也不能跳过。

## 工作流

### 0. 建立基线 (Phase: baseline)

**主代理执行**：确认 MVP 范围、验收标准、技术栈、当前 HEAD、工作区改动、测试/构建命令和基线结果。创建 .review-evidence/ 并初始化 baseline.md、run-state.md、findings-index.md。

**完成后**：更新 run-state.md，设置 `current_phase: review`, `current_round: 1`, `next_action: "启动第 1 轮评审角色"`。

### 1. 独立评审 (Phase: review)

**必须使用子代理**：按项目风险选择互补角色（至少 3 个），使用 review-protocol.md 中的提示模板。每个角色是一个独立子代理，只读检查项目文件，将候选 finding 写到自己的 inbox 目录。

**完成后**：更新 run-state.md，设置 `current_phase: adjudication`, `next_action: "筛选、去重并裁决候选 findings"`。

### 2. 主代理裁决 (Phase: adjudication)

**主代理执行但必须委派复现审查**：先筛选偏好和范围外建议到 screening-log.md，再去重并分配标准 ID。**常规复现必须委派给独立子代理**（复现审查代理），主代理检查其返回的证据后裁决。高风险项由主代理亲自加验。P0/P1 及敏感 finding 需要挑战时，**必须委派给挑战代理**。

**临时测试文件移动**：在所有候选的 decision 确定后，主代理批量移动临时测试文件：
- decision 为 accepted：移动到 `tests/review/reproductions/`
- decision 为 rejected/needs-evidence/deferred：删除临时测试文件

**完成后**：
- 若有 accepted findings：更新 run-state.md，设置 `current_phase: repair`, `next_action: "修复第一个 accepted finding: [ID]"`
- 若无 accepted findings：更新 run-state.md，设置 `current_phase: round_decision`, `next_action: "检查轮次迭代条件（本轮无 accepted findings）"`

### 3. TDD 修复与提交 (Phase: repair)

**必须使用子代理**：每次处理一个 accepted finding，**委派给实现代理**按 tdd-and-commit.md 执行 RED-GREEN-REFACTOR、提交。

**完成后**：更新 run-state.md，设置 `current_phase: verification`, `active_finding: [ID]`, `next_action: "验证 finding [ID] 的修复"`。

### 4. 修复验证 (Phase: verification)

**必须使用子代理**：**委派给验证代理**（不能是实现该 finding 的代理）验证修复效果。验证代理检查 RED 证据、运行原始反例、运行回归测试。

**完成后**：
- 更新 finding 状态（verified / fail / inconclusive）到 findings-index.md
- 若还有其他 accepted 未验证的 findings：继续修复下一个
- 若当前轮所有 accepted findings 已验证：检查轮次迭代条件

### 5. 轮次迭代与最终审计 (Phase: round_decision or final_audit)

**轮次迭代决策（主代理执行）**：
- 检查 run-state.md 中的 `rounds_consumed` 和 `can_trigger_new_round` 字段
- 检查是否满足进入最终审计的条件（见下方）
- 若不满足且 `can_trigger_new_round = true`：进入下一轮常规评审，更新 run-state.md，递增 `rounds_consumed`，设置 `current_round: N+1`, `current_phase: review`, `next_action: "启动第 N+1 轮评审角色"`
- 若满足：进入最终审计，更新 run-state.md，设置 `current_phase: final_audit`, `final_audit_attempt: 1/3`, `next_action: "启动最终审计代理（盲扫）"`
- 未解决的验证阻塞（inconclusive，不包括 blocked_by_user_changes）阻止进入最终审计，报告 INCOMPLETE

**进入最终审计的条件**（满足其一即可）：
1. **提前收敛**（仅在第 2 轮后检查）：连续第 1、2 轮本轮评审后均无新 accepted P0/P1，且第 2 轮也无新 accepted P2
2. **正常完成**（第 3-5 轮后）：完成当前轮的所有修复和验证，且本轮评审后无新 accepted P0/P1。第 3 轮起，评审角色仅关注 P0/P1 风险，P2 类 findings 若无安全/数据影响可标记为 screened_out_low_priority
3. **达到轮次上限**（第 5 轮后）：无论是否还有问题，都必须进入最终审计以评估最终状态

**最终审计流程（必须使用子代理）**：
- **委派给最终审计代理**（未参与前序评审或实现的新代理），分两阶段：
  1. 盲扫：不读取已有 findings，独立检查
  2. 定向复核：检查已修复的 findings 是否真的有效
- 若第一阶段发现新问题且 `can_trigger_new_round = true`：回到普通裁决流程（adjudication phase），修复验证后启动新常规评审轮（递增 `rounds_consumed`，计入 5 轮上限），检查回归后重新进行最终审计（递增 `final_audit_attempt`）
- 若第一阶段发现新问题但 `can_trigger_new_round = false`（已达轮次上限）：直接裁决并修复（不启动新评审轮），修复验证后重新进行最终审计（递增 `final_audit_attempt`）
- 最终审计最多 3 次尝试（`final_audit_attempt` 最大值 3）；若第 3 次尝试仍发现新问题，报告 INCOMPLETE

**完成后**：进入收敛判定和最终报告。

### 6. 收敛判定与最终报告 (Phase: report)

**收敛条件**（全部满足才是 CONVERGED）：
- 所有 accepted 且范围内的 P0/P1 已修复且验证通过（rejected/deferred 的不计入）
- 所有 accepted finding（所有优先级）已 verified 或 blocked_by_user_changes（后者在最终报告中单独披露，提供手工合并建议）
- 反例覆盖率（verified findings 的 reproduction 占 accepted findings 的比例）≥80%
- 最终审计两阶段完成且无新 accepted findings
- P2 needs-evidence 中，所有 `needs_evidence_clarity: unclear_claim` 的必须解决；`clear_claim_lacking_env` 的可作为残余风险
- 反例覆盖率（verified findings 的 reproduction 占 accepted findings 的比例）≥80%
- 最终审计两阶段完成且无新 accepted findings

**未满足时报告 INCOMPLETE**，列明残余风险、阻塞原因和未验证项。

**最终报告**：从 screening-log.md、findings-index.md 和 run-state.md 汇总轮次、状态、证据、测试、提交、风险和收敛结论。无论 CONVERGED 或 INCOMPLETE，都附上所有 screened_out_preference 建议的汇总清单供用户决策。

**清理临时文件**：
- 删除 `tests/review/` 整个目录（candidates/、reproductions/、verifications/）
- 保留项目正式测试文件中已合并的测试用例
- 保留 `.review-evidence/` 目录作为审计证据

## 恢复检查点

**压缩上下文后恢复时的强制步骤**：
1. 立即读取 `.review-evidence/run-state.md`
2. 确认 `current_phase`、`current_round`、`active_finding` 和 `next_action`
3. 根据 `next_action` 继续执行，不要跳过或重复已完成的阶段
4. 若 `current_round < 5` 且不满足提前收敛条件，必须继续下一轮常规评审
