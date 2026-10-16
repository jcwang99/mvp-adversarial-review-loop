# Main Agent Instructions for MVP Adversarial Review Loop

**如果你是主代理，正在执行 MVP 对抗式评审循环流程，尤其是在压缩上下文后恢复时，请务必立即阅读本文件。**

## 重要：这是一个多轮循环流程

这是一个**结构化、多轮、多代理协作流程**，不是一次性任务。**最少 2 轮常规评审，最多 5 轮，然后进行最终审计。**

### 流程概览

```
第 1-5 轮（常规评审循环）:
  评审 → 裁决 → 修复 → 验证 → 轮次决策 → (下一轮或最终审计)

最终审计:
  盲扫 → 定向复核 → (若发现新问题则返回修复) → 收敛判定 → 最终报告
```

**最少 2 轮，最多 5 轮常规评审，然后进行最终审计。**

## 压缩上下文后恢复：立即做这 4 件事

如果你刚刚压缩了上下文，或者不确定自己在流程中的位置：

### 1. 立即读取 `.review-evidence/run-state.md`

这是当前流程状态的检查点，包含：
- `current_phase`: 当前在哪个阶段（baseline | review | adjudication | repair | verification | round_decision | final_audit | report）
- `current_round`: 当前是第几轮（1-5）
- `final_audit_attempt`: 最终审计尝试次数（0-3）
- `active_finding`: 当前正在处理哪个 finding
- `next_action`: 下一步应该做什么（包括需要委派的子代理类型）

### 2. 检查你在哪个轮次

**不要在第 1 轮后就结束流程！** 至少需要 2 轮常规评审，最多 5 轮。

查看 `run-state.md` 中的 `current_round` 和 Round History：
- Round 1 完成后 → 必须进入 Round 2（除非你已经在 Round 2 或更后面）
- Round 2 完成后 → 检查提前收敛条件，否则进入 Round 3
- Round 3-4 完成后 → 检查正常完成条件，否则继续
- Round 5 完成后 → 必须进入最终审计

### 3. 检查当前阶段需要做什么

根据 `current_phase`，参考下方的"阶段流转路径"，确认：
- 当前阶段是否已完成
- 下一步应该进入哪个阶段
- 是否需要委派子代理

### 4. 检查是否需要委派子代理

以下任务**必须委派给子代理**，不能自己做：
- **review**: 评审角色（至少 3 个）
- **adjudication**: 复现审查、挑战
- **repair**: 实现代理（修复 finding）
- **verification**: 验证代理（不能是实现代理）
- **final_audit**: 最终审计代理（未参与前序评审或实现）

**例外**：当所有可用独立代理都已提交过相关候选时，主代理可以亲自复现，但必须在 adjudication.md 中明确记录并标注为高风险项。

## 阶段流转路径

```
baseline (Phase 0)
  ↓
review (Phase 1) - 必须使用子代理：至少 3 个评审角色
  ↓
adjudication (Phase 2) - 必须使用子代理：复现审查、挑战
  ↓
  ├─ 若有 accepted findings → repair (Phase 3)
  └─ 若无 accepted findings → round_decision (Phase 5)
  
repair (Phase 3) - 必须使用子代理：实现代理
  ↓
verification (Phase 4) - 必须使用子代理：验证代理
  ↓
  ├─ 若还有其他 accepted 未验证的 findings → 继续 repair
  └─ 若当前轮所有 accepted findings 已验证 → round_decision (Phase 5)

round_decision (Phase 5) - 主代理检查
  ↓
  ├─ 若满足进入最终审计的条件 → final_audit (Phase 6)
  └─ 若不满足且 current_round < 5 → review (Phase 1, current_round + 1)

final_audit (Phase 6) - 必须使用子代理：最终审计代理
  ↓
  ├─ 若发现新问题且 current_round < 5 → adjudication → ... → round_decision → review (新一轮)
  ├─ 若发现新问题但 current_round >= 5 → adjudication → repair → verification → 重新 final_audit
  └─ 若无新问题 → report (Phase 7)

report (Phase 7) - 主代理汇总
  ↓
  结束（CONVERGED 或 INCOMPLETE）
```

