---
name: mvp-adversarial-review-loop
description: 当用户要求对已完成的 MVP 进行评审、查找并修复问题（覆盖产品、功能、安全、可靠性、API、性能、可访问性、运维等领域），或要求对抗式/多轮评审、反例验证、有证据且可审计的修复时使用。
---

# MVP 对抗式评审循环

主代理根据项目契约裁决可重放的反例。独立代理评审、复现、实现和验证，最后由新代理盲扫。常规评审至少两轮，轮次上限在 baseline 与用户确认（默认 5）。

## 0. 启动与恢复

要求 Node.js ≥18 和 Git。开始时与用户一次确认轮次上限及可选的角色模型。已有选择直接采用，未指定模型的角色由 harness 使用默认值或交给主代理决定。

- 用 `reviewctl init --max-rounds N --user-confirmed` 保存启动配置。每项指定追加一个 `--role-model ROLE=MODEL`，例如 `--role-model review=provider/model-a --role-model FUNC=provider/model-b --role-model repair=provider/model-c`。
- `main` 对应主代理，`review` 是八个评审领域的通用设置，单个领域可按下表代码覆盖。其余角色为 `replay`、`challenge`、`reinforce`、`repair`、`verification`、`final-audit`。
- 主代理在调度前运行 `reviewctl model-for --role ROLE`。有值时用 harness 的模型参数或角色配置启动代理；返回 `null` 时沿用默认或由主代理选择。主代理仅在 harness 支持时切换自己的模型。指定模型不可用或该角色不支持切换时，告知用户受影响的角色及实际回退方式，并继续流程。代理独立性按参与记录判断，同一模型可以用于不同的独立会话。

首次启动按 `references/phase-playbooks.md` §0 建立 baseline 并记录恢复指南路径。恢复时按技能目录的 `AGENTS.md` 找到当前阶段、活动 finding 和下一步。

## 1. 测试与证据

在 baseline 根据项目实际测试耗时和覆盖范围选模式。希望减少全量次数、且有能覆盖普通修复的快速套件时，优先选 `progressive`。沿用已确认的模式。每次 full 都按项目声明的完整命令、原始长测尺度和资源条件执行。

| 被评审项目的门禁 | progressive | default | full-everywhere |
|---|---|---|---|
| 基线 | full | full | full |
| 普通风险 P2/P3 修复提交前 | fast | full | full |
| 普通修复的独立验证 | 修复后反例 + impacted | 修复后反例 + impacted | 修复后反例 + full |
| P0/P1 或高风险修复 | 提交前 full，验证者独立 full | 同左 | 同左 |
| 常规轮末 | 当前 HEAD 的 full 证据，先检查复用 | 无额外 full | 无额外 full |
| 每次终审 | 第二阶段由新审计代理运行一次 full | 同左 | 同左 |

轮末复用条件见 `references/phase-playbooks.md` §5.2。风险不明按高风险处理。每个修复仍须先证明 RED，提交前通过适用的代码质量门禁。`already_fixed` 的例外和高风险路径见 `references/tdd-and-commit.md`。相邻测试由主代理按轮及终审 attempt 单独批测。

- 从项目根目录运行 `node "<skill-dir>/scripts/reviewctl.js"`，通过它更新状态。原始日志先落盘并脱敏。主代理核对实跑命令、退出码、commit/tree、计数和风险判断。
- 默认串行。并行需用户明确授权并隔离 worktree。baseline 显式开启的 bounded 乐观修复仅生成预检候选，提升后仍须正式提交和独立验证，见阶段手册 §3.0。
- 保留用户改动和暂存内容。一个 finding 一个隔离提交。环境或证据阻塞时记录实际状态，所需授权经用户明确决定后用 `reviewctl authorize` 留痕。

## 2. 阶段状态机

