# TDD、修复与提交协议

本文件是修复实现、TDD、提交和工作区冲突处理的唯一来源；阶段门禁见 `SKILL.md`，操作顺序见 `phase-playbooks.md` §3-§4。

## 实现代理串行约束

**主代理一次只启动一个实现代理，处理一个 finding 的完整 RED-GREEN-REFACTOR 循环并提交。** 默认串行执行（原因：减少上下文管理复杂度、避免 git 工作区冲突、降低 token 消耗），除非用户明确授权并行且有独立的 git worktree 隔离机制。实现代理完成提交后，主代理再启动下一个实现代理处理下一个 finding。

### 有限乐观修复旁路

当 baseline 声明 `Optimistic repair policy: bounded` 时，主代理可以为已 accepted、已确认 RED 且 severity 为 P2/P3 的后续 finding 提前创建独立 worktree。使用 `reviewctl optimistic-start`、`optimistic-record`、`optimistic-promote` 和 `optimistic-discard` 管理生命周期；默认最多一个活动 worktree。候选 worktree 必须从没有源代码用户改动的 HEAD 创建（允许已有评审临时文件），并指定 `risk-assessment=normal`；不能写入主状态或正式证据。

候选通过测试和代码质量检查只代表预检成功。只有在主 HEAD 仍等于 `base_commit`、主工作树干净且补丁无冲突时才能提升；提升后仍按本文件执行正式 RED/GREEN 证据、`guard-commit`、正式提交和独立验证。候选 commit 不得直接作为 finding 的正式 `commit`，也不得替代验证代理对正式 commit 的测试。主 HEAD 变化、用户改动、候选包含禁止路径或 worktree 有未提交改动时，标记 stale/conflict 或 discard，不得强制合并。

## 实现代理任务模板

```text
你是唯一的实现代理，只处理 finding [标准 ID，如 R1-F001-SEC]。
现状与证据：[主代理裁决]
必须重现的反例：[完整前提、步骤和期望/实际]
原始反例证据路径：[.review-evidence/round-[N]/R[N]-F[XXX]-[CAT]/ 中的 reproduce.* 或 manual-steps.md]（使用主代理分配的标准 ID）
验收断言：[可测试的行为]
允许改动：[文件/模块]
必须运行：[focused 测试（RED）、按 baseline tiering mode 执行 GREEN（fast 或 full）、静态或安全检查]
禁止：[用户已有改动、无关重构、真实外部写入]

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架、依赖、构建环境
- 项目测试套件使用项目本身的测试配置和数据机制
- 若需要验证修复前后状态对比的临时数据，可放在：.review-evidence/round-[N]/_testdata/impl-[finding-id]/
- **测试输出先落盘**：运行 RED/GREEN/full 命令前，把完整输出重定向到 .review-evidence/round-[N]/[标准 ID]/output.log 并记录退出码（POSIX：`{ <command>; echo "EXIT_CODE=$?"; } > <output.log> 2>&1`；PowerShell：`<command> *> <output.log>; Add-Content <output.log> "EXIT_CODE=$LASTEXITCODE"`）。输出被截断时读取该日志，不要重复运行；RED、GREEN、full 可分别写入 `output-red.log`、`output-green-suite.log`、`output-full-suite.log`。
- **技能脚本（如需）**：`node "[skill-dir]/scripts/reviewctl.js"`；`[skill-dir]` 由主代理替换为当前 harness 的实际绝对路径；用于 `guard-commit` 或状态查看，不要修改状态或推进阶段
- **编译缓存复用（按磁盘预算）**：在 baseline 记录的磁盘预算内复用缓存（Rust 如 `CARGO_TARGET_DIR`）；focused 优先 `cargo test --test <target> <filter>` 或 `cargo nextest run -p <crate> -E 'test(<filter>)'`，impacted 用 `cargo nextest run -p <crate> -p <dependent>`，GREEN 按 baseline 的 full 命令运行；不要为每个 finding 新建 target 目录。缓存超预算时按主代理指示在轮次边界集中清理（如 `cargo clean`），不要每个 finding 都清理重建

## 输出约定
- 完整实现报告写入：.review-evidence/round-[N]/[标准 ID]/implementation-result.md
- 必要的完整命令输出写入：.review-evidence/round-[N]/[标准 ID]/output.log
- 返回修复摘要、命令与退出状态摘要、证据路径、提交哈希和未解决问题
- 不要在回复中粘贴完整日志，不要替其他 finding 改代码
```

