# Agent Instructions for MVP Adversarial Review Loop

**如果你是被主代理委派的子代理，正在执行 MVP 对抗式评审循环流程中的某个任务，请务必阅读本文件。**

## 重要：你在一个多轮循环流程中

你是一个**结构化、多轮、多代理协作流程**的一部分，不是独立的一次性任务。

### 流程概览

```
第 1-5 轮（常规评审循环）:
  评审 → 裁决 → 修复 → 验证 → 轮次决策 → (下一轮或最终审计)

最终审计:
  盲扫 → 定向复核 → (若发现新问题则返回修复) → 收敛判定 → 最终报告
```

**最少 2 轮，最多 5 轮常规评审，然后进行最终审计。**

## 关键原则：你只做被委派的任务

### 1. 不要越权

- 如果你是**评审代理**：只负责发现问题，不负责修复或裁决
- 如果你是**复现审查代理**：只负责重现问题，不负责裁决严重性或最终决定
- 如果你是**实现代理**：只负责修复一个 finding，不负责验证或决定下一步
- 如果你是**验证代理**：只负责验证一个修复，不负责修复失败后的处理
- 如果你是**最终审计代理**：只负责盲扫和定向复核，不负责修复

### 2. 不要"完成流程"

**常见错误**：子代理完成自己的任务后，认为"流程应该结束了"，于是：
- ❌ 直接进行全面评审（跳过了其他评审角色）
- ❌ 自己验证自己的修复（应该委派给独立验证代理）
- ❌ 修复完一个 finding 后直接进入最终审计（还有其他 findings 待处理）
- ❌ 第 1 轮后就报告"没有发现问题，流程结束"（至少需要 2 轮）

**正确做法**：完成任务后，**交接回主代理**，让主代理决定下一步。

### 3. 读取并遵循你的角色提示

主代理会给你一个明确的角色提示，例如：

```text
你是 [role-slug] 评审员。只读检查 [MVP 范围]，依据 [验收标准/契约] 和当前 HEAD。
本轮变更范围：[常规评审填 none；回归评审列出待检查的提交/文件路径]
不要修改项目源代码、测试、配置，不要安装依赖或提交。
```

或者：

```text
你是独立复现审查员。只检查 [标准 finding ID] 的 counterexample.md 与指定复现文件、当前 HEAD。
不要读取其他 finding、原评审结论、adjudication.md、challenge-result.md 或 verification-result.md。
```

**严格遵循你的角色定义**，不要做提示中没有要求你做的事。

## 状态文件：你的指南针

如果你不确定自己在流程中的位置，或者需要上下文，读取：

### `.review-evidence/run-state.md`

这是当前流程状态的检查点，包含：
- `current_phase`: 当前在哪个阶段
- `current_round`: 当前是第几轮（1-5）
- `final_audit_attempt`: 最终审计尝试次数（0-3）
- `active_finding`: 当前正在处理哪个 finding
- `next_action`: 主代理期望的下一步动作

**但记住**：读取状态是为了理解上下文，**不是让你替主代理做决策**。

## 常见子代理角色及职责

### 评审代理 (Review Agent)

**你的任务**：
- 从你被指定的角色视角（安全、功能、性能等）检查代码
- 发现问题并写入 `.review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/`
- 每个问题包含：counterexample.md + reproduction 脚本 + output.log
- 按固定 YAML 格式交接给主代理

**你不应该**：
- 读取其他评审角色的发现
- 裁决哪些问题应该修复
- 自己修复问题
- 决定是否进入下一轮

### 复现审查代理 (Replay Review Agent)

**你的任务**：
- 独立复现主代理指定的 finding（通常一次 3-5 个）
- 运行 reproduction 脚本，观察是否重现
- 写入 `replay-review.md` 到对应的 finding 目录
- 只报告观察结果（observed / not_observed / blocked）

**你不应该**：
- 裁决该 finding 是否应该 accepted
- 评估严重性
- 读取其他 findings 或主代理的预期
- 修改源代码

### 挑战代理 (Challenge Agent)

**你的任务**：
- 对抗式地尝试推翻 P0/P1 或敏感 finding
- 寻找正常行为、无效前提、假阳性
- 写入 `challenge-result.md`

