# 证据目录结构与管理

## 目录结构

所有 reproduction 代码和相关证据保存在项目根目录的 `.review-evidence/` 目录：

```
.review-evidence/
├── README.md                          # 本次评审的元信息和索引
├── baseline.md                        # 评审基线：范围、技术栈、测试命令
├── round-1/
│   ├── R1-F001-SEC/                   # 主代理分配的标准 ID
│   │   ├── original-id.txt            # 评审代理的原始 ID（如 SEC-001）
│   │   ├── reproduce.test.js          # 评审代理提供的原始反例代码
│   │   ├── counterexample.md          # 文字描述：前提、步骤、期望/实际
│   │   ├── adjudication.md            # 主代理的裁决记录（合理性检查 + 验证结果）
│   │   ├── challenge-result.md        # 挑战代理的验证结果（如有）
│   │   └── verification-result.md     # 终审代理的验证结果
│   ├── R1-F002-FUNC/
│   │   ├── original-id.txt            # FUNC-001
│   │   ├── reproduce.sh               # 脚本形式的反例
│   │   ├── counterexample.md          # 文字描述
│   │   ├── adjudication.md            # 裁决记录
│   │   └── output.log                 # 实际运行输出
│   └── R1-F003-UX/
│       ├── original-id.txt            # UX-001
│       ├── manual-steps.md            # 手工复现步骤
│       ├── adjudication.md            # 裁决记录
│       ├── expected-screenshot.png    # 期望行为截图（描述）
│       └── actual-screenshot.png      # 实际行为截图（描述）
├── round-2/
│   ├── R2-F004-PERF/                  # 序号全局递增
│   └── ...
└── findings-index.md                  # 全局 finding 索引表
```

## finding_id 命名规则

**主代理统一分配 finding_id**，避免跨角色、跨轮次的编号冲突。

### 格式

```
R[轮次]-F[序号]-[类别]
```

- **R[轮次]**：评审轮次，从 1 开始
- **F[序号]**：全局递增序号，从 001 开始，跨轮次不重置
- **[类别]**：3-4 字母的类别代码（见下表）

### 类别代码

| 代码 | 含义 | 示例 |
|------|------|------|
| `SEC` | 安全与隐私 | R1-F001-SEC |
| `FUNC` | 功能与边界 | R1-F002-FUNC |
| `REL` | 可靠性与一致性 | R1-F003-REL |
| `API` | API 与兼容性 | R1-F004-API |
| `PERF` | 性能与资源 | R1-F005-PERF |
| `UX` | UX 与可访问性 | R1-F006-UX |
| `OPS` | 测试与运维 | R1-F007-OPS |
| `PROD` | 产品与契约 | R1-F008-PROD |

### ID 分配流程

1. **评审代理**：可以使用临时 ID（如 `SEC-001`、`FUNC-001`），保存文件时使用临时 ID 作为目录名
2. **主代理裁决时**：
   - 分配标准 ID（如 `R1-F001-SEC`）
   - 将评审代理的目录从 `SEC-001/` 重命名为 `R1-F001-SEC/`
   - 在 `original-id.txt` 中记录原始 ID 以便追溯
   - 更新 `findings-index.md` 索引表

3. **去重时**：如果发现重复，使用最早分配的 ID，其他 finding 在 `adjudication.md` 中记录 `deduplicated_with: R1-F001-SEC`

### 示例：ID 分配和重命名

```bash
# 评审代理创建（使用临时 ID）
.review-evidence/round-1/SEC-001/reproduce.test.js
.review-evidence/round-1/FUNC-001/reproduce.sh

# 主代理裁决后重命名
.review-evidence/round-1/R1-F001-SEC/           # 重命名自 SEC-001
.review-evidence/round-1/R1-F001-SEC/original-id.txt  # 内容: SEC-001
.review-evidence/round-1/R1-F002-FUNC/          # 重命名自 FUNC-001
.review-evidence/round-1/R1-F002-FUNC/original-id.txt # 内容: FUNC-001
```

## 主代理裁决流程

主代理在裁决每个 finding 时，按以下顺序执行：

### 1. 反例合理性检查

**在运行 reproduction 代码前**，先检查反例的合理性：

#### 前提检查
- ✅ 前提条件明确且可验证（用户角色、数据状态、环境配置）
- ✅ 前提符合 MVP 范围内的合理场景
- ✅ 前提与其他 finding 不冲突
- ❌ "在生产环境高并发下"（MVP 可能还没上生产）
- ❌ "假设数据库已有 100 万条记录"（超出 MVP 测试数据规模）