## 常见的压缩后遗忘错误

### ❌ 错误 1：第 1 轮后就结束
**症状**：完成 Round 1 的评审、裁决、修复、验证后，直接生成最终报告

**正确做法**：检查 `current_round`，如果是 1，必须进入 Round 2（至少需要 2 轮）

### ❌ 错误 2：自己做评审，不用子代理
**症状**：压缩后，主代理自己读代码、发现问题、写 counterexample

**正确做法**：委派至少 3 个评审子代理，每个代理独立评审

### ❌ 错误 3：修复后不验证
**症状**：实现代理修复完成后，直接进入下一个 finding 或下一轮

**正确做法**：每个修复后必须委派独立验证代理验证

### ❌ 错误 4：跳过 adjudication 阶段
**症状**：评审完成后，直接进入 repair 或 round_decision

**正确做法**：必须先进入 adjudication，筛选、去重、分配标准 ID、复现审查、裁决

### ❌ 错误 5：忘记更新 run-state.md
**症状**：完成某个阶段后，没有更新状态文件，导致下次恢复时位置错误

**正确做法**：每个阶段完成后，立即更新 `run-state.md`

### ❌ 错误 6：最终审计发现新问题后直接结束
**症状**：最终审计发现新问题，报告为 INCOMPLETE

**正确做法**：
- 若 `current_round < 5`：修复验证后启动新常规评审轮，然后重新最终审计
- 若 `current_round >= 5`：直接裁决修复验证，然后重新最终审计
- 最终审计最多 3 次尝试

## 进入最终审计的条件

**必须满足以下之一**：

1. **提前收敛**（仅在第 2 轮后检查）：
   - 连续第 1、2 轮本轮评审后均无新 accepted P0/P1
   - 且第 2 轮也无新 accepted P2

2. **正常完成**（第 3-5 轮后）：
   - 完成当前轮的所有修复和验证
   - 且本轮评审后无新 accepted P0/P1
   - 第 3 轮起，只关注 P0/P1，P2 可标记为 screened_out_low_priority

3. **达到轮次上限**（第 5 轮后）：
   - 无论是否还有问题，都必须进入最终审计

**注意**：未解决的验证阻塞（inconclusive）会阻止进入最终审计，报告 INCOMPLETE

## 收敛条件

**全部满足才是 CONVERGED**：
- 所有 accepted 且范围内的 P0/P1 已修复且验证通过
- 所有 accepted finding（所有优先级）已 verified
- 反例覆盖率（verified findings 的 reproduction 占 accepted findings 的比例）≥80%
- 最终审计两阶段完成且无新 accepted findings

**未满足时报告 INCOMPLETE**，列明残余风险、阻塞原因和未验证项。

## 委派子代理的模板

### 评审阶段（至少 3 个角色，每个独立代理）

```
你是 [role-slug] 评审员。只读检查 [MVP 范围]，依据 [验收标准/契约] 和当前 HEAD。
本轮变更范围：[常规评审填 none；回归评审列出待检查的提交/文件路径]

检查重点：[该角色的关注点]

不要修改项目源代码、测试、配置，不要安装依赖或提交。
不要读取其他评审角色的发现（`.review-evidence/round-[N]/inbox/` 的其他子目录）。

发现问题后，写入：
- `.review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/counterexample.md`
- `.review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/reproduce.[ext]`
- `.review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/output.log`

完成后按 YAML 格式交接（见 references/review-protocol.md）。
```

### 复现审查阶段（每次 3-5 个 findings，独立代理）

```
你是独立复现审查员。只检查以下 findings 的复现脚本：

[列出 finding IDs 和路径]

对每个 finding：
1. 读取 counterexample.md 和 reproduction 脚本
2. 运行复现命令
3. 观察是否重现预期失败
4. 写入 replay-review.md（observed / not_observed / blocked）

不要读取：
- 其他 finding 的内容
- 原评审结论
- adjudication.md
- challenge-result.md
- verification-result.md

不要修改项目源代码或裁决严重性。

完成后按 YAML 格式交接（见 references/review-protocol.md）。
```

### 挑战阶段（P0/P1 或敏感 finding，独立代理）

