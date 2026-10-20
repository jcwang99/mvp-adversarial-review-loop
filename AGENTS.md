# Main Agent Recovery Guide - MVP Adversarial Review Loop

**本文件是压缩上下文恢复指南。完整流程、阶段详情与评审协议见 SKILL.md。**

**这是一个多轮循环流程，最少 2 轮常规评审，最多 max_rounds 轮（默认 5，与用户在 baseline 确认并记入 run-state.md），然后进行最终审计。**

## 压缩上下文后立即做的 3 件事

### 1. 读取 `.review-evidence/run-state.md`

获取当前状态：
- `current_phase`: 当前在哪个阶段
- `current_round`: 当前是第几轮（1 至 max_rounds）
- `max_rounds`: 常规评审轮上限（默认 5，与用户在 baseline 确认并记入 run-state.md）
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
- **final_audit**: 最终审计代理（未参与本流程任何阶段）

**唯一例外**：当所有可用独立代理都已提交过相关候选时，主代理经用户明确授权后可以亲自复现，但必须在 adjudication.md 中明确记录并标注为高风险项，并在最终报告中单独披露。

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
round_decision (检查轮次迭代条件)
  ↓
  ├─ 满足进入最终审计 → final_audit (委派)
  └─ 不满足且未达 max_rounds → review (下一轮)
  ↓
final_audit
  ↓
  ├─ 发现新问题 → 裁决修复验证 → 若未达 max_rounds 须先开新常规评审轮 → 重新 final_audit (最多 3 次)
  └─ 无新问题 → report (结束)
```

## 进入最终审计与收敛判定

- **进入最终审计的条件、轮次上限与优先级**：见 `SKILL.md` 的"轮次迭代与最终审计"章节
- **收敛条件（CONVERGED）**：见 `SKILL.md` 的"收敛判定与最终报告"章节
- **关键检查点**：
  - 未解决的验证阻塞（inconclusive，不包括 blocked_by_user_changes）会使结论只能为 INCOMPLETE（不阻止终审执行）
  - 检查 run-state.md 中的 `rounds_consumed`、`max_rounds` 和 `can_trigger_new_round` 字段

## 详细文档

- **流程、阶段详情与评审协议**：`SKILL.md`
- **TDD 与提交规范**：`references/tdd-and-commit.md`
- **证据结构和模板**：`references/evidence-structure.md`
- **子代理提示模板与输出格式**：`references/agent-prompts.md`
- **证据归档流程**：`references/archival.md`（可选，仅在评审完成后）
- **当前运行状态**：`.review-evidence/run-state.md`

## 记住

**压缩后立即读取 run-state.md，确认当前位置，不要在第 1 轮后就结束，不要跳过阶段，不要自己做评审/修复/验证。**
