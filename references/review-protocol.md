# 评审、裁决与收敛协议

本文件是评审角色、finding 状态、证据裁决和轮次边界的权威定义。完整记录格式见 evidence-structure.md；实现和提交规则见 tdd-and-commit.md。

## 角色选择

按项目实际风险选择 3 到 6 个互补角色，避免职责重复。至少覆盖产品/契约、功能/边界、安全/权限三个角度；对小型或不涉及某领域的 MVP，可说明为何某角色不适用。每轮至少安排一个角色作为反证视角，主动检查常见风险假设是否有正常行为或无效前提；仍不得向其透露其他角色的 findings。

| 角色 | 检查重点 |
|------|----------|
| 产品与契约 | 用户故事、验收标准、非目标、错误提示 |
| 功能与边界 | 空值、极值、重复调用、非法状态、失败恢复 |
| 安全与隐私 | 身份、授权、注入、秘密、敏感数据、信任边界 |
| 可靠性与一致性 | 超时、重试、并发、幂等、事务、部分失败 |
| API 与兼容性 | schema、版本、序列化、错误码、旧客户端 |
| 性能与资源 | 复杂度、查询、内存、连接、限流和 MVP 设计负载 |
| UX 与可访问性 | 键盘、读屏、焦点、移动布局、空/错/载状态 |
| 测试与运维 | 可观测性、部署、迁移、回滚、配置、测试盲区 |

默认一次只启动一个代理。每个评审角色有唯一的 role-slug，写入独立 inbox 子目录。不得把先前代理的发现或主代理预期告诉后续评审员。

主代理按 finding 委派独立复现审查，避免在主上下文中展开所有命令输出。该代理必须与提交原始候选的评审员不同，一次只读取一个标准 finding 目录及必要的基线/契约；只报告重放观察，不裁决范围、严重性或最终 decision。主代理仍负责检查证据并作出所有 finding 决定。

若所有可用独立代理都已提交过相关候选，主代理必须亲自复现；P0/P1 及权限/数据完整性类 finding 若由主代理单独复现，需在 adjudication.md 中明确记录并标注为高风险项，在最终报告中单独披露。

## 严重性与证据门槛

| 级别 | 判断依据 |
|------|----------|
| P0 | 数据破坏、重大安全事故、核心功能完全不可用 |
| P1 | 核心验收路径失败、越权或广泛的崩溃/部署阻断 |
| P2 | 有限条件下的非核心功能、性能、兼容性或可访问性缺陷 |
| P3 | 轻微体验、文档、风格或可选改进 |

严重性按可重复影响定级，不按最坏想象。除纯偏好和仅文档措辞的 P3 外，候选意见必须描述具体前提、执行路径和可观察的期望/实际差异。优先提交可运行 reproduction；只有确认无法自动化时才提交手工步骤，并说明原因、环境、操作和观察点。

**偏好类建议 (kind: preference)** 不进入修复流程，但收集在 screening-log.md 作为 screened_out_preference。达到收敛条件或轮次上限后，主代理将所有 preference 建议汇总交给用户决定是否采纳。

每条候选 finding 包含：

~~~text
finding_id: [该角色内唯一临时 ID，如 SEC-001]
severity: P0 | P1 | P2 | P3
claim: [一句话描述可观察的问题]
location: [文件、符号或行号]
preconditions: [触发前提]
counterexample: [输入/状态/时序/权限/环境及步骤]
expected_vs_actual: [期望与实际]
reproduction_path: [该角色 inbox 目录中的文件路径]
impact: [对用户、数据、权限、可用性的实际影响]
confidence: high | medium | low
kind: defect | spec-gap | risk | preference
~~~

## 评审代理提示模板

为每个代理替换 round、role-slug、范围和验收标准。第 4、5 轮还需提供待检查的修复提交/变更路径，但不提供历史 finding 或预期结论。此模板用于常规评审；最终审计使用后文的专用模板。

