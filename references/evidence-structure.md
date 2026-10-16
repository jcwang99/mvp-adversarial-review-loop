# 证据目录与状态记录

本文件只定义审计材料的存放方式和可恢复状态。角色、裁决、反例门槛与轮次判断以 SKILL.md 为准；修复和提交以 tdd-and-commit.md 为准。

## 目录布局

评审开始时创建：

~~~
.review-evidence/
├── baseline.md
├── run-state.md
├── findings-index.md
├── screening-log.md
└── round-1/
    ├── _testdata/                          # 可选：需要隔离的测试数据
    │   ├── security/                       # 评审角色的测试数据（如 SQLite DB、fixture）
    │   │   ├── test.db
    │   │   └── fixtures/
    │   ├── replay-R1-F001-SEC/             # 独立复现审查的测试数据
    │   ├── challenge-R1-F001-SEC/          # 挑战代理的反例变体数据
    │   ├── verify-R1-F001-SEC/             # 修复验证的变体测试数据
    │   ├── impl-R1-F001-SEC/               # 实现代理的修复前后对比数据
    │   └── final-audit/
    │       └── attempt-1/                  # 最终审计的测试数据
    ├── inbox/
    │   ├── security/
    │   │   └── SEC-001/
    │   │       ├── counterexample.md
    │   │       └── output.log              # 完整命令输出
    │   ├── functionality/
    │   │   └── FUNC-001/
    │   │       ├── counterexample.md
    │   │       └── manual-steps.md
    │   ├── reliability/
    │   │   └── REL-001/
    │   │       ├── counterexample.md
    │   │       └── output.log
    │   └── api/
    │       └── API-001/
    │           ├── counterexample.md
    │           └── output.log
    ├── final-audit/
    │   └── attempt-1/
    │       ├── blind-scan.md
    │       ├── targeted-review.md
    │       └── inbox/
    │           └── FA-001/
    │               ├── counterexample.md
    │               └── output.log
    └── R1-F001-SEC/
        ├── original-id.txt
        ├── counterexample.md
        ├── adjudication.md
        ├── replay-review.md
        ├── challenge-result.md
        ├── implementation-result.md
        ├── verification-result.md
        └── output.log                      # 可选：完整命令输出

tests/                                      # 项目测试目录
├── auth.test.js                            # 项目正式测试文件
├── api.test.js
└── review/                                 # 临时测试目录（评审流程结束后删除）
    ├── candidates/                         # 评审代理写入（测试框架忽略）
    │   └── r1_sec_001.test.js
    ├── reproductions/                      # adjudication accepted 后移动到这里
    │   └── r1_f001_auth_bypass.test.js    # 保留供 verification 使用
    └── verifications/                      # verification 阶段生成的相邻测试
        └── r1_f001_auth_bypass_adjacent.test.js   # 保留供最终合并
~~~

**目录职责说明**：

