---
name: mvp-adversarial-review-loop
description: 当用户要求对已完成的 MVP 进行评审、查找并修复问题（覆盖产品、功能、安全、可靠性、API、性能、可访问性、运维等领域），或要求对抗式/多轮评审、反例验证、有证据且可审计的修复时使用。
---

# MVP 对抗式评审循环

## ⚠️ 执行检查清单（每次行动前检查）

**技能刚加载？** → 先执行"0. 建立基线"中的启动部署：把技能目录的 AGENTS.md 部署到项目的项目级指令文件（幂等，可重复运行）

**压缩上下文后恢复？** → 立即读取 `.review-evidence/run-state.md`，确认 `current_phase`、`current_round`、`next_action`；若项目级指令文件既无恢复指南标记（`mvp-adversarial-review-loop-recovery-guide`）也无恢复指南标题，先从技能目录重新部署

**当前在哪个阶段？** → 检查 run-state.md 中的 `current_phase`：
- `review` → 必须委派评审子代理（至少 3 个角色）
- `adjudication` → 复现审查与必须挑战范围内的挑战必须委派子代理（见 2.4）
- `repair` → 必须委派实现子代理
- `verification` → 必须委派验证子代理
- `round_decision` → 检查轮次迭代条件
- `final_audit` → 必须委派最终审计子代理

**这是多轮循环流程**：最少 2 轮，最多 `max_rounds` 轮常规评审（默认 5，用户可在 baseline 指定），然后进行最终审计。不要在第 1 轮后就结束！

**每个阶段完成后**：更新 run-state.md 的 `current_phase`、`next_action`、`last_completed_event`

## 目标与资料路由

以可重放证据确认缺陷，以按统一标准的验证确认修复。主代理对 finding 和最终收敛负责；子代理提供独立评审、挑战、实现或验证结果，不替主代理作最终裁决。

评审与裁决的协议规则（角色、筛查、裁决、挑战/补强、验证、轮次、收敛）已整合在本文件的工作流章节中。阶段相关的操作材料和模板：

- [references/evidence-structure.md](references/evidence-structure.md)：证据目录、状态检查点、索引和记录格式。初始化证据目录时读取。
- [references/tdd-and-commit.md](references/tdd-and-commit.md)：实现任务、RED-GREEN-REFACTOR、工作区隔离和提交验收。进入修复阶段时读取。
- [references/agent-prompts.md](references/agent-prompts.md)：子代理提示模板与标准输出格式。委派任何子代理时必须按对应章节的模板执行。
- [references/archival.md](references/archival.md)：证据归档流程（可选）。评审循环完成后按需参考。

不要默认加载所有参考文件；只读取当前阶段需要的资料。

## 关键约束

1. **主代理保留判断权。** 子代理的结论是输入，不是事实。主代理负责范围、契约、状态与收敛裁决；常规复现可委派给独立代理，但主代理必须检查其证据。任何 finding 进入修复前都必须有主代理确认的失败证据。
2. **证据目录是持久事实来源。** 在 .review-evidence/ 中维护 baseline.md、run-state.md、findings-index.md 和 screening-log.md。完整 reproduction、命令输出和阶段记录写入相应文件；敏感值先脱敏。对话只保留摘要和路径。
3. **每次交接都要压缩状态。** 子代理返回短摘要、finding ID、文件路径、命令/退出状态摘要和阻塞项，不要在回复中重复完整代码、日志或裁决历史。每个代理返回、finding 状态变化、提交、验证或轮次切换后，更新 run-state.md。下一阶段只读取该检查点和当前工作所需的 finding 文件。
4. **串行控制共享工作区。** 默认一次只运行一个子代理（评审角色串行，同类代理批量处理多个 findings）。每个评审角色使用独立的 inbox 子目录；不得依赖临时 ID 在不同角色之间唯一。未经用户明确授权，不并发评审或进行真实外部写入。
5. **先证明，再修复；提交必须隔离。** 每个 accepted finding 都须先确认失败，再按 TDD 修复、运行回归、检查差异并完成验证。修复提交只包含当前 finding 的实现和测试，不包含 .review-evidence/。不得覆盖基线中的用户改动。
6. **区分失败、未知和阻塞。** 环境不可用或证据不充分时不能标 rejected 或 verified。未完成的核验保持未完成，并记录阻塞原因。
7. **报告真实收敛状态。** 遵循本文件的轮次上限、覆盖率和收敛条件。没有完成要求的验证时，报告 INCOMPLETE，不以测试绿灯或”未发现问题”代替证据。

**用户明确授权机制**：当需要用户授权时（并发执行、主代理亲自复现/验证、使用兜底方案等），主代理使用 AskUserQuestion 工具请求确认。授权决策记录到 run-state.md 的 `blockers` 字段（格式：`”[事项] - user authorized on [ISO 8601]”` 或 `”[事项] - user declined on [ISO 8601]”`）。在最终报告中披露所有需要授权的操作及用户决策。