````text
你是 [role-slug] 评审员。只读检查 [MVP 范围]，依据 [验收标准/契约] 和当前 HEAD。
本轮变更范围：[常规评审填 none；回归评审列出待检查的提交/文件路径，不提供历史 finding 或预期结论]
不要修改项目源代码、测试、配置，不要安装依赖或提交。只用临时 fixture/数据库执行验证；若命令会改写持久数据、调用真实外部服务或无法确认副作用，停止运行并报告阻塞。

## 文件组织与运行约定

**证据文件**（counterexample.md、reproduction 脚本、output.log）：
- 存放位置：.review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/
- Reproduction 脚本命名：按项目语言约定（reproduce.test.js、reproduce_test.py、reproduce_test.go 等）
- 完整命令输出保存为 output.log，不要粘贴到回复或 counterexample.md 中

**运行 reproduction**：
- 从项目根目录运行，使用项目自身的测试框架、依赖、构建环境
- Reproduction 脚本就是普通项目测试，调用项目代码和测试工具
- 示例：pnpm vitest run .review-evidence/round-1/inbox/security/SEC-001/reproduce.test.js
- 不要为每个 finding 创建独立的依赖/编译环境

**隔离数据文件**（仅在需要避免冲突时）：
- 测试数据库、fixture、临时输出可放在：.review-evidence/round-[N]/_testdata/[role-slug]/
- 通过环境变量传递路径：TEST_DB_PATH=.review-evidence/round-1/_testdata/security/test.db
- 若项目测试本身已支持临时数据库（如 SQLite `:memory:`、Jest 自动隔离），直接使用
- 默认串行运行，避免端口/进程冲突；需要并发时在阻塞项中说明原因

不要查看其他角色的 findings，也不要把个人偏好作为缺陷。

每条 finding 的 counterexample.md 按上方字段 schema 填写；完整 reproduction 或经确认无法自动化时的 manual-steps.md 放在该 finding 目录。按以下固定 YAML 结构交接，保留所有字段；无内容使用 [] 或 none，不省略字段。没有发现时 findings 写 []；未覆盖的路径及原因写入 uncovered_paths；无法完成检查的部分写入 blockers。
不要在回复中粘贴 reproduction 源码或完整命令输出。回复中的命令仅给命令、退出状态和必要的短输出摘要，详细记录放在证据文件。

~~~yaml
review_status: "complete | partial | blocked"
round: "<round number>"
role_slug: "<role-slug>"
scope_checked: "<scope summary>"
commands:
  - command: "<command>"
    exit_status: "<exit code or not_run>"
findings:
  - finding_id: "<role-local temporary ID>"
    severity: "P0 | P1 | P2 | P3"
    claim: "<observable behavior>"
    kind: "defect | spec-gap | risk | preference"
    confidence: "high | medium | low"
    evidence_dir: "<inbox directory>"
    counterexample_file: "<counterexample.md path>"
    reproduction_file: "<reproduce.* | manual-steps.md | none>"
    reproduction_command: "<command | manual | not_run>"
    reproduction_exit_status: "<exit code | manual | not_run>"
    reproduction_status: "observed | not_observed | blocked | not_run"
blockers: []
uncovered_paths: []
~~~

`reproduction_status` 只描述该候选的复现结果：`observed` 表示观察到 claim；`not_observed` 表示复现完整运行但未观察到 claim；`blocked` 表示无法判断；`not_run` 表示未尝试。`reproduction_exit_status` 只记录进程退出码；是否观察到 claim 以 `reproduction_status` 和证据为准。没有运行通用检查命令时，`commands` 写 `[]`。

示例（假设项目有项目详情 API；仅示范交接格式，实际路径、命令和结果必须来自当前项目）：

