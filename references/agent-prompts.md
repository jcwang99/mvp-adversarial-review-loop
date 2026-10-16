# 子代理提示模板与输出格式

本文件提供各类子代理的完整提示模板和标准输出格式。

## 1. 评审代理（Review Agent）

### 提示模板

见 `review-protocol.md` 中的"评审代理提示模板"章节（L63-172）。

### 输出格式（YAML）

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
    evidence_dir: ".review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/"
    counterexample_file: ".review-evidence/round-[N]/inbox/[role-slug]/[临时_id]/counterexample.md"
    reproduction_file: "tests/review/candidates/r{round}_{role}_{temp_id}.test.{ext} | manual-steps.md | none"
    reproduction_command: "<command | manual | not_run>"
    reproduction_exit_status: "<exit code | manual | not_run>"
    reproduction_status: "observed | not_observed | blocked | not_run"
blockers: []
uncovered_paths: []
~~~

## 2. 独立复现审查代理（Replay Reviewer Agent）

### 提示模板

见 `review-protocol.md` 中的"独立复现审查员"章节（L198-223）。

### 输出格式（简短摘要）

~~~yaml
finding_id: "<标准 ID>"
replay_status: "reproduced | not-reproduced | blocked"
replay_evidence_path: ".review-evidence/round-[N]/[标准 ID]/replay-review.md"
output_log_path: ".review-evidence/round-[N]/[标准 ID]/output.log"
commands_summary:
  - command: "<command>"
    exit_status: "<exit code>"
    outcome: "<short summary>"
blockers: []
notes: "<brief observation>"
~~~

### replay-review.md 格式（完整报告）

~~~markdown
# Replay Review: [标准 ID]

## Finding Summary
- Claim: [claim from counterexample.md]
- Severity: [P0/P1/P2/P3]
- Original reviewer: [role-slug]

## Replay Execution
- Reproduction file: [tests/review/reproductions/... 或 manual-steps.md]
- Command: `<exact command>`
- Exit status: [exit code]
- Environment: [relevant env vars, data paths]

## Observations
[描述运行过程中观察到的行为]

## Replay Status
- Status: reproduced | not-reproduced | blocked
- Evidence: [关键输出片段或现象描述]
- Reasoning: [为什么得出这个结论]

## Blockers (if any)
[无法完成复现的原因]

## Output Logs
完整命令输出见：`.review-evidence/round-[N]/[标准 ID]/output.log`
~~~

## 3. 挑战代理（Challenge Agent）

### 提示模板

见 `review-protocol.md` 中的"挑战代理"章节（L292-316）。

### 输出格式（简短摘要）

~~~yaml
finding_id: "<标准 ID>"
challenge_result: "supports | disputes | inconclusive"
challenge_evidence_path: ".review-evidence/round-[N]/[标准 ID]/challenge-result.md"
output_log_path: ".review-evidence/round-[N]/[标准 ID]/output.log"
commands_summary:
  - command: "<command>"
    exit_status: "<exit code>"
    outcome: "<short summary>"
key_findings: "<brief summary of what was found>"
blockers: []
~~~

### challenge-result.md 格式（完整报告）

~~~markdown
# Challenge Result: [标准 ID]

## Original Finding
- Claim: [claim from counterexample.md]
- Severity: [P0/P1/P2/P3]
- Original confidence: [high/medium/low]

## Independent Replay
- Reproduction file: [path]
- Command: `<exact command>`
- Exit status: [exit code]
- Replay outcome: [能否重现原始 claim]

## Challenge Attempts
[描述为了反驳 claim 而进行的尝试]

### Attempt 1: [描述]
- Command: `<command>`
- Exit status: [exit code]
- Observation: [结果]

### Attempt 2: [描述]
...

## Contract/Specification Review
[检查规范、文档、承诺的内容，是否支持或反驳 claim]

## Challenge Result
- Result: supports | disputes | inconclusive
- Reasoning: [详细解释]
- Evidence: [支持结论的关键证据]

## Recommendations (if disputes)
- Suggested decision: rejected | needs-evidence | accepted-with-revision
- Severity adjustment: [如果需要降级]
- Claim revision: [如果需要修订 claim]

## Blockers (if inconclusive)
[无法完成挑战的原因]

## Output Logs
完整命令输出见：`.review-evidence/round-[N]/[标准 ID]/output.log`
~~~