## 强制执行规则

**你是主代理，每个阶段必须遵循以下规则。压缩上下文后恢复时，立即读取 `.review-evidence/run-state.md` 确认当前位置。**

1. **这是一个多轮循环流程**，最少 2 轮常规评审，最多 `max_rounds` 轮（默认 5，与用户在 baseline 确认并记入 run-state.md），然后进行最终审计。不要在第 1 轮后就结束。
2. **每个需要独立评估的任务必须使用子代理**：评审角色、复现审查、挑战、补强、修复实现、修复验证、最终审计都必须委派给子代理。**例外**：当所有可用独立代理都已提交过相关候选时，主代理经用户明确授权后可以亲自复现，但必须在 adjudication.md 中明确记录并标注为高风险项，并在最终报告中单独披露。
3. **每个阶段完成后，立即更新 run-state.md**，记录 current_phase、current_round、next_action 和 last_completed_event。
4. **每个轮次完成后，必须检查轮次迭代条件**（见下方"轮次迭代与最终审计"），决定是否进入下一轮常规评审或最终审计。
5. **修复实现必须按 TDD 流程**：委派给实现代理，按 tdd-and-commit.md 执行 RED-GREEN-REFACTOR。
6. **修复验证必须委派给独立验证代理**，不能由实现代理自己验证，也不能跳过。

## 工作流

### 0. 建立基线 (Phase: baseline)

**主代理执行**：确认 MVP 范围、验收标准、技术栈、当前 HEAD、工作区改动、测试/构建命令、基线结果和最大轮数（`max_rounds`，默认 5，与用户确认，用户可指定；最小值 2，小于 2 时按 2 处理并记录）。创建 .review-evidence/ 并初始化 baseline.md、run-state.md、findings-index.md、screening-log.md。确保项目测试配置忽略 tests/review/（或使用等价的 ADVERSARIAL_REVIEW 开关），将方式和是否可在结束时还原记录到 baseline.md；无法确保时记录阻塞。

**启动部署（技能加载后、开始评审前执行；幂等，可安全重复运行）**：把技能目录下的 AGENTS.md（主代理恢复指南）部署到项目级指令文件，保证上下文压缩后恢复指南仍被自动加载：

1. **定位目标文件**：项目根目录的 `AGENTS.md`；若项目以 `CLAUDE.md` 为项目级指令文件（存在 `CLAUDE.md` 且无 `AGENTS.md`），则以 `CLAUDE.md` 为目标。
2. **幂等检查**：目标文件已包含标记 `mvp-adversarial-review-loop-recovery-guide` 或恢复指南标题（`Main Agent Recovery Guide - MVP Adversarial Review Loop`）时跳过，不重复追加。
3. **部署**：
   - 目标文件不存在：把技能目录的 `AGENTS.md` 复制到项目根目录，并在内容前后加 `<!-- BEGIN mvp-adversarial-review-loop-recovery-guide -->` / `<!-- END mvp-adversarial-review-loop-recovery-guide -->` 标记。
   - 目标文件已存在：先把原始内容备份到 `.review-evidence/baseline-project-instructions.bak`（目录不存在时先创建），再把带标记的恢复指南追加到文件末尾。
4. **记录**：把目标文件、模式（created / appended / skipped）、标记和备份路径写入 baseline.md 的 "Recovery Guide Deployment" 小节；无法部署时记录原因和阻塞。

**完成后**：更新 run-state.md，设置 `current_phase: review`, `current_round: 1`, `max_rounds: [5 或用户指定值]`, `rounds_consumed: 0/max_rounds`, `can_trigger_new_round: true`, `next_action: "启动第 1 轮评审角色"`。

### 1. 独立评审 (Phase: review)

**必须使用子代理**：每个角色是一个独立子代理，只读检查项目文件，将候选 finding 写到自己的 inbox 目录。

**角色选择**——根据 MVP 范围选择互补角色，每轮至少 3 个，不同角色不能重复：

| 代码 | 领域 | 关注点 |
|------|------|--------|
| SEC | security | 认证、授权、数据保护、注入、XSS、CSRF、敏感信息泄露 |
| FUNC | functionality | 核心功能契约、业务逻辑、边界条件、数据验证 |
| REL | reliability | 错误处理、并发、资源清理、数据一致性、幂等性 |
| API | api-compatibility | 版本兼容、废弃声明、破坏性变更、响应格式 |
| PERF | performance | 响应时间、查询效率、资源占用、扩展性瓶颈 |
| UX | accessibility | 键盘导航、屏幕阅读器、ARIA、颜色对比、焦点管理 |
| OPS | operations | 日志、监控、可调试性、部署、配置、测试覆盖 |
| PROD | product | 产品契约、用户体验一致性、错误消息清晰度 |

