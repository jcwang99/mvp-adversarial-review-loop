# 阶段操作手册

本文件是 `SKILL.md` 的阶段展开。进入某个阶段前，只读取对应章节；规则冲突时，以 `SKILL.md` 的硬门禁和收敛判定为准。

## 命令入口

命令从被评审项目根目录运行，`reviewctl` 的完整调用见 `SKILL.md` §0。`reviewctl help` 列出参数。主代理负责 `init`、`new-inbox`、`advance`、`record-*` 及其余状态写入。子代理在分配的目录交付材料，实现代理在提交前运行只读的 `guard-commit`。

委派时把 `agent-prompts.md` 的通用交接与对应角色模板一起发送。授权按最后一条适用于全局或该 finding 的决定生效。仅为当前 finding 获准的例外使用 `authorize --scope ID`，已有操作保留登记时的凭据。

## 0. baseline

**主代理执行**，不委派评审。

1. 按 `SKILL.md` §0 完成启动选择和初始化。
2. 确认 MVP 范围、明确排除项、验收标准及来源、技术栈、入口和关键数据流、外部服务与认证边界、部署方式。
3. 把初始化前采集的仓库路径、分支、HEAD、工作树与暂存区状态写入 baseline，并与配置记录的 `baseline_head` 核对。
4. 确认测试/构建/类型检查/lint/安全扫描命令，并记录测试范围分级：
   - `focused`：反例、相邻测试或单个模块/测试目标的命令
   - `impacted`：改动所在 package/crate、传递反向依赖及相关测试目标的命令
   - `fast`：仅 progressive 模式必填的快速回归命令；应覆盖微型数据集和高频逻辑测试，不能删减为无测试的成功命令。允许使用 `reduced-data`、`accelerated-time`、`virtual-clock`、`tmpfs` 或 `mixed` profile；必须保留关键断言，并说明保留契约、未覆盖语义和对应 full 兜底。虚拟时钟适合定时逻辑；加速真实时间不覆盖调度竞争；tmpfs 不覆盖真实磁盘持久性、崩溃和介质故障
   - `full`：项目/workspace 的完整测试套件命令（Rust 需包含 doctest；`cargo test <filter>` 仍会编译当前 package/workspace 默认成员的全部测试目标，缩小编译范围要用 `-p`、`--lib`、`--test` 或 `cargo nextest`）
   - `Adjacent test command`：独立的相邻测试命令模板，以唯一的 `{test_paths}` 结尾，如 `node --test {test_paths}`。不得额外扫描目录或吞掉失败；不支持文件参数的框架使用只执行给定路径的项目适配脚本。正常 full 排除 `tests/review/verifications/`。
   - tiering mode（`default`、`full-everywhere` 或 `progressive`）、高风险路径清单、full 单次耗时、full suite composition、feature matrix 和 baseline full result。所有 tier 都须登记稳定的长测 ID 清单及 Full runtime scale；无长测填写 `none` / `not_applicable`。progressive 还需记录 Fast test command、Fast test profile、快速测试清单/耗时、长时测试策略、profile 的保留/缺失语义和时间/数据缩放证据
   - 在基线 full 之前确认项目命令只收集正式套件，排除 `tests/review/` 及 `.review-evidence/` 中的临时测试。优先使用现有的正式测试入口或命令参数，保留全部正式测试。把隔离方式和临时配置的恢复方式写入 baseline；无法确保时记录阻塞。
   - 长测清单和原始尺度要在基线 full 开始前确定，并让测试 runner 将对应 runtime 标记写入原始日志；运行后再把同一记录填入 baseline，避免事后补写运行信息
   - 代码质量门禁：记录 `Code quality command`、`Code quality policy`、`Baseline code quality result` 和日志。Rust 默认包含 `cargo fmt --all -- --check` 与 `cargo clippy --workspace --all-targets --all-features -- -D warnings`；其它语言填写仓库已有的 formatter/linter/type-check 命令。无适用工具时写 `not_applicable: 原因`，不得把未运行写成 pass
   写入 `baseline.md` 的 "Test Scope / Regression Policy"。
5. **按实测决定是否编译预热**：只有全量测试/构建耗时明显（例如单次超过 2-3 分钟）或会生成大量临时测试的项目才做；短编译项目沿用现有命令，不要额外引入缓存层。
   - 先确定磁盘预算：记录可用空间和缓存上限，云端环境尤其要留足余量；缓存目录放在仓库外，不要放进 `.review-evidence/`，也不要提交。
   - Rust：可设置共享的 `CARGO_TARGET_DIR`，先运行 `cargo test --tests --no-run`（或 `cargo nextest run --no-run`）预编译测试目标；类型检查用 `cargo check --tests`，聚焦测试用 `cargo test --test <target> <filter>` 或 `cargo nextest run <filter>`；保持 `CARGO_INCREMENTAL=1`。
   - 缓存策略：同一轮内复用缓存，不要为每个 finding 新建 target；当缓存超过预算或磁盘紧张时，在轮次边界集中清理（删除共享 target 或 `cargo clean`），下一轮再预热。不要每个 finding 都清理重建，也不要无上限保留。
   - Rust 的 `tests/review/` 是嵌套目录，Cargo 不会自动发现；baseline 要确认测试如何被注册（显式 `[[test]]` 目标或统一 harness），并记录结束时如何还原，否则候选测试不会被编译或运行。
   - 可选：项目已有 `sccache`/构建缓存配置时沿用，不要覆盖；没有且实测收益明显时再考虑安装。
   - 其他长编译栈：仅在实测确实拖慢流程时启用依赖预编译/缓存，并设置同样的磁盘预算和轮次边界清理策略；短编译栈不要过度优化。
   - 把预热命令、缓存路径、环境变量、磁盘预算、清理时机和单次测试耗时写入 `baseline.md` 的 "Build Cache / Compile Prewarm"；无法安全预热时记录耗时和阻塞，不要跳过。