| Phase | 主代理做什么 | 必须委派 | 出口 |
|-------|--------------|----------|------|
| `baseline` | 确认范围/验收/max_rounds，初始化证据，隔离临时测试，记录恢复入口 | 无 | `review` |
| `review` | 选角色、定范围、建 inbox | 至少 3 个独立评审代理，串行 | `adjudication` |
| `adjudication` | 筛查、去重、分配标准 ID、检查证据、裁决、复核更早轮次 deferred | 独立复现审查代理；必须范围内的挑战代理；必要时补强代理 | 有 accepted → `repair`；否则 → `round_decision` |
| `repair` | 一次一个 finding，检查 RED 和提交 | 实现代理 | `verification`；`cannot_fix`/`blocked` 时进入 `adjudication` 重新裁决，或登记未解决后 `round_decision` |
| `verification` | 检查证据、更新 finding 状态 | 验证代理（不能是实现者） | 下一个 finding；fail 回到 `repair`；回归问题进入 `adjudication`；全部终结后 `round_decision` |
| `round_decision` | 计数、判断提前收敛/轮次上限 | 无 | 下一轮 `review`、`final_audit`，或终审后的 `report` |
| `final_audit` | 提供盲扫材料、保存两阶段结果 | 未参与过本流程的新审计代理 | 无新问题或审计失败 → `report`；有新问题 → `adjudication` |
| `report` | 收敛判定、报告、清理、还原指令文件 | 无 | 结束 |

阶段手册 `references/phase-playbooks.md` 的 §0–§7 与上表依次对应。安全领域评审使用静态代码检查及防御性断言验证权限、隔离和数据保护契约。

委派时取 `references/agent-prompts.md` 的角色模板；修复和提交读 `references/tdd-and-commit.md`，机器证据示例见 `references/evidence-structure.md`。完成后可按 `references/archival.md` 归档。

## 3. 委派硬门禁

- **所有阶段**：状态只通过 `reviewctl` 修改；`advance` 会先校验证据，恢复或排查时可单独运行 `validate`；修复提交前运行 `reviewctl guard-commit`。
- **提示词路径**：委派任何子代理时，把模板中的 `[skill-dir]` 替换为当前 harness 的技能安装目录绝对路径（动态确定，不要写死），并在提示中提供 `node [skill-dir]/scripts/reviewctl.js` 的用法；子代理只读使用脚本，不得修改状态或推进阶段。
- **review**：每个角色一个独立、只读子代理；至少 3 个不同角色；用 `reviewctl new-inbox` 创建 inbox；临时测试只写 `tests/review/candidates/`；每个代理必须写 `handoff.json`。
- **adjudication**：复现必须由未提出该候选的独立代理执行，并写入 `replay-review.md`；提出者不能单独决定自己的 finding；P0/P1、权限/数据完整性/公开 API 或证据异常项，主代理必须检查证据，必要时再委派第二个独立审查。
- **必须挑战**：所有拟 accepted 的 P0/P1，以及复现结果矛盾或不寻常的证据。无法挑战必须范围项时，必须获得用户明确授权并留痕。
- **repair**：一个实现代理只处理一个 finding；必须按 TDD 先 RED 后 GREEN；一个 finding 一个提交；blocked/unresolved 后用 `reviewctl next-finding` 切换。
- **verification**：验证代理不能是实现者；复现证据必须包含 tested commit、tree hash 和测试文件 SHA-256。P0/P1、高风险或复现哈希无法核对时，验证代理必须在修复前 commit 的独立 worktree 重放原始反例；其余可信证据可跳过修复前重放，但仍需运行修复后的反例和 §1 规定的回归范围。至少生成 2 个相邻测试（正常 + 边界）放入 `tests/review/verifications/`，由主代理在轮末及终审前批测；发现缺陷时转为正式测试并登记 finding。无法生成时用 `--adjacent-reason` 说明；验证代理的 `blocked` 结论按 `inconclusive` 记录；同一 finding 最多 2 次修复-验证循环。
- **final_audit**：启动每次终审前，在当前 HEAD 对全部历史相邻测试做通过的聚合批测并记录 attempt、路径、哈希、精确命令、提交、tree、日志及计数；失败须按 finding 流程处理后重跑，终审后有新修复轮则重新聚合。已转为正式回归测试的相邻测试仅可通过 `promote-adjacent-test` 记录对应关系后从聚合中排除，原始测试保留。审计代理不得参与过评审、复现、挑战、补强、实现或验证；第一阶段盲扫不得读取 `.review-evidence/` 历史内容；第一阶段保存后才发第二阶段材料；最多 3 次尝试。
- **主代理兜底**：只有没有未参与该 finding 的独立代理可用（所有可用代理都提交过相关候选，或没有代理可用）且用户明确授权时，主代理才能亲自复现或验证；必须在 `adjudication.md` 标为高风险，并在最终报告单独披露。