**轮次策略**：
- **"倒数第N轮"定义**：相对于 `max_rounds` 的固定位置，与实际消耗轮次无关：
  - 倒数第 3 轮 = Round (max_rounds - 2)
  - 倒数第 2 轮 = Round (max_rounds - 1)
  - 倒数第 1 轮 = Round max_rounds
  - 提前收敛时，这些位置不会到达
  - **终审触发的新轮次不受"倒数第N轮"规则限制**：按终审发现的问题性质决定（常规扫描或回归检查），但仍计入 max_rounds 上限
- **各轮策略**：
  - 第 1、2 轮：默认选择 SEC、FUNC、REL，根据项目特点补充其他角色
  - 中段轮次（第 3 轮至倒数第 4 轮，max_rounds ≥ 6 时存在）：沿用默认广扫
  - 倒数第 3 轮：根据前序发现的高风险区域选择针对性角色
  - 倒数第 2 轮及以后（即最后两轮）：仅检查回归，选择与已修复 findings 相关的角色
  - max_rounds 小于 5 时省略无空间的阶段（优先保留第 1、2 轮默认广扫与最后两轮回归）

**提示模板**：完整提示模板和输出格式见 agent-prompts.md 的"评审代理（Review Agent）"章节。委派时为每个代理替换 round、role-slug、范围和验收标准；倒数第 2 轮及以后（最后两轮回归检查轮）提供待检查的修复提交/变更路径，但不提供历史 finding 或预期结论。临时测试文件写入 `tests/review/candidates/r{round}_{role}_{temp_id}.test.{ext}`；证据文档写入 `.review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/`。代理返回固定 YAML 结构的摘要，完整日志写入 output.log；该摘要属于交接摘要，不是第二份证据副本，主代理只在裁决当前 finding 时读取其完整证据。

**临时 ID**：每个代理只需在自身 role-slug 目录内保证临时 ID 唯一，例如 security 角色使用 SEC-001、SEC-002，functionality 角色使用 FUNC-001、FUNC-002。类别代码：SEC 安全隐私；FUNC 功能边界；REL 可靠性一致性；API API兼容性；PERF 性能资源；UX 可访问性；OPS 测试运维；PROD 产品契约。标准 ID 由主代理在裁决阶段统一分配。

**完成后**：更新 run-state.md，设置 `current_phase: adjudication`, `next_action: "筛选、去重并裁决候选 findings"`。

### 2. 主代理裁决 (Phase: adjudication)

**主代理执行但必须委派复现审查**：先筛选偏好和范围外建议到 screening-log.md，再去重并分配标准 ID；分配 ID 时将候选复现文件复制到标准 ID 目录作为 `reproduce.*`（tests/review/ 中的临时文件保留运行用、流程结束时会删除）。**常规复现必须委派给独立子代理**（复现审查代理），主代理检查其返回的证据后裁决。高风险项由主代理亲自加验。**必须挑战范围内的 finding（见 2.4）必须委派给挑战代理**。提出意见的代理不得单独决定自己的 finding 是否成立。

#### 2.1 范围与契约筛查

检查前提是否可能成立、意见是否针对 MVP 已承诺的功能、预期行为是否有验收标准/契约支持、影响是否与严重性相称。

**筛查决策流程**：

```
候选 finding
  ↓
[1] 是否仅为偏好或措辞建议？(kind: preference)
  ├─ 是 → screened_out_preference（不分配标准 ID）
  └─ 否 → [2]
  ↓
[2] 是否仅要求新增明确不在 MVP 承诺内的功能？
  ├─ 是 → screened_out_scope（不分配标准 ID）
  └─ 否 → [3]
  ↓
[3] 是否针对当前已存在的行为？
  ├─ 否 → screened_out_scope（功能不存在，无需检查）
  └─ 是 → [4]
  ↓
[4] 当前行为是否可能影响已承诺边界、数据、权限或用户？
  （注："当前行为"指 finding 指出的实际行为，而非期望行为。即使触发场景不在 MVP 范围内，但若违反安全、数据完整性、隐私等隐含契约，也不应筛除。）
  ├─ 否 → screened_out_scope（范围外行为，无实际影响）
  └─ 是 → [5]
  ↓
[5] 期望行为是否有验收标准/契约支持？
  ├─ 无依据 → 是否指出当前行为的具体损害？
  │   ├─ 否 → screened_out_contract（仅为无依据的偏好）
  │   └─ 是 → [6]（有损害，继续调查）
  └─ 有依据 → [6]
  ↓
[6] 前提是否可能成立？证据是否可验证？
  ├─ 前提不成立 → needs-evidence（需补充前提）
  ├─ 证据不可验证 → needs-evidence（需补充证据）
  └─ 可验证 → 进入复现阶段
```

**具体规则**：

- **纯偏好或仅措辞建议** (kind: preference)：标记为 screened_out_preference，写入 screening-log.md；不分配标准 finding ID、不进入 findings-index.md，也不进入修复队列或反例覆盖率分母。所有 preference 建议汇总后在达到收敛或轮次上限时交给用户决策。