6. 希望减少 full 次数且已有可信 fast 套件时选 `progressive`。将本次 full 的实际运行记录同时保存为 `.review-evidence/baseline-full.json`（结构见 `evidence-structure.md` 的“轮末 progressive full gate”）。进入 review 时会核对原始日志、计数和 HEAD 并登记摘要，供后续轮末引用。

   运行基线 full（使用预热后的缓存）；记录结果（pass/fail）、完整日志路径、耗时、测试计数和已知环境限制。full 必须包含原始长时 I/O/稳定性测试；存在长测时，日志必须记录 `RUNTIME_PROFILE=original`、排序后的 `LONG_RUNNING_TESTS=<ID,...>`、`FULL_RUNTIME_SCALE=<baseline 中的原始尺度>`，结构化证据也须绑定同一清单和尺度。运行 baseline 声明的代码质量命令并保存独立日志；formatter/linter/type checker 失败时停止并报告 blocked。若环境无法运行，记录为 blocked，不得用缩短参数、排除项或过滤命令冒充 full。full 失败时停止并报告 blocked，不得带红灯基线进入 review。
7. 填写 `init` 创建的 `baseline.md` 和 `screening-log.md` 模板。
8. 默认直接使用技能目录的 `AGENTS.md` 恢复，将该绝对路径记入 `baseline.md` 的 Recovery Guide Deployment，模式填 `skipped`。这样项目工作区不会因为写入恢复指南而失去复用资格。若用户或 harness 确需项目级指南，按以下方式部署：
   - 目标是项目根目录的 `AGENTS.md`；若项目以 `CLAUDE.md` 为项目级指令文件（存在 `CLAUDE.md` 且无 `AGENTS.md`），以 `CLAUDE.md` 为目标。
   - 目标文件已含标记 `mvp-adversarial-review-loop-recovery-guide` 或标题 `Main Agent Recovery Guide - MVP Adversarial Review Loop` 时跳过。
   - 目标文件不存在：复制技能目录的 `AGENTS.md`，并在前后加 `<!-- BEGIN mvp-adversarial-review-loop-recovery-guide -->` / `<!-- END mvp-adversarial-review-loop-recovery-guide -->`。
   - 目标文件已存在：先把原内容备份到 `.review-evidence/baseline-project-instructions.bak`，再把带标记的恢复指南追加到末尾。
   - 把目标文件、模式（created / appended / skipped）、标记和备份路径写入 `baseline.md` 的 "Recovery Guide Deployment"。
9. 运行 `reviewctl advance --to review`。该命令先校验状态和基线，遇到错误按提示修复；派生字段不一致时使用 `normalize`。脚本会设置 `current_round: 1`、`rounds_consumed: 0`、`can_trigger_new_round: true` 和 `next_action`。

可选部署对项目级指令文件的改动属于本流程引入的临时改动，不提交，结束时还原。本流程要求 Node.js（>= 18）和 Git；缺少任一依赖时不要初始化，记录阻塞。

## 1. review

**必须委派**：每个角色一个独立、只读的评审子代理。

- 每轮至少 3 个不同角色，最多 6 个；角色表见 `SKILL.md`。
- 默认串行；用 `reviewctl new-inbox --round N --role SEC --temp-id SEC-001` 创建独立 inbox 和 `meta.json`。临时 ID 只需在角色目录内唯一。
- 评审代理只写指定 inbox、候选临时测试及隔离数据，保留源代码、正式测试和配置，不得安装依赖或提交；不得查看其他角色的 findings，也不要把个人偏好当缺陷。
- 临时测试写入 `tests/review/candidates/`，文件名使用角色 code 和语言对应的测试后缀：JS/TS `r{round}_{role-token}_{seq}.test.js|.spec.ts`，Python/Go/Ruby `..._test.py|_test.go|_spec.rb`，Java/C# `...Test.java|Test.cs`，Rust `....rs`；完整规则见 `evidence-structure.md`。若发现临时测试会被日常测试收集，停止并报告阻塞，不要自行修改项目配置。
- 从项目根目录运行，使用项目自身的测试框架和依赖；需要隔离数据时放在 `.review-evidence/round-[N]/_testdata/[role-slug]/`。
- 首次复现用 `run-logged` 写入分配的 inbox 中的 `output.log`。
- 每个已建 inbox 都要交付有效的 `handoff.json`。零发现也使用该角色预建的 `CODE-001` 和 `findings: []`。有更多候选时，主代理在 `review` 阶段按需为同一角色创建 `CODE-002` 等 inbox，并把路径交给该会话。
- 轮次策略、最后两轮回归检查和角色选择见 `SKILL.md` 的轮次策略。
- 被判定为回归检查的轮次只提供待检查的修复提交/变更路径，不提供历史 finding、裁决或预期结论。
- 要求代理记录 `uncovered_paths` 和 `blockers`；没有发现时返回 `findings: []`，不要用偏好凑数。

离开 `review` 前统计实际开展评审的不同角色，至少 3 个。`complete` 和有实际检查的 `partial` 可以计入，`blocked` 保留阻塞记录。核对 `partial` 披露的缺口，必要时在本阶段补派角色并创建 inbox。

**完成后**：运行 `reviewctl record-round --round N --raw N --duplicates N --screened N --new-p0p1p2 N`，再运行 `reviewctl advance --to adjudication`。

若裁决使 finding 升级至 P0/P1/P2，在 adjudication 阶段重新运行 `record-round` 修订当前轮计数。该计数不得小于 `findings.json` 中本轮未 rejected 的 P0/P1/P2 数；已完成轮次不可修订。

## 2. adjudication

主代理负责筛查和裁决。按 §2.3、§2.5、§2.6 的触发条件委派复现、挑战和补强。

### 2.1 筛查与去重