## 测试范围分级

GREEN 门禁由 baseline 的 tiering mode 决定；任何模式下，快速结果都不能替代 progressive 轮末 full 或最终审计 full。

| 范围 | 含义 | 典型用途 |
|------|------|----------|
| focused | 反例、相邻测试或单个模块/测试目标 | RED、快速反馈 |
| impacted | 改动所在 package/crate、直接依赖方及相关测试目标 | 验证阶段的默认回归 |
| full | 项目/workspace 的完整测试套件，包含原始长时 I/O/稳定性测试 | default GREEN 提交前、progressive 轮末门禁、P0/P1/高风险/full-everywhere 验证、already_fixed 默认验证、最终审计 |

- **GREEN 证据按 baseline mode 执行**：`default` 与 `full-everywhere` 保持提交前运行 full。`progressive` 对普通风险 P2/P3 运行 baseline `Fast test command`，在 `Reviewctl GREEN Evidence` 记录 `quality_checks`、`fast_suite`、`fast_profile`、缩放方式、保留契约和未覆盖语义，并在修复报告标 `risk_assessment: normal`；P0/P1 或实现代理判断为 high 时仍须提交前运行 full。无论 fast 还是 full，提交前都必须运行 baseline `Code quality command`；Rust 默认执行 `cargo fmt --all -- --check` 和 `cargo clippy --workspace --all-targets --all-features -- -D warnings`，其它语言执行 baseline 声明的 formatter/linter/type-check 命令。质量检查失败不得提交。fast/full 都必须在被测 index tree 上验证，记录命令、退出码、tree hash、clean 状态、运行位置、测试计数和日志；有长测时，full 证据及日志还必须绑定 baseline 登记的测试 ID 清单和原始 runtime scale。提交后 tree 必须与修复 commit 一致。progressive 的 full 集中在轮末，必须在当前 HEAD 运行并通过 `reviewctl record-round-regression`，且不得使用 fast 的缩短参数，否则不能开下一轮或终审。轮末失败须保留证据并回到 adjudication；不能把 fast/impacted 结果当作 full。
- **验证默认 impacted**：验证代理按风险决定是否重放修复前反例，运行修复后反例和 impacted 回归，生成相邻测试交主代理轮末批测，并核对实现阶段的 full 证据（命令、退出码、tree hash 与修复 commit 一致、测试计数）。pass 的最低回归范围是 **impacted**；focused 只能作为补充。P0/P1、高风险变更、baseline 设为 full-everywhere，或 full 证据失败/缺失/不匹配时，验证代理必须自己重跑 full；P0/P1 和高风险变更不能用实现证据替代验证重跑。每次终审前还必须聚合全部历史相邻测试，见 phase-playbooks.md §5.3。
- **高风险触发 full**：构建/依赖清单（`Cargo.toml`、`Cargo.lock`、`build.rs`、workspace 配置）、公共 API、共享核心模块、认证/权限、数据 schema/迁移、并发/全局状态、feature flag、序列化、测试基础设施、调度/超时/重试、资源泄漏/长期稳定性，或改动跨多个 package、无法有把握判断影响范围。“测试基础设施”仅指影响多个测试的 harness、配置、fixture、helper 或测试运行器；在普通正式测试文件中新增一个用例不算。
- 小项目如果 full 只需 1-2 分钟，可以直接在所有阶段使用 full，不必引入分级。
- Rust：focused 示例 `cargo nextest run -p <crate> -E 'test(<module_or_name>)'` 或 `cargo test -p <crate> --lib <filter>`；impacted = 改动所在 crate + 反向依赖 crate，示例 `cargo nextest run -p <crate> -p <dependent>`（反向依赖可用 `cargo tree -i <crate>` 或 `cargo metadata` 计算）；full 示例 `cargo nextest run --workspace --all-targets` 加 `cargo test --workspace --doc`。`cargo test <filter>` 仍会编译当前 package/workspace 默认成员的所有测试目标，缩小编译范围要用 `-p`、`--lib`、`--test` 或 `cargo nextest` 的 package/target 选择。

### 实现状态与 full 义务

