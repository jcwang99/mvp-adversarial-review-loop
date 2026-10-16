# 评审协议与交接格式

本文件定义评审角色、finding 裁决流程、挑战/补强机制、验证要求、轮次边界和收敛规则。

**所有子代理的完整提示模板和输出格式**见 `agent-prompts.md`。本文件只保留协议规则和流程说明。

## 评审角色选择

根据 MVP 范围选择角色，每轮至少 3 个角色，不同角色不能重复：

- **SEC** (security)：认证、授权、数据保护、注入、XSS、CSRF、敏感信息泄露
- **FUNC** (functionality)：核心功能契约、业务逻辑、边界条件、数据验证
- **REL** (reliability)：错误处理、并发、资源清理、数据一致性、幂等性
- **API** (api-compatibility)：版本兼容、废弃声明、破坏性变更、响应格式
- **PERF** (performance)：响应时间、查询效率、资源占用、扩展性瓶颈
- **UX** (accessibility)：键盘导航、屏幕阅读器、ARIA、颜色对比、焦点管理
- **OPS** (operations)：日志、监控、可调试性、部署、配置、测试覆盖
- **PROD** (product)：产品契约、用户体验一致性、错误消息清晰度

第 1、2 轮默认选择：SEC、FUNC、REL，根据项目特点补充其他角色。
第 3 轮起：根据前序发现的高风险区域，选择针对性角色。
第 4、5 轮：仅检查回归，选择与已修复 findings 相关的角色。

## 评审代理提示模板

**完整提示模板和输出格式**见 `agent-prompts.md` 的"评审代理（Review Agent）"章节。

**关键要求摘要**：
- 为每个代理替换 round、role-slug、范围和验收标准
- 第 4、5 轮提供待检查的修复提交/变更路径，但不提供历史 finding 或预期结论
- 临时测试文件写入 `tests/review/candidates/r{round}_{role}_{temp_id}.test.{ext}`
- 证据文档写入 `.review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/`
- 返回固定 YAML 结构的摘要，完整日志写入 output.log
- 代理返回属于交接摘要，不是第二份证据副本。主代理只在裁决当前 finding 时读取其完整证据

## Finding ID 与证据路径

每个代理只需在自身 role-slug 目录内保证临时 ID 唯一，例如：

- security 角色：SEC-001、SEC-002、...
- functionality 角色：FUNC-001、FUNC-002、...

类别代码：SEC 安全隐私；FUNC 功能边界；REL 可靠性一致性；API API兼容性；PERF 性能资源；UX 可访问性；OPS 测试运维；PROD 产品契约。

## 独立复现审查员

**完整提示模板和输出格式**见 `agent-prompts.md` 的"独立复现审查代理（Replay Reviewer Agent）"章节。

**关键要求摘要**：
- 主代理完成去重、范围/契约初筛并分配标准 ID 后，对可复现候选指派一名未提交该候选的独立复现审查员
- 原评审员运行过的结果可作线索，但不能替代独立复现
- 挑战代理的独立重放可满足此要求；高风险或证据异常项还须由主代理加验或再委派第二个独立审查
- 返回 `reproduced`、`not-reproduced` 或 `blocked`，完整复现报告写入 replay-review.md

**结果解释**：
- `reproduced`：有效前提下观察到 claim 所述行为；是否违反承诺范围由主代理另行裁决
- `not-reproduced`：前提和断言有效、复现完整运行，但观察结果明确不符合 claim；记录具体反证
- `blocked`：环境、依赖、前提、脚本或观察点不完整，无法判断 claim；保留 `needs-evidence`，不得据此 rejected

主代理审查 replay-review.md 和关键原始输出后，填写 adjudication。P0/P1、权限/数据完整性/公开 API、高影响 finding，以及结果互相矛盾或不寻常的证据，主代理必须亲自加验或再委派第二个独立审查。若没有独立代理可用，主代理亲自复现作为退路。

## 主代理筛查与裁决

对每条去重后的独立候选，主代理独立完成筛查、裁决和必要的复现。提出意见的代理不得单独决定自己的 finding 是否成立。

### 1. 范围与契约筛查

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
[4] 该行为是否可能影响已承诺边界、数据、权限或用户？
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

### 2. 优先级与严重性判定