1. 把纯偏好、措辞建议、明确不在 MVP 范围内的功能请求筛到 `screening-log.md`，写明依据；同时在 `round-[N]/screening.json` 记录 original_id、disposition 和 reason（格式见 `evidence-structure.md`）。不分配标准 ID，不进入覆盖率分母，也无需运行反例。
2. 对其余候选去重；重复项指向 canonical ID，保留原始 inbox。跨角色重复必须在 screening.json 中记录 duplicate 和 canonical_id；同角色多 original-id 映射到同一标准 finding 时自动计算重复数。
3. 进入生命周期的候选分配标准 ID（`R[N]-F[XXX]-[CAT]`），把 inbox 的内容平铺复制到 `.review-evidence/round-[N]/[标准 ID]/`（保留原始 inbox；不要把 `inbox/[...]/[临时 ID]/` 整个目录嵌套进去），并把候选复现文件复制为 `reproduce.*`；`tests/review/` 中的原文件保留运行用。独立审查及裁决完成后，再用 `reviewctl record-finding` 登记结论。
4. 标准 ID 一旦分配，永久计入覆盖率分母，即使后来 rejected 或 deferred。
5. 关闭本轮前核对所有候选的去向并更新 record-round 计数。脚本会在进入 round_decision 以及已完成轮次的 validate/finalize 时拒绝遗漏候选、无来源的标准 finding、矛盾的筛查映射或不符的计数。

筛查决策流程：

```text
候选 finding
  ↓
[1] 仅为偏好或措辞建议？(kind: preference)
  ├─ 是 → screened_out_preference（不分配标准 ID）
  └─ 否 → [2]
  ↓
[2] 仅要求新增明确不在 MVP 承诺内的功能？
  ├─ 是 → screened_out_scope（不分配标准 ID）
  └─ 否 → [3]
  ↓
[3] 针对当前已存在的行为？
  ├─ 否 → screened_out_scope（功能不存在）
  └─ 是 → [4]
  ↓
[4] 当前行为是否可能影响已承诺边界、数据、权限或用户？
  ├─ 否 → screened_out_scope（无实际影响）
  └─ 是 → [5]
  ↓
[5] 期望行为有验收标准/契约支持？
  ├─ 无依据 → 是否指出当前行为的具体损害？
  │   ├─ 否 → screened_out_contract（仅为无依据的偏好）
  │   └─ 是 → [6]
  └─ 有依据 → [6]
  ↓
[6] 前提可能成立且证据可验证？
  ├─ 前提尚未证实 → needs-evidence（补前提）
  ├─ 前提已被反证 → rejected（记录反证）
  ├─ 证据不可验证 → needs-evidence（补证据）
  └─ 可验证 → 进入复现阶段
```

关键边界：

- 纯偏好/措辞：`screened_out_preference`；汇总后在收敛或轮次上限时交给用户。
- 仅要求未承诺功能：`screened_out_scope`。示例："应该支持 OAuth2 登录"（MVP 只承诺密码登录）。
- 针对现有行为但仅在承诺范围外触发、且不影响已承诺边界/数据/权限/用户：`screened_out_scope`。示例："XML 导出未转义"（MVP 只承诺 JSON）。
- 无契约但指出具体损害：不得直接筛除。示例："删除无确认提示，可能误删"。
- 当前行为即使触发场景不在 MVP 内，只要违反安全、数据完整性、隐私等隐含契约，也不得筛除。
- handoff 中的 `observed` 等字段描述提出者的观察。主代理根据 §2.3 的独立复现结果登记 `--reproduction-status`。

### 2.2 严重性

| 级别 | 判定 |
|------|------|
| P0 | 数据丢失/泄露、认证绕过、权限提升、完全不可用、公开 API 破坏性变更 |
| P1 | 部分功能失效、非完全绕过的安全漏洞、数据不一致、明显性能问题、可访问性阻断 |
| P2 | 边界条件失败、错误消息不清晰、日志缺失、次要功能缺陷 |
| P3 | 优化建议、测试覆盖改进、文档缺失、代码风格 |

### 2.3 独立复现

- 每个可复现 finding 由未提出该候选的独立复现审查员运行；提出者不能自己决定。
- 独立复现审查必须写入该 finding 目录的 `replay-review.md`；除文字结论外，必须包含 `Reviewctl Replay Evidence` JSON：`tested_commit`、`tested_tree_hash`、`test_path`、`test_sha256`、实际命令和退出码。commit/tree 标识被测代码状态；`test_sha256` 校验保存的反例文件。验证阶段按风险决定是否在修复前状态重放，详见 §4。
- 若由未提出该候选的挑战代理兼做复现，为该会话提供两份模板并收取 `replay-review.md` 和 `challenge-result.md`。原评审员的运行结果作为线索。两个角色指定不同模型且均需使用时，分别委派。
- 可将最多 5 个符合独立性条件的 findings 交给同一复现审查代理，依次执行；默认不并行，除非用户明确授权且有独立 worktree。
- 记录精确命令/操作、环境、退出状态、观察结果和证据路径；主代理必须检查证据与 claim 相符，并在 `adjudication.md` 注明执行者和证据路径。不要求主代理重复每条常规命令，但证据必须与 claim 相符。
- 手工步骤仅在确认无法自动化时使用，并在 `manual-steps.md` 记录无法自动化的原因、前提、精确操作和观察点。
- P0/P1、权限/数据完整性/公开 API、高影响或证据异常项：主代理必须亲自检查证据，或在独立复现之外再委派第二个独立审查；实际复现仍应由未提出该候选的代理执行（除非触发 §2.3 末尾的主代理兜底并留痕）。
- 没有未参与该 finding 的独立代理可用（所有可用代理都提交过相关候选，或没有代理可用）时，主代理经用户明确授权后才能亲自复现；用 `reviewctl authorize --action main-agent-reproduction --scope ID --decision authorized` 留痕，并在 `record-finding` 时加 `--reproduced-by main-agent`，在 `adjudication.md` 标为高风险，最终报告单独披露。有独立代理可用时不得使用兜底。