| implementation_status | 实现阶段 full | 验证阶段 |
|---|---|---|
| `fixed`（含 manual fixed） | default/full-everywhere 提交前 full；progressive 普通风险 P2/P3 提交前 fast，P0/P1/high 提交前 full | 复核 GREEN 证据；P0/P1、高风险或 full-everywhere 必须重跑 full |
| `already_fixed` | 允许 `not_run` | 默认在当前 HEAD 重跑 full；普通风险 P2/P3 可按验证模板使用 baseline ancestor 例外 |
| `prepared` | 允许 `not_run` | 不走 pass，按 `blocked_by_user_changes` 记录 |
| `blocked` / `cannot_fix` | 允许 `not_run` | 不 pass，登记 unresolved |
| `blocked_by_user_changes` | 允许 `not_run` | 不 pass；报告披露无 full 证据 |

## RED-GREEN 循环与正式回归测试

1. **RED**：读取当前 `git status --short`，确认没有新的外部写入。
   - **读取临时测试文件**：检查 `tests/review/reproductions/r{round}_f{num}_{slug}{suffix}` 目录（由主代理在 adjudication 阶段从 candidates/ 移动而来）
   - 如果存在可运行的 reproduction 代码，直接运行验证问题存在；若是经批准的手工 finding，执行 `manual-steps.md` 并记录结果
   
   - **将复现测试合入项目正式测试套件**：
     - 读取临时 reproduction 文件的测试用例
     - 确定项目中合适的正式测试文件（如 `tests/auth.test.js`、`tests/api_test.py`、`tests/security_test.go` 等）
       - 根据被测模块路径、项目测试组织结构、命名约定临场判断
       - 不同项目情况不同，灵活选择最合适的测试文件
     - **复制**测试用例到正式测试文件（不是移动，临时文件保留）：
       - 调整导入路径、fixture 路径、断言库以符合项目风格
       - 在测试用例中添加注释标注 finding ID（如 `// R1-F001-SEC`、`# R1-F001-SEC`）
       - 合并到现有 describe/suite 块，或创建新的测试分组
     - 临时文件 `tests/review/reproductions/r{round}_f{num}_{slug}{suffix}` **保留不删除**（供 verification 阶段使用）
   
   - **运行正式回归测试**：
     - 运行正式测试文件中的 finding 回归测试
     - 保存按预期失败的输出（RED 证据）
   
   - **手工 finding 的处理**：对经确认无法自动化的手工 finding，执行 `manual-steps.md` 并记录环境、操作、结果和证据。回归测试策略：
     - 优先尝试为相邻可测路径添加自动化测试
     - **相邻可测路径示例**：
       - **UI 层问题 → 测底层 API**：手工"点击删除按钮后无确认提示" → 相邻可测"测试 DELETE /api/items/:id 端点的确认头或预检查逻辑"
       - **浏览器兼容性问题 → 测核心逻辑**：手工"某 CSS 在 Safari 渲染错误" → 相邻可测"测试生成的 HTML 结构和 CSS 类名是否符合预期"
       - **第三方集成问题 → 测 mock 层**：手工"真实支付网关回调超时" → 相邻可测"测试 mock 回调处理逻辑和超时重试机制"
       - **可访问性问题 → 测语义结构**：手工"屏幕阅读器无法识别某表单" → 相邻可测"测试表单元素的 ARIA 属性和 label 关联"
      - 若完全无法构造等价自动化测试：
        - 用 `record-implementation --manual` 记录，修复提交中说明理由并引用对应 finding 目录中的 manual-steps.md
        - verification-result.md 必须包含修复后的手工复测证据，由验证执行者独立执行步骤
        - 验证时可用 `--adjacent-reason` 说明无法生成相邻自动化测试；后续回归扫描中，该 finding 需要再次手工检查，或由主代理判断是否跳过并在报告中披露风险
   
   - 没有 RED 证据（自动化失败输出或手工复现记录）不得改实现

2. **GREEN**：实现满足验收断言的最小修复
   - **只修改项目源代码**（不修改测试文件）
   - 沿用项目现有抽象和错误处理，避免顺手升级依赖、重排格式或重写不相关模块
   - 修复后按 baseline tiering mode 运行 GREEN：default/full-everywhere 必须运行 full；progressive 普通风险 P2/P3 运行 Fast test command，P0/P1 或 high 风险必须运行 full。
     - finding 正式回归测试必须通过
     - progressive fast command 必须包含 baseline 声明的快速回归范围
   - 在 `implementation-result.md` 记录实际门禁命令、退出码、测试时的 tree hash 和日志路径；门禁失败不得提交。progressive 延后的 full 在轮末运行
   - 不要为了让测试通过而删除/放宽断言、吞掉错误、跳过权限检查或把真实调用改成无条件 mock