~~~yaml
review_status: complete
round: 1
role_slug: security
scope_checked: "GET /api/projects/{projectId} 的访问授权"
commands: []
findings:
  - finding_id: SEC-001
    severity: P1
    claim: "已登录用户可读取其无权访问的项目详情"
    kind: defect
    confidence: high
    evidence_dir: ".review-evidence/round-1/inbox/security/SEC-001/"
    counterexample_file: ".review-evidence/round-1/inbox/security/SEC-001/counterexample.md"
    reproduction_file: ".review-evidence/round-1/inbox/security/SEC-001/reproduce.spec.ts"
    reproduction_command: "pnpm vitest run .review-evidence/round-1/inbox/security/SEC-001/reproduce.spec.ts"
    reproduction_exit_status: 1
    reproduction_status: observed
blockers: []
uncovered_paths: []
~~~

对应的 `counterexample.md` 示例：

~~~text
finding_id: SEC-001
severity: P1
claim: 已登录用户可读取其无权访问的项目详情
location: src/routes/projects.ts:getProject
preconditions: Alice 已登录；project-42 存在；Alice 不是该项目成员
counterexample: 以 Alice 的会话请求 GET /api/projects/project-42
expected_vs_actual: 预期 HTTP 403；实际 HTTP 200 并返回项目详情
reproduction_path: .review-evidence/round-1/inbox/security/SEC-001/reproduce.spec.ts
impact: 登录用户可读取其他项目的名称和配置，造成跨项目信息泄露
confidence: high
kind: defect
~~~

若没有发现，仍返回相同结构，设置 `review_status: complete`、`findings: []`；只有部分范围未检查时使用 `partial`，完全无法开展检查时使用 `blocked`。每个命令和 finding 的证据路径必须可定位到实际记录。
````

代理返回属于交接摘要，不是第二份证据副本。主代理只在裁决当前 finding 时读取其完整证据。

## Finding ID 与证据路径

每个代理只需在自身 role-slug 目录内保证临时 ID 唯一，例如：

~~~
.review-evidence/round-1/inbox/security/SEC-001/
.review-evidence/round-1/inbox/functionality/FUNC-001/
~~~

主代理先筛掉纯偏好和明确不构成现存风险的范围/契约请求，再对剩余候选去重并分配标准 ID；只有进入 finding 生命周期的候选有标准 ID 和索引行。将对应 inbox 目录移动为：

~~~
.review-evidence/round-[N]/R[N]-F[全局序号]-[类别]/
~~~

格式为 R[轮次]-F[全局递增序号]-[类别]，如 R1-F001-SEC。序号跨轮次递增。标准 ID 在实质裁决前分配，即使最终 decision 是 rejected、deferred 或 needs-evidence，也保留该 ID 和证据目录。original-id.txt 记录 role-slug 与临时 ID。

重复候选不另分标准 ID；保留其 inbox 目录，在 findings-index.md 中引用 canonical ID，并在 canonical adjudication.md 中记录来源及去重理由。不得覆盖、合并丢失或删除原始候选证据。

类别代码：SEC 安全隐私；FUNC 功能边界；REL 可靠性一致性；API API兼容性；PERF 性能资源；UX 可访问性；OPS 测试运维；PROD 产品契约。

## 独立复现审查

主代理完成去重、范围/契约初筛并分配标准 ID 后，对可复现候选指派一名未提交该候选的独立复现审查员。原评审员运行过的结果可作线索，但不能替代独立复现。挑战代理的独立重放可满足此要求；高风险或证据异常项还须由主代理加验或再委派第二个独立审查。

~~~text
你是独立复现审查员。只检查 [标准 finding ID] 的 counterexample.md 与指定复现文件、当前 HEAD，以及主代理提供的相关基线/契约。不要读取其他 finding、原评审结论、adjudication.md、challenge-result.md 或 verification-result.md。
复现材料：[该 finding 目录内 reproduce.* 或 manual-steps.md 的准确路径]
只读项目文件和测试；不要修改源代码、测试、配置或提交。

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架和依赖
- 若需要隔离测试数据库/fixture，放在：.review-evidence/round-[N]/_testdata/replay-[finding-id]/
- 通过环境变量传递数据路径，或使用项目测试框架的临时数据机制
- 若命令会改写持久数据、调用真实外部服务或无法确认副作用，停止运行并报告 blocked

