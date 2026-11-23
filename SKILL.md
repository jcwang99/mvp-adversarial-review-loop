---
name: mvp-adversarial-review-loop
description: 当用户要求对已完成的 MVP 进行评审、查找并修复问题（覆盖产品、功能、安全、可靠性、API、性能、可访问性、运维等领域），或要求对抗式/多轮评审、反例验证、有证据且可审计的修复时使用。
---

# MVP 对抗式评审循环

主代理根据项目契约裁决可重放的反例。独立代理评审、复现、实现和验证，最后由新代理盲扫。常规评审至少两轮，轮次上限在 baseline 与用户确认（默认 5）。

## 0. 启动与恢复

从被评审项目的 Git 根目录运行，要求 Node.js ≥18。`init` 在写入证据前检查目标是 Git 工作树根目录且 HEAD 已有提交。下文的 `reviewctl` 均指 `node "<技能绝对路径>/scripts/reviewctl.js"`。从本次加载的技能定位脚本和恢复指南。

1. **分辨首次运行与恢复。** 已有 `.review-evidence/review-config.json` 或状态文件时，按技能目录的 `AGENTS.md` 检查运行进度。首次运行先保存分支、HEAD、`git status --short`（含暂存改动），供初始化后填写 baseline。
2. **一次收集启动选择。** 沿用用户已确认的轮次上限（至少 2，默认 5）和模型，只询问尚需确认的上限，同时允许用户指定任意角色模型。非交互示例为 `reviewctl init --max-rounds 5 --user-confirmed --role-model review=model-a --role-model FUNC=model-b`。在交互终端也可用 `reviewctl init --interactive`，一行输入 `5 review=model-a FUNC=model-b`。直接提交空行会采用 5 轮和默认模型配置。两个例子中的模型名均替换为 harness 可用的标识。
3. **应用模型。** 初始化后用 `reviewctl model-for --role main` 解析主代理模型。每次委派按实际角色查询，下表给出上例的结果。解析只读取保存的配置。若返回对象的 `model` 有值，主代理将其传给 harness 的模型参数或角色配置。未指定模型且没有可继承配置时返回 `model: null`，主代理可沿用 harness 默认值，也可按任务和 harness 能力选择可用模型。主代理自身的模型切换取决于 harness 能力。

| 调度对象 | `--role` | 上例返回的 `model` |
|---|---|---|
| 功能评审 | `FUNC`（也接受 `functionality`） | `model-b` |
| 其他评审领域 | 各自的领域代码，见 §4 | 未单配的领域继承 `review`，如 `SEC` 得到 `model-a` |
| 主代理及流程角色 | `main`、`replay`、`challenge`、`reinforce`、`repair`、`verification`、`final-audit` | 逐角色取值，本例均为 `null` |

`agents/openai.yaml` 提供技能选择器的显示信息和默认提示。角色模型设置保存在被评审项目的 `.review-evidence/review-config.json`。指定模型不可用时，向用户说明受影响角色和实际回退方式。模型回退仍须满足 §3 的独立会话要求。首次运行接阶段手册 §0 填写 baseline，已有运行沿用原配置。

## 1. 测试与证据

在 baseline 根据项目实际测试耗时和覆盖范围选模式。希望减少全量次数、且有能覆盖普通修复的快速套件时，优先选 `progressive`。沿用已确认的模式。每次 full 都按项目声明的完整命令、原始长测尺度和资源条件执行。

| 被评审项目的门禁 | progressive | default | full-everywhere |
|---|---|---|---|
| 基线 | full | full | full |
| 普通风险 P2/P3 修复提交前 | fast | full | full |
| 普通修复的独立验证 | 修复后反例 + impacted | 修复后反例 + impacted | 修复后反例 + full |
| P0/P1 或高风险修复 | 提交前 full，验证者独立 full | 同左 | 同左 |
| 常规轮末 | 当前 HEAD 的 full 证据，先检查复用 | 无额外 full | 无额外 full |
| 每次终审 | 同一位审计代理在盲扫落盘后运行一次 full | 同左 | 同左 |