- **P0** (critical)：数据丢失/泄露、认证绕过、权限提升、完全不可用、公开 API 破坏性变更
- **P1** (high)：部分功能失效、安全漏洞（非完全绕过）、数据不一致、明显性能问题、可访问性阻断
- **P2** (medium)：边界条件失败、错误消息不清晰、日志缺失、次要功能缺陷
- **P3** (low)：优化建议、测试覆盖改进、文档缺失、代码风格

### 3. 复现与独立验证

通过筛查的候选必须由独立复现审查员、挑战代理或主代理之一运行 reproduction；执行者必须与提出候选的评审员不同。**主代理启动一个复现审查代理，一次性给它多个 findings 的任务列表（推荐 3-5 个），由该代理依次处理；默认不同时启动多个复现审查代理（算力限制），除非用户明确授权并行。** 手工步骤仅在已确认无法自动化时使用。记录精确命令/操作、环境、退出状态、观察结果及证据路径。主代理必须检查证据与 claim 相符，且在 adjudication.md 中注明复现者和证据路径；不要求主代理重复每条常规命令。

**裁决逻辑**（主代理综合筛查、复现审查、挑战/补强结果后决定）：

- **reproduced 且范围契约相符**：decision 为 accepted，安排修复。P0/P1 优先；P2 根据轮次和资源决定；P3 一般 deferred，在最终报告中披露。
- **reproduced 但范围不符或影响低于声称严重性**：修订 severity 或 claim 后 deferred，或降级后 accepted。
- **not-reproduced 且有明确反证**：decision 为 rejected，写明理由和反证路径。
- **blocked 或 reproduction 不完整**：decision 为 needs-evidence，列出需要的证据。可派补强代理修正小缺陷。根本无法运行但仍有合理方向的，保留 needs-evidence；补强代理不能修正本身不证明问题不存在。

**注意**：
- 前提或证据不充分：decision 为 needs-evidence，列出需要的证据。可派补强代理修正小缺陷。根本无法运行但仍有合理方向的，保留 needs-evidence；补强代理不能修正本身不证明问题不存在。

### 4. 挑战代理

**完整提示模板和输出格式**见 `agent-prompts.md` 的"挑战代理（Challenge Agent）"章节。

**挑战代理采用单代理批量处理**：主代理启动一个挑战代理，一次性给它多个需要挑战的 findings（推荐 2-4 个），由该代理依次挑战；默认不同时启动多个挑战代理（算力限制），除非用户明确授权并行。优先挑战最高严重性或最敏感领域的 findings。

**结果解释**：
- `supports`：挑战者有效重放了 claim，且未找到足以推翻它的证据。主代理确认挑战未推翻 finding 后，decision 可为 accepted。
- `disputes`：必须附具体反证，证明前提不成立、行为符合契约或影响/严重性需要修订。主代理审查双方证据；证据充分时 rejected，影响较小则降级/修订后 accepted，争议未解决则 needs-evidence。
- `inconclusive`：单纯重放失败、环境不可用或观察不确定不能标为 disputes，必须标 `inconclusive`。不是自动接受。主代理基于已有重放证据作决定；证据仍不足则 needs-evidence。

挑战代理不得修改项目代码、测试或 finding 的原始 reproduction。

### 5. 补强代理

**完整提示模板和输出格式**见 `agent-prompts.md` 的"补强代理（Reinforce Agent）"章节。

**仅在反例思路合理但有小的执行瑕疵时使用**。补强代理采用单代理批量处理：主代理启动一个补强代理，一次性给它多个需要补强的 findings（推荐 2-3 个），由该代理依次处理；默认不同时启动多个补强代理（算力限制），除非用户明确授权并行。补强代理只修改标准 ID 目录内的 reproduction 或 counterexample.md，不改项目文件。

**结果解释**：
- `fixed`：主代理重新检查并重放；补强成功本身不等于 finding 成立
- `cannot-fix`：保留 needs-evidence，说明未解决部分；不能仅因代理补强失败而 rejected
- 如果补强结果证明原假设错误，再由主代理基于该证据裁决 rejected

## 修复验证

**完整提示模板和输出格式**见 `agent-prompts.md` 的"验证代理（Verification Agent）"章节。