复现结果：

| 结果 | 含义 | 后续 |
|------|------|------|
| `reproduced` | 有效前提下观察到 claim 行为 | 由主代理判断是否违反范围/契约 |
| `not-reproduced` | 前提和断言有效、完整运行但明确不符合 claim | 记录反证，可 rejected |
| `blocked` | 环境、依赖、前提、脚本或观察点不完整 | 保留 needs-evidence，不得据此 rejected |

### 2.4 裁决

| Decision | 含义 |
|----------|------|
| `accepted` | 在本轮修复；必须验证，否则阻塞收敛 |
| `deferred` | P2/P3 可推迟修复，不阻塞本轮收敛；范围内 P0/P1 `deferred` 视为未解决并阻塞最终收敛。所有 deferred 都必须记录原因和后续处置，并在最终报告披露 |
| `rejected` | 不修；必须有明确反证 |
| `needs-evidence` | 尚未决定；缺少复现证据或前提不明确 |

- 每条 finding 在 `adjudication.md` 记录 `change_origin: regression | pre-existing | undetermined`；无法确定时 decision 必须是 `needs-evidence`，不能 accepted/deferred/rejected。
- reproduced 且范围/契约相符：accepted。P0/P1 优先；P2 默认本轮 accepted，确因资源限制推迟时必须改为 deferred；P3 一般 deferred。
- reproduced 但范围不符或影响低于声称：修订 severity/claim 后 deferred，或降级后 accepted。
- not-reproduced 且有明确反证：rejected，写明理由和反证路径。
- blocked 或证据不足：needs-evidence，列出所需证据；可派补强代理修正小瑕疵。
- 补强失败不能证明 finding 不存在；不能仅因补强失败而 rejected。
- deferred 必须记录原因（如资源限制、优先级排序、等待外部依赖、需要架构重构）和后续处置建议（如下一轮修复、建议在 vX.Y 修复、等待依赖升级），并在最终报告披露。

#### 2.4.1 更早轮次 deferred 复核

每轮 adjudication 开始时，主代理读取 `findings.json`，找出所有 `decision=deferred` 且 ID 轮次小于 `current_round` 的 finding，逐条给出本轮结论。不能只在上一轮的 `disposition_plan` 里写“下一轮处理”就跳过。

对每条 finding，使用原标准 ID、原证据目录和原 `--original-id` 重新运行 `record-finding`，不要新建 finding 或复制证据目录：

| 结论 | 状态处理 | 必填参数 |
|------|----------|----------|
| `include` | 改 `accepted`，进入本轮 repair | `--decision accepted --reproduced true --reproduction-status reproduced --deferred-review-action include --deferred-review-reason TEXT` |
| `continue` | 保持 `deferred` | `--decision deferred --deferred-reason TEXT --disposition-plan TEXT --deferred-review-action continue --deferred-review-reason TEXT` |
| `reject` | 改 `rejected` | `--decision rejected --reproduced false --reproduction-status not-reproduced --deferred-review-action reject --deferred-review-reason TEXT` |

例如把上一轮的 deferred 纳入本轮：

```bash
reviewctl record-finding --id R1-F001-PERF --role PERF --original-id PERF-001 \
  --severity P2 --decision accepted --reproduced true --reproduction-status reproduced \
  --evidence-dir .review-evidence/round-1/R1-F001-PERF --change-origin pre-existing \
  --deferred-review-action include --deferred-review-reason "本轮纳入修复"
```

- 同步更新原 finding 的 `adjudication.md`：`include` 改为 `accepted`，`reject` 改为 `rejected`，`continue` 保持 `deferred`；`reject` 还必须在 `replay-review.md` 记录新的反证。
- `include` 后需要正式复现测试才能进入 repair。先检查 `tests/review/reproductions/` 是否已有 `r{轮次}_f{编号}_*`；上一轮 accepted 的测试会保留，存在就直接复用，不要重新生成。仅当该文件确实不存在时，才从 finding 目录的 `reproduce.*` 恢复为 `tests/review/reproductions/r{轮次}_f{编号}_{slug}{后缀}`，或提供 `manual-steps.md`。不要清空 `tests/review/` 中其他 finding 的测试。
- 脚本在离开 adjudication 前检查：所有更早轮次的 deferred 必须有 `deferred_review_round = current_round`、合法 action 和理由；否则 `advance --to repair` / `--to round_decision` 会拒绝。
- 本轮新产生的 deferred 不要求本轮复核，从下一轮 adjudication 开始检查。

### 2.5 挑战（必须挑战范围）

**必须挑战**：所有拟 accepted 的 P0/P1，以及复现结果矛盾或不寻常的证据。其余 accepted 按轮次和资源优先挑战最高严重性项。`record-finding` 会强制 accepted P0/P1 提供 `--challenge-result`。

- 可将最多 4 个符合独立性条件的 findings 交给同一挑战代理，依次执行；默认串行。
- 挑战代理只读，不得修改项目代码、测试或原始 reproduction。
- 结果：
  - `supports`：有效重放且未找到推翻证据；主代理确认后可 accepted。
  - `disputes`：必须附具体反证；主代理审查双方证据后 rejected、降级/修订后 accepted，或争议未解决时 needs-evidence。
  - `inconclusive`：重放失败、环境不可用或观察不确定；不是自动接受，也不是 disputes。主代理基于已有重放证据裁决；证据仍不足则 needs-evidence。
- 确因资源限制无法挑战必须范围项时，必须获得用户明确授权，用 `reviewctl authorize --action skip-mandatory-challenge --scope ID --decision authorized` 留痕，在 `adjudication.md` 记录，并在最终报告列出。

### 2.6 补强

仅在反例思路合理但有小的执行瑕疵时使用。