运行复现并记录精确命令/操作、环境、退出状态、观察结果和证据路径。完整输出写入该 finding 的 replay-review.md，必要时写入 output.log。
只返回 reproduced、not-reproduced 或 blocked，附证据路径、命令/退出状态摘要和阻塞项；不要判断 scope、severity 或最终 decision，不要粘贴完整日志。
~~~

- `reproduced`：有效前提下观察到 claim 所述行为；是否违反承诺范围由主代理另行裁决。
- `not-reproduced`：前提和断言有效、复现完整运行，但观察结果明确不符合 claim；记录具体反证。仅仅没有得到输出或结果模糊不算。
- `blocked`：环境、依赖、前提、脚本或观察点不完整，无法判断 claim；保留 `needs-evidence`，不得据此 rejected。

主代理审查 replay-review.md 和关键原始输出后，填写 adjudication。P0/P1、权限/数据完整性/公开 API、高影响 finding，以及结果互相矛盾或不寻常的证据，主代理必须亲自加验或再委派第二个独立审查。若没有独立代理可用，主代理亲自复现作为退路。

## 主代理筛查与裁决

对每条去重后的独立候选，主代理独立完成筛查、裁决和必要的复现。提出意见的代理不得单独决定自己的 finding 是否成立。

### 1. 范围与契约筛查

检查前提是否可能成立、意见是否针对 MVP 已承诺的功能、预期行为是否有验收标准/契约支持、影响是否与严重性相称。

- 仅要求新增明确不在 MVP 承诺内的功能，或把没有契约依据的偏好当成验收失败，且没有指出当前行为的具体损害：记为 `screened_out_scope` 或 `screened_out_contract`，写明依据；不分配标准 ID、不进入 findings-index.md 或覆盖率分母，也无需运行反例。此规则不能用于否认当前行为造成的具体损害；若现存行为可能影响已承诺边界、数据、权限或用户，继续调查其实际影响和适用契约。
- 不得仅因某条功能不在 MVP 承诺内，就拒绝检查该功能当前已存在的行为。若该行为可能影响已承诺边界、数据、权限或用户，可验证时继续筛查和重放；只有确认问题真实且仅在 MVP 范围外场景触发后，才可标 deferred。
- 纯偏好或仅措辞建议 (kind: preference)：标记为 screened_out_preference，写入 screening-log.md；不分配标准 finding ID、不进入 findings-index.md，也不进入修复队列或反例覆盖率分母。所有 preference 建议汇总后在达到收敛或轮次上限时交给用户决策。
- 有具体后果但依赖未定产品决策、缺少必要前提或尚未确定的契约解释：decision 为 needs-evidence，列出需要的证据。不能只因契约没有明说就把具体、可观察的现有行为风险 rejected。
- 反例有小的可修正缺陷：decision 暂为 needs-evidence，可派补强代理。
- 根本无法运行但仍有合理方向：保留 needs-evidence；补强代理不能修正本身不证明问题不存在。

### 2. 复现与主代理裁决

通过筛查的候选必须由独立复现审查员、挑战代理或主代理之一运行 reproduction；执行者必须与提出候选的评审员不同。手工步骤仅在已确认无法自动化时使用。记录精确命令/操作、环境、退出状态、观察结果及证据路径。主代理必须检查证据与 claim 相符，且在 adjudication.md 中注明复现者和证据路径；不要求主代理重复每条常规命令。

- 重放观察到承诺范围内的缺陷：进入挑战判断。
- 有效前提下未观察到所述缺陷，且断言与描述正确并有明确反证：rejected，记录反证。
- 脚本错误、依赖缺失、服务不可用或观察不充分：needs-evidence，不得伪称为缺陷不存在。
- 缺陷真实但仅在 MVP 范围外的场景触发：deferred，记录触发条件、风险和复查条件。

