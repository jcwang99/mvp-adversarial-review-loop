# 证据目录结构与管理

## 目录结构

所有 reproduction 代码和相关证据保存在项目根目录的 `.review-evidence/` 目录：

```
.review-evidence/
├── README.md                          # 本次评审的元信息和索引
├── round-1/
│   ├── SEC-001/
│   │   ├── reproduce.test.js          # 评审代理提供的原始反例代码
│   │   ├── counterexample.md          # 文字描述：前提、步骤、期望/实际
│   │   ├── challenge-result.md        # 挑战代理的验证结果（如有）
│   │   └── verification-result.md     # 终审代理的验证结果
│   ├── FUNC-002/
│   │   ├── reproduce.sh               # 脚本形式的反例
│   │   ├── counterexample.md          # 文字描述
│   │   └── output.log                 # 实际运行输出
│   └── UX-003/
│       ├── manual-steps.md            # 手工复现步骤
│       ├── expected-screenshot.png    # 期望行为截图（描述）
│       └── actual-screenshot.png      # 实际行为截图（描述）
├── round-2/
│   └── ...
└── baseline.md                        # 评审基线：范围、技术栈、测试命令
```

## 文件命名规范

### reproduction 代码文件
- **测试文件**：`reproduce.test.[ext]`（ext 根据项目语言：js/ts/py/go/java 等）
- **脚本文件**：`reproduce.sh`（Unix）或 `reproduce.ps1`（Windows）
- **HTTP 请求**：`reproduce.http`（使用 REST Client 格式）
- **SQL 查询**：`reproduce.sql`
- **手工步骤**：`manual-steps.md`

### 辅助文件
- **文字描述**：`counterexample.md`（必须包含：preconditions、steps、expected、actual）
- **挑战结果**：`challenge-result.md`（挑战代理的验证）
- **验证结果**：`verification-result.md`（终审代理的验证）
- **运行输出**：`output.log`（实际运行的完整输出）
- **截图描述**：`expected-*.png`/`actual-*.png`（描述性文件名）

## 评审代理职责

### 1. 创建 finding 目录
评审代理为每个 finding 创建 `round-[N]/[finding_id]/` 目录。

### 2. 写入 reproduction 代码
根据问题类型选择合适的格式：

```javascript
// reproduce.test.js 示例
const { getUserById } = require('../src/user-service');

describe('SEC-001: Unauthorized access', () => {
  test('should reject null userId without authentication', async () => {
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
# reproduce.sh 示例
#!/bin/bash
# SEC-002: SQL injection in search endpoint

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

1. **检查 reproduction 代码是否存在**
   ```bash
   ls -la .review-evidence/round-1/[finding_id]/reproduce.*
   ```

2. **运行 reproduction 代码**
   ```bash
   cd .review-evidence/round-1/SEC-001
   node reproduce.test.js > output.log 2>&1
   ```

3. **验证问题确实存在**
   - 检查输出是否与 counterexample.md 中的"Actual"一致
   - 确认不是测试本身的问题

4. **记录验证结果**
   在裁决记录中填写 `reproduction_path` 和 `counterexample_replayed`

## 实现代理职责

实现代理在修复时：

1. **读取原始 reproduction 代码**
   ```bash
   cat .review-evidence/round-1/[finding_id]/reproduce.test.js
   ```

2. **运行验证问题存在（RED）**
   ```bash
   node .review-evidence/round-1/[finding_id]/reproduce.test.js
   # 应该失败
   ```

3. **改编为项目测试（如需要）**
   - 将 reproduction 代码迁移到项目测试套件
   - 调整导入路径、fixture、断言格式
   - 保留原始 reproduction 代码不变

4. **修复后验证（GREEN）**
   ```bash
   node .review-evidence/round-1/[finding_id]/reproduce.test.js
   # 应该通过
   npm test  # 运行项目完整测试套件
   ```

## 终审代理职责

终审代理验证修复时：

1. **运行原始 reproduction 代码**
   ```bash
   node .review-evidence/round-1/[finding_id]/reproduce.test.js
   ```

2. **运行项目测试套件中的相关测试**
   ```bash
   npm test -- --testPathPattern=user-service
   ```

3. **构造变体**
   - 边界条件（空字符串、超长输入）
   - 类似场景（其他注入点）

4. **写入验证结果**
   `.review-evidence/round-1/[finding_id]/verification-result.md`

## 目录生命周期

- **创建时机**：主代理启动第 N 轮评审前创建 `round-N/` 目录
- **清理策略**：`.review-evidence/` 目录不纳入 `.gitignore`，应该提交到版本控制以保持审计追踪
- **用户访问**：用户可以直接打开 `.review-evidence/` 查看所有反例代码和验证过程

## 示例工作流

```bash
# 主代理：创建第 1 轮目录
mkdir -p .review-evidence/round-1

# 评审代理：创建 finding 并写入 reproduction
mkdir -p .review-evidence/round-1/SEC-001
cat > .review-evidence/round-1/SEC-001/reproduce.test.js << 'EOF'
[测试代码]
EOF
cat > .review-evidence/round-1/SEC-001/counterexample.md << 'EOF'
[文字描述]
EOF

# 主代理：验证
cd .review-evidence/round-1/SEC-001
node reproduce.test.js
# 确认失败，标记为 accepted

# 实现代理：修复
node .review-evidence/round-1/SEC-001/reproduce.test.js  # RED
# 修改源代码
node .review-evidence/round-1/SEC-001/reproduce.test.js  # GREEN
git commit -m "fix(security): SEC-001 prevent SQL injection"

# 终审代理：验证
node .review-evidence/round-1/SEC-001/reproduce.test.js  # 应该通过
# 测试变体
cat > .review-evidence/round-1/SEC-001/verification-result.md << 'EOF'
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