- 可将最多 3 个 findings 交给同一补强代理，依次执行；默认串行。
- 只修改标准 ID 目录内的 reproduction 或 `counterexample.md`，不改项目文件。
- 结果：`fixed` 后主代理重新检查并重放；补强成功本身不等于 finding 成立。`cannot-fix` 保留 needs-evidence；不能仅因补强失败而 rejected。若补强结果证明原假设错误，主代理可基于该证据裁决 rejected。

### 2.7 临时测试文件

所有 decision 确定后，主代理批量处理：

- accepted：按 `r{round}_f{num}_{slug}` 重命名并移到 `tests/review/reproductions/`，保留语言对应的测试后缀（`.test.js`、`_test.py`、`_test.go`、`_spec.rb`、`Test.java`、`Test.cs`、`.rs` 等）。
- rejected / needs-evidence / deferred：删除临时测试文件；手工 finding 保留 `manual-steps.md`。

移动或删除前，必须把自动化反例保存为标准 finding 目录中的 `reproduce.*`；筛除项则保存在原 inbox 的 `reproduce.*`。保留原始 handoff 及其候选路径作为来源记录，不把 `reproduction_file` 改成正式复现测试名。校验器在临时路径不存在时检查该轮候选对应的持久反例；原文件及持久副本均丢失仍会失败。

**完成后**：有 accepted → `reviewctl advance --to repair`；无 accepted → `reviewctl advance --to round_decision`。

## 3. repair

### 3.0 乐观修复（可选旁路）

用户授权并行、baseline 设为 `bounded` 时，主代理可从干净主 HEAD 为已 accepted、已确认 RED 的普通风险 P2/P3 各建一个 worktree。优先并行没有依赖、预计修改不同文件的 finding。活动候选默认最多 1 个，`Optimistic max active worktrees: 2` 允许两个候选同时实现和预检。主代理串行执行下列登记命令，候选代理只在各自的 worktree 工作。

```text
reviewctl optimistic-start --id ID --worktree <仓库外路径> --risk-assessment normal
reviewctl optimistic-record --id ID --candidate-commit SHA --test-status pass --quality-status pass --test-log PATH --quality-log PATH
```

候选预检在 `progressive` 模式下运行 fast，在 `default` 下运行 impacted，在 `full-everywhere` 下运行 full。在分配的候选分支上用 `run-logged --candidate` 运行，质量检查另加 `--quality`。两项通过后登记，CLI 核对本次分支、tree、命令和退出码，再归档到 `.review-evidence/optimistic/<finding>/attempt-<N>/`。重开会递增 `attempt` 并清空当前日志引用。查看预检结果时取当前记录的 `test_log` 和 `quality_log`。

轮到该 finding 成为 `repair` 的 `active_finding` 时，若主 HEAD 已前进，先在新 HEAD 重放 focused 反例（手工项依原步骤）并复核风险。若反例已通过，按 §3.1 核实 `already_fixed`。风险升高时走正式修复。仍属普通风险且 RED 时运行以下命令。

```text
reviewctl optimistic-promote --id ID
```

基准相同时直接应用候选补丁。主 HEAD 前进时，CLI 用 `git merge-tree --write-tree` 预演合并。跨提交提升需要本地 Git 支持该命令，且相对新 HEAD 的文件路径、前后内容和文件模式均须与原补丁一致。主工作树有用户改动时保留 `candidate_green`，待其干净后重试。历史分叉或补丁变化记为 `stale`，合并或应用冲突记为 `conflict`。这两种情况转回正式修复，可参考原 worktree。

提升成功后补丁进入主工作树和暂存区，`promotion_head` 记录集成起点。按 §3.1 在集成后的代码上运行正式 GREEN 和质量门禁，执行 `guard-commit`、提交，再由独立代理验证正式提交。候选预检日志只对应候选 tree。完成或放弃时用 `optimistic-discard --id ID` 清理 worktree。

### 3.1 正式修复

主代理委派实现代理按 `tdd-and-commit.md` 处理当前 `active_finding`，核对报告和实际提交后按结果登记。

- 实现代理只处理当前 finding；RED 必须先确认，测试必须合并到项目正式测试文件。确实无法自动化时使用 `--manual`，并在 `implementation-result.md` / `verification-result.md` 记录人工复测。
- 按 `SKILL.md` §1 的门禁表和 `tdd-and-commit.md` 记录 GREEN、质量检查及修复 tree。快速套件缩放长测时记录实际 profile、保留的断言和未覆盖的语义。
- 进入 repair 时脚本将 HEAD 和逐文件暂存差异记录在 `repair_baseline_index`；提交只包含当前 finding 的源代码、正式测试和必要配置；不包含 `.review-evidence/` 或 `tests/review/` 临时文件。
- 提交前运行 `reviewctl guard-commit --finding [ID] --test [PATH]`；脚本会拒绝证据目录、临时测试目录，以及在进入 repair 前就已暂存的用户改动。
| 实现代理交付 | 主代理在 `repair` 中登记及转移 |
|---|---|
| `fixed` / `already_fixed` | `record-implementation --id ID --status fixed --commit SHA --test PATH`（已有修复用 `--status already_fixed`）。无法自动化的手工项用 `--manual`。核对正式测试已提交，再 `advance --to verification`。已有修复的测试和历史 SHA 要求见 `tdd-and-commit.md`。 |
| 用户改动无法隔离，已备好手工合并建议 | 核对报告中的 RED 和 `Manual Merge Guidance`。依次运行 `record-implementation --id ID --status prepared --reason TEXT`、`record-verification --id ID --status blocked_by_user_changes`，均在 `repair` 中完成。 |
| 无法修复或环境阻塞 | `record-implementation --id ID --status cannot_fix --reason TEXT` 或 `--status blocked`。CLI 同时登记 unresolved；需要改变裁决时 `advance --to adjudication`。 |