decision 只取 accepted、needs-evidence、rejected 或 deferred。修复验证另记 verification 状态；inconclusive 是一次验证的结果，不是 finding decision。

### 3. 裁决记录字段

主代理在 adjudication.md 中记录：

~~~text
finding_id:
original_id_and_role:
deduplicated_with:
change_origin: pre-existing | regression | undetermined
severity_after_review:
scope_and_contract:
evidence_screen:
replay_status: reproduced | not-reproduced | blocked | not-required
replay_reviewer: [role-slug 或 main-agent]
replay_evidence_path: [replay-review.md 或其他完整证据路径]
replay_command_or_steps:
replay_result_and_evidence_path:
challenge_result: not-triggered | supports | disputes | inconclusive
decision: accepted | needs-evidence | rejected | deferred
reasoning:
next_action:
verification: not-applicable | pending | pass | fail | inconclusive
~~~

### 4. 挑战代理

**必须挑战的触发条件**（在 accepted 前满足任一项即触发）：

- P0/P1 且 confidence 为 medium 或 low。
- 涉及权限、数据完整性或公开 API 兼容性的 finding，即使 confidence 为 high。

触发后不得因为主代理已成功重放、已有失败测试或生产日志而跳过挑战；这些只证明现象，不能替代独立的反证尝试。对同一根因可由一个挑战任务覆盖多个 finding，但主代理仍须逐条确认适用性和影响。

提示模板：

~~~text
你是独立挑战代理。只读检查 [标准 ID] 及当前 HEAD，不要修改项目或提交。
原始 finding：[claim、范围、契约和前提]
只读文件：[counterexample.md 与 reproduce.* 或 manual-steps.md 的准确路径]

先独立重放 reproduce；若明确无法自动化，执行 manual-steps.md。
随后尝试证明 claim 不成立：查规范、检查前提、尝试反例变体、寻找符合契约的正常行为。
不要读取 adjudication.md、replay-review.md、其他代理的结论或主代理的裁决理由。

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架和依赖
- 若需要隔离测试数据或尝试反例变体，可放在：.review-evidence/round-[N]/_testdata/challenge-[finding-id]/
- 无法隔离持久数据或外部写入时，停止并返回 inconclusive

返回 supports、disputes 或 inconclusive；附证据路径、命令/退出状态和必要的短输出摘要。
完整输出写入 challenge-result.md 或 output.log，不要粘贴完整代码和日志。
~~~

`supports` 表示挑战者有效重放了 claim，且未找到足以推翻它的证据。`disputes` 必须附具体反证，证明前提不成立、行为符合契约或影响/严重性需要修订；单纯重放失败、环境不可用或观察不确定不能标为 disputes，必须标 `inconclusive`。

- supports：主代理确认挑战未推翻 finding 后，decision 可为 accepted。
- disputes：主代理审查双方证据；证据充分时 rejected，影响较小则降级/修订后 accepted，争议未解决则 needs-evidence。若修订改变了 claim、触发条件或期望行为，且修订后仍满足挑战触发条件，须针对修订版重新挑战再 accepted。
- inconclusive：不是自动接受。主代理基于已有重放证据作决定；证据仍不足则 needs-evidence。

挑战代理不得修改项目代码、测试或 finding 的原始 reproduction。

### 5. 补强代理

仅在反例思路合理但有小的执行瑕疵时使用。补强代理只修改标准 ID 目录内的 reproduction 或 counterexample.md，不改项目文件。返回 fixed 或 cannot-fix，并把完整结果写入 reinforce-result.md。

- fixed：主代理重新检查并重放；补强成功本身不等于 finding 成立。
- cannot-fix：保留 needs-evidence，说明未解决部分；不能仅因代理补强失败而 rejected。
- 如果补强结果证明原假设错误，再由主代理基于该证据裁决 rejected。