**验证代理采用单代理批量处理**：主代理启动一个验证代理，一次性给它多个修复提交的验证任务（推荐 3-5 个），由该代理依次验证；默认不同时启动多个验证代理（算力限制），除非用户明确授权并行。每个修复提交后，使用未参与该 finding 实现的验证代理。提供当前 HEAD、commit、原始 finding、原始 reproduction 路径、修复后的项目测试路径和必要的运行入口。不要把实现代理的结论当作验证结果。

若所有可用代理都已参与该 finding 的实现，由主代理执行验证，并在 verification-result.md 标注 verified_by: main-agent。主代理按相同的检查要求和证据标准判定 pass、fail 或 inconclusive；最终报告列明由主代理验证的 finding。

**结果解释**：
- **pass**：验证执行者完成所有要求的检查，且主代理确认记录和证据后，verification 记 pass，finding 可标 verified。执行者为主代理时，按上述兜底规则记录。
- **fail**：verification 记 fail，保持未 verified，回到修复或创建新的回归 finding。
- **inconclusive**：保持 accepted 但未 verified，记录环境/证据阻塞；不得把它作为 pass 或直接开始收敛终审。

## 覆盖率与轮次记录

每轮分别报告 raw_candidates、duplicates、screened_out（偏好/明确 scope 或 contract 非 finding）和 replay-eligible 独立 finding 数。被筛除的意见、重复项不进入反例覆盖率分母，但必须单独计数并写入 `.review-evidence/round-[N]/screening-log.md`。进入 finding 生命周期的候选（包括 needs-evidence 及之后被 rejected/deferred 的候选）必须获得标准 ID 和 `.review-evidence/round-[N]/findings-index.md` 中的索引行。

counterexample_coverage = 已由主代理或独立执行者重放并留证的 replay-eligible 独立 finding 数 / replay-eligible 独立 finding 总数。缺少证据或环境阻塞的 finding 仍在分母内。自动化与手工复现分别报告。分母为 0 时报告 N/A，不视为自动通过；须确认每个原始候选都已在 screening-log.md 有明确处理结果，并完成要求的评审与终审。覆盖率低于 80% 时不得声称评审充分或收敛；补足证据或在最终报告中标记 INCOMPLETE。

## 轮次上限与优先级

- 默认最多 5 轮常规评审，每轮最多 6 个评审角色。**轮次计数只包含常规评审轮；最终审计不计入轮次，但其发现的问题如需修复会触发新的常规评审轮。**
- 第 1、2 轮的常规扫描覆盖 P0-P2；第 3 轮的常规扫描只寻找新 P0。此限制不取消此前已 accepted finding 的修复，也不屏蔽强制终审扫描发现的问题；后者仍须进入普通裁决和修复流程。
- 第 4、5 轮的常规扫描只检查此前修复引入的回归。终审发现的新候选仍须裁决；若修复后已没有轮次完成所需的互补复核和新终审，则报告 INCOMPLETE。
- **提前结束条件**：连续 2 轮（第 1、2 轮）没有新的、范围内且仍未解决的 P0/P1，也没有新 accepted P2，可在完成第 2 轮后跳过第 3-5 轮常规扫描，直接进入最终审计。此条件仅适用于前 2 轮；第 3 轮后不再适用（第 3 轮本身只找 P0，"没有新 accepted P2"已不是有效判断标准）。
- **正常进入最终审计的时机**：
  - 每轮常规评审结束（所有 accepted finding 已 verified）后，检查是否满足提前结束条件
  - 若不满足提前结束条件且未达第 5 轮上限，进入下一轮常规评审
  - 若达到第 5 轮上限，或在第 3-5 轮后没有新的范围内 P0/P1 且所有 accepted finding 已 verified，进入最终审计
  - 未解决的验证阻塞（inconclusive）阻止进入最终审计，应报告 INCOMPLETE
- 范围内 P0/P1 的 accepted 未修复或 needs-evidence 都是未解决项，阻止收敛。**常规评审轮中的 P2 needs-evidence 按 adjudication.md 中的 needs_evidence_clarity 字段处理**：
  - `clear_claim_lacking_env`：前提、触发路径和潜在影响已明确记录，仅缺少运行环境或外部依赖，可作为残余风险披露而不阻止收敛
    - 示例（不阻止收敛）：P2 "在 Redis 集群模式下，缓存可能读到过期数据" - 前提、路径、影响明确，但当前环境只有单机 Redis，无法复现；needs_evidence_clarity: clear_claim_lacking_env
  - `unclear_claim`：claim、范围或契约解释本身不明确，阻止收敛
    - 示例（阻止收敛）：P2 "某些情况下性能可能不好" - claim 不明确（哪些情况？期望值？实际值？）；needs_evidence_clarity: unclear_claim