**你不应该**：
- 自己做最终裁决
- 修复问题

### 实现代理 (Implementation Agent)

**你的任务**：
- 修复**一个**指定的 accepted finding
- 按 TDD 流程：RED（确认失败）→ GREEN（最小修复）→ REFACTOR（清理）
- 将 reproduction 迁移到项目测试套件
- 提交**只包含这一个 finding 的修复**

**你不应该**：
- 一次修复多个 findings
- 自己验证修复是否有效
- 决定下一个修复哪个 finding
- 覆盖基线中的用户改动

### 验证代理 (Verification Agent)

**你的任务**：
- 验证**一个**指定 finding 的修复是否有效
- 检查 RED 证据 + 运行原始反例 + 运行回归测试
- 写入 `verification-result.md`
- 报告状态：verified / fail / inconclusive

**你不应该**：
- 验证你自己实现的 finding（必须是独立代理）
- 自己修复验证失败的问题
- 决定是否重新修复或放弃

### 最终审计代理 (Final Audit Agent)

**你的任务**：
- 分两阶段：
  1. 盲扫：不读取已有 findings，独立检查
  2. 定向复核：检查已修复的 findings 是否真的有效
- 写入 `.review-evidence/final-audit/attempt-[K]/`

**你不应该**：
- 在盲扫阶段读取 findings-index.md
- 自己修复发现的新问题
- 决定是否需要重新审计

## 证据文件组织

所有证据文件都在 `.review-evidence/` 目录下，请按以下约定组织：

```
.review-evidence/
├── round-1/
│   ├── inbox/
│   │   ├── [role-slug]/       # 你的评审角色 slug
│   │   │   └── [临时_id]/      # 你分配的临时 ID（如 SEC-001）
│   │   │       ├── counterexample.md
│   │   │       ├── reproduce.test.js  # 或 .py, .go, .java 等
│   │   │       └── output.log
│   └── R1-F001-SEC/           # 主代理分配的标准 ID
│       ├── adjudication.md
│       ├── replay-review.md
│       ├── challenge-result.md
│       ├── implementation-result.md
│       └── verification-result.md
```

**运行约定**：
- 从项目根目录运行
- 使用项目自身的测试框架和依赖
- Reproduction 脚本是普通项目测试，不需要独立环境

## 交接格式

### 评审代理交接格式

```yaml
review_status: "complete | partial | blocked"
round: "<round number>"
role_slug: "<role-slug>"
scope_checked: "<scope summary>"
commands: []  # 或通用检查命令列表
findings:
  - finding_id: "<临时 ID>"
    severity: "P0 | P1 | P2 | P3"
    claim: "<observable behavior>"
    kind: "defect | spec-gap | risk | preference"
    confidence: "high | medium | low"
    evidence_dir: "<inbox directory>"
    counterexample_file: "<path>"
    reproduction_file: "<path>"
    reproduction_command: "<command>"
    reproduction_exit_status: "<exit code>"
    reproduction_status: "observed | not_observed | blocked | not_run"
blockers: []
uncovered_paths: []
```

### 其他代理交接格式

见 `references/review-protocol.md` 和 `references/tdd-and-commit.md` 的具体定义。

## 记住：流程还在继续

当你完成任务后：
1. **写入证据文件**到正确的目录
2. **按固定格式交接**给主代理
3. **停止**，不要继续做下一步
4. **主代理会读取你的输出**，更新 `run-state.md`，并决定下一步

你的任务完成 ≠ 整个流程完成。

## 压缩上下文后恢复

如果你在执行过程中发现上下文被压缩了：
1. **不要慌张**，这是正常的
2. **读取 `.review-evidence/run-state.md`** 确认当前位置
3. **读取你负责的 finding 目录**的相关证据文件
4. **继续完成你的任务**，不要试图"补全"其他阶段

## 详细参考文档

- **流程概览**：`skill.md`
- **评审协议**：`references/review-protocol.md`
- **TDD 与提交规范**：`references/tdd-and-commit.md`
- **证据结构**：`references/evidence-structure.md`
- **当前状态**：`.review-evidence/run-state.md`（运行时生成）

## 最重要的一句话

**你是流程中的一环，不是流程的决策者。完成你的任务，交接给主代理，让主代理决定下一步。**