- **仅要求新增明确不在 MVP 承诺内的功能**：记为 screened_out_scope，写明依据；不分配标准 ID、不进入 findings-index.md 或覆盖率分母，也无需运行反例。
  - **示例（筛除）**："应该支持 OAuth2 登录"（MVP 只承诺密码登录）
  - **反例（不筛除）**："当前的密码登录没有长度限制，可以设置单字符密码"（当前行为存在，影响安全）

- **针对当前已存在的行为但无实际影响**：若该行为仅在 MVP 承诺范围外的场景触发，且不影响已承诺边界、数据、权限或用户，记为 screened_out_scope。
  - **示例（筛除）**："导出为 XML 格式时，特殊字符未转义"（MVP 只承诺 JSON 导出）
  - **反例（不筛除）**："导出为 XML 格式时，数据库凭据泄露到输出"（安全问题，即使功能不在承诺内）

- **期望行为无契约支持但指出具体损害**：若候选指出当前行为可能造成数据丢失、安全风险、用户困惑或违反常规期望，即使无明确契约，也应继续筛查。
  - **示例（不筛除）**："删除操作无确认提示，用户可能误删数据"（无明确契约，但有损害）
  - **反例（筛除）**："按钮颜色应该是蓝色而不是绿色"（无契约，无损害，纯偏好）

#### 2.2 优先级与严重性判定

- **P0** (critical)：数据丢失/泄露、认证绕过、权限提升、完全不可用、公开 API 破坏性变更
- **P1** (high)：部分功能失效、安全漏洞（非完全绕过）、数据不一致、明显性能问题、可访问性阻断
- **P2** (medium)：边界条件失败、错误消息不清晰、日志缺失、次要功能缺陷
- **P3** (low)：优化建议、测试覆盖改进、文档缺失、代码风格

#### 2.3 复现与独立验证

主代理完成去重、范围/契约初筛并分配标准 ID 后，对可复现候选指派一名未提交该候选的独立复现审查员（复现审查代理，模板见 agent-prompts.md 的"独立复现审查代理"章节）。原评审员运行过的结果可作线索，但不能替代独立复现；挑战代理的独立重放可满足此要求；高风险或证据异常项还须由主代理加验或再委派第二个独立审查。

通过筛查的候选必须由独立复现审查员、挑战代理或主代理之一运行 reproduction；执行者必须与提出候选的评审员不同。**主代理启动一个复现审查代理，一次性给它多个 findings 的任务列表（推荐 3-5 个），由该代理依次处理；默认不同时启动多个复现审查代理（串行执行，原因：减少上下文管理复杂度、避免 git 工作区冲突、降低 token 消耗），除非用户明确授权并行且有独立的 git worktree 隔离机制。** 手工步骤仅在已确认无法自动化时使用。记录精确命令/操作、环境、退出状态、观察结果及证据路径。主代理必须检查证据与 claim 相符，且在 adjudication.md 中注明复现者和证据路径；不要求主代理重复每条常规命令。若确实没有独立代理可用，主代理经用户明确授权后亲自复现作为退路，并在 adjudication.md 标注高风险项、最终报告单独披露；有独立代理可用时不得使用兜底。P0/P1、权限/数据完整性/公开 API、高影响 finding，以及结果互相矛盾或不寻常的证据，主代理必须亲自加验或再委派第二个独立审查。

**复现结果解释**（完整复现报告写入 replay-review.md）：
- `reproduced`：有效前提下观察到 claim 所述行为；是否违反承诺范围由主代理另行裁决
- `not-reproduced`：前提和断言有效、复现完整运行，但观察结果明确不符合 claim；记录具体反证
- `blocked`：环境、依赖、前提、脚本或观察点不完整，无法判断 claim；保留 `needs-evidence`，不得据此 rejected

**裁决逻辑**（主代理综合筛查、复现审查、挑战/补强结果后决定）：

- **reproduced 且范围契约相符**：decision 为 accepted，安排修复。P0/P1 优先；P2 默认 accepted，确因资源限制推后修复的仍在后续轮次或最终报告处置并披露；P3 一般 deferred，在最终报告中披露。
- **reproduced 但范围不符或影响低于声称严重性**：修订 severity 或 claim 后 deferred，或降级后 accepted。
- **not-reproduced 且有明确反证**：decision 为 rejected，写明理由和反证路径。
- **blocked、reproduction 不完整，或前提/证据不充分**：decision 为 needs-evidence，列出需要的证据。可派补强代理修正小缺陷。根本无法运行但仍有合理方向的，保留 needs-evidence；补强代理不能修正本身不证明问题不存在。

#### 2.4 挑战代理

**完整提示模板和输出格式**见 agent-prompts.md 的"挑战代理（Challenge Agent）"章节。

