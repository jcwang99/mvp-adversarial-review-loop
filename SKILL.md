---
name: mvp-adversarial-review-loop
description: 当用户要求对已完成的 MVP 进行评审、查找并修复问题（覆盖产品、功能、安全、可靠性、API、性能、可访问性、运维等领域），或要求对抗式/多轮评审、反例验证、有证据且可审计的修复时使用。
---

# MVP 对抗式评审循环

以可重放证据确认缺陷，以 TDD 修复，以独立验证确认修复，多轮有界，最后进行盲扫审计。主代理保留判断权；子代理提供独立评审、挑战、实现或验证结果。

**控制面与细节分离**：本文件只保留常驻的硬规则、阶段状态机、轮次策略和收敛判定。进入具体阶段前，读取 `references/phase-playbooks.md` 的对应章节；委派模板只从 `references/agent-prompts.md` 取。**状态和格式由 `scripts/reviewctl.js` 约束**：类型化状态只写 JSON，`run-state.md` / `findings-index.md` 是生成视图。

## 0. 启动与恢复

**首次加载**：先按 `references/phase-playbooks.md` §0 部署项目级恢复指南并建立 baseline，再开始评审。`<skill-dir>` 指本技能目录的实际安装路径（Claude Code 通常在 `~/.claude/skills/mvp-adversarial-review-loop/`，OpenCode 通常在 `~/.config/opencode/skills/mvp-adversarial-review-loop/`；以当前 harness 的 skill 位置为准）。本技能要求 Node.js（>= 18）和 Git；缺少任一依赖时不要启动循环，记录阻塞并报告。

**启动前编译预热**：只有实测全量测试/构建明显偏慢的项目（如 Rust、C++、大型 TypeScript）才在 baseline 运行前做编译加速，并把缓存路径、环境变量和磁盘预算写入 `baseline.md`；后续子代理在预算内复用缓存，超预算时在轮次边界集中清理。短编译项目沿用现有命令，不要额外引入缓存层。具体做法见 `references/phase-playbooks.md` §0。

**压缩上下文后恢复**：

1. 立即读取 `.review-evidence/run-state.md` 和 `.review-evidence/state.json`。
2. 运行 `node <skill-dir>/scripts/reviewctl.js status` 和 `node <skill-dir>/scripts/reviewctl.js validate`；校验失败先运行 `reviewctl normalize` 重算派生字段（`rounds_consumed`、`current_round`、`can_trigger_new_round` 等），仍失败则按错误逐项修复，不要继续委派。
3. 按 `current_phase` 和 `next_action` 继续；不要跳阶段，不要在第 1 轮后就结束。
4. 若项目级指令文件既无标记 `mvp-adversarial-review-loop-recovery-guide` 也无标题 `Main Agent Recovery Guide - MVP Adversarial Review Loop`，先按 `references/phase-playbooks.md` §0 重新部署。

**每次阶段切换后**运行 `reviewctl advance` / `record-*`；脚本更新 `state.json`、`findings.json` 和生成视图。不要手改这些文件。

## 1. 不可违反的约束

