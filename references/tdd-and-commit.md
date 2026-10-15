# TDD、修复与提交协议

## 实现代理任务模板

```text
你是唯一的实现代理，只处理 finding [标准 ID，如 R1-F001-SEC]。
现状与证据：[主代理裁决]
必须重现的反例：[完整前提、步骤和期望/实际]
原始反例证据路径：[.review-evidence/round-[N]/R[N]-F[XXX]-[CAT]/ 中的 reproduce.* 或 manual-steps.md]（使用主代理分配的标准 ID）
验收断言：[可测试的行为]
允许改动：[文件/模块]
必须运行：[聚焦测试、回归、静态或安全检查]
禁止：[用户已有改动、无关重构、真实外部写入]

## 运行约定
- 从项目根目录运行，使用项目自身的测试框架、依赖、构建环境
- 项目测试套件使用项目本身的测试配置和数据机制
- 若需要验证修复前后状态对比的临时数据，可放在：.review-evidence/round-[N]/_testdata/impl-[finding-id]/

把 RED/GREEN、测试输出、差异检查和提交记录写入对应 finding 目录的 implementation-result.md，完整输出按需保存在 output.log。返回修复摘要、命令与退出状态摘要、证据路径、提交哈希和未解决问题；不要粘贴完整日志，不要替其他 finding 改代码。
```

## RED-GREEN-REFACTOR

1. **RED**：读取当前 `git status --short`，确认没有新的外部写入。
   - **优先使用评审代理提供的反例证据**：检查 `.review-evidence/round-[N]/R[N]-F[XXX]-[CAT]/` 目录（使用主代理分配的标准 ID）
   - 如果存在可运行的 reproduction 代码，直接运行它验证问题存在；若是经批准的手工 finding，执行 `manual-steps.md` 并记录结果
   - **自动化 reproduction 必须迁移到项目测试套件**：
     - 确定项目测试目录位置（如 `tests/`、`__tests__/`、`test/`、`src/**/*_test.go`）
     - 将 reproduction 代码改编为项目测试格式（调整导入路径、fixture 路径、断言库）
     - 保留 `.review-evidence/` 中的原始文件作为审计证据
     - 在项目测试套件中创建新测试文件或添加到相关测试文件
     - 测试文件命名应反映 finding ID 并符合项目约定，如：
       - JavaScript/TypeScript: `security-R1-F001-SEC.test.js` 或在现有测试中添加注释 `// R1-F001-SEC`
       - Python: `test_security_R1_F001_SEC.py` 或 `test_auth.py` 中注释 `# R1-F001-SEC`
       - Go: `security_test.go` 中函数 `TestAuthR1F001SEC` 或注释 `// R1-F001-SEC`
       - Java: `AuthTest.java` 中方法 `testAuthR1F001SEC` 或注释 `// R1-F001-SEC`
       - Rust: `tests/security_r1_f001_sec.rs` 或 `#[test] fn auth_r1_f001_sec()` 附注释 `// R1-F001-SEC`
       - Ruby: `spec/security/auth_r1_f001_sec_spec.rb` 或在现有 spec 中注释 `# R1-F001-SEC`
       - C#: `AuthTests.cs` 中方法 `[Test] public void TestAuth_R1F001SEC()` 或注释 `// R1-F001-SEC`
   - 自动化反例迁移为项目测试后，运行新测试并保存按预期失败的结果；手工 finding 保存修复前的复现记录
   - 对经确认无法自动化的手工 finding，执行 `manual-steps.md` 并记录环境、操作、结果和证据；尽量添加相邻可测行为的自动化回归测试。若等价测试也无法构造，记录原因，并要求验证执行者在修复后重复手工步骤。没有 RED 证据不得改实现
2. **GREEN**：实现满足验收断言的最小修复。沿用项目现有抽象和错误处理，避免顺手升级依赖、重排格式或重写不相关模块。修复后，新增测试和手工复测（如适用）应该通过。
3. **REFACTOR**：仅在聚焦测试或获准的手工复测通过后清理重复代码或命名；每次整理后重跑聚焦验证。不要为了让测试通过而删除/放宽断言、吞掉错误、跳过权限检查或把真实调用改成无条件 mock。
4. **回归**：运行项目已存在的最小回归集，再运行完整可用的测试、类型检查、lint、构建和适用的安全扫描。记录跳过项、失败项和环境限制，不把未执行写成通过。

## 工作区与暂存隔离

共享工作区可能已有用户改动。实现代理必须在开始和提交前各执行一次 `git status --short`，比较基线；只暂存自己为当前 finding 新增或修改的明确路径，例如 `git add -- path/to/test path/to/source`，禁止 `git add -A` 或 `git commit -am`。若同一文件同时含有用户改动，先停止并让主代理决定是否能安全分块；不能安全分块就不提交。

提交前至少执行：

```text
git diff --check
git diff --cached --stat
git diff --cached
```

检查秘密、凭据、生成物、日志和大文件没有被暂存。提交信息应包含 finding ID，推荐格式：

```text
fix(review): [ID] concise behavior being corrected
```

**提交内容必须包含**：
1. 源代码修复
2. 可行的项目回归测试（从 `.review-evidence/` 改编而来）；若手工 finding 确认无法自动化，提交记录中说明原因和手工验证证据路径
3. 必要的配置或依赖更新

**.review-evidence/ 目录不提交到本次修复 commit**：
- 证据目录应该在评审开始时就已提交（或在每轮评审后集中提交）
- 修复 commit 只包含源代码、可行的测试和必要的手工验证例外记录
- 避免混淆"审计证据"和"产品代码"的边界

提交成功后返回完整哈希，并更新 run-state.md 与 findings-index.md。若提交钩子失败，修复钩子报告的问题并重新检查差异；不要绕过钩子。若仓库没有 Git 或用户明确要求不提交，返回 commit: unavailable，由主代理在最终报告说明。

## 失败处理

- 聚焦测试没有按预期失败，或手工复现没有观察到预期现象：停止实现，由主代理重新确认 finding。只可撤销实现代理自己刚添加且与用户改动隔离的测试；无法安全区分时保留现场并报告，不能继续猜测实现。
- 修复后测试仍失败：区分代码失败、测试错误和环境故障，保留原始输出；最多做有理由的修正，不以无限重试代替诊断。
- 完整回归失败：暂停后续低优先级 finding，判断是否为回归；必要时创建更高优先级 finding。
- 需要架构改动、破坏性迁移、真实凭据或生产数据：停止并请求主代理确认范围；不得擅自扩大任务。
- 修复无法安全隔离用户改动：不提交，给出最小人工操作建议和阻塞证据。

## 主代理验收清单

只有全部满足才进入修复验证：

- RED 阶段失败证据与原始反例一致。
- 自动化 reproduction 已迁移到项目测试套件；手工 finding 已添加可行的自动化回归测试，或记录无法自动化的理由和修复前后手工执行证据。
- 修复最小、可读、符合现有契约，且新增测试锁定回归；无法自动化的手工 finding 有明确理由和修复后复测证据。
- 聚焦和回归命令的实际结果已记录；失败/跳过没有被隐藏。
- 提交只包含当前 finding（源代码 + 可行的项目测试或手工验证例外记录），`git diff --check` 通过，用户改动未被覆盖。
- commit、测试、反例和 finding ID 已写入 findings-index.md 与 run-state.md。
- `.review-evidence/` 目录的原始文件保持完整（作为审计证据，不在修复 commit 中）。