3. **回归检查**：GREEN 门禁已覆盖其声明的测试范围；这里运行类型检查、lint、构建和适用的安全扫描
   - 高风险变更在验证阶段按“测试范围分级”重跑 full
   - 记录跳过项、失败项和环境限制，不把未执行写成通过
   - 后续 findings 的修复会自动检查之前的修复（因为正式回归测试属于全量测试套件）

## 工作区与暂存隔离

共享工作区可能已有用户改动。实现代理必须在开始和提交前各执行一次 `git status --short`，比较基线；只暂存自己为当前 finding 新增或修改的明确路径，例如 `git add -- path/to/test path/to/source`，禁止 `git add -A` 或 `git commit -am`。进入 repair 时 `reviewctl` 会记录 `repair_baseline_staged` 路径和 `repair_baseline_index` 内容基线（HEAD 与暂存 diff）；`guard-commit` 会拒绝仍包含用户改动的提交。同一文件可先取消暂存，再用 `git add -p` 仅暂存与用户改动不重叠的修复，用户改动保留在工作区。守卫只读，不会刷新基线或修改索引。旧状态只有路径基线、HEAD 已变化、重叠块、重复文本造成对齐歧义、二进制或文件类型/模式变化时，守卫保守拒绝；无法安全分离则登记 `blocked_by_user_changes`，不要通过重建基线绕过检查。

### 工作区冲突处理

若同一文件同时含有用户改动和 finding 修复：

1. **实现代理停止并报告**：
   - 在 implementation-result.md 中记录冲突文件列表
   - 标记 `implementation_status: prepared`
   - 返回 `blocker: "user_changes_conflict: [文件列表]"`

2. **主代理判断是否能安全分块**：
   - 使用 `git diff -U5 <冲突文件>` 检查用户改动和修复改动的具体位置（显示上下 5 行上下文）
   - 使用 `git add -p <冲突文件>` 尝试交互式分块暂存
   - **安全分块的条件**（必须全部满足）：
     - 用户改动和修复改动在不同函数或不同模块
     - 若在同一文件：修改间隔至少 3 行且无共享依赖（不涉及相同变量、类型定义、接口或函数调用）
     - `git add -p` 能清晰分离两类改动（每个 hunk 只包含一类改动）
   - **不能安全分块的情况**（任一满足即不能分块）：
     - 改动在同一函数内（无论间隔多少行）
     - 改动涉及相同的变量、类型定义、接口或相互调用
     - `git add -p` 的某个 hunk 同时包含用户改动和修复改动
     - 用户改动修改了修复涉及的函数签名、导入语句或依赖声明

3. **冲突解决流程**：
   - **能安全分块**：
     - 主代理执行 `git add -p <冲突文件>`，在交互模式中只暂存修复改动
     - 运行 `git diff --cached` 确认暂存内容不包含用户改动
     - 提交修复，更新 finding 状态为 `verification: pending`
     - 在 implementation-result.md 记录："工作区冲突已通过分块暂存解决"
   - **不能安全分块**：
     - 先用 `reviewctl record-implementation --id [ID] --status prepared --reason "user changes conflict"` 记录准备好的修复
     - 再用 `reviewctl record-verification --id [ID] --status blocked_by_user_changes` 记录手工合并状态
     - 最终报告和 `reviewctl coverage` 会统计这类 finding
     - **可能导致 CONVERGED_WITH_MANUAL_MERGE**：这类 finding 在最终报告中单独章节披露，作为"需要用户手工合并的修复"
     - 在 adjudication.md 中添加字段：`merge_conflict: true`, `user_changes_files: [列表]`, `chunk_attempt_result: "<git add -p 的具体失败原因>"`
     - 实现代理必须在 implementation-result.md 提供详细的手工合并建议（见下方"手工合并建议要求"）

4. **手工合并建议要求**（blocked_by_user_changes 时必须提供）：
   - **冲突文件列表**：所有无法安全暂存的文件
   - **修复 diff patch**：`git diff` 输出（不含用户改动的部分），或清晰的代码片段
   - **建议步骤**：用户如何手工合并（例如：打开文件、找到第 X 行、插入代码片段、运行测试）
   - **验证方法**：用户合并后如何验证修复生效（运行哪个测试、预期结果）
   - **风险提示**：如果用户改动可能与修复冲突，明确说明冲突点