1. **主代理裁决**：子代理结论只是输入；范围、契约、状态和收敛由主代理决定。任何 finding 进入修复前必须有主代理确认的失败证据。
2. **证据持久化**：`.review-evidence/state.json` 和 `findings.json` 是事实来源；`run-state.md` / `findings-index.md` 由 `reviewctl` 生成，禁止手改。完整复现、命令输出和阶段记录写入文件；对话只留摘要和路径；敏感值先脱敏。
3. **独立性**：评审员不能复现或裁决自己的 finding；复现审查员不能是提出者；验证代理不能是实现者；最终审计代理不能参与过本流程任何阶段。
4. **先证明再修复**：每个 accepted finding 必须先确认 RED，再按 `references/tdd-and-commit.md` 完成 RED-GREEN-REFACTOR、回归和隔离提交。
5. **失败、未知、阻塞分开**：环境不可用或证据不足不能标 rejected 或 verified；未完成核验保持未完成并记录阻塞。
6. **默认串行**：一次一个子代理；评审角色串行，复现/挑战/补强/验证/实现按批次串行。只有用户明确授权且有独立 worktree 隔离时才并行；未经授权不得并发评审或进行真实外部写入。
7. **不覆盖用户改动**：修复提交只含当前 finding 的代码和正式测试；`.review-evidence/` 不进修复提交；禁止强制 checkout、reset、clean。
8. **真实报告**：没有完成要求的验证时报告 INCOMPLETE；不把测试绿灯或“未发现问题”当成收敛证据。
9. **授权留痕**：需要用户授权时使用当前 harness 的用户提问工具（Claude Code 的 AskUserQuestion、OpenCode 的 `question` 等；没有专用工具时直接在对话中提问并等待明确回答）；决策用 `reviewctl authorize --action ... --decision authorized|declined` 写入状态和 `blockers`，最终报告披露。
10. **轮次有界**：最少 2 轮常规评审，最多 `max_rounds`（默认 5，最小 2）；最终审计不计入轮次，但终审触发的新常规轮计入。
11. **手工与阻塞 finding**：确实无法自动化时用 `reviewctl record-implementation --id ID --status fixed --manual`，并在验证中提供独立人工复测；用户改动导致无法提交时运行 `reviewctl record-implementation --id ID --status prepared --reason "user changes conflict"`，再运行 `record-verification --status blocked_by_user_changes`；无法修复时运行 `reviewctl record-implementation --id ID --status cannot_fix --reason "REASON"`，环境或依赖阻塞时运行 `reviewctl record-implementation --id ID --status blocked --reason "REASON"`，然后登记未解决或进入 `adjudication` 重新裁决。本流程要求 Git（commit、worktree、guard-commit）；无 Git 时不得启动。
12. **编译缓存与磁盘预算**：长编译项目应在 baseline 预热，并在 `baseline.md` 记录的磁盘预算内复用共享缓存；不要为每个 finding 重建依赖或创建独立 target。缓存超过预算或磁盘紧张时，在轮次边界集中清理（如 `cargo clean`），不要每个 finding 都清理重建。短编译项目不强制引入缓存层。
13. **复核更早轮次的 deferred**：每轮 adjudication 必须对更早轮次所有 `deferred` finding 逐条给出本轮结论（`include` / `continue` / `reject`）并记录理由，使用 `record-finding --deferred-review-action ... --deferred-review-reason ...`；遗漏时 `advance` 会拒绝。`continue` 保持 deferred，`include` 改为 accepted 并进入本轮修复，`reject` 改为 rejected（需反证）。

## 2. 阶段状态机

| Phase | 主代理做什么 | 必须委派 | 出口 |
|-------|--------------|----------|------|
| `baseline` | 确认范围/验收/max_rounds，初始化证据，隔离临时测试，部署恢复指南 | 无 | `review` |
| `review` | 选角色、定范围、建 inbox | 至少 3 个独立评审代理，串行 | `adjudication` |
| `adjudication` | 筛查、去重、分配标准 ID、检查证据、裁决、复核更早轮次 deferred | 独立复现审查代理；必须范围内的挑战代理；必要时补强代理 | 有 accepted → `repair`；否则 → `round_decision` |
| `repair` | 一次一个 finding，检查 RED 和提交 | 实现代理 | `verification`；`cannot_fix`/`blocked` 时进入 `adjudication` 重新裁决，或登记未解决后 `round_decision` |
| `verification` | 检查证据、更新 finding 状态 | 验证代理（不能是实现者） | 下一个 finding；fail 回到 `repair`；回归问题进入 `adjudication`；全部终结后 `round_decision` |
| `round_decision` | 计数、判断提前收敛/轮次上限 | 无 | 下一轮 `review`、`final_audit`，或终审后的 `report` |
| `final_audit` | 提供盲扫材料、保存两阶段结果 | 未参与过本流程的新审计代理 | `report`；审计失败时直接 `report` 并 INCOMPLETE；有预算时新常规轮 |
| `report` | 收敛判定、报告、清理、还原指令文件 | 无 | 结束 |

**阶段入口必读**：