#### 期望行为检查
- ✅ 期望行为有明确的验收标准、契约或规范支持
- ✅ 引用了具体的文档、测试或代码位置
- ✅ 期望合理，不是过度防御或超出 MVP 承诺
- ❌ "应该在 10ms 内返回"（没有性能 SLA 文档支持）
- ❌ "应该支持 OAuth2.0"（如果 MVP 只承诺基础认证）

#### 影响评估
- ✅ 声明的严重性与实际影响匹配
- ✅ 影响是可观察的后果，不是推测
- ❌ "可能导致数据库崩溃"（推测而非可观察后果）
- ❌ P0 标记在非核心功能上（严重性夸大）

#### reproduction 代码检查
- ✅ 代码语法正确（不要求运行，只检查明显错误）
- ✅ 依赖的库、模块、API 存在于项目中
- ✅ 测试断言与 expected_vs_actual 描述一致
- ❌ 调用了项目不存在的函数或模块
- ❌ 断言写反了（期望失败但实际测试会通过）

#### 合理性检查不通过的处理
- 标记为 `needs-evidence`
- 在 `adjudication.md` 中记录哪部分不合理
- 不运行 reproduction 代码（避免浪费时间）
- 要求评审代理补充依据或修正反例

### 2. 分配标准 ID

通过合理性检查后：

1. 分配标准 ID：`R[轮次]-F[全局序号]-[类别]`
2. 将目录从临时 ID 重命名为标准 ID
   ```bash
   mv .review-evidence/round-1/SEC-001 .review-evidence/round-1/R1-F001-SEC
   ```
3. 创建 `original-id.txt` 记录原始 ID
   ```bash
   echo "SEC-001" > .review-evidence/round-1/R1-F001-SEC/original-id.txt
   ```

### 3. 运行 reproduction 代码验证

1. 检查 `.review-evidence/round-[N]/R[N]-F[XXX]-[CAT]/` 目录中的 reproduction 代码
2. 实际运行该代码，确认能复现问题
3. 观察实际输出是否与 `expected_vs_actual` 描述一致
4. 如果无法复现，标记为 `rejected` 或 `needs-evidence`

### 4. 写入裁决记录

在 `adjudication.md` 中记录完整的裁决过程：

```markdown
# 裁决记录：R1-F001-SEC

## 原始信息
- 原始 ID: SEC-001
- 评审代理: security-reviewer
- 提交时间: 2026-10-14 14:30

## 合理性检查
- 前提检查: ✅ 通过 - 未认证用户访问，符合 MVP 范围
- 期望行为检查: ✅ 通过 - 引用了 API 设计文档第 3.2 节
- 影响评估: ✅ 通过 - P0 标记合理，影响核心数据安全
- reproduction 代码检查: ✅ 通过 - 语法正确，依赖存在

## 验证结果
- reproduction_path: .review-evidence/round-1/R1-F001-SEC/reproduce.test.js
- 运行命令: `node .review-evidence/round-1/R1-F001-SEC/reproduce.test.js`
- 运行结果: ❌ 测试失败，成功复现问题
- 实际输出:
  ```
  Expected: 401 Unauthorized
  Actual: 200 OK with admin user data
  ```
- counterexample_replayed: yes

## 裁决
- finding_id: R1-F001-SEC
- decision: accepted
- severity_after_review: P0
- scope_check: in-scope
- reasoning: 当前实现确实允许未认证用户获取管理员数据，违反安全契约
- next_action: TDD 修复
```

### 5. 更新索引

在 `findings-index.md` 中添加记录：

```markdown
| Finding ID | 原始 ID | 类别 | 严重性 | 状态 | 轮次 |
|------------|---------|------|--------|------|------|
| R1-F001-SEC | SEC-001 | 安全与隐私 | P0 | accepted | 1 |
| R1-F002-FUNC | FUNC-001 | 功能与边界 | P1 | accepted | 1 |
```

## 文件命名规范

### reproduction 代码文件
- **测试文件**：`reproduce.test.[ext]`（ext 根据项目语言：js/ts/py/go/java 等）
- **脚本文件**：`reproduce.sh`（Unix）或 `reproduce.ps1`（Windows）
- **HTTP 请求**：`reproduce.http`（使用 REST Client 格式）
- **SQL 查询**：`reproduce.sql`
- **手工步骤**：`manual-steps.md`