**必须挑战的范围**：拟 decision 为 accepted 的 P0、涉及安全/权限/数据完整性/公开 API 的 P1，以及复现结果互相矛盾或不寻常的证据。其余 accepted finding 按轮次与资源优先挑战最高严重性项。必须挑战范围内的项不得默认跳过；确因资源限制无法在本轮挑战时，必须获得用户明确授权，在 adjudication.md 记录未挑战项及理由，并在最终报告中列出未挑战的必须范围项。

**挑战代理采用单代理批量处理**：主代理启动一个挑战代理，一次性给它多个需要挑战的 findings（推荐 2-4 个），由该代理依次挑战；默认串行执行（原因同上：减少上下文管理复杂度、避免 git 工作区冲突、降低 token 消耗），除非用户明确授权并行且有独立的 git worktree 隔离机制。

**结果解释**：
- `supports`：挑战者有效重放了 claim，且未找到足以推翻它的证据。主代理确认挑战未推翻 finding 后，decision 可为 accepted。
- `disputes`：必须附具体反证，证明前提不成立、行为符合契约或影响/严重性需要修订。主代理审查双方证据；证据充分时 rejected，影响较小则降级/修订后 accepted，争议未解决则 needs-evidence。
- `inconclusive`：单纯重放失败、环境不可用或观察不确定不能标为 disputes，必须标 `inconclusive`。不是自动接受。主代理基于已有重放证据作决定；证据仍不足则 needs-evidence。

挑战代理不得修改项目代码、测试或 finding 的原始 reproduction。

#### 2.5 补强代理

**完整提示模板和输出格式**见 agent-prompts.md 的"补强代理（Reinforce Agent）"章节。

**仅在反例思路合理但有小的执行瑕疵时使用**。补强代理采用单代理批量处理：主代理启动一个补强代理，一次性给它多个需要补强的 findings（推荐 2-3 个），由该代理依次处理；默认串行执行（原因同上），除非用户明确授权并行且有独立的 git worktree 隔离机制。补强代理只修改标准 ID 目录内的 reproduction 或 counterexample.md，不改项目文件。

**结果解释**：
- `fixed`：主代理重新检查并重放；补强成功本身不等于 finding 成立
- `cannot-fix`：保留 needs-evidence，说明未解决部分；不能仅因代理补强失败而 rejected
- 如果补强结果证明原假设错误，再由主代理基于该证据裁决 rejected

#### 2.6 临时测试文件移动

在所有候选的 decision 确定后，主代理批量移动临时测试文件：
- decision 为 accepted：移动到 `tests/review/reproductions/`
- decision 为 rejected/needs-evidence/deferred：删除临时测试文件

**完成后**：
- 若有 accepted findings：更新 run-state.md，设置 `current_phase: repair`, `next_action: "修复第一个 accepted finding: [ID]"`
- 若无 accepted findings：更新 run-state.md，设置 `current_phase: round_decision`, `next_action: "检查轮次迭代条件（本轮无 accepted findings）"`

### 3. TDD 修复与提交 (Phase: repair)

**必须使用子代理**：每次处理一个 accepted finding，**委派给实现代理**按 tdd-and-commit.md 执行 RED-GREEN-REFACTOR、提交。

**结果处理**：already_fixed（测试直接通过）时，确认现有提交覆盖后进入验证；cannot_fix 或 blocked 时，主代理重新裁决（改为 deferred/rejected，或保留 accepted 并登记未解决），更新 findings-index.md 与 run-state.md，不得静默跳过。

**完成后**：更新 run-state.md，设置 `current_phase: verification`, `active_finding: [ID]`, `next_action: "验证 finding [ID] 的修复"`。

### 4. 修复验证 (Phase: verification)

**必须使用子代理**：**委派给验证代理**（不能是实现该 finding 的代理）验证修复效果，必须使用 agent-prompts.md 的"验证代理（Verification Agent）"模板并按其 YAML 回收摘要。验证代理检查 RED 证据、运行原始反例、**生成至少 2 个相邻测试**（正常情况 + 边界情况）、运行回归测试；无法生成有意义的相邻测试时须说明理由方可 pass。

**批量与独立性**：主代理启动一个验证代理，一次性给它多个修复提交的验证任务（推荐 3-5 个），由该代理依次验证；默认串行执行（原因同上），除非用户明确授权并行且有独立的 git worktree 隔离机制。每个修复提交后，使用未参与该 finding 实现的验证代理。提供当前 HEAD、commit、原始 finding、原始 reproduction 路径、修复后的项目测试路径和必要的运行入口。不要把实现代理的结论当作验证结果。若所有可用代理都已参与该 finding 的实现，先获得用户明确授权后由主代理执行验证，并在 verification-result.md 标注 verified_by: main-agent、adjudication.md 标注高风险项，最终报告列明由主代理验证的 finding。