| 进入 | 读取 |
|------|------|
| `baseline` | `references/phase-playbooks.md` §0 |
| `review` | `references/phase-playbooks.md` §1 |
| `adjudication` | `references/phase-playbooks.md` §2 |
| `repair` | `references/phase-playbooks.md` §3 + `references/tdd-and-commit.md` |
| `verification` | `references/phase-playbooks.md` §4 |
| `round_decision` | `references/phase-playbooks.md` §5 |
| `final_audit` | `references/phase-playbooks.md` §6 |
| `report` | `references/phase-playbooks.md` §7 |
| 委派任何子代理 | `references/agent-prompts.md` 对应模板 |
| 状态操作、校验、提交守卫 | `scripts/reviewctl.js`（`reviewctl help`） |
| 证据目录、JSON 状态模板 | `references/evidence-structure.md` |
| 完成后归档（可选） | `references/archival.md` |

不要默认加载所有 reference；只读当前阶段需要的章节。

## 3. 委派硬门禁

- **所有阶段**：状态只通过 `reviewctl` 修改；进入下一阶段前运行 `reviewctl validate`；修复提交前运行 `reviewctl guard-commit`。
- **提示词路径**：委派任何子代理时，把模板中的 `[skill-dir]` 替换为当前 harness 的技能安装目录绝对路径（动态确定，不要写死），并在提示中提供 `node [skill-dir]/scripts/reviewctl.js` 的用法；子代理只读使用脚本，不得修改状态或推进阶段。
- **review**：每个角色一个独立、只读子代理；至少 3 个不同角色；用 `reviewctl new-inbox` 创建 inbox；临时测试只写 `tests/review/candidates/`；每个代理必须写 `handoff.json`。
- **adjudication**：复现必须由未提出该候选的独立代理执行，并写入 `replay-review.md`；提出者不能单独决定自己的 finding；P0/P1、权限/数据完整性/公开 API 或证据异常项，主代理必须检查证据，必要时再委派第二个独立审查。
- **必须挑战**：所有拟 accepted 的 P0/P1，以及复现结果矛盾或不寻常的证据。无法挑战必须范围项时，必须获得用户明确授权并留痕。
- **repair**：一个实现代理只处理一个 finding；必须按 TDD 先 RED 后 GREEN；一个 finding 一个提交；blocked/unresolved 后用 `reviewctl next-finding` 切换。
- **verification**：验证代理不能是实现者；必须在修复前 commit 重放原始反例（默认独立 worktree，兜底方案需主代理批准）；至少生成 2 个相邻测试（正常 + 边界）并合并到正式测试文件，用 `--merged-test` 记录；无法生成时用 `--adjacent-reason` 说明；验证代理的 `blocked` 结论按 `inconclusive` 记录；同一 finding 最多 2 次修复-验证循环。
- **final_audit**：审计代理不得参与过评审、复现、挑战、补强、实现或验证；第一阶段盲扫不得读取 `.review-evidence/` 历史内容；第一阶段保存后才发第二阶段材料；最多 3 次尝试。
- **主代理兜底**：只有没有未参与该 finding 的独立代理可用（所有可用代理都提交过相关候选，或没有代理可用）且用户明确授权时，主代理才能亲自复现或验证；必须在 `adjudication.md` 标为高风险，并在最终报告单独披露。

## 4. 轮次策略

| 轮次位置 | 扫描范围 | 角色选择 |
|----------|----------|----------|
| 第 1、2 轮及中段（第 3 轮至倒数第 4 轮，`max_rounds ≥ 6` 时存在） | 广扫 P0-P2 | 默认 SEC、FUNC、REL，按项目补充 |
| 倒数第 3 轮（`max_rounds - 2`，`max_rounds ≥ 3`） | 只寻找新 P0 | 针对前序高风险区域 |
| 倒数第 2、1 轮（`max_rounds - 1`、`max_rounds`） | 只检查回归 | 与已修复 findings 相关的角色 |
| 终审触发的新常规轮 | 按问题性质：新 P0/P1 → 广扫；仅回归 → 回归检查 | 相应角色 |

- “倒数第 N 轮”按相对 `max_rounds` 的固定位置计算，与实际消耗轮次无关；提前收敛时这些位置不会到达。
- 每轮至少 3 个、最多 6 个不同角色。
- 同一轮命中多个位置时，按以下优先级决定：**第 1 轮始终广扫**（尚无修复可回归）→ **最后两轮只查回归** → **倒数第 3 轮只找新 P0** → 其余轮次广扫。`max_rounds < 5` 时按此优先级压缩，广覆盖由最终审计盲扫补足。
- 被判定为回归检查的轮次给代理提供待检查的修复提交/变更路径，但不提供历史 finding、裁决或预期结论。
- 终审触发的新轮不受“倒数第 N 轮”限制。