## 修复验证

每个修复提交后，使用未参与该 finding 实现的验证代理。提供当前 HEAD、commit、原始 finding、原始 reproduction 路径、修复后的项目测试路径和必要的运行入口。不要把实现代理的结论当作验证结果。

若所有可用代理都已参与该 finding 的实现，由主代理执行验证，并在 verification-result.md 标注 verified_by: main-agent。主代理按相同的检查要求和证据标准判定 pass、fail 或 inconclusive；最终报告列明由主代理验证的 finding。

~~~text
你是独立修复验证员。只读检查当前 HEAD 和 commit [hash]，不要编辑或提交。
Finding：[标准 ID、原始 claim、验收契约和前提]
原始证据：[reproduce.* 或 manual-steps.md 的准确路径]
修复测试：[项目测试套件路径及命令]

先检查 implementation-result.md 中修复前的 RED 证据，确认它覆盖原始 claim 和同一验收断言；再在当前 HEAD 运行原始反例，确认修复后通过。除非提供可安全检查的修复前 commit/worktree，不得声称验证执行者亲自重现了修复前状态。手工 finding 则独立执行步骤并记录当前观察。
运行相关项目测试，尝试至少一个相邻变体，并检查回归、兼容性和权限/数据副作用。

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架和依赖
- 若需要隔离测试数据或尝试变体，可放在：.review-evidence/round-[N]/_testdata/verify-[finding-id]/
- 若验证会改写持久数据或调用真实外部服务，停止并返回 inconclusive

把完整记录写入该 finding 的 verification-result.md，必要的完整输出写入 output.log。
只返回 pass、fail 或 inconclusive、命令/退出状态摘要、证据路径和阻塞项。不要粘贴完整日志。
~~~

- pass：验证执行者完成所有要求的检查，且主代理确认记录和证据后，verification 记 pass，finding 可标 verified。执行者为主代理时，按上述兜底规则记录。
- fail：verification 记 fail，保持未 verified，回到修复或创建新的回归 finding。
- inconclusive：保持 accepted 但未 verified，记录环境/证据阻塞；不得把它作为 pass 或直接开始收敛终审。

## 覆盖率与轮次记录

每轮分别报告 raw_candidates、duplicates、screened_out（偏好/明确 scope 或 contract 非 finding）和 replay-eligible 独立 finding 数。被筛除的意见、重复项不进入反例覆盖率分母，但必须单独计数并写入 screening-log.md。进入 finding 生命周期的候选（包括 needs-evidence 及之后被 rejected/deferred 的候选）必须获得标准 ID 和索引行。

counterexample_coverage = 已由主代理或独立执行者重放并留证的 replay-eligible 独立 finding 数 / replay-eligible 独立 finding 总数。缺少证据或环境阻塞的 finding 仍在分母内。自动化与手工复现分别报告。分母为 0 时报告 N/A，不视为自动通过；须确认每个原始候选都已在 screening-log.md 有明确处理结果，并完成要求的评审与终审。覆盖率低于 80% 时不得声称评审充分或收敛；补足证据或在最终报告中标记 INCOMPLETE。

## 轮次上限与优先级

- 默认最多 5 轮常规评审，每轮最多 6 个评审角色。**轮次计数只包含常规评审轮；最终审计不计入轮次，但其发现的问题如需修复会触发新的常规评审轮。**
- 第 1、2 轮的常规扫描覆盖 P0-P2；第 3 轮的常规扫描只寻找新 P0。此限制不取消此前已 accepted finding 的修复，也不屏蔽强制终审扫描发现的问题；后者仍须进入普通裁决和修复流程。
- 第 4、5 轮的常规扫描只检查此前修复引入的回归。终审发现的新候选仍须裁决；若修复后已没有轮次完成所需的互补复核和新终审，则报告 INCOMPLETE。
- 连续 2 轮没有新的、范围内且仍未解决的 P0/P1，也没有新 accepted P2，可在完成第 2 轮后提前停止常规扫描；仍须完成最终审计。**第 3 轮后不适用此条件（第 3 轮本身只找 P0，"没有新 accepted P2"已不是有效判断标准）。**
- 范围内 P0/P1 的 accepted 未修复或 needs-evidence 都是未解决项，阻止收敛。**常规评审轮中的 P2 needs-evidence 按以下规则处理**：
  - 若该 P2 的前提、触发路径和潜在影响已明确记录，仅缺少运行环境或外部依赖，可作为残余风险披露而不阻止收敛
  - 若 claim、范围或契约解释本身不明确，阻止收敛