### 辅助文件
- **原始 ID**：`original-id.txt`（评审代理的临时 ID，如 SEC-001）
- **裁决记录**：`adjudication.md`（主代理的完整裁决过程）
- **文字描述**：`counterexample.md`（必须包含：preconditions、steps、expected、actual）
- **挑战结果**：`challenge-result.md`（挑战代理的验证）
- **验证结果**：`verification-result.md`（终审代理的验证）
- **运行输出**：`output.log`（实际运行的完整输出）
- **截图描述**：`expected-*.png`/`actual-*.png`（描述性文件名）

## 评审代理职责

### 1. 创建 finding 目录
评审代理为每个 finding 创建 `round-[N]/[临时_id]/` 目录。**使用简单的临时 ID**（如 `SEC-001`、`FUNC-001`），主代理裁决时会重命名为标准 ID。

临时 ID 格式建议：`[类别前缀]-[三位数字]`，例如：
- `SEC-001`, `SEC-002` - 安全相关
- `FUNC-001`, `FUNC-002` - 功能相关
- `PERF-001` - 性能相关

**注意**：临时 ID 只需要在同一个评审代理的输出中唯一即可，不需要担心跨代理冲突（主代理裁决时会统一分配标准 ID）。

### 2. 写入 reproduction 代码
根据问题类型选择合适的格式：

```javascript
// reproduce.test.js 示例（评审代理创建时使用临时 ID）
// 主代理裁决后，此文件会位于 R1-F001-SEC/ 目录
const { getUserById } = require('../src/user-service');

describe('Unauthorized access to user data', () => {
  test('should reject access without authentication', async () => {
    // Precondition: no auth token set
    process.env.AUTH_TOKEN = '';
    
    // Execute
    const result = await getUserById(null);
    
    // Expected: should throw 401 error
    // Actual: returns admin user object
    expect(result).toThrow(/401|unauthorized/i);
  });
});
```

```bash
# reproduce.sh 示例（评审代理创建时使用临时 ID）
# 主代理裁决后，此文件会位于 R1-F002-SEC/ 目录
#!/bin/bash
# SQL injection in search endpoint

# Precondition: server running on localhost:3000
# Input: malicious search query
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "test'\'' OR 1=1--"}'

# Expected: 400 bad request or sanitized query
# Actual: returns all records (SQL injection successful)
```

### 3. 写入文字描述
`counterexample.md` 必须包含：

```markdown
# [Finding ID]: [简短标题]

## Preconditions
- 用户角色：未认证用户
- 数据状态：数据库包含 100 条用户记录
- 环境：开发环境，DEBUG=false

## Steps
1. 发送 POST 请求到 `/api/search`
2. payload 包含 SQL 注入字符串：`{"query": "test' OR 1=1--"}`
3. 观察响应内容

## Expected
- 返回 400 Bad Request
- 或查询被正确转义，只返回匹配 "test" 的记录

## Actual
- 返回 200 OK
- 响应包含所有 100 条用户记录
- SQL 日志显示执行了 `SELECT * FROM users WHERE name LIKE '%test' OR 1=1--%'`

## Impact
任何未认证用户可以绕过搜索过滤，读取所有用户数据。