## 4. 补强代理（Reinforce Agent）

### 提示模板

~~~text
你是补强代理。修复 [标准 ID] 的 reproduction 或 counterexample.md 中的小缺陷。
原始证据目录：.review-evidence/round-[N]/[标准 ID]/
主代理反馈：[具体的缺陷描述]

只修改标准 ID 目录内的 reproduction 或 counterexample.md，不改项目源代码、测试或配置。

## 允许的修改
- 修正小的语法错误、导入路径、断言逻辑
- 补充缺失的前提条件说明
- 调整环境变量或数据路径
- 修正 counterexample.md 中的不一致描述

## 禁止的修改
- 改变 claim 的本质含义
- 放宽或删除关键断言
- 添加项目源代码中不存在的假设
- 修改项目源代码

## 输出约定
- 完整补强报告写入：.review-evidence/round-[N]/[标准 ID]/reinforce-result.md
- 返回 fixed 或 cannot-fix、修改摘要、证据路径和未解决问题
- 不要在回复中粘贴完整代码
~~~

### 输出格式（简短摘要）

~~~yaml
finding_id: "<标准 ID>"
reinforce_result: "fixed | cannot-fix"
reinforce_evidence_path: ".review-evidence/round-[N]/[标准 ID]/reinforce-result.md"
modifications: "<brief summary of what was changed>"
remaining_issues: []
blockers: []
~~~

### reinforce-result.md 格式（完整报告）

~~~markdown
# Reinforce Result: [标准 ID]

## Original Issue
[主代理指出的缺陷]

## Modifications Made
[详细列出修改内容]

### File: [文件路径]
- Line [N]: [原内容] → [新内容]
- Reason: [修改理由]

## Verification
- Command: `<command to verify fix>`
- Exit status: [exit code]
- Outcome: [修复后能否正常运行]

## Reinforce Result
- Result: fixed | cannot-fix
- Reasoning: [详细解释]

## Remaining Issues (if cannot-fix)
[无法解决的问题]

## Output Logs
完整命令输出见：`.review-evidence/round-[N]/[标准 ID]/output.log`
~~~

## 5. 实现代理（Implementation Agent）

### 提示模板

~~~text
你是唯一的实现代理，只处理 finding [标准 ID，如 R1-F001-SEC]。
现状与证据：[主代理裁决摘要]
必须重现的反例：[完整前提、步骤和期望/实际]
原始反例文件：tests/review/reproductions/r{round}_f{num}_{slug}.test.{ext}
验收断言：[可测试的行为]
允许改动：[文件/模块]
必须运行：[聚焦测试、回归、静态或安全检查]
禁止：[用户已有改动、无关重构、真实外部写入]

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架、依赖、构建环境
- 项目测试套件使用项目本身的测试配置和数据机制
- 若需要验证修复前后状态对比的临时数据，可放在：.review-evidence/round-[N]/_testdata/impl-[finding-id]/

## TDD 流程

### RED 阶段
1. 检查工作区状态：`git status --short`
2. 读取临时测试文件：tests/review/reproductions/r{round}_f{num}_{slug}.test.{ext}
3. 确定项目中合适的正式测试文件（如 tests/auth.test.js）
4. **复制**测试用例到正式测试文件（不是移动，临时文件保留）：
   - 调整导入路径、fixture 路径、断言库以符合项目风格
   - 在测试用例中添加注释标注 finding ID（如 `// R1-F001-SEC`）
   - 合并到现有 describe/suite 块，或创建新的测试分组
5. 运行合并后的测试，保存按预期失败的输出（RED 证据）
6. 临时文件保留不删除（供 verification 阶段使用）

### GREEN 阶段
1. 实现最小修复（只修改项目源代码，不修改测试文件）
2. 运行测试确认修复：新合并的测试应该通过
3. 运行回归测试：所有原有项目测试也应该通过

### 回归检查
运行项目完整测试套件、类型检查、lint、构建和适用的安全扫描。

### 工作区隔离与提交
1. 提交前检查：`git status --short`，只暂存当前 finding 相关文件
2. 提交内容：源代码修复 + 项目正式测试文件的修改
3. **tests/review/ 临时目录不提交**
4. 提交信息格式：`fix(review): [ID] concise behavior being corrected`