- **inbox/[role-slug]/[临时_id]/**：评审代理提交的候选证据，包含 counterexample.md 和完整输出
- **R[N]-F[XXX]-[CAT]/**：主代理分配标准 ID 后的正式 finding 目录，包含裁决、复现审查、挑战、实现、验证等完整生命周期记录
- **_testdata/**（可选）：仅当需要隔离测试数据时使用，存放测试数据库文件、fixture、反例变体等
  - 按代理类型和 finding ID 隔离：`[role-slug]/`、`replay-[id]/`、`challenge-[id]/`、`verify-[id]/`、`impl-[id]/`、`final-audit/attempt-[K]/`
  - 不包含项目依赖、编译环境、构建产物
  - 若项目测试本身已支持临时数据（如 SQLite `:memory:`、Jest 隔离），不需要此目录
  - **清理规则**：
    - **保留条件**：_testdata/ 必须保留直到该轮所有 accepted findings 验证完成
    - **清理时机**：
      - 每轮评审和修复验证完全完成后，可清理该轮的 `_testdata/` 目录
      - 若该轮有 verification: fail 或 inconclusive 的 findings，保留对应的 _testdata/ 子目录
      - 进入下一轮常规评审时，可清理上一轮已验证的 _testdata/
    - **清理前检查**：
      - 确认所有证据文件（counterexample.md、output.log、*-result.md）已保存在 inbox/ 或标准 ID 目录
      - 确认不需要复现失败或 inconclusive 的 finding
    - **最终清理**：最终审计通过且收敛后，可清理所有 _testdata/
    - **版本控制**：_testdata/ 应列入 .gitignore，不提交到版本控制

**tests/review/ 临时测试目录**（评审流程专用，结束后删除）：
- **candidates/**：评审代理写入，测试框架配置中忽略此目录，不会在日常测试中运行
- **reproductions/**：adjudication accepted 后从 candidates/ 移动到这里
  - 命名规则：`r{round}_f{num}_{slug}.test.{ext}`（如 `r1_f001_auth_bypass.test.js`）
  - **在 TDD 阶段**：实现代理读取此文件，复制测试用例到项目正式测试文件（如 `tests/auth.test.js`）
  - **保留不删除**：供 verification 阶段使用（验证代理基于此生成相邻测试）
  - 测试框架配置中忽略此目录（或仅在 `ADVERSARIAL_REVIEW=true` 时运行）
- **verifications/**：verification 阶段，验证代理写入相邻测试
  - 命名规则：`r{round}_f{num}_{slug}_adjacent.test.{ext}`（如 `r1_f001_auth_bypass_adjacent.test.js`）
  - 相邻测试通过后，验证代理复制到项目正式测试文件
  - **保留不删除**：供最终报告统计
  - 测试框架配置中忽略此目录（或仅在 `ADVERSARIAL_REVIEW=true` 时运行）
- **整个 tests/review/ 目录在评审流程结束后删除**

**测试框架配置示例**（跨语言）：

JavaScript (jest.config.js):
```javascript
const isReviewMode = process.env.ADVERSARIAL_REVIEW === 'true';
module.exports = {
  testMatch: isReviewMode 
    ? ['**/tests/**/*.test.js']
    : [
        '**/tests/**/*.test.js',
        '!**/tests/review/**'  // 日常测试跳过 review/
      ],
};
```

Python (pytest.ini):
```ini
[pytest]
testpaths = tests
addopts = --ignore=tests/review  # 默认跳过 review/
# 评审模式: ADVERSARIAL_REVIEW=true pytest tests/
```

Go (使用 build tags):
```go
// +build adversarial_review
// 在 tests/review/ 下的文件添加此 tag
// 日常测试不会运行，评审时用 go test -tags adversarial_review
```

Rust (Cargo.toml):
```toml
[features]
adversarial-review = []
# 评审模式: cargo test --features adversarial-review
```

**运行约定**：
- 所有命令从项目根目录运行，使用项目自身的测试框架、依赖、构建环境
- **评审代理的 reproduction**：直接写入 `tests/review/candidates/` 目录，使用项目测试格式
- **实现代理的测试合并**：从 `tests/review/reproductions/` 读取，复制测试用例到项目正式测试文件
- 项目运行环境（如 Rust `target/`、Node `node_modules/`、Python `venv/`）由项目自身管理，不在 .review-evidence/ 中重复创建
- 仅在需要避免数据冲突时使用 _testdata/，通过环境变量传递路径
- 示例运行命令（POSIX shell 语法；Windows PowerShell 请转换为等价命令，如 `$env:ADVERSARIAL_REVIEW='true'; npm test ...`）：
  ```bash
  # 运行正式测试（日常测试，跳过 tests/review/）
  npm test
  
  # 运行临时测试（评审流程中）
  ADVERSARIAL_REVIEW=true npm test tests/review/reproductions/r1_f001_auth_bypass.test.js
  
  # 需要隔离数据时
  TEST_DB_PATH=.review-evidence/round-1/_testdata/security/test.db \
    npm test tests/review/candidates/r1_sec_001.test.js
  ```

**Reproduction 文件命名**：
- **评审阶段（candidates/）**：`r{round}_{role}_{temp_id}.test.{ext}`（如 `r1_sec_001.test.js`）
- **adjudication accepted（reproductions/）**：`r{round}_f{num}_{slug}.test.{ext}`（如 `r1_f001_auth_bypass.test.js`）
- **verification 阶段（verifications/）**：`r{round}_f{num}_{slug}_adjacent.test.{ext}`（如 `r1_f001_auth_bypass_adjacent.test.js`）
- 按项目语言和测试约定选择扩展名：
  - JavaScript/TypeScript: `.test.js`, `.spec.ts`
  - Python: `_test.py`, `test_.py`
  - Go: `_test.go`
  - Java: `Test.java`（类名需匹配文件名）
  - Rust: `.rs`（放在 `tests/` 下）
  - Ruby: `_spec.rb`
  - C#: `Test.cs`

每个评审角色使用唯一的 role-slug 目录，例如 security、functionality、api。临时 ID 只需在该角色目录内唯一。不同角色即使都使用 SEC-001，也不会写入同一路径。

主代理记录纯偏好和明确不构成现存风险的范围/契约请求后，对剩余候选去重；只有进入 finding 生命周期的独立候选才分配标准 ID，并将其 inbox 目录移动到该轮目录下的标准 ID 目录。分配 ID 时同时将候选复现文件复制为标准 ID 目录中的 `reproduce.*`（tests/review/ 中的原始文件保留运行用，流程结束时删除；手工 finding 的 manual-steps.md 随 inbox 移动）。之后即使 decision 为 rejected、deferred 或 needs-evidence，也保留 ID 和索引行。重复候选不另分配标准 ID：保留其 inbox 目录，在索引和主 finding 记录中标注 deduplicated_with。

经确认无法自动化的反例使用 manual-steps.md，并记录无法自动化的原因、前提、精确操作和观察点。自动化反例应保存完整可执行文件。完整命令输出保存在 finding 目录内，记录中引用路径并摘要关键结果。

## run-state.md 检查点

run-state.md 是当前执行位置的短检查点，不是完整历史日志。每次代理交接、状态变化、提交、验证和轮次切换后更新。**压缩上下文后恢复时，主代理必须立即读取此文件确认当前位置。**

~~~markdown
# Review Run State

**这是一个多轮循环流程：最少 2 轮常规评审，最多 5 轮，然后进行最终审计。**

- overall_status: in_progress | waiting_on_evidence | incomplete | converged
- current_phase: baseline | review | adjudication | repair | verification | round_decision | final_audit | report
- current_round: 1 (常规评审轮次，1-5)
- rounds_consumed: 0/5 (已完成的常规评审轮次 / 上限；baseline 初始化为 0，每轮完成时更新为 current_round)
- can_trigger_new_round: true (是否还能触发新的常规评审轮；每轮完成时重算 = rounds_consumed < 5)
- final_audit_attempt: 0/3 (已完成的最终审计尝试 / 上限)
- baseline_head: [初始 HEAD 或 unavailable]
- current_head: [当前 HEAD 或 unavailable]
- last_completed_event: [短摘要，包括完成的阶段和轮次]
- active_finding: [标准 ID 或 none]
- next_action: [一个明确动作及所需文件路径，包括需要委派的子代理类型]
- blockers: [无，或阻塞事项和负责人]
- updated_at: [ISO 8601]

## Workflow Reminder
- Phase: review → 必须使用独立评审子代理（至少 3 个角色）
- Phase: adjudication → 复现审查必须委派给子代理，挑战必须委派给挑战代理；**主代理负责移动 accepted findings 的临时测试文件**
- Phase: repair → 必须委派给实现子代理
- Phase: verification → 必须委派给验证子代理（不能是实现代理）
- Phase: round_decision → 检查是否满足进入最终审计的条件，否则进入下一轮（若 can_trigger_new_round = true）
- Phase: final_audit → 必须委派给最终审计子代理

## Rounds Budget
- 常规评审轮：最多 5 轮（rounds_consumed 计数）
- 最终审计尝试：最多 3 次（final_audit_attempt 计数）
- 当 rounds_consumed = 5 时，can_trigger_new_round = false，无法再启动新的常规评审轮
- 当 final_audit_attempt = 3 且仍发现问题时，报告 INCOMPLETE

## Counts
- raw_candidates: [数量]
- duplicates: [数量]
- screened_out: [数量]
- independently_replayed: [自动化数量 / 手工数量]
- decisions: [accepted / needs-evidence / rejected / deferred 数量]
- verification: [pending / pass / fail / inconclusive 数量]
- verification_blocked_by_user_changes: [数量] (因工作区冲突无法提交的 findings)
- counterexample_coverage: [百分比及分子/分母]

## Round History
- Round 1: [评审角色数] roles, [accepted数] accepted, [verified数] verified, [新accepted P0/P1数] new accepted P0/P1
- Round 2: ...
(用于判断提前收敛条件和轮次上限)
~~~

不要把 reproduction 源码或完整命令输出复制进 run-state.md。摘要必须足以判断当前阶段、待办和阻塞，但具体依据留在 finding 记录中。

## baseline.md

记录初始范围和工作区状态，至少包含：

~~~markdown
# Review Baseline

## MVP Scope
- Included:
- Explicitly excluded:
- Acceptance criteria and source:
- Design load or compatibility promises:

## System
- Language/runtime and key dependencies:
- Entry points and critical data flows:
- External services and auth boundaries:
- Deployment model:

## Repository
- Repository path:
- Branch:
- Baseline HEAD:
- Initial git status:
- Existing user changes:

## Verification
- Unit/integration/E2E commands:
- Build/type-check/lint/security commands:
- Baseline results: [summary and paths to full logs]
- Known environment limits:

## Review
- Started at:
- Assumptions:
~~~

先记录初始 git status，再创建审计文件。区分原有用户改动、评审证据文件和后续实现改动；任何提交都不得夹带基线中的用户改动。

## findings-index.md

每条独立候选一行，维护唯一的当前状态。至少记录：

~~~markdown
| Finding ID | Original ID(s) | Role | Severity | Decision | Verification | Evidence | Regression test | Commit | Duplicate of |
|------------|----------------|------|----------|----------|--------------|----------|-----------------|--------|--------------|
| R1-F001-SEC | SEC-001 | security | P1 | accepted | pending | round-1/R1-F001-SEC/ | tests/auth.test.js | - | - |
~~~

Decision 取 accepted、needs-evidence、rejected 或 deferred。验证结果单独取 pending、pass、fail、inconclusive 或 blocked_by_user_changes；只有 accepted 且 verification 为 pass 时，用户报告中才可称 verified（verified 是报告用词，不是 verification 枚举值）。记录验证执行者；主代理兜底适用相同的检查标准。verification 为 inconclusive 时仍是 accepted、未 verified，不是新的 decision 值。

索引应保持精简。裁决理由、命令、输出、挑战过程、补强过程和验证细节写在对应 finding 目录的记录中，并在索引中链接相对路径。

## screening-log.md

screening-log.md 按轮次记录全部原始评审报告及其去重/筛查结果，包括 ID 分配前筛除的意见。每条至少包含角色、临时 ID、处理结果、理由，以及 duplicate 时对应的 canonical ID。

- preference 或仅措辞建议 (kind: preference)：记录为 screened_out_preference，不分配标准 finding ID，不进入 findings-index.md，也不进入反例覆盖率分母。所有 preference 建议汇总后在达到收敛或轮次上限时交给用户决策。
- 明确要求增加未承诺功能，或仅把无契约依据的偏好当成验收失败，且没有指出当前行为的具体损害：记录为 screened_out_scope 或 screened_out_contract，不分配标准 ID、不进入 findings-index.md，也不进入覆盖率分母。若其描述的是现有行为的具体风险，则不得仅据此筛出，必须按 finding 审查。
- 重复报告：记录为 duplicate，并指向 canonical ID；原始 inbox 文件保留。
- 进入 finding 生命周期的候选：记录 canonical ID 和证据目录路径。

这样 raw_candidates 的计数可审计，同时 findings-index.md 只维护实际进入 finding 生命周期的唯一候选。

## Finding 记录

每个标准 ID 目录按实际需要包含以下文件：

- original-id.txt：来源角色和原始临时 ID。
- counterexample.md：前提、步骤、期望/实际行为、影响和置信度。
- reproduce.* 或 manual-steps.md：原始复现材料。
- adjudication.md：主代理的范围/契约筛查、复现证据引用、裁决及理由。
- replay-review.md：独立复现审查的命令、观察、结果和证据路径。
- challenge-result.md：触发挑战时的短结论和证据路径。
- reinforce-result.md：需要补强时的修改摘要和运行结果。
- implementation-result.md：RED/GREEN、回归、差异、提交和未解决项。
- verification-result.md：验证命令、结果、执行者、变体和阻塞。
- output.log：完整且脱敏的命令输出；体积较大时可按阶段分文件。

## Final audit records

每次最终审计记录放在 `round-[N]/final-audit/attempt-[K]/`，候选材料放在 `round-[N]/final-audit/attempt-[K]/inbox/`（临时 ID 使用 FA- 前缀，如 FA-001）。重跑时递增 attempt，保留旧目录，不覆盖历史扫描或复核结果。

日志不得包含未脱敏的凭据、个人数据或秘密。若实际运行输出含敏感信息，先清理再保存；记录关键片段和退出状态，避免把整份日志贴入代理回复。

## 审计材料的 Git 生命周期

审计材料应纳入版本控制以保持追溯。可在每轮评审结束时单独提交证据记录；实现修复提交只包含当前 finding 的产品代码、可行的项目回归测试及必要配置，不包含 .review-evidence/。若无法安全区分用户已有改动，不提交并在 run-state.md 记录阻塞。

**证据与代码的历史一致性**：修复 commit 引用的证据路径在该 commit 快照中不存在（证据在独立的评审 commit 中）。这是有意的设计取舍：避免混淆审计证据与产品代码边界。在 commit message 中使用相对引用（如"证据见前一次评审 commit 的 .review-evidence/round-1/R1-F001-SEC/"）帮助定位。checkout 旧修复 commit 时，需同时参考时间上相邻的评审 commit 获取完整证据。

评审取消时保留已有证据，除非用户明确要求清理。证据目录不应被全局忽略。