```
你是对抗式挑战员。尝试推翻以下 finding：

Finding ID: [ID]
Claim: [声明]
Evidence: [证据路径]

尝试寻找：
- 正常行为被误判为问题
- 前提假设无效
- 复现脚本有误
- 假阳性

写入 `.review-evidence/round-[N]/[finding-id]/challenge-result.md`

不要自己做最终裁决。

完成后按 YAML 格式交接（见 references/review-protocol.md）。
```

### 实现阶段（一次一个 finding，独立代理）

```
你是实现代理。修复以下 finding：

Finding ID: [ID]
Evidence: [路径]

按 TDD 流程：
1. RED：确认当前失败（运行原始 reproduction）
2. GREEN：最小化修复使测试通过
3. REFACTOR：清理代码
4. 将 reproduction 迁移到项目测试套件

提交信息格式：
fix([finding-id]): [简短描述]

[详细说明]

Fixes: [finding-id]

不要：
- 一次修复多个 findings
- 覆盖基线中的用户改动
- 自己验证修复是否有效

完成后按 YAML 格式交接（见 references/tdd-and-commit.md）。
```

### 验证阶段（一次一个 finding，必须是独立代理）

```
你是验证代理。验证以下 finding 的修复：

Finding ID: [ID]
Implementation commit: [commit hash]
Evidence: [路径]

验证步骤：
1. 检查 RED 证据（implementation-result.md）
2. 运行原始反例（应该通过）
3. 运行回归测试（应该通过）
4. 检查修复是否完整

写入 `.review-evidence/round-[N]/[finding-id]/verification-result.md`
状态：verified / fail / inconclusive

不要：
- 验证你自己实现的 finding
- 自己修复验证失败的问题

完成后按 YAML 格式交接（见 references/tdd-and-commit.md）。
```

### 最终审计阶段（未参与前序评审或实现的独立代理）

```
你是最终审计员。分两阶段检查：

**阶段 1：盲扫**
不读取 findings-index.md，独立检查是否有遗漏问题。
写入 `.review-evidence/final-audit/attempt-[K]/blind-scan.md`

**阶段 2：定向复核**
读取所有 verified findings，检查修复是否真的有效。
写入 `.review-evidence/final-audit/attempt-[K]/spot-check.md`

不要：
- 在盲扫阶段读取已有 findings
- 自己修复发现的新问题

完成后按 YAML 格式交接（见 references/review-protocol.md）。
```

## 证据文件结构

```
.review-evidence/
├── run-state.md                    # 当前状态（主代理维护）
├── findings-index.md               # 所有 findings 汇总（主代理维护）
├── baseline/
│   └── baseline.md                 # 基线信息
├── round-1/
│   ├── inbox/                      # 评审代理输出
│   │   ├── [role-slug]/
│   │   │   └── [临时_id]/
│   │   │       ├── counterexample.md
│   │   │       ├── reproduce.[ext]
│   │   │       └── output.log
│   ├── R1-F001-SEC/                # 标准 finding 目录
│   │   ├── adjudication.md         # 主代理裁决
│   │   ├── replay-review.md        # 复现审查代理输出
│   │   ├── challenge-result.md     # 挑战代理输出（可选）
│   │   ├── implementation-result.md # 实现代理输出
│   │   └── verification-result.md  # 验证代理输出
│   └── round-1-summary.md          # 主代理轮次总结
├── round-2/
│   └── ...
├── final-audit/
│   ├── attempt-1/
│   │   ├── blind-scan.md
│   │   └── spot-check.md
│   └── ...
└── final-report.md                 # 最终报告（主代理生成）
```

## 详细参考文档

- **流程概览**：`SKILL.md`
- **评审协议**：`references/review-protocol.md`
- **TDD 与提交规范**：`references/tdd-and-commit.md`
- **证据结构**：`references/evidence-structure.md`
- **当前状态**：`.review-evidence/run-state.md`（运行时生成）

## 最重要的话

**这是一个多轮循环流程。压缩上下文后，立即读取 `.review-evidence/run-state.md` 确认当前位置，不要在第 1 轮后就结束，不要跳过任何阶段，不要自己做评审/修复/验证（必须委派子代理）。**