## 输出约定
- 完整实现报告写入：.review-evidence/round-[N]/[标准 ID]/implementation-result.md
- 必要的完整命令输出写入：.review-evidence/round-[N]/[标准 ID]/output.log
- 返回修复摘要、命令与退出状态摘要、证据路径、提交哈希和未解决问题
- 不要在回复中粘贴完整日志
~~~

### 输出格式（简短摘要）

~~~yaml
finding_id: "<标准 ID>"
implementation_status: "committed | blocked"
commit_hash: "<full git hash or unavailable>"
implementation_evidence_path: ".review-evidence/round-[N]/[标准 ID]/implementation-result.md"
output_log_path: ".review-evidence/round-[N]/[标准 ID]/output.log"
test_file_merged_to: "<项目正式测试文件路径>"
commands_summary:
  - phase: "RED | GREEN | REGRESSION"
    command: "<command>"
    exit_status: "<exit code>"
    outcome: "<short summary>"
blockers: []
unresolved_issues: []
~~~

### implementation-result.md 格式（完整报告）

~~~markdown
# Implementation Result: [标准 ID]

## Finding Summary
- Claim: [claim]
- Severity: [P0/P1/P2/P3]
- Acceptance criteria: [验收断言]

## RED Phase
- Temporary test file: tests/review/reproductions/r{round}_f{num}_{slug}.test.{ext}
- Merged to: [项目正式测试文件，如 tests/auth.test.js]
- Test command: `<command>`
- Exit status: [exit code] (expected failure)
- RED evidence: [关键失败输出片段]

## GREEN Phase
- Modified files: [列出修改的源代码文件]
- Implementation approach: [简述实现策略]
- Test command: `<command>`
- Exit status: 0 (tests pass)

## Regression Check
- Full test suite: `<command>` - exit status: [exit code]
- Type check: `<command>` - exit status: [exit code]
- Lint: `<command>` - exit status: [exit code]
- Build: `<command>` - exit status: [exit code]

## Commit
- Pre-commit check: `git diff --check` - [result]
- Staged files: [列出暂存的文件]
- Commit hash: [full hash]
- Commit message: [message]

## Implementation Status
- Status: committed | blocked
- Blockers: [如果有]
- Unresolved issues: [如果有]

## Output Logs
完整命令输出见：`.review-evidence/round-[N]/[标准 ID]/output.log`
~~~

## 6. 验证代理（Verification Agent）

### 提示模板

见 `review-protocol.md` 中的"修复验证"章节（L332-390）。

### 输出格式（简短摘要）

~~~yaml
finding_id: "<标准 ID>"
verification_status: "pass | fail | inconclusive"
verification_evidence_path: ".review-evidence/round-[N]/[标准 ID]/verification-result.md"
output_log_path: ".review-evidence/round-[N]/[标准 ID]/output.log"
adjacent_tests_generated: <number>
adjacent_tests_merged_to: "<项目正式测试文件路径>"
commands_summary:
  - phase: "RED_CHECK | FIX_CHECK | ADJACENT_GEN | ADJACENT_RUN | MERGE | FULL_SUITE"
    command: "<command>"
    exit_status: "<exit code>"
    outcome: "<short summary>"
blockers: []
~~~

### verification-result.md 格式（完整报告）

~~~markdown
# Verification Result: [标准 ID]

## Finding and Fix Summary
- Claim: [claim]
- Commit: [hash]
- Implementation evidence: [path to implementation-result.md]

## RED Evidence Check
- RED evidence location: [path in implementation-result.md]
- Covers original claim: yes | no
- Notes: [any observations]

## Fix Verification
- Temporary test file: tests/review/reproductions/r{round}_f{num}_{slug}.test.{ext}
- Command: `<command>`
- Exit status: 0 (tests pass)
- Outcome: [问题已修复]

## Adjacent Tests Generation
- Generated tests count: [number]
- Generated test file: tests/review/verifications/r{round}_f{num}_adjacent.test.{ext}
- Test cases:
  1. [描述相邻测试用例 1]
  2. [描述相邻测试用例 2]
  ...

## Adjacent Tests Execution
- Command: `<command>`
- Exit status: [exit code]
- Outcome: [all pass | some failed]
- Failed cases (if any): [列出失败的用例及原因]