## 4. 轮次策略

每轮选择 3–6 个不同领域，按以下顺序确定扫描范围。默认广扫使用 SEC、FUNC、REL，再按项目补充。

1. 终审触发的后续轮按新问题性质定范围。跨区域或新高风险问题广扫，局部回归检查相关变更。
2. 第 1 轮广扫 P0–P2。
3. 常规预算的最后两轮检查回归。向代理提供修复提交和变更路径，保留独立判断所需的盲审条件。
4. 倒数第 3 轮只寻找新 P0。其余轮次广扫 P0–P2。

**角色表**：

| 代码 | 领域 | 关注点 |
|------|------|--------|
| SEC | security | 认证、授权、数据保护、注入、XSS、CSRF、敏感信息泄露 |
| FUNC | functionality | 核心功能契约、业务逻辑、边界条件、数据验证 |
| REL | reliability | 错误处理、并发、资源清理、数据一致性、幂等性 |
| API | api | 版本兼容、废弃声明、破坏性变更、响应格式 |
| PERF | performance | 响应时间、查询效率、资源占用、扩展性瓶颈 |
| UX | accessibility | 键盘导航、屏幕阅读器、ARIA、颜色对比、焦点管理 |
| OPS | operations | 日志、监控、可调试性、部署、配置、测试覆盖 |
| PROD | product | 产品契约、用户体验一致性、错误消息清晰度 |

## 5. 收敛判定

进入最终审计的条件（满足其一）：

1. **提前收敛**：从第 2 轮起，最近连续两轮都没有新找到的、范围内的 P0/P1/P2；被筛除/去重/rejected 的候选和 P3 不算。
2. **达到上限**：完成 `max_rounds` 轮常规评审。

| 状态 | 条件（全部满足） |
|------|------------------|
| `CONVERGED` | 所有 accepted 且范围内 P0/P1 verified；所有 accepted verified；所有修复已进入 git 历史；每轮相邻测试批测及最后一次终审前全历史聚合批测均通过，批测发现的问题均已登记和处置；无 `blocked_by_user_changes`；调整后覆盖率 ≥80%；最终审计两阶段完成且该次审计没有新的 accepted（盲扫重复报告的 rejected 候选不算）；无 `unclear_claim` 的 P2 needs-evidence；P3 可作残余风险 |
| `CONVERGED_WITH_MANUAL_MERGE` | 所有 accepted 且范围内 P0/P1 verified 或 `blocked_by_user_changes`（有手工合并建议）；所有 accepted verified 或 `blocked_by_user_changes`；至少一个 `blocked_by_user_changes`；调整后覆盖率 ≥80%；最终审计两阶段完成且该次审计没有新的 accepted；无 `unclear_claim` 的 P2 needs-evidence；P3 可作残余风险 |
| `INCOMPLETE` | 有未解决范围内 P0/P1；有未解决 `inconclusive`；调整后覆盖率 <80%；达到 `max_rounds` 但最终审计未完成或仍有新 accepted |

- 已复现的范围内 P0/P1 `deferred` finding 视为未解决，阻止 `CONVERGED` 和 `CONVERGED_WITH_MANUAL_MERGE`；P2/P3 `deferred` 可作为残余风险，但必须在最终报告披露。
- 范围内 P0/P1 不得停留在 `needs-evidence`：必须升级 accepted 并验证，或有反证后 rejected。
- 原始覆盖率 = 已裁决（复现为 accepted/deferred，或有 not-reproduced 反证为 rejected）/ 所有标准 ID；豁免项为所有 P3 needs-evidence 和 `clear_claim_lacking_env` 的 P2 needs-evidence；调整后覆盖率 = 分子 / (分母 - 豁免项)。
- 报告必须同时披露原始覆盖率、豁免项数量和调整后覆盖率；低于 80% 不得声称收敛。分母为 0 时必须用 `finalize --ack-empty-coverage` 显式确认，不能静默视为通过。
- 未解决的 `inconclusive` 不阻止最终审计执行，但结论只能为 INCOMPLETE。