**工作区保护**：验证代理必须在独立 worktree 中检出修复前 commit 复现；无法使用 worktree 时按模板中的受控兜底流程（stash + 受控 checkout + 完成后恢复，需记录原 HEAD）。不得强制清理或以任何方式覆盖用户改动。细节见 agent-prompts.md 的验证代理模板。

**外部改动检查**：验证开始前对照 baseline_head 运行 `git status --short`；发现与被验 finding 相关的新外部改动时，验证状态记为 `inconclusive`（验证无法继续），在 blockers 中说明"工作区含新的外部改动，涉及待验证的修复路径"，并列出冲突文件。不使用 `blocked_by_user_changes`（该状态仅用于 repair 阶段无法提交时）。

**结果解释**：
- **pass**：验证执行者完成所有要求的检查，且主代理确认记录和证据后，verification 记 pass，finding 可标 verified。执行者为主代理时，按上述兜底规则记录。
- **fail**：verification 记 fail，保持未 verified；回到修复（同一 finding 的修复-验证循环最多 2 次），第 2 次仍 fail 时创建更高优先级的回归 finding 并把原 finding 登记为未解决，不得无限重试。
- **inconclusive**：保持 accepted 但未 verified，记录环境/证据阻塞；最多重新委派验证代理重试 1 次；仍无法判定时登记为未解决并继续其他项，不得把它作为 pass 或作为 CONVERGED 的依据。

**完成后**：
- 更新 finding 状态（verification: pending / pass / fail / inconclusive / blocked_by_user_changes）到 findings-index.md
- 若还有其他 accepted findings 未处理或未解决：处理下一个（每个 finding 的修复-验证循环最多 2 次，超过后按上方结果解释的退出规则处理）
- 若本轮所有 accepted findings 均已终结（verified / blocked_by_user_changes / 已登记未解决）：检查轮次迭代条件

### 5. 轮次迭代与最终审计 (Phase: round_decision or final_audit)

**轮次完成的定义**：
- **轮次开始**：`current_round = N`, `current_phase = review`，启动评审角色
- **轮次修复验证阶段**：`current_phase = repair | verification`, `current_round = N`（不变），处理本轮 accepted findings
- **轮次完成**：所有 accepted findings 终结（verified 或 blocked_by_user_changes 或已登记未解决）后，`current_phase = round_decision`

**轮次迭代决策（主代理执行）**：
1. **确认当前轮已完成**：所有 accepted findings 已终结（verified / blocked_by_user_changes / 已登记未解决）
2. **轮次计数**：设置 `rounds_consumed = current_round`（表示已完成的常规评审轮数），并重算 `can_trigger_new_round = (rounds_consumed < max_rounds)`
3. **检查是否满足进入最终审计的条件**（见下方）
4. **决策分支**：
   - 若不满足且 `can_trigger_new_round = true`：进入下一轮常规评审，更新 run-state.md，设置 `current_round: N+1`, `current_phase: review`, `next_action: "启动第 N+1 轮评审角色"`
   - 若满足：进入最终审计，更新 run-state.md，设置 `current_phase: final_audit`, `final_audit_attempt: 1/3`, `next_action: "启动最终审计代理（盲扫）"`
5. **验证阻塞处理**：未解决的验证阻塞（inconclusive，不包括 blocked_by_user_changes）不阻止最终审计的执行，但使收敛结论只能为 INCOMPLETE；最终报告必须列明未验证项

**轮次证据提交（可选）**：每轮所有 accepted findings 验证完成后，主代理将本轮 `.review-evidence/` 变更作为独立提交（如 `chore(review): round-[N] evidence`），不夹带产品代码或测试；用户不希望提交或无法安全区分改动时跳过，并在 run-state.md 记录。

**轮次上限与优先级**：

- 最多 `max_rounds` 轮常规评审（默认 5，与用户在 baseline 确认并记入 run-state.md），每轮最多 6 个评审角色。**轮次计数只包含常规评审轮；最终审计不计入轮次，但其发现的问题如需修复会触发新的常规评审轮。**
- 第 1、2 轮与中段轮次（定义见"轮次策略"）的常规扫描覆盖 P0-P2；倒数第 3 轮的常规扫描只寻找新 P0。此限制不取消此前已 accepted finding 的修复，也不屏蔽强制终审扫描发现的问题；后者仍须进入普通裁决和修复流程。
- 最后两轮（倒数第 2、1 轮）的常规扫描只检查此前修复引入的回归。**终审触发的新轮次不受"倒数第N轮"规则限制**：按终审发现的问题性质决定（如发现新 P0/P1 应执行常规扫描，如只有回归则执行回归检查），但仍计入 max_rounds 上限。若修复后已没有轮次完成所需的互补复核和新终审，则报告 INCOMPLETE。
- **提前结束条件**：从第 2 轮起，每轮 round_decision 时检查最近两轮；若连续两轮都没有新找到的、范围内的 P0/P1/P2 问题，则跳过其后所有常规扫描轮，直接进入最终审计。判定口径：该轮没有新增范围内 P0/P1/P2 finding（被筛除或去重的候选、最终 rejected 的 finding 不算；P3 不算）。
- 已证实的 deferred 风险应披露，但本身不阻止收敛。达到轮次上限仍有未解决的范围内 P0/P1、未解决的 inconclusive 验证阻塞（blocked_by_user_changes 除外）或覆盖率不足时，标记 INCOMPLETE。不要为了达到轮数而继续提交低优先级改动。