## Adjacent Tests Merge
- Merged to: [项目正式测试文件路径]
- Adjustments made: [导入路径、格式调整]
- Finding ID annotation: [已添加]

## Full Test Suite
- Command: `<command>`
- Exit status: [exit code]
- Outcome: [all pass | some failed]
- Regression detected: no | yes [如果有，列出失败的测试]

## Verification Status
- Status: pass | fail | inconclusive
- Reasoning: [详细解释]
- Verified by: [agent-id or main-agent]

## Blockers (if inconclusive)
[无法完成验证的原因]

## Output Logs
完整命令输出见：`.review-evidence/round-[N]/[标准 ID]/output.log`
~~~

## 7. 最终审计代理（Final Audit Agent）

### 第一阶段提示模板（盲扫）

见 `review-protocol.md` 中的"最终审计与收敛"章节（L443-460）。

### 第二阶段提示模板（定向复核）

见 `review-protocol.md` 中的"最终审计与收敛"章节（L463-479）。

### 第一阶段输出格式（盲扫摘要）

~~~yaml
audit_phase: "blind-scan"
audit_attempt: <number>
scan_status: "SCAN_COMPLETE | BLOCKED"
blind_scan_evidence_path: ".review-evidence/round-[N]/final-audit/attempt-[K]/blind-scan.md"
candidate_findings_count: <number>
candidate_findings:
  - temp_id: "<audit-local ID>"
    severity: "P0 | P1 | P2 | P3"
    claim: "<short claim>"
    evidence_dir: ".review-evidence/round-[N]/inbox/final-audit-attempt-[K]/[temp_id]/"
commands_summary:
  - command: "<command>"
    exit_status: "<exit code>"
    outcome: "<short summary>"
blockers: []
~~~

### 第二阶段输出格式（定向复核摘要）

~~~yaml
audit_phase: "targeted-verification"
audit_attempt: <number>
verification_status: "COMPLETE | BLOCKED"
targeted_verification_evidence_path: ".review-evidence/round-[N]/final-audit/attempt-[K]/targeted-verification.md"
verified_findings_count: <number>
findings_verification:
  - finding_id: "<标准 ID>"
    original_test_passed: yes | no
    fix_test_passed: yes | no
    notes: "<brief observation>"
residual_risks:
  - category: "needs-evidence | rejected | deferred"
    count: <number>
    notes: "<brief summary>"
commands_summary:
  - command: "<command>"
    exit_status: "<exit code>"
    outcome: "<short summary>"
blockers: []
~~~

### blind-scan.md 格式（第一阶段完整报告）

见 `review-protocol.md` L455-458 的输出约定。

### targeted-verification.md 格式（第二阶段完整报告）

见 `review-protocol.md` L475-478 的输出约定。

## 输出格式使用规范

1. **简短摘要（返回给主代理）**：使用 YAML 格式，只包含关键字段、状态、证据路径和命令摘要
2. **完整报告（写入证据文件）**：使用 Markdown 格式，包含详细步骤、观察、推理和证据
3. **完整命令输出（写入 output.log）**：原始的、未经编辑的命令输出，脱敏后保存
4. **不要在回复中粘贴完整代码或日志**：只在摘要中引用路径和关键片段

## 相邻测试（Adjacent Tests）的最低标准

验证代理生成的相邻测试必须满足以下最低标准：

1. **至少生成 2 个相邻测试用例**：
   - 一个测试正常情况（修复没有破坏合法用例）
   - 一个测试边界情况（修复没有过度限制）

2. **相邻测试必须可运行**：
   - 使用项目的测试框架和风格
   - 导入路径、断言库正确
   - 不依赖临时测试目录

3. **相邻测试失败的处理**：
   - 若相邻测试失败，验证状态为 `fail`
   - 在 verification-result.md 中说明失败原因（over-fix / under-fix / regression）
   - 不合并失败的相邻测试到项目测试文件

4. **无法生成相邻测试的处理**：
   - 若修复过于简单（如修正拼写错误），可以不生成相邻测试
   - 在 verification-result.md 中说明理由
   - 验证状态仍可为 `pass`（基于 RED 证据和修复测试）

5. **手工 finding 的相邻测试**：
   - 优先为相邻可测路径生成自动化测试
   - 若完全无法自动化，在 verification-result.md 中说明理由和已尝试的相邻路径
   - 必须包含修复后的手工复测证据