**角色表**：

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

## 5. 收敛判定

进入最终审计的条件（满足其一）：

1. **提前收敛**：从第 2 轮起，最近连续两轮都没有新找到的、范围内的 P0/P1/P2；被筛除/去重/rejected 的候选和 P3 不算。
2. **达到上限**：完成 `max_rounds` 轮常规评审。

| 状态 | 条件（全部满足） |
|------|------------------|
| `CONVERGED` | 所有 accepted 且范围内 P0/P1 verified；所有 accepted verified；所有修复已进入 git 历史；相邻测试已合并到正式测试（`merged_tests`）；无 `blocked_by_user_changes`；调整后覆盖率 ≥80%；最终审计两阶段完成且该次审计没有新的 accepted（盲扫重复报告的 rejected 候选不算）；无 `unclear_claim` 的 P2 needs-evidence；P3 可作残余风险 |
| `CONVERGED_WITH_MANUAL_MERGE` | 所有 accepted 且范围内 P0/P1 verified 或 `blocked_by_user_changes`（有手工合并建议）；所有 accepted verified 或 `blocked_by_user_changes`；至少一个 `blocked_by_user_changes`；调整后覆盖率 ≥80%；最终审计两阶段完成且该次审计没有新的 accepted；无 `unclear_claim` 的 P2 needs-evidence；P3 可作残余风险 |
| `INCOMPLETE` | 有未解决范围内 P0/P1；有未解决 `inconclusive`；调整后覆盖率 <80%；达到 `max_rounds` 但最终审计未完成或仍有新 accepted |

- 已复现的范围内 P0/P1 `deferred` finding 视为未解决，阻止 `CONVERGED` 和 `CONVERGED_WITH_MANUAL_MERGE`；P2/P3 `deferred` 可作为残余风险，但必须在最终报告披露。
- 范围内 P0/P1 不得停留在 `needs-evidence`：必须升级 accepted 并验证，或有反证后 rejected。
- 原始覆盖率 = 已裁决（复现为 accepted/deferred，或有 not-reproduced 反证为 rejected）/ 所有标准 ID；豁免项为所有 P3 needs-evidence 和 `clear_claim_lacking_env` 的 P2 needs-evidence；调整后覆盖率 = 分子 / (分母 - 豁免项)。
- 报告必须同时披露原始覆盖率、豁免项数量和调整后覆盖率；低于 80% 不得声称收敛。分母为 0 时必须用 `finalize --ack-empty-coverage` 显式确认，不能静默视为通过。
- 未解决的 `inconclusive` 不阻止最终审计执行，但结论只能为 INCOMPLETE。

## 6. 常见错误

| 错误 | 正确做法 |
|------|----------|
| 第 1 轮后就结束 | 至少 2 轮，检查 `current_round` |
| 主代理自己做评审/复现/修复/验证 | 委派独立子代理，保留裁决权 |
| 评审后跳过 adjudication | 先筛查、去重、独立复现、必要挑战 |
| 修复后不验证 | 委派未参与实现的验证代理 |
| 把 `blocked` 当 `rejected` | 保留 `needs-evidence` |
| 手工 finding 被测试卡住 | 用 `reviewctl record-implementation --id ID --status fixed --manual`，验证时记录独立人工复测 |
| 忘记更新状态 | 用 `reviewctl advance` / `record-*`，不要手改 JSON |
| 校验失败就手改 JSON | 先运行 `reviewctl normalize`，仍失败再按错误修复 |
| 手改 `run-state.md` / `findings-index.md` | 运行 `reviewctl render` 重新生成 |
| 跳过 `reviewctl validate` | 每个阶段边界和提交前都运行 |
| 到 `max_rounds` 仍启动新常规轮 | 报告 INCOMPLETE |
| 把 `.review-evidence/` 混入修复提交 | `reviewctl guard-commit` 会拒绝 |