**进入最终审计的条件**（满足其一即可）：

1. **提前收敛**（连续两轮都没有新找到的、范围内的 P0/P1/P2 问题后）：满足上方"提前结束条件"（判定口径见该处）
2. **达到上限**（完成 max_rounds 轮后）：无论如何都必须进入最终审计

**轮次记录与覆盖率**：每轮分别报告 raw_candidates、duplicates、screened_out（偏好/明确 scope 或 contract 非 finding）和 replay-eligible 独立 finding 数。被筛除的意见、重复项不进入反例覆盖率分母，但必须单独计数并写入 `.review-evidence/screening-log.md`（顶层文件，按轮次分节）。进入 finding 生命周期的候选（包括 needs-evidence 及之后被 rejected/deferred 的候选）必须获得标准 ID 和 `.review-evidence/findings-index.md` 中的索引行。

**反例覆盖率计算**：
- **分母（replay-eligible findings）**：所有获得标准 ID 的独立 finding（screened_out 与 duplicate 不算）
- **分子（已复现并留证）**：
  - **accepted**：必须有复现证据（reproduced），算在分子
  - **rejected**：必须有复现证据（not-reproduced，即有反证）才能拒绝，算在分子
  - **deferred**：已复现但推迟修复，算在分子
  - **needs-evidence**：缺少复现证据（blocked），不算在分子
- **计算公式**：counterexample_coverage = 分子 / 分母
- **自动化与手工复现分别报告**。分母为 0 时报告 N/A，不视为自动通过；须确认每个原始候选都已在 screening-log.md 有明确处理结果，并完成要求的评审与终审。
- **覆盖率低于 80% 时不得声称评审充分或收敛**；补足证据或在最终报告中标记 INCOMPLETE。
- **decision 或分类变更不得用于缩小分母**：一旦获得标准 ID，finding 永久计入分母，即使后续改为 rejected 或 deferred。

**回归 finding**：每条新 finding 在 adjudication.md 标记 `change_origin: regression | pre-existing | undetermined`。只有证据表明问题由本轮修复引入时才标 regression；无法确定时保持 undetermined，并将 decision 设为 needs-evidence。回归 finding 按实际影响评估严重性，不自动升高一级。

**needs-evidence 的处理**（按优先级）：
- **P0/P1**：必须解决（升级为 accepted 并验证，或有反证后 rejected），否则阻止收敛
- **P2**：按 adjudication.md 中的 needs_evidence_clarity 字段处理：
  - `clear_claim_lacking_env`：前提、触发路径和潜在影响已明确记录，仅缺少运行环境或外部依赖，可作为残余风险披露而不阻止收敛
    - 示例（不阻止收敛）：P2 "在 Redis 集群模式下，缓存可能读到过期数据" - 前提、路径、影响明确，但当前环境只有单机 Redis，无法复现；needs_evidence_clarity: clear_claim_lacking_env
  - `unclear_claim`：claim、范围或契约解释本身不明确，阻止收敛
    - 示例（阻止收敛）：P2 "某些情况下性能可能不好" - claim 不明确（哪些情况？期望值？实际值？）；needs_evidence_clarity: unclear_claim
- **P3**：可作为残余风险披露，不阻止收敛

**最终审计流程（必须使用子代理，完整提示模板见 agent-prompts.md 的"最终审计代理"章节）**：

- 由未参与本流程任何阶段（评审、复现审查、挑战、补强、实现、验证）的新代理完成，并记录该代理身份；分两阶段，防止历史结论锚定宽泛扫描。同一个终审代理先完成第一阶段，保存结果后，主代理才发送第二阶段材料。每次审计使用新目录 `.review-evidence/round-[N]/final-audit/attempt-[K]/`，不得覆盖之前轮次或尝试的结果。
  1. **未提示历史的扫描（盲扫）**：主代理从 baseline.md 中提取 MVP 范围和验收标准，在委派时直接提供给审计代理（代理不需要自己读取 baseline.md）。只提供 MVP 范围、验收标准、当前 HEAD 和测试/构建命令。不给 finding 列表、adjudication、历史评审结论或修复清单；要求先完成并保存独立扫描。不要让审计员读取 .review-evidence/ 中的任何历史内容（包括 baseline.md、历史 finding 材料等）。
  2. **定向复核**：扫描结果已保存后，再提供所有 accepted finding、未结的范围内 needs-evidence P0/P1、原始证据路径、修复测试路径和提交，要求逐项复核，并检查完整测试、构建、适用静态检查及遗留风险。