后两类已终结的项，有其他待修项时用 `next-finding`，否则 `advance --to round_decision`。

## 4. verification

为当前 finding 委派独立于实现者的验证代理。

- 状态机一次只有一个 `active_finding`，因此一个验证代理一次验证一个 finding；不同 finding 的验证串行进行。
- 使用 `agent-prompts.md` 的验证代理模板，并按其 YAML 结构回收摘要；`verification-result.md` 还必须包含 `Reviewctl Verification Evidence` JSON 区块，字段见 `evidence-structure.md`。提供原始 counterexample、reproduction、修复 commit 和 changed files、当前 HEAD、正式测试路径和运行入口、baseline 的 “Test Scope / Regression Policy” 摘要、finding severity；`risk_assessment` 由验证代理根据 changed files 独立判断。
- 验证代理写 `verification-result.md`；主代理用 `reviewctl record-verification --id [ID] --status pass|fail|inconclusive` 写入状态（代理输出的 `blocked` 按 `inconclusive` 记录）。pass 时必须提供至少 2 个 `--adjacent-test`，或用 `--adjacent-reason` 说明无法生成的理由；相邻测试只放在 `tests/review/verifications/`，不合并正式测试，也不进入常规 full。`Reviewctl Verification Evidence` JSON 必须记录 regression scope/命令/退出状态/tree hash/tested commit/测试计数/日志、风险评估、实现阶段 full 状态；验证阶段重跑 full 时还要记录完整 `full_test_suite`。`reviewctl` 会校验结构化字段、baseline 命令和计数、tree hash 与日志退出标记，但不会自行运行测试，也无法独立证明日志确由所写命令产生或风险分类准确；主代理仍须对照原始日志、HEAD 和 changed files 复核这些事实。
- 独立检查 RED 和被修复的行为。P0/P1、高风险或复现 commit/tree/测试哈希无法核对时，在修复前 commit 的独立 worktree 重放。随后在修复后的 HEAD 运行反例和表中规定的回归。progressive 普通 P2/P3 有合规的 GREEN fast 时，验证代理运行 impacted。所需 GREEN 门禁失败或证据无效时交回修复或登记阻塞。相邻测试由主代理按 §5.3 批测。
- 相邻测试的轮末登记、终审前聚合、失败恢复和正式测试替代按 §5.3 执行。
- 验证代理不得强制清理或以任何方式覆盖用户改动；兜底流程必须记录原 HEAD 并验证恢复结果。
- 若所有可用代理都已参与该 finding 的实现，先获得用户明确授权，用 `reviewctl authorize --action main-agent-verification --scope ID --decision authorized` 留痕，再由主代理执行验证；`record-verification` 加 `--verified-by main-agent`，在 `verification-result.md` 标注 `verified_by: main-agent`，在 `adjudication.md` 标为高风险，并在最终报告列明。
- 验证开始前对照 `baseline_head` 运行 `git status --short`；发现与被验 finding 相关的新外部改动时，记为 `inconclusive`，在 `blockers` 说明并列出冲突文件。不要使用 `blocked_by_user_changes`（该状态只用于 repair 无法提交）。
**失败验证只登记一次。** 每次实际验证由主代理登记一次。`fail` 和 `inconclusive` 共用同一 finding 的两次失败预算。重复登记同一次结果应被拒绝，`verification_attempts` 保持原值。中断恢复先读 `status --json`，核对活动 finding、是否 `unresolved`、已登记结果、次数和本次报告，再按下表继续。

| 当前结果 | 主代理下一步 |
|---|---|
| `pending` | 查原验证会话和当次报告。已有完整结果就登记，仍在执行就续接该会话。若这是显式重开后的 `pending`，使用新一轮的实跑证据。 |
| `pass` | 有其他待修项时 `advance --to repair`，全部终结时 `advance --to round_decision`。 |
| `fail` 且有预算、未标 unresolved | `advance --to repair` 重修当前项，再走正式验证。新回归有独立证据时可进 `adjudication`。 |
| `inconclusive` 且 `verification_attempts < 2`、未标 unresolved | 若能补验，在 `verification` 执行 `advance --to verification`，为同一 finding 显式开启下一次验证。保存前次报告及日志，确认状态已回到 `pending` 后，重新委派独立验证代理，最多再委派一次。 |
| 预算耗尽或此次阻塞无法继续 | 用 `mark-unresolved --id ID --reason TEXT` 登记未解决，再处理其他项。有新裁决依据时按 §2 处理。已标 unresolved 的项直接续接其他项。 |

## 5. round_decision

### 5.1 轮次完成

轮次开始：`current_round = N`、`current_phase = review`。修复验证期间 `current_round` 不变。所有 accepted findings 终结（verified / blocked_by_user_changes / 已登记未解决）后，`current_phase = round_decision`。

### 5.2 决策

1. 确认本轮所有 accepted findings 已终结。
2. `reviewctl advance` 在进入 `round_decision` 时自动设置 `rounds_consumed = current_round` 并重算 `can_trigger_new_round`。
3. `progressive` 要求每轮有当前 HEAD 的 full 证据。若运行时、依赖、环境变量、外部服务或数据、长测资源条件均与原运行相同，且没有新失败、flaky 或要求现场重跑的验证目标，先用 `reviewctl record-round-regression --reuse`。它只引用最近登记的成功 full（结构化基线、验证代理的 full、或实跑的轮末 full），复核 HEAD、产品工作区、baseline、证据与日志哈希。Git 之外的输入由主代理核实。条件不明、命令拒绝或没有记录时，在干净的当前 HEAD 实跑一次 full，并用 `record-round-regression --status pass|fail --evidence FILE` 登记新的原始证据。无法运行用 `--status inconclusive --reason TEXT`。失败或阻塞进入 adjudication。
4. 检查进入最终审计的条件：
   - 提前收敛：从第 2 轮起，最近连续两轮都没有新找到的、范围内的 P0/P1/P2。
   - 达到上限：完成 `max_rounds` 轮。