- 范围外且已证实的 deferred 风险应披露，但本身不阻止收敛。达到轮次上限仍有未解决的范围内 P0/P1、accepted finding 验证阻塞或覆盖率不足时，标记 INCOMPLETE。不要为了达到轮数而继续提交低优先级改动。

### 回归 finding

每条新 finding 在 adjudication.md 标记 `change_origin: regression | pre-existing | undetermined`。只有证据表明问题由本轮修复引入时才标 regression；无法确定时保持 undetermined，并将 decision 设为 needs-evidence。回归 finding 按实际影响评估严重性，不自动升高一级。

## 最终审计与收敛

最终审计由未参与前序评审或实现的新代理完成，分两阶段，防止历史结论锚定宽泛扫描。同一个终审代理先完成第一阶段，保存结果后，主代理才发送第二阶段材料。每次审计使用新目录 `.review-evidence/round-[N]/final-audit/attempt-[K]/`，不得覆盖之前轮次或尝试的结果：

1. **未提示历史的扫描**：只提供 MVP 范围、验收标准、当前 HEAD 和测试/构建命令。不给 finding 列表、adjudication、历史评审结论或修复清单；要求先完成并保存独立扫描。不要让审计员读取 .review-evidence/ 中的历史 finding 材料。
2. **定向复核**：扫描结果已保存后，再提供所有 accepted finding、原始证据路径、修复测试路径和提交，要求逐项复核，并检查完整测试、构建、适用静态检查及遗留风险。

主代理预先提供新的输出路径。第一阶段代理不得读取任何已有 `.review-evidence/` 内容，但可以把本阶段结果写入指定文件；完整候选证据写在 inbox，摘要只在 blind-scan.md 记录一次。

第一阶段提示：

~~~text
你是独立最终审计员。检查 [MVP 范围和验收标准] 在当前 HEAD 的整体行为。
可运行的验证命令：[测试/构建/静态检查命令]
不要读取 .review-evidence/ 中任何已有内容、历史 finding、修复清单或以前的裁决；不要编辑项目文件或提交。

## 文件组织约定
- 候选证据写入：.review-evidence/round-[N]/inbox/final-audit-attempt-[K]/[临时_id]/
- 扫描摘要写入：.review-evidence/round-[N]/final-audit/attempt-[K]/blind-scan.md
- 从项目根目录运行，使用项目自身的测试框架和依赖
- 若需要隔离测试数据，可放在：.review-evidence/round-[N]/_testdata/final-audit-attempt-[K]/
- 若命令会改写持久数据、调用真实外部服务或无法确认副作用，停止并记录阻塞

执行全新只读扫描和可用的整体验证。每条具体候选及完整反例写入对应 inbox 目录；在 blind-scan.md 中只写范围、命令摘要、候选临时 ID 和阻塞项，不记录 inbox 路径；主代理分配标准 ID 后在 screening-log.md 记录稳定的证据路径。
返回 SCAN_COMPLETE 或 BLOCKED、finding 摘要/证据路径、命令退出状态和阻塞项。此阶段不得判定整体 CONVERGED，也不要核验历史 finding。
~~~

第一阶段扫描已保存后，再给同一审计员第二阶段提示：