- 主代理预先提供新的输出路径。第一阶段代理不得读取任何已有 `.review-evidence/` 内容，但可以把本阶段结果写入指定文件；完整候选证据写在 inbox，摘要只在 blind-scan.md 记录一次。
- 若最终审计发现新问题：回到裁决流程；accepted 的问题仍修复并由验证代理验证。
  - 若 `rounds_consumed < max_rounds`：必须启动新的常规评审轮（计入 max_rounds 上限），该轮按终审发现的问题性质选择策略：
    - 发现新 P0/P1 或多个高风险区域问题 → 常规扫描（覆盖受影响区域）
    - 仅发现回归或单个修复引入的问题 → 回归检查
    - 该轮不受"倒数第N轮"规则限制（即使轮次数落在倒数第2、1轮，也按上述性质决定）
    随后重新审计（递增 attempt，最多共 3 次尝试）。
  - 若已达 max_rounds 轮上限：不再启动常规评审轮，报告 INCOMPLETE，并标注"已修复验证、但缺少独立互补评审轮复核"的项及未修复的项。
- 最终审计最多 3 次尝试；第 3 次尝试仍发现需要修复的问题时，报告 INCOMPLETE（修复与验证仍按上一条执行并标注）。
- 关键规则：第一阶段扫描已保存后，再给同一审计员第二阶段提示，不要改写第一阶段结论；不得询问 "是否还有其他问题" 或依赖对话记忆，所有 finding 必须写在指定证据文件中；第一阶段结果是基线，第二阶段逐项复核但不必重复第一阶段已列举的 finding。

**完成后**：进入收敛判定和最终报告。

### 6. 收敛判定与最终报告 (Phase: report)

**收敛条件**（全部满足才是 CONVERGED）：
- 所有 accepted 且范围内的 P0/P1 已修复且验证通过，或为 blocked_by_user_changes（后者在最终报告单独披露并提供手工合并建议）；rejected/deferred 的不计入；范围内 P0/P1 不得停留在 needs-evidence（须升级为 accepted 并验证，或有反证后 rejected）
- 所有 accepted finding（所有优先级）已 verified 或 blocked_by_user_changes（后者在最终报告中单独披露，提供手工合并建议）
- 反例覆盖率（replay-eligible findings 中已重放并留下证据的比例）≥80%
- 最终审计两阶段完成且无新 accepted findings
- P2 needs-evidence 中，所有 `needs_evidence_clarity: unclear_claim` 的必须解决；`clear_claim_lacking_env` 的可作为残余风险

**未满足时报告 INCOMPLETE**，列明残余风险、阻塞原因和未验证项。

**最终报告**：将最终报告写入 `.review-evidence/final-report.md`（从 screening-log.md、findings-index.md 和 run-state.md 汇总轮次、状态、证据、测试、提交、风险和收敛结论），把 run-state.md 的 `overall_status` 更新为 `converged` 或 `incomplete`，并对照基线列出评审期间未纳入本流程的用户改动。无论 CONVERGED 或 INCOMPLETE，都附上所有 screened_out_preference 建议的汇总清单供用户决策。

**清理临时文件**：
- 删除 `tests/review/` 整个目录（candidates/、reproductions/、verifications/）
- 保留项目正式测试文件中已合并的测试用例
- 保留 `.review-evidence/` 目录作为审计证据
- 还原 baseline 阶段为隔离临时测试对项目测试配置所做的临时改动（仅还原自己引入的部分，不触碰用户改动；无法安全还原时记录）
- 按 baseline.md 的 "Recovery Guide Deployment" 记录还原项目级指令文件：appended 模式删除标记分节并对照备份确认用户内容未受损；created 模式在文件仍只含本指南时删除整个文件，否则仅删除标记分节；无法安全还原时记录

**可选归档**（长期项目）：
- 压缩轮次证据以节省存储空间（见 [references/archival.md](references/archival.md)）
- 仅在评审循环完成（CONVERGED 或 INCOMPLETE）后执行
- 保持核心索引文件（baseline.md、run-state.md、findings-index.md）可读

## 恢复检查点

**压缩上下文后恢复时的强制步骤**（恢复指南由启动部署写入项目级指令文件；若标记和恢复指南标题均缺失，先按"0. 建立基线"重新部署）：
1. 立即读取 `.review-evidence/run-state.md`
2. 确认 `current_phase`、`current_round`、`max_rounds`、`rounds_consumed`、`can_trigger_new_round` 和 `next_action`
3. 根据 `next_action` 继续执行，不要跳过或重复已完成的阶段
4. 这是多轮循环流程（最少 2 轮，最多 max_rounds 轮，默认 5），不要在第 1 轮后就结束