5. 分支：
   - 不满足且 `can_trigger_new_round = true`：`reviewctl advance --to review`。
   - 满足：若 `reviewctl adjacent-plan --scope all` 有路径，运行其输出命令并保存日志，再执行 `reviewctl record-final-adjacent-batch --attempt K ...`。全历史测试通过且证据验证后，执行 `reviewctl advance --to final_audit`。每次重入终审都按新的 HEAD 和 attempt 重跑；最多 3 次。
   - 本次终审新报告的候选全部裁决且无 accepted 时，按 §6.3 进入 `report` 并核对收敛门禁。若有新 accepted 且仍有常规轮及审计 attempt 预算，须开新常规轮再终审。若有新 accepted 但已达到 `max_rounds` 或审计尝试已达 3 次：`reviewctl advance --to report`，再 `finalize --status incomplete`。
6. finding 的未解决验证阻塞（inconclusive，不含 blocked_by_user_changes）不阻止最终审计执行，但使最终结论只能为 INCOMPLETE；终审前聚合批测仍必须通过。运行 `reviewctl validate` 检查。

提前收敛判定口径：被筛除或去重的候选、最终 rejected 的 finding 不算；P3 不算。

### 5.3 相邻批测与终审前聚合

`adjacent-plan` 只输出清单和命令，`record-*` 只登记证据，不执行测试。主代理运行输出的精确命令，核对框架实际执行的文件与用例、没有跳过或漏跑，再登记真实计数。路径使用 `tests/review/verifications/` 内的规范相对路径，字符限字母、数字、点、下划线、连字符和目录分隔符；每个登记文件必须含实际测试。命令模板和项目适配脚本必须将清单视为完整执行范围。

1. **每轮末尾**：`reviewctl adjacent-plan --scope round` 仅选择在本轮 verification 登记的测试。按输出运行后，用 `record-adjacent-batch --status ... --command ... --exit-status ... --tree-hash ... --tested-commit ... --log ... --test-count ... --failed-count ...` 登记。本轮没有测试则跳过。finding 源自更早轮次但本轮才完成验证时，测试计入本轮。
2. **每次终审前**：`reviewctl adjacent-plan --scope all` 合并历史登记清单，按本节第 4 条核对已登记的升级；无剩余路径时不要求聚合批测。否则在当前 HEAD 对应的代码状态上执行，并用 `record-final-adjacent-batch --attempt K` 加同样的证据参数登记，`K = final_audit_attempt + 1`。记录后 HEAD、路径或测试内容改变时，须重新运行；已有轮末通过记录不能替代本次聚合。代码状态、测试内容和日志真实性由主代理对照原始运行核实。
3. **失败或阻塞**：失败附 `--failed-finding ID`（失败用例原所属 finding，可跨轮），阻塞附 `--reason`。聚合未通过不能进入终审；`advance --to adjudication` 可重开当前轮，失败场景写入当前轮候选，按独立复现、裁决、TDD、验证处理并更新 `record-round` 计数。重跑沿用尚未启动的审计 attempt，但用新的日志路径；脚本将旧记录归档为 `adjacent-batch-attempt-N.md`，原始日志不得覆盖。重新判断轮次条件；批测本身不消耗新常规轮或终审次数。
4. **升级正式测试**：缺陷处理完成、本轮批测通过后，运行 `promote-adjacent-test --test <原相邻路径> --finding <已验证缺陷 ID> --formal-test <已提交正式测试> --reason <覆盖对应关系>`。主代理核对正式用例保留了原断言；登记保存源测试哈希、正式测试路径、提交和哈希。每次生成全历史计划时，只有正式文件在工作树、暂存区均与当前 HEAD 一致，且 HEAD 中的文件内容 SHA-256 仍等于升级登记值，才从聚合中排除原相邻测试。正式文件被修改、删除，或无法与 HEAD 核对时，`adjacent-plan --scope all` 会自动选回原测试。保留原文件及其 fixture，按当次计划执行。

相邻测试登记历史不会随 finding 重裁决清空。已完成轮次的测试文件及其依赖 fixture 必须保留到流程结束；重验新增用例使用新的文件名，不覆盖历史测试。不得通过删除文件或取消登记缩小聚合范围。

### 5.4 轮次与覆盖率核对

扫描优先级见 `SKILL.md` §4，覆盖率口径和残余风险见 §5。运行 `reviewctl coverage` 核对原始值、豁免项数量与调整后值。各轮另列 `raw_candidates`、`duplicates`、`screened_out` 和 `replay_eligible`，与筛查记录核对。零分母时逐一确认候选与必需评审已处理，再决定是否使用 `--ack-empty-coverage`。

### 5.5 轮次证据

保存轮次材料。需要提交证据时遵循 `evidence-structure.md` 的“审计材料的 Git 生命周期”。

## 6. final_audit

每次 attempt 使用未参与过本流程的新审计会话，记录可恢复的会话标识。同一会话分两阶段，盲扫保存后主代理才发送第二阶段材料。每次审计使用新目录 `.review-evidence/round-[N]/final-audit/attempt-[K]/`，不得覆盖旧结果。

### 6.1 第一阶段：盲扫

- 主代理从 `baseline.md` 提取 MVP 范围、验收标准、当前 HEAD、测试/构建命令，直接写在提示中。
- 不提供 finding、adjudication、历史评审结论或修复清单。
- 审计代理不得读取 `.review-evidence/` 中任何历史内容；完整候选证据写入 `inbox/`，摘要只在 `blind-scan.md` 记录一次。
- 使用 `agent-prompts.md` 的最终审计第一阶段模板；没有发现时返回 `findings: []`。第一阶段可用 focused/impacted 探索，full 测试留给第二阶段。

### 6.2 第二阶段：定向复核

