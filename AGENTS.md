# Main Agent Recovery Guide - MVP Adversarial Review Loop

**这是一个多轮循环流程，最少 2 轮常规评审，最多 5 轮，然后进行最终审计。**

## 压缩上下文后立即做的 3 件事

### 1. 读取 `.review-evidence/run-state.md`

获取当前状态：
- `current_phase`: 当前在哪个阶段
- `current_round`: 当前是第几轮（1-5）
- `next_action`: 下一步应该做什么（包括需要委派的子代理类型）

### 2. 确认你在循环中的位置

- **不要在第 1 轮后就结束**：至少需要 2 轮常规评审
- **检查是否该进入最终审计**：参考 run-state.md 中的 Workflow Reminder
- **检查当前轮是否完成**：所有 accepted findings 是否都已验证

### 3. 确认是否需要委派子代理

以下任务**必须委派给子代理**，不能自己做：
- **review**: 评审角色（至少 3 个）
- **adjudication 中的复现审查和挑战**
- **repair**: 实现代理（修复 finding）
- **verification**: 验证代理（不能是实现代理）
- **final_audit**: 最终审计代理（未参与前序评审或实现）

**唯一例外**：当所有可用独立代理都已提交过相关候选时，主代理可以亲自复现，但必须在 adjudication.md 中明确记录并标注为高风险项。

## 常见压缩后错误

| 错误 | 症状 | 正确做法 |
|------|------|---------|
| 第 1 轮后就结束 | 完成 Round 1 后直接生成最终报告 | 检查 `current_round`，至少需要 2 轮 |
| 自己做评审 | 主代理自己读代码、写 counterexample | 委派至少 3 个评审子代理 |
| 修复后不验证 | 实现完成后直接进入下一个 finding | 每个修复后必须委派独立验证代理 |
| 跳过 adjudication | 评审完成后直接进入 repair 或 round_decision | 必须先进行复现审查和裁决 |
| 忘记更新状态 | 完成阶段后没有更新 run-state.md | 每个阶段完成后立即更新 |

## 阶段流转简图

```
baseline → review (委派) → adjudication (复现审查+裁决)
  ↓
  ├─ 有 accepted → repair (委派) → verification (委派) → round_decision
  └─ 无 accepted → round_decision
  ↓
round_decision (检查收敛条件)
  ↓
  ├─ 满足进入最终审计 → final_audit (委派)
  └─ 不满足且 < 5 轮 → review (下一轮)
  ↓
final_audit
  ↓
  ├─ 发现新问题 → 裁决修复验证 → 重新 final_audit (最多 3 次)
  └─ 无新问题 → report (结束)
```

## 进入最终审计的条件（满足任一）

1. **提前收敛**（第 2 轮后）：连续 1、2 轮无新 accepted P0/P1，且第 2 轮也无新 accepted P2
2. **正常完成**（第 3-5 轮后）：本轮无新 accepted P0/P1
3. **达到上限**（第 5 轮后）：无论如何都必须进入最终审计

**注意**：
- 未解决的验证阻塞（inconclusive）会阻止进入最终审计
- 检查 run-state.md 中的 `rounds_consumed` 和 `can_trigger_new_round` 字段
- P2 needs-evidence 根据 `needs_evidence_clarity` 字段判断是否阻止收敛（详见 review-protocol.md）

## 收敛条件（全部满足才是 CONVERGED）

- 所有 accepted 且范围内的 P0/P1 已修复且验证通过
- 所有 accepted finding（所有优先级）已 verified 或 blocked_by_user_changes（后者在最终报告中单独披露）
- 反例覆盖率 ≥80%（verified findings 的 reproduction 占 accepted findings 的比例）
- 最终审计两阶段完成且无新 accepted findings
- P2 needs-evidence 中，所有 `needs_evidence_clarity: unclear_claim` 的必须解决；`clear_claim_lacking_env` 的可作为残余风险

## 详细文档

- **流程和阶段详情**：`SKILL.md`
- **评审协议和交接格式**：`references/review-protocol.md`
- **TDD 与提交规范**：`references/tdd-and-commit.md`
- **证据结构和模板**：`references/evidence-structure.md`
- **子代理提示模板与输出格式**：`references/agent-prompts.md`
- **当前运行状态**：`.review-evidence/run-state.md`

## 记住

**压缩后立即读取 run-state.md，确认当前位置，不要在第 1 轮后就结束，不要跳过阶段，不要自己做评审/修复/验证。**