~~~text
现在执行定向复核。第一阶段扫描已保存，不要改写其结论。
第一阶段记录：[.review-evidence/round-[N]/final-audit/attempt-[K]/blind-scan.md]
已修复 finding 及其原始证据、项目测试、commit：[由主代理提供的列表]
遗留 needs-evidence、rejected、deferred 风险：[由主代理提供的索引摘要]
可以读取第一阶段记录和主代理提供的 finding 裁决/证据；不要改写 blind-scan.md。

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架和依赖
- 若需要隔离测试数据，继续使用：.review-evidence/round-[N]/_testdata/final-audit-attempt-[K]/
- 若验证会改写持久数据或调用真实外部服务，停止并记录阻塞

复核所有 accepted finding 和盲扫候选的最终裁决；运行每条 accepted finding 的原始反例和修复测试，再运行完整测试、构建和适用静态检查。
逐项处理 finding，只按需读取当前 finding 的证据并立即写入该项结果；不要一次性加载全部 reproduction 或日志。
把逐项结果及风险检查写入 `.review-evidence/round-[N]/final-audit/attempt-[K]/targeted-verification.md`。
只返回状态、finding ID、命令退出状态摘要、证据路径和阻塞项；不得编辑或提交。
~~~

终审代理的回复同样只返回状态、finding ID、命令/退出状态摘要、证据路径和阻塞项；完整记录保存在证据文件。

任一终审阶段发现的每个具体问题都必须由主代理以 `final-audit-attempt-[K]` 作为 role-slug 记录到 screening-log.md，并进入普通去重、ID 分配、筛查、重放和裁决流程。它不能停留在终审报告之外，也不能被直接放入 accepted 清单。若成为 accepted，修复并验证通过后，当前终审失效；必须启动新的常规评审轮，由相关互补角色检查受影响区域和修复回归，再由新的终审代理重跑两阶段审计。**终审发现触发的新常规评审轮计入 5 轮上限；若此时已达第 5 轮上限，报告 INCOMPLETE 并列出未完成修复的终审发现。**终审发现的 P1/P2 即使出现在原本第 3-5 轮的时间点，也不能因常规扫描优先级限制而被丢弃；若轮次上限不允许完成后续互补复核和新终审，报告 INCOMPLETE。若终审发现仍为 needs-evidence，整体不得报告 CONVERGED；若因明确反证而 rejected 或真实范围外而 deferred，则记录后可继续第二阶段终审。

只有同时满足以下条件才报告 CONVERGED：

1. 达到可提前结束条件的一整轮独立评审（第 2 轮后连续 2 轮无新 P0/P1 且无新 accepted P2），或完成规定的最后回归轮；没有未解决的范围内 P0/P1，也没有未解决 accepted P2。范围外且已证实的 deferred 不阻止收敛，但必须列为残余风险。
2. 所有历史 accepted finding 均按上述规则验证 pass；没有 fail 或 inconclusive 被当作通过。
3. 反例覆盖率至少 80%；若分母为 0，按前述规则报告 N/A，且每个原始候选均有 screening-log 结果。所有进入 finding 生命周期的候选均有当前 decision，所有筛除项/重复项均有筛查记录。范围内 P0/P1 needs-evidence 阻止收敛；常规轮中的 P2 needs-evidence 按其明确性处理：前提和影响已明确但缺环境的可作残余风险，claim 或契约解释本身不明确的阻止收敛。
4. 最终审计两阶段完成，盲扫中的候选均已裁决且没有 needs-evidence；完整测试/构建结果和所有 rejected、deferred、needs-evidence 风险均有记录。

最终报告包含每轮 finding 状态、关键证据路径、测试/提交、遗留风险、覆盖率和 CONVERGED/INCOMPLETE。**如果收敛或达到上限，附上所有 screened_out_preference 建议的汇总清单供用户决策。** CONVERGED 只表示本流程达到约定条件，不代表形式化证明或生产安全保证。