- 第一阶段保存后，提供所有 accepted finding、未结的范围内 needs-evidence P0/P1、原始证据路径、修复测试路径和提交。
- 在当前审计 HEAD 独立运行一次 baseline full、构建和适用静态检查。长测使用基线清单及原始尺度。
- 要求逐项复核修复有效性、回归、测试覆盖、遗留风险。
- 在 `targeted-review.md` 的 `## Reviewctl Audit Evidence` 小节内写一个 JSON 代码块，顶层 `full_suite` 沿用轮末格式，包含 `tested_commit`。日志固定为本 attempt 的 `output-full-suite.log`。full 失败且发现新问题时记录 `fail`、实际非零退出码并转裁决；收敛要求最近一次终审 full 通过。
- 运行 `reviewctl record-audit --attempt K --status complete --new-issues N --auditor NAME` 记录结果；审计代理身份写入 state 和 `blind-scan.md`。审计无法完成时可用 `--status failed` 记录（不要求两份报告），随后从 `final_audit` 进入 `report` 并 `finalize --status incomplete`；已记录的 attempt 不能覆盖。
- `new_issues=N` 表示该 attempt 报告了 N 个新问题；进入 `adjudication` 后必须为这 N 个问题各记录一个 `source=final-audit`、`audit_attempt=K` 的 finding（重复项也要记录并裁决/去重），否则 `advance --to round_decision` 和 `finalize` 都会拒绝。仅记录 1 个 rejected finding 不能代表 N 个问题已裁决。

### 6.3 发现新问题

1. 运行 `reviewctl advance --to adjudication`；accepted 的问题修复并由验证代理验证。重新裁决终审 finding 时必须保留原来的 `--source final-audit --audit-attempt K`，不能把旧 review finding 改标为终审 finding。
2. 若终审 finding 最终有 accepted，且 `rounds_consumed < max_rounds`：必须运行 `reviewctl advance --to review` 启动新的常规评审轮，按问题性质选择策略：
   - 新 P0/P1 或多个高风险区域问题 → 常规广扫（覆盖受影响区域）。
   - 仅回归或单个修复引入的问题 → 回归检查。
   - 不受"倒数第 N 轮"规则限制，但计入 `max_rounds`。
   随后重新审计，递增 attempt，最多共 3 次。若终审 finding 全部 rejected/deferred 且没有新 accepted，可从 `round_decision` 直接 `advance --to report`，不需要为重复报告再开一轮。
3. 若有新 accepted 且已达 `max_rounds`：不再启动常规评审轮；问题仍按裁决 → 修复 → 独立验证处理，完成后从 `round_decision` 运行 `reviewctl advance --to report`，再 `reviewctl finalize --status incomplete`，并标注"已修复验证、但缺少独立互补评审轮复核"的项及未修复项。
4. 第 3 次尝试仍发现需修复的问题：同样处理并报告 INCOMPLETE，不再进行第 4 次审计。

关键规则：所有 finding 必须写在指定证据文件；不得问"是否还有其他问题"或依赖对话记忆；第二阶段只复核，不重复第一阶段已列出的 finding。

## 7. report

### 7.1 收敛判定

按 `SKILL.md` §5 的收敛判定表逐项核对，确定 `CONVERGED`、`CONVERGED_WITH_MANUAL_MERGE` 或 `INCOMPLETE`。

- 覆盖率按 `SKILL.md` §5 和本手册 §5.4 核对，并在报告中同时披露原始值、豁免项数量和调整后值。

### 7.2 报告内容

运行 `reviewctl finalize --status converged|converged_with_manual_merge|incomplete [--ack-empty-coverage]`。脚本会写 `.review-evidence/final-report.md`、设置 `overall_status`，并在不满足收敛条件或 `validate` 有错误时拒绝 converged 状态。脚本已生成按 severity/decision 的汇总、覆盖率、残余风险、手工合并指南、screened preference 汇总和基线用户改动；主代理可在 `<!-- END GENERATED -->` 之后补充叙述，重新 finalize 会保留该部分。

报告必须包含（脚本生成后仍由主代理核对）：

1. 收敛状态与汇总。
2. 覆盖率透明披露：原始覆盖率、豁免项数量、调整后覆盖率。
3. 所有 findings 的最终状态：按优先级和 decision 分组。
4. `CONVERGED_WITH_MANUAL_MERGE` 专用章节（如适用）：blocked findings 列表、每个 finding 的手工合并指南（diff patch、冲突文件、建议步骤）、警告"完成手工合并前不要部署"。
5. 残余风险：所有 P3 needs-evidence、`clear_claim_lacking_env` 的 P2 needs-evidence、deferred findings 及后续处置。
6. `screened_out_preference` 建议汇总。
7. 对照基线列出评审期间未纳入本流程的用户改动。

### 7.3 清理

- `finalize` 后对照初始工作区和证据引用清理本次生成的临时测试与 `_testdata/`。保留用户文件、仍被报告或未完成项引用的复现/验证文件及 fixture、标准目录中的反例、原始 handoff 和正式回归测试。整目录清理只适用于内容全部属于本次运行且均可丢弃的目录。
- 保留 `.review-evidence/` 作为审计证据。
- 还原 baseline 阶段为隔离临时测试对项目测试配置做的临时改动；只还原自己引入的部分，不触碰用户改动；无法安全还原时记录。
- 按 `baseline.md` 的 "Recovery Guide Deployment" 还原项目级指令文件：
  - appended：删除标记分节，并对照备份确认用户内容未受损。
  - created：文件仍只含本指南时删除整个文件；否则只删除标记分节。
  - 无法安全还原时记录。
- 归档可选，见 `archival.md`；仅在评审循环完成后执行。

## 8. 恢复

按技能目录的 `AGENTS.md` 恢复。仅在 baseline 已记录项目级部署且标记和标题均丢失时，按 §0 恢复该分节。