5. **最终报告处理**：
   - 如果有任何 `blocked_by_user_changes` 的 finding，收敛状态为 `CONVERGED_WITH_MANUAL_MERGE`（而非 `CONVERGED`）
   - 单独章节（"需要手工合并的修复"）列出所有 `blocked_by_user_changes` 的 findings
   - 每个 finding 包含完整的手工合并建议（从 implementation-result.md 提取）
   - 章节开头警告："在完成手工合并前，不要部署此版本"
   - 这些 findings 不计入"未验证"统计，但必须明确披露

提交前至少执行：

```text
node <skill-dir>/scripts/reviewctl.js guard-commit --finding [ID] --test [PATH]
git diff --check
git diff --cached --stat
git diff --cached
```

`guard-commit` 会拒绝暂存 `.review-evidence/` 或 `tests/review/`，并检查 finding 的 `implementation-result.md`、测试路径和源代码改动。检查秘密、凭据、生成物、日志和大文件没有被暂存。提交信息应包含 finding ID，推荐格式：

```text
fix(review): [ID] concise behavior being corrected
```

**提交内容必须包含**：
1. 源代码修复
2. **项目正式测试文件的修改**（已合并 reproduction 测试用例）；若手工 finding 确认无法自动化，使用 `record-implementation --manual`，提交记录中说明原因、引用 manual-steps.md 路径，并列出已尝试的相邻可测路径（如有）
3. 必要的配置或依赖更新

**tests/review/ 临时目录不提交到本次修复 commit**：
- 临时测试文件（`tests/review/reproductions/`）保留在工作区，供 verification 阶段使用
- 修复 commit 只包含源代码和正式测试文件的修改
- 整个评审流程结束后，`tests/review/` 目录会被删除

提交成功后运行 `reviewctl record-implementation --id [ID] --status fixed --commit [SHA] --test [PATH]`，由脚本更新 `state.json` / `findings.json` 和生成视图。若提交钩子失败，修复钩子报告的问题并重新检查差异；不要绕过钩子。本流程要求 Git（commit、worktree、guard-commit）；仓库没有 Git 时停止并报告阻塞，不要启动实现阶段。

## 失败处理

- 聚焦测试没有按预期失败，或手工复现没有观察到预期现象：停止实现，由主代理重新确认 finding。只可撤销实现代理自己刚添加且与用户改动隔离的测试；无法安全区分时保留现场并报告，不能继续猜测实现。
- 修复后测试仍失败：区分代码失败、测试错误和环境故障，保留原始输出；最多做有理由的修正，不以无限重试代替诊断。
- GREEN 门禁失败：暂停后续低优先级 finding，判断是否为回归；必要时创建更高优先级 finding。progressive 的轮末 full 失败则保留门禁证据，重新进入 adjudication；修复后对新 HEAD 重跑。
- 需要架构改动、破坏性迁移、真实凭据或生产数据：停止并请求主代理确认范围；不得擅自扩大任务。
- 确认当前轮无法修复：运行 `record-implementation --status cannot_fix --reason TEXT`；环境/依赖阻塞用 `--status blocked --reason TEXT`。随后由主代理决定 `next-finding`、`advance --to round_decision` 或 `advance --to adjudication` 重新裁决。
- 修复无法安全隔离用户改动：不提交，给出最小人工操作建议和阻塞证据。

## 主代理验收清单

只有全部满足才进入修复验证：

- RED 阶段失败证据与原始反例一致。
- **复现测试已复制到项目正式测试文件**；手工 finding 已添加可行的自动化回归测试，或使用 `--manual` 记录无法自动化的理由、已尝试的相邻可测路径、以及修复前后手工执行证据。
- 修复最小、可读、符合现有契约，且正式测试锁定回归；无法自动化的手工 finding 有明确理由和修复后复测证据。验证阶段产生的相邻测试留在 `tests/review/verifications/`，在轮末批量执行；批测发现的缺陷转为正式 finding 后，其修复回归测试才进入正式测试套件。
- focused 和 GREEN 门禁的实际结果已记录；GREEN 证据包含命令、退出码、tree hash、workspace clean/run location、测试计数（total/passed/failed/skipped）和日志；失败/跳过没有被隐藏。progressive 轮末 full gate 通过并绑定当前 HEAD。
- **提交只包含当前 finding（源代码 + 正式测试文件修改）**，`git diff --check` 通过，用户改动未被覆盖。
- commit、测试、反例和 finding ID 已通过 `reviewctl` 写入 `findings.json` / `state.json`。
- **临时文件 `tests/review/reproductions/` 保留在工作区**（不提交，供 verification 使用）。