- 范围外且已证实的 deferred 风险应披露，但本身不阻止收敛。达到轮次上限仍有未解决的范围内 P0/P1、accepted finding 验证阻塞或覆盖率不足时，标记 INCOMPLETE。不要为了达到轮数而继续提交低优先级改动。

### 回归 finding

每条新 finding 在 adjudication.md 标记 `change_origin: regression | pre-existing | undetermined`。只有证据表明问题由本轮修复引入时才标 regression；无法确定时保持 undetermined，并将 decision 设为 needs-evidence。回归 finding 按实际影响评估严重性，不自动升高一级。

## 最终审计与收敛

**完整提示模板和输出格式**见 `agent-prompts.md` 的"最终审计代理（Final Audit Agent）"章节。

**最终审计的触发时机**：
- 最终审计不属于常规评审轮（不计入 5 轮上限），而是在满足特定条件后触发的独立阶段
- **提前触发**：第 2 轮后若连续两轮没有新的范围内 P0/P1 且无新 accepted P2，可跳过第 3-5 轮直接进入最终审计
- **正常触发**：第 3-5 轮中任一轮结束后，若没有新的范围内 P0/P1（考虑该轮优先级限制）且所有 accepted finding 已 verified，可进入最终审计
- **强制触发**：第 5 轮结束后，无论是否还有未解决问题，都必须进入最终审计以评估最终状态

**最终审计与轮次的关系**：
- 若最终审计第一阶段（盲扫）发现新问题，该问题必须回到普通裁决流程
- 若该问题被 accepted 并修复，必须启动新的常规评审轮检查受影响区域和回归，然后重新进行最终审计
- 终审触发的新常规评审轮计入 5 轮上限；若已达第 5 轮上限，报告 INCOMPLETE
- 最终审计本身最多重试 2 次（共 3 次尝试）；若第 3 次仍发现需要修复的问题，报告 INCOMPLETE

**最终审计的执行流程**：

最终审计由未参与前序评审或实现的新代理完成，分两阶段，防止历史结论锚定宽泛扫描。同一个终审代理先完成第一阶段，保存结果后，主代理才发送第二阶段材料。每次审计使用新目录 `.review-evidence/round-[N]/final-audit/attempt-[K]/`，不得覆盖之前轮次或尝试的结果：

1. **未提示历史的扫描（盲扫）**：只提供 MVP 范围、验收标准、当前 HEAD 和测试/构建命令。不给 finding 列表、adjudication、历史评审结论或修复清单；要求先完成并保存独立扫描。不要让审计员读取 .review-evidence/ 中的历史 finding 材料。
2. **定向复核**：扫描结果已保存后，再提供所有 accepted finding、原始证据路径、修复测试路径和提交，要求逐项复核，并检查完整测试、构建、适用静态检查及遗留风险。

主代理预先提供新的输出路径。第一阶段代理不得读取任何已有 `.review-evidence/` 内容，但可以把本阶段结果写入指定文件；完整候选证据写在 inbox，摘要只在 blind-scan.md 记录一次。

**关键规则**：
- 第一阶段扫描已保存后，再给同一审计员第二阶段提示，不要改写第一阶段结论
- 不得询问 "是否还有其他问题" 或依赖对话记忆；所有 finding 必须写在指定证据文件中
- 第一阶段结果是基线，第二阶段逐项复核但不必重复第一阶段已列举的 finding

## 收敛条件

**全部满足才能标记 CONVERGED**：
- 所有 accepted 且范围内的 P0/P1 已修复且验证通过
- 所有 accepted finding（所有优先级）已 verified 或 blocked_by_user_changes（后者在最终报告中单独披露）
- 反例覆盖率 ≥80%
- 最终审计两阶段完成且无新 accepted findings
- P2 needs-evidence 中，所有 `needs_evidence_clarity: unclear_claim` 的必须解决；`clear_claim_lacking_env` 的可作为残余风险

**未满足时标记 INCOMPLETE**，列明残余风险、阻塞原因和未验证项。