轮末复用条件见 `references/phase-playbooks.md` §5.2。风险不明按高风险处理。每个修复仍须先证明 RED，提交前通过适用的代码质量门禁。`already_fixed` 的例外和高风险路径见 `references/tdd-and-commit.md`。相邻测试由主代理按轮及终审 attempt 单独批测。

- 每次运行按 `references/evidence-structure.md` 的“实跑日志”留证。主代理核对原始输出、commit/tree、计数和风险判断，再用 `reviewctl` 登记。
- 默认串行。并行需用户明确授权并隔离 worktree。baseline 显式开启的 bounded 乐观修复仅生成预检候选，提升后仍须正式提交和独立验证，见阶段手册 §3.0。
- 保留用户改动和暂存内容。一个 finding 一个隔离提交。环境或证据阻塞时记录实际状态，所需授权经用户明确决定后用 `reviewctl authorize` 留痕。

## 2. 阶段状态机

| Phase | 主代理做什么 | 必须委派 | 出口 |
|-------|--------------|----------|------|
| `baseline` | 确认范围/验收/max_rounds，初始化证据，隔离临时测试，记录恢复入口 | 无 | `review` |
| `review` | 选角色、定范围、建 inbox | 至少 3 个独立评审代理，串行 | `adjudication` |
| `adjudication` | 筛查、去重、分配标准 ID、检查证据、裁决、复核更早轮次 deferred | 独立复现审查代理；必须范围内的挑战代理；必要时补强代理 | 有 accepted → `repair`；否则 → `round_decision` |
| `repair` | 一次一个 finding，检查 RED 和提交 | 实现代理 | `verification`；`cannot_fix`/`blocked` 时进入 `adjudication` 重新裁决，或登记未解决后 `round_decision` |
| `verification` | 检查证据、更新 finding 状态 | 验证代理（不能是实现者） | `inconclusive` 可按手册 §4 显式重开 `verification` 一次，`fail` 回 `repair`。新回归进 `adjudication`，其余待修项进 `repair`，全部终结后进 `round_decision` |
| `round_decision` | 计数、判断提前收敛/轮次上限 | 无 | 门禁失败回 `adjudication`，通过后进入 `review`、`final_audit` 或终审重入后的 `report` |
| `final_audit` | 提供盲扫材料、保存两阶段结果 | 未参与过本流程的新审计代理 | 无新问题或审计失败 → `report`；有新问题 → `adjudication` |
| `report` | 收敛判定、报告、清理、还原指令文件 | 无 | 结束 |

阶段手册 `references/phase-playbooks.md` 的 §0–§7 与上表依次对应。安全领域评审使用静态代码检查及防御性断言验证权限、隔离和数据保护契约。

委派时取 `references/agent-prompts.md` 的角色模板；修复和提交读 `references/tdd-and-commit.md`，机器证据示例见 `references/evidence-structure.md`。完成后可按 `references/archival.md` 归档。

## 3. 委派硬门禁

