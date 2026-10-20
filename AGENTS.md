# Main Agent Recovery Guide - MVP Adversarial Review Loop

**本文件是压缩上下文恢复指南。控制面见 `<skill-dir>/SKILL.md`，阶段操作见 `<skill-dir>/references/phase-playbooks.md`。`<skill-dir>` 指本技能目录的实际安装路径（Claude Code 通常在 `~/.claude/skills/...`，OpenCode 通常在 `~/.config/opencode/skills/...`）。本技能要求 Node.js（>= 18）和 Git；缺少任一依赖时停止并报告阻塞。**

**这是多轮循环：最少 2 轮常规评审，最多 max_rounds 轮（默认 5，与用户在 baseline 确认并记入 state.json），然后进行最终审计。**

## 压缩上下文后立即做的 3 件事

### 1. 读取并校验 `.review-evidence/state.json`

`state.json` 和 `findings.json` 是事实来源；`run-state.md` / `findings-index.md` 是生成视图。

获取当前状态：

- `current_phase`：当前阶段
- `current_round` / `max_rounds`：当前轮次 / 常规评审轮上限
- `rounds_consumed` / `can_trigger_new_round`：已完成轮数 / 是否还能开新常规轮
- `final_audit_attempt`：最终审计尝试次数（最多 3）
- `active_finding`：当前正在修复/验证的 finding
- `next_action`：下一步动作及需要委派的子代理类型

校验命令：

```bash
node <skill-dir>/scripts/reviewctl.js status
node <skill-dir>/scripts/reviewctl.js validate
```

校验失败先运行 `node <skill-dir>/scripts/reviewctl.js normalize` 重算派生字段，仍失败再按错误逐项修复，不要继续委派。没有 Node.js 时无法推进状态机；停止并报告阻塞，不要手改 `state.json`。

### 2. 确认你在循环中的位置

- **不要在第 1 轮后就结束**：至少需要 2 轮常规评审。
- **检查当前轮是否完成**：所有 accepted findings 是否已终结（verified / blocked_by_user_changes / 已登记未解决）。
- **检查是否该进入最终审计**：按 SKILL.md 的轮次策略和收敛判定。
- 未解决的验证阻塞（inconclusive，不含 blocked_by_user_changes）不阻止终审执行，但结论只能为 INCOMPLETE。

### 3. 确认是否需要委派子代理

以下任务**必须委派**，不能自己做（下表“先读”路径相对 `<skill-dir>/references/`）：

| 阶段 | 必须委派 | 先读 |
|------|----------|------|
| review | 至少 3 个独立评审代理；用 `reviewctl new-inbox` 建路径 | `phase-playbooks.md` §1 |
| adjudication | 独立复现审查代理（写 `replay-review.md`）；所有 accepted P0/P1 的挑战代理；必要时补强代理 | `phase-playbooks.md` §2 |
| repair | 实现代理（一个 finding 一个代理） | `phase-playbooks.md` §3 + `tdd-and-commit.md` |
| verification | 验证代理（不能是实现者） | `phase-playbooks.md` §4 |
| final_audit | 未参与本流程任何阶段的新审计代理 | `phase-playbooks.md` §6 |

**唯一例外**：没有未参与该 finding 的独立代理可用（所有可用代理都提交过相关候选，或没有代理可用）时，主代理经用户明确授权后才能亲自复现或验证；必须在 `adjudication.md` 标为高风险，并在最终报告单独披露。

## 常见压缩后错误

| 错误 | 症状 | 正确做法 |
|------|------|---------|
| 第 1 轮后就结束 | 完成 Round 1 后直接生成最终报告 | 检查 `current_round`，至少需要 2 轮 |
| 自己做评审 | 主代理自己读代码、写 counterexample | 委派至少 3 个评审子代理 |
| 修复后不验证 | 实现完成后直接进入下一个 finding | 每个修复后必须委派独立验证代理 |
| 跳过 adjudication | 评审完成后直接进入 repair 或 round_decision | 先筛查、去重、独立复现、必要挑战 |
| 忘记更新状态 | 完成阶段后没有更新状态 | 用 `reviewctl advance` / `record-*` |
| 手改生成文件 | 直接编辑 run-state.md 或 findings-index.md | 运行 `reviewctl render` |
| 校验失败就手改 JSON | 直接编辑 `state.json` | 先运行 `reviewctl normalize`，仍失败再按错误修复 |
| `blocked` 当 `rejected` | 复现环境不可用却直接拒绝 | 保留 `needs-evidence` |
| 手工 finding 被测试卡住 | `record-implementation` 报缺少 `--test` | 用 `--manual` 并记录独立人工复测 |
| 到 max_rounds 仍开新轮 | 终审发现新问题后启动第 max_rounds+1 轮 | 报告 INCOMPLETE |

## 阶段流转简图

```text
baseline → review (委派) → adjudication (复现审查+裁决)
  ↓
  ├─ 有 accepted → repair (委派) → verification (委派) → round_decision
  │                └─ cannot_fix/blocked → 登记未解决，或 adjudication 重新裁决
  └─ 无 accepted → round_decision
  ↓
round_decision (检查提前收敛/轮次上限)
  ↓
  ├─ 进入最终审计 → final_audit (新代理，两阶段)
  ├─ 终审新问题且无预算 → report (INCOMPLETE)
  └─ 未满足且未达上限 → review (下一轮)
  ↓
final_audit
  ↓
  ├─ 新问题 → 裁决修复验证 → 有预算则新常规轮 → 重新终审 (最多 3 次)
  └─ 无新问题 → report
```

## 进入最终审计与收敛判定

- **进入条件、轮次上限与扫描范围**：见 `<skill-dir>/SKILL.md` 的“轮次策略”。
- **收敛条件**：见 `<skill-dir>/SKILL.md` 的“收敛判定”。
- **关键检查点**：
  - `round_decision` 阶段应有 `rounds_consumed = current_round`；在 review/adjudication/repair/verification 中通常是 `rounds_consumed = current_round - 1`，不要把后者当成状态损坏。
  - `can_trigger_new_round = (rounds_consumed < max_rounds)`。
  - 提前收敛要求最近连续两轮都没有新找到的范围内 P0/P1/P2。
  - 达到 max_rounds 后终审发现新的 accepted：不再开常规轮，报告 INCOMPLETE；仅被 rejected 的盲扫重复项不阻止收敛。

## 详细文档

- **控制面、阶段状态机、轮次策略、收敛判定**：`<skill-dir>/SKILL.md`
- **状态操作、校验、提交守卫**：`<skill-dir>/scripts/reviewctl.js`
- **阶段操作细节**：`<skill-dir>/references/phase-playbooks.md`
- **TDD 与提交规范**：`<skill-dir>/references/tdd-and-commit.md`
- **证据结构和 run-state 模板**：`<skill-dir>/references/evidence-structure.md`
- **子代理提示模板与输出格式**：`<skill-dir>/references/agent-prompts.md`
- **证据归档**：`<skill-dir>/references/archival.md`（可选，仅在评审完成后）
- **当前运行状态**：`.review-evidence/state.json`（人读视图：`.review-evidence/run-state.md`）

## 记住

**压缩后先读并校验 state.json / run-state.md；不要在第 1 轮后就结束；不要跳过阶段；不要自己做评审/修复/验证。**