## Confidence
High - 已在本地环境成功复现。
```

## 主代理裁决职责

主代理在裁决时必须：

1. **检查 reproduction 代码是否存在**（使用评审代理的临时 ID）
   ```bash
   ls -la .review-evidence/round-1/SEC-001/reproduce.*
   ```

2. **进行合理性检查**（阶段 1，在运行代码前）
   - 前提检查：是否明确、可验证、符合 MVP 范围
   - 期望行为检查：是否有规范支持
   - 影响评估：严重性是否匹配
   - reproduction 代码检查：语法、依赖、断言一致性

3. **分配标准 ID 并重命名**（通过合理性检查后）
   ```bash
   # 分配标准 ID: R1-F001-SEC
   mv .review-evidence/round-1/SEC-001 .review-evidence/round-1/R1-F001-SEC
   echo "SEC-001" > .review-evidence/round-1/R1-F001-SEC/original-id.txt
   ```

4. **运行 reproduction 代码**（阶段 2，使用标准 ID）
   ```bash
   cd .review-evidence/round-1/R1-F001-SEC
   node reproduce.test.js > output.log 2>&1
   ```

5. **验证问题确实存在**
   - 检查输出是否与 counterexample.md 中的"Actual"一致
   - 确认不是测试本身的问题

6. **写入裁决记录**
   在 `adjudication.md` 中记录合理性检查、验证过程、`reproduction_path`（标准 ID 路径）和裁决结果

7. **更新全局索引**
   在 `findings-index.md` 中添加记录

## 实现代理职责

实现代理在修复时（使用主代理分配的标准 ID）：

1. **读取原始 reproduction 代码**
   ```bash
   cat .review-evidence/round-1/R1-F001-SEC/reproduce.test.js
   ```

2. **运行验证问题存在（RED）**
   ```bash
   node .review-evidence/round-1/R1-F001-SEC/reproduce.test.js
   # 应该失败
   ```

3. **改编为项目测试（如需要）**
   - 将 reproduction 代码迁移到项目测试套件
   - 调整导入路径、fixture、断言格式
   - 保留原始 reproduction 代码不变

4. **修复后验证（GREEN）**
   ```bash
   node .review-evidence/round-1/R1-F001-SEC/reproduce.test.js
   # 应该通过
   npm test  # 运行项目完整测试套件
   ```

## 终审代理职责

终审代理验证修复时（使用标准 ID）：

1. **运行原始 reproduction 代码**
   ```bash
   node .review-evidence/round-1/R1-F001-SEC/reproduce.test.js
   ```

2. **运行项目测试套件中的相关测试**
   ```bash
   npm test -- --testPathPattern=user-service
   ```

3. **构造变体**
   - 边界条件（空字符串、超长输入）
   - 类似场景（其他注入点）

4. **写入验证结果**
   `.review-evidence/round-1/R1-F001-SEC/verification-result.md`

## 目录生命周期

- **创建时机**：主代理启动第 N 轮评审前创建 `round-N/` 目录
- **清理策略**：`.review-evidence/` 目录不纳入 `.gitignore`，应该提交到版本控制以保持审计追踪
- **用户访问**：用户可以直接打开 `.review-evidence/` 查看所有反例代码和验证过程

## 示例工作流

```bash
# 主代理：创建第 1 轮目录
mkdir -p .review-evidence/round-1

# 评审代理：创建 finding 并写入 reproduction（使用临时 ID）
mkdir -p .review-evidence/round-1/SEC-001
cat > .review-evidence/round-1/SEC-001/reproduce.test.js << 'EOF'
[测试代码]
EOF
cat > .review-evidence/round-1/SEC-001/counterexample.md << 'EOF'
[文字描述]
EOF

# 主代理：合理性检查（阶段 1）
# 检查前提、期望、影响、代码合理性
# 通过检查后...

# 主代理：分配标准 ID 并重命名（阶段 2）
mv .review-evidence/round-1/SEC-001 .review-evidence/round-1/R1-F001-SEC
echo "SEC-001" > .review-evidence/round-1/R1-F001-SEC/original-id.txt

# 主代理：验证
cd .review-evidence/round-1/R1-F001-SEC
node reproduce.test.js
# 确认失败，写入 adjudication.md，更新 findings-index.md，标记为 accepted

# 实现代理：修复（使用标准 ID）
node .review-evidence/round-1/R1-F001-SEC/reproduce.test.js  # RED
# 修改源代码
node .review-evidence/round-1/R1-F001-SEC/reproduce.test.js  # GREEN
git add [修改的文件]
git commit -m "fix(security): R1-F001-SEC prevent SQL injection"

# 终审代理：验证（使用标准 ID）
node .review-evidence/round-1/R1-F001-SEC/reproduce.test.js  # 应该通过
# 测试变体
cat > .review-evidence/round-1/R1-F001-SEC/verification-result.md << 'EOF'
Status: PASS
- Original reproduction: PASS
- Variant 1 (empty string): PASS
- Variant 2 (special chars): PASS
- Regression suite: PASS
EOF
```

## 常见问题

### Q: reproduction 代码可以依赖项目的测试工具吗？
A: 可以，但要在 `counterexample.md` 中说明依赖。例如："需要先运行 `npm install` 安装 jest"。

### Q: 如果问题无法自动化，怎么办？
A: 写 `manual-steps.md`，包含精确的操作序列、预期行为描述和实际行为描述（可以包含截图的文字描述）。

### Q: reproduction 代码需要外部服务（数据库、API）？
A: 优先使用 mock 或 fixture。如果必须依赖外部服务，在 `counterexample.md` 中说明前置条件和 setup 步骤。

### Q: 同一个 finding 多次修复失败，如何管理？
A: 保持原始 `round-N/[finding_id]/` 不变，后续轮次的修复记录写入 `verification-result.md` 的追加段落，或创建 `attempt-2.md` 等。