- **所有阶段**：状态只通过 `reviewctl` 修改；`advance` 会先校验证据，恢复或排查时可单独运行 `validate`；修复提交前运行 `reviewctl guard-commit`。
- **委派交接**。主代理发送 `references/agent-prompts.md` 的通用交接和角色模板，在本轮交接材料中保存角色与实际会话标识，供复现、验证和终审核对参与者。不同会话可使用同一模型。缺少必需的独立会话时保存阻塞及恢复点，主代理兜底仅适用于本节列出的复现和验证。
- **review**：每个角色一个独立、只读子代理；至少 3 个不同角色实际开展评审。主代理核对 `review_status`、`blockers`、`uncovered_paths`，按实际覆盖判读本轮结论。用 `reviewctl new-inbox` 创建 inbox；临时测试只写 `tests/review/candidates/`；每个代理必须写 `handoff.json`。
- **adjudication**：复现必须由未提出该候选的独立代理执行，并写入 `replay-review.md`；提出者不能单独决定自己的 finding；P0/P1、权限/数据完整性/公开 API 或证据异常项，主代理必须检查证据，必要时再委派第二个独立审查。
- **必须挑战**：所有拟 accepted 的 P0/P1，以及复现结果矛盾或不寻常的证据。无法挑战必须范围项时，必须获得用户明确授权并留痕。
- **repair**：一个实现代理只处理一个 finding；必须按 TDD 先 RED 后 GREEN；一个 finding 一个提交；当前项终结后，仍在 `repair` 且有其他待修项时用 `next-finding` 切换。
- **verification**：验证代理不能是实现者；复现证据必须包含 tested commit、tree hash 和测试文件 SHA-256。P0/P1、高风险或复现哈希无法核对时，验证代理必须在修复前 commit 的独立 worktree 重放原始反例；其余可信证据可跳过修复前重放，但仍需运行修复后的反例和 §1 规定的回归范围。至少生成 2 个相邻测试（正常 + 边界）放入 `tests/review/verifications/`，由主代理在轮末及终审前批测；发现缺陷时转为正式测试并登记 finding。无法生成时用 `--adjacent-reason` 说明；验证代理的 `blocked` 结论按 `inconclusive` 记录；失败登记及重验预算见阶段手册 §4。
- **final_audit**：启动每次终审前，若全历史相邻计划非空，在当前 HEAD 完成聚合批测并记录 attempt、路径、哈希、精确命令、提交、tree、日志及计数；失败须按 finding 流程处理后重跑，终审后有新修复轮则重新聚合。已升级测试按阶段手册 §5.3 核对替代关系，保留原测试。审计代理不得参与过评审、复现、挑战、补强、实现或验证；第一阶段盲扫不得读取 `.review-evidence/` 历史内容；第一阶段保存后才发第二阶段材料；最多 3 次尝试。
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

**进入终审的轮次条件**满足其一即可。常规评审已完成 `max_rounds` 轮，或从第 2 轮起最近连续两轮均无新的范围内 P0/P1/P2。进入前按阶段手册 §5 核对轮末门禁。筛除、去重、最终 rejected 的候选和 P3 均不计入新增数。

**两种收敛状态必须同时满足以下条件。**

1. 至少完成两轮常规评审。每一轮均已通过适用的回归门禁和当轮相邻批测，最近一次终审前的全历史聚合已通过，批测发现的问题已登记并处置。相邻测试清单为空时按 §5.3 跳过对应批测。
2. 范围内 P0/P1 均已裁决，无 `deferred` 或 `needs-evidence` 遗留。无 `unclear_claim` 的 P2 `needs-evidence`，无未解决的验证 `inconclusive`。已验证的 `fixed` 修复均已进入 Git 历史。
3. 调整后反例覆盖率至少为 80%。调整后分母为 0 时，先核对候选均已处理，再用 `finalize --ack-empty-coverage` 显式确认。
4. 最近一次终审已完成盲扫和定向复核，报告的候选已逐项裁决，该次无新 `accepted`。终审结构化凭据 `full_evidence` 中，完整测试结果 `status` 与审计总评 `overall_status`（取自 `targeted-review.md` 的 `Overall Status`）均须为 `pass`。

| 共享条件全部满足后 | 最终状态 |
|---|---|
| 所有 `accepted` finding 均已验证通过 | `CONVERGED` |
| 至少一项 `accepted` 因用户改动记为 `blocked_by_user_changes`，每项均有手工合并建议，其余 `accepted` 均已验证通过 | `CONVERGED_WITH_MANUAL_MERGE` |

**`INCOMPLETE` 按任一原因判定。** 收尾时，只要有一项共享条件未满足，或仍有 `accepted` finding 无法按表中任一行结案，即报告 `INCOMPLETE`。未解决的 `inconclusive` 仍可进入终审。若终审发现新 `accepted` 且仍有预算，先按阶段手册 §6.3 续评；预算耗尽后仍缺少通过的复审或终审，即以 `INCOMPLETE` 收尾。

报告同时披露原始覆盖率、豁免项数和调整后覆盖率。原始分母为所有标准 ID，分子为已复现的 `accepted` / `deferred` 和有未复现反证的 `rejected`。调整后分母扣除所有 P3 `needs-evidence` 和 `clear_claim_lacking_env` 的 P2 `needs-evidence`，分子沿用原值。报告列明豁免项及 P2/P3 `deferred` 的残余风险。
