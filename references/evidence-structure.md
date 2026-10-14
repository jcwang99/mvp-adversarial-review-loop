# 证据目录结构与管理

## 目录结构

所有 reproduction 代码和相关证据保存在项目根目录的 `.review-evidence/` 目录。仅当确认无法自动化时，才用 `manual-steps.md` 作为手工复现证据：

```
.review-evidence/
├── README.md                          # 本次评审的元信息和索引
├── baseline.md                        # 评审基线：范围、技术栈、测试命令（详细格式见下文）
├── round-1/
│   ├── R1-F001-SEC/                   # 主代理分配的标准 ID
│   │   ├── original-id.txt            # 评审代理的原始 ID（如 SEC-001）
│   │   ├── reproduce_test.py          # 评审代理提供的原始反例代码（根据项目语言命名）
│   │   ├── counterexample.md          # 文字描述：前提、步骤、期望/实际
│   │   ├── adjudication.md            # 主代理的裁决记录（合理性检查 + 验证结果）
│   │   ├── challenge-result.md        # 挑战代理的对抗式验证结果（如有）
│   │   ├── reinforce-result.md        # 补强代理的修正结果（如有）
│   │   └── verification-result.md     # 验证代理的验证结果
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

## baseline.md 格式

评审基线文件记录项目初始状态和评审环境，用于后续轮次对比和审计追踪。

```markdown
# 评审基线

## MVP 范围
- 核心功能：[列出 MVP 承诺的核心功能]
- 设计负载：[如有明确定义，如"单用户"、"<1000 QPS"等]
- 明确不包含：[MVP 范围外的功能或场景]

## 技术栈
- 语言和运行时：[如 Python 3.11, Node.js 20, Go 1.21]
- 主要框架：[如 FastAPI, Express, Gin]
- 数据库：[如 PostgreSQL 15, MongoDB 6]
- 关键依赖：[列出核心依赖及版本]

## 架构概览
- 入口点：[如 main.py, server.js, cmd/api/main.go]
- 关键数据流：[简要描述核心业务流程]
- 外部依赖：[第三方 API、消息队列、缓存等]
- 认证边界：[如有，描述认证和授权机制]
- 部署方式：[如 Docker, 云函数, 单机部署]

## Git 状态
- 仓库路径：[绝对路径]
- 当前分支：[如 main, develop]
- HEAD commit：[完整哈希]
- 工作区状态：[git status --short 输出]
- 未提交改动：[如有，列出文件和简要说明]

## 测试与验证命令
- 单元测试：[如 npm test, pytest, go test ./...]
- 集成测试：[如有]
- E2E 测试：[如有]
- 构建命令：[如 npm run build, go build]
- 类型检查：[如 npm run type-check, mypy .]
- Lint：[如 eslint ., ruff check .]
- 格式检查：[如 prettier --check ., black --check .]
- 安全扫描：[如 npm audit, safety check]

## 基线测试结果
[首次运行所有测试命令的完整输出摘要，包括通过/失败/跳过数量]

```bash
$ npm test
# 输出摘要：Tests: 42 passed, 2 skipped, 0 failed

$ npm run build
# 输出摘要：Build successful, bundle size: 245KB
```

## 评审开始时间
[ISO 8601 格式，如 2026-10-14T15:30:00+08:00]
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
.review-evidence/round-1/SEC-001/reproduce_test.py     # 或 .go / .java / .sh 等
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

**在重放反例前**，先检查反例的合理性：

#### 前提检查
- ✅ 前提条件明确且可验证（用户角色、数据状态、环境配置）
- ✅ 前提与其他 finding 不冲突
- ❌ "在生产环境高并发下"（MVP 可能还没上生产）
- ❌ "假设数据库已有 100 万条记录"（超出 MVP 测试数据规模）

#### 范围检查
- ✅ 意见针对 MVP 明确包含的功能
- ✅ 不是要求添加 MVP 不包含的功能
- ❌ "应该支持多语言切换"（如果 MVP 明确只做中文）
- ❌ "应该有实时通知"（如果 MVP 不包含通知功能）

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

#### 反例证据检查
- ✅ 代码语法正确（不要求运行，只检查明显错误）
- ✅ 依赖的库、模块、API 存在于项目中
- ✅ 测试断言与 expected_vs_actual 描述一致
- ❌ 调用了项目不存在的函数或模块
- ❌ 断言写反了（期望失败但实际测试会通过）
- 手工步骤仅用于确认无法自动化的情况，且必须有明确观察点

#### 合理性检查不通过的处理

评审代理提交意见后即终止，无法回来修正。主代理根据问题性质决策：

**1. 可补强的瑕疵**（反例思路合理但执行有小问题）：
- 标记为 `needs-evidence`
- 在 `adjudication.md` 中记录需要补强的部分
- 派**补强代理**修正 reproduction 代码或补充前提条件
- 补强代理成功后重新验证；失败则转为 `rejected`

**2. 需要重新构造反例**（根本性错误）：
- 标记为 `needs-evidence`，暂时搁置
- 可在下一轮重新评审时覆盖该问题

**3. 完全不合理的意见**（以下情况直接 rejected）：
- 基于错误假设或误解
- 要求 MVP 明确不包含的功能
- 期望行为不合理或无规范支持
- 直接标记为 `rejected`
- 在 `adjudication.md` 中记录拒绝原因
- 无需派补强代理，避免浪费资源

不运行不合理或无法修正的反例（避免浪费时间）。

**示例：可补强 vs 需重构 vs 完全不合理**
- ✅ 可补强：reproduction 代码调用了 `getUser()` 但实际是 `getUserById()` → needs-evidence，派补强代理修正
- ⚠️ 需重构：reproduction 代码思路错误，需要从 API 层面而不是数据库层面测试 → needs-evidence，搁置到下一轮
- ❌ 完全不合理：声称"生产环境崩溃"但 MVP 未部署 → rejected
- ✅ 可补强：前提条件缺少管理员 token → needs-evidence，派补强代理补充
- ❌ 完全不合理：期望"10ms 返回"但无 SLA 文档 → rejected

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

### 3. 重放反例验证

1. 检查 `.review-evidence/round-[N]/R[N]-F[XXX]-[CAT]/` 目录中的 reproduction 或 `manual-steps.md`
2. 运行 reproduction；若已说明无法自动化，由主代理实际执行手工步骤并记录操作和结果
3. 确认观察结果与 `expected_vs_actual` 描述一致
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
- 范围检查: ✅ 通过 - 针对 MVP 包含的认证功能
- 期望行为检查: ✅ 通过 - 引用了 API 设计文档第 3.2 节
- 影响评估: ✅ 通过 - P0 标记合理，影响核心数据安全
- reproduction 代码检查: ✅ 通过 - 语法正确，依赖存在

## 验证结果
- reproduction_path: .review-evidence/round-1/R1-F001-SEC/reproduce.test.js
- 运行命令: 根据项目语言选择（如 `node reproduce.test.js`、`pytest reproduce_test.py`、`go test reproduce_test.go` 等）
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

命名遵循项目所用语言的测试文件约定：

- **JavaScript/TypeScript**：`reproduce.test.js` 或 `reproduce.test.ts`（点号分隔，符合 Jest/Vitest 约定）
- **Python**：`reproduce_test.py`（下划线，符合 pytest 约定）
- **Go**：`reproduce_test.go`（下划线，符合 Go 测试约定）
- **Java**：`ReproduceTest.java`（驼峰命名，符合 JUnit 约定）
- **Shell 脚本**：`reproduce.sh`（Unix）或 `reproduce.ps1`（Windows）
- **HTTP 请求**：`reproduce.http`（使用 REST Client 格式）
- **SQL 查询**：`reproduce.sql`
- **手工步骤**：`manual-steps.md`（仅当确认无法自动化时使用；包含原因、前提、精确操作和观察点）

### 辅助文件
- **原始 ID**：`original-id.txt`（评审代理的临时 ID，如 SEC-001）
- **裁决记录**：`adjudication.md`（主代理的完整裁决过程）
- **文字描述**：`counterexample.md`（必须包含：preconditions、steps、expected、actual）
- **挑战结果**：`challenge-result.md`（挑战代理的对抗式验证结果）
- **补强结果**：`reinforce-result.md`（补强代理的修正结果）
- **验证结果**：`verification-result.md`（验证代理的验证）
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

### 2. 保存反例证据
优先根据问题类型和项目语言写入完整可运行的 reproduction 代码。只有确认无法自动化时，才使用 `manual-steps.md`，并说明原因、前提、精确操作和观察点。评审代理不得修改项目源代码、测试或配置，但可以在 `.review-evidence/` 中保存这些证据。

**JavaScript/TypeScript 示例：**
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

**Python 示例：**
```python
# reproduce_test.py 示例
import pytest
from app.services.user_service import get_user_by_id

def test_unauthorized_access():
    """Should reject access without authentication"""
    # Precondition: no auth token set
    token = None

    # Execute & Expected: should raise 401 error
    # Actual: returns admin user object
    with pytest.raises(Exception, match=r"401|unauthorized"):
        get_user_by_id(user_id=1, auth_token=token)
```

**Go 示例：**
```go
// reproduce_test.go 示例
package userservice_test

import (
    "testing"
    "yourapp/userservice"
)

func TestUnauthorizedAccess(t *testing.T) {
    // Precondition: no auth token
    token := ""

    // Execute
    _, err := userservice.GetUserByID(1, token)

    // Expected: should return 401 error
    // Actual: returns admin user object
    if err == nil {
        t.Error("Expected 401 error, got nil")
    }
}
```

**Java 示例：**
```java
// ReproduceTest.java 示例
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ReproduceTest {
    @Test
    void testUnauthorizedAccess() {
        // Precondition: no auth token
        String token = null;

        // Expected: should throw 401 exception
        // Actual: returns admin user object
        assertThrows(UnauthorizedException.class, () -> {
            userService.getUserById(1, token);
        });
    }
}
```

**Shell 脚本示例（适用于 API 测试）：**
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

**SQL 示例（数据库问题）：**
```sql
-- reproduce.sql 示例
-- Precondition: users table contains 100 records
-- Expected: query returns only matching records
-- Actual: query returns all records due to injection

SELECT * FROM users WHERE name LIKE '%test' OR 1=1--%';
```

**HTTP 请求示例（REST Client 格式）：**
```http
### reproduce.http 示例
### SQL injection in search endpoint

POST http://localhost:3000/api/search
Content-Type: application/json

{
  "query": "test' OR 1=1--"
}

# Expected: 400 Bad Request
# Actual: 200 OK with all records
```

**自动化反例的关键原则**：
- 使用项目实际使用的语言和测试框架
- 代码必须完整可运行（包含必要的导入、设置、断言）
- 在注释中明确标注：Precondition、Expected、Actual
- 不要只引用现有测试，必须写出完整的独立 reproduction 代码

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

1. **检查反例证据是否存在**（使用评审代理的临时 ID）
   ```bash
   ls -la .review-evidence/round-1/SEC-001
   # 若为手工复现，检查 manual-steps.md 和无法自动化的说明
   ```

2. **进行合理性检查**（阶段 1，在重放反例前）
   - 前提检查：是否明确、可验证、不冲突
   - 范围检查：是否针对 MVP 包含的功能，不要求添加 MVP 不包含的功能
   - 期望行为检查：是否有规范支持
   - 影响评估：严重性是否匹配
   - 证据检查：有代码时检查语法、依赖、断言；手工复现则检查原因、操作和观察点

3. **分配标准 ID 并重命名**（通过合理性检查后）
   ```bash
   # 分配标准 ID: R1-F001-SEC
   mv .review-evidence/round-1/SEC-001 .review-evidence/round-1/R1-F001-SEC
   echo "SEC-001" > .review-evidence/round-1/R1-F001-SEC/original-id.txt
   ```

4. **重放反例**（阶段 2，使用标准 ID）
   根据项目语言和文件类型运行；若标记为无法自动化，则执行 `manual-steps.md` 并将操作、观察结果和附件路径写入 `output.log` 或 `adjudication.md`：
   ```bash
   cd .review-evidence/round-1/R1-F001-SEC

   # JavaScript/TypeScript
   node reproduce.test.js > output.log 2>&1
   # 或
   npm test -- reproduce.test.js > output.log 2>&1

   # Python
   python reproduce_test.py > output.log 2>&1
   # 或
   pytest reproduce_test.py > output.log 2>&1

   # Go
   go test reproduce_test.go > output.log 2>&1

   # Java
   javac ReproduceTest.java && java ReproduceTest > output.log 2>&1
   # 或
   mvn test -Dtest=ReproduceTest > output.log 2>&1

   # Shell script
   bash reproduce.sh > output.log 2>&1

   # SQL
   psql -f reproduce.sql > output.log 2>&1
   # 或
   mysql < reproduce.sql > output.log 2>&1
   ```

5. **验证问题确实存在**
   - 自动化反例：检查输出是否与 counterexample.md 中的"Actual"一致，并确认不是测试本身的问题
   - 手工反例：主代理执行步骤，记录操作者、环境、结果和证据路径

6. **写入裁决记录**
   在 `adjudication.md` 中记录合理性检查、验证过程、`reproduction_path`（reproduction 或 `manual-steps.md` 的标准 ID 路径）和裁决结果

7. **更新全局索引**
   在 `findings-index.md` 中添加记录

## 实现代理职责

实现代理在修复时（使用主代理分配的标准 ID）：

1. **读取原始反例证据**
   ```bash
   cat .review-evidence/round-1/R1-F001-SEC/reproduce.test.js
   # 或根据项目语言：reproduce_test.py, reproduce_test.go 等
   ```

2. **运行验证问题存在（RED）**
   根据项目语言选择运行命令：
   ```bash
   # JavaScript/TypeScript
   node .review-evidence/round-1/R1-F001-SEC/reproduce.test.js
   # 或
   npm test -- .review-evidence/round-1/R1-F001-SEC/reproduce.test.js

   # Python
   pytest .review-evidence/round-1/R1-F001-SEC/reproduce_test.py

   # Go
   go test .review-evidence/round-1/R1-F001-SEC/reproduce_test.go

   # Java
   mvn test -Dtest=ReproduceTest

   # Shell
   bash .review-evidence/round-1/R1-F001-SEC/reproduce.sh

   # 应该失败，确认问题存在
   ```

3. **添加回归保护**
   根据项目使用的测试框架改编：
   ```bash
   # 示例：Python 项目使用 pytest
   # 从 .review-evidence/round-1/R1-F001-SEC/reproduce_test.py
   # 迁移到 tests/security/test_sql_injection.py

   # 调整：
   # - 导入路径（相对路径 → 项目模块路径）
   # - fixture 设置（使用项目的 conftest.py）
   # - 断言格式（保持项目风格一致）

   # 保留原始 reproduction 代码作为审计证据
   ```
   自动化 reproduction 必须迁移到项目测试套件。对于确认无法自动化的 finding，尽量增加相邻可测行为的自动化回归测试；若确实不可行，记录原因，并在修复前后执行手工步骤、保存结果供独立验证。

4. **修复后验证（GREEN）**
   同时验证原始反例和项目测试；手工 finding 重复执行 `manual-steps.md` 并记录结果：
   ```bash
   # 运行原始 reproduction 代码
   pytest .review-evidence/round-1/R1-F001-SEC/reproduce_test.py
   # 应该通过

   # 运行项目测试套件中的新测试
   pytest tests/security/test_sql_injection.py
   # 应该通过

   # 运行项目完整测试套件
   pytest  # Python
   # 或
   npm test  # JavaScript
   # 或
   go test ./...  # Go
   # 或
   mvn test  # Java
   ```

## 验证代理职责

验证代理验证修复时（使用标准 ID）：

1. **复核原始反例**
   根据项目语言选择运行命令；若 finding 是手工复现，独立执行 `manual-steps.md` 并记录结果：
   ```bash
   # JavaScript/TypeScript
   node .review-evidence/round-1/R1-F001-SEC/reproduce.test.js

   # Python
   pytest .review-evidence/round-1/R1-F001-SEC/reproduce_test.py

   # Go
   go test .review-evidence/round-1/R1-F001-SEC/reproduce_test.go

   # Java
   mvn test -Dtest=ReproduceTest

   # Shell
   bash .review-evidence/round-1/R1-F001-SEC/reproduce.sh
   ```

2. **运行项目测试套件中的相关测试**
   根据项目测试框架：
   ```bash
   # JavaScript/TypeScript
   npm test -- --testPathPattern=user-service

   # Python
   pytest tests/security/test_sql_injection.py

   # Go
   go test ./internal/user/...

   # Java
   mvn test -Dtest=UserServiceTest
   ```

3. **构造变体**
   - 边界条件（空字符串、超长输入）
   - 类似场景（其他注入点）

4. **写入验证结果**
   `.review-evidence/round-1/R1-F001-SEC/verification-result.md`

## 目录生命周期

- **创建时机**：主代理启动第 N 轮评审前创建 `round-N/` 目录
- **提交策略**：
  - `.review-evidence/` 目录不纳入 `.gitignore`
  - 应该在每轮评审完成后（或评审开始时）单独提交作为审计追踪
  - 修复 commit 只包含源代码和项目测试，不包含 `.review-evidence/` 目录
  - 建议在评审流程的关键节点提交证据目录：
    ```bash
    # 第 1 轮评审完成后
    git add .review-evidence/round-1/
    git commit -m "docs(review): round 1 evidence and adjudication records"

    # 第 1 轮修复完成后
    git add [源代码和项目测试]
    git commit -m "fix(security): R1-F001-SEC prevent SQL injection"
    ```
- **用户访问**：用户可以直接打开 `.review-evidence/` 查看所有反例代码和验证过程

## 示例工作流

以下示例展示完整流程，根据项目语言选择对应命令：

```bash
# 主代理：创建第 1 轮目录
mkdir -p .review-evidence/round-1

# 评审代理：创建 finding 并写入 reproduction（使用临时 ID）
# 根据项目语言选择合适的文件扩展名
mkdir -p .review-evidence/round-1/SEC-001

# JavaScript 项目示例
cat > .review-evidence/round-1/SEC-001/reproduce.test.js << 'EOF'
[测试代码]
EOF

# Python 项目示例
# cat > .review-evidence/round-1/SEC-001/reproduce_test.py << 'EOF'

# Go 项目示例
# cat > .review-evidence/round-1/SEC-001/reproduce_test.go << 'EOF'

cat > .review-evidence/round-1/SEC-001/counterexample.md << 'EOF'
[文字描述]
EOF

# 主代理：合理性检查（阶段 1）
# 检查前提、期望、影响、代码合理性
# 通过检查后...

# 主代理：分配标准 ID 并重命名（阶段 2）
mv .review-evidence/round-1/SEC-001 .review-evidence/round-1/R1-F001-SEC
echo "SEC-001" > .review-evidence/round-1/R1-F001-SEC/original-id.txt

# 主代理：验证（根据项目语言选择运行命令）
cd .review-evidence/round-1/R1-F001-SEC

# JavaScript
node reproduce.test.js
# Python
# pytest reproduce_test.py
# Go
# go test reproduce_test.go

# 确认失败，写入 adjudication.md，更新 findings-index.md，标记为 accepted

# 实现代理：修复（使用标准 ID）
# RED: 运行原始 reproduction 代码
# JavaScript
node .review-evidence/round-1/R1-F001-SEC/reproduce.test.js  # RED - 应该失败
# Python
# pytest .review-evidence/round-1/R1-F001-SEC/reproduce_test.py  # RED
# Go
# go test .review-evidence/round-1/R1-F001-SEC/reproduce_test.go  # RED

# 将 reproduction 代码迁移到项目测试套件
# JavaScript 项目使用 Jest 示例
cat > tests/security/sql-injection.test.js << 'EOF'
// R1-F001-SEC: Prevent SQL injection in user query
const request = require('supertest');
const app = require('../../src/app');

test('should reject SQL injection in username field', async () => {
  const response = await request(app)
    .get('/api/users')
    .query({ username: "admin' OR '1'='1" });

  expect(response.status).toBe(400);
  expect(response.body.error).toMatch(/invalid input/i);
});
EOF

# Python 项目使用 pytest 示例
# cat > tests/security/test_sql_injection.py << 'EOF'
# # R1-F001-SEC: Prevent SQL injection in user query
# import pytest
# from app.api import search_users
#
# def test_should_reject_sql_injection():
#     """Should reject SQL injection in username field"""
#     with pytest.raises(ValueError, match=r"invalid input"):
#         search_users(username="admin' OR '1'='1")
# EOF

# 运行项目测试（应该失败）
# JavaScript
npm test -- tests/security/sql-injection.test.js  # RED
# Python
# pytest tests/security/test_sql_injection.py  # RED
# Go
# go test ./tests/security/...  # RED

# 修改源代码（修复 SQL 注入）
# [实际修复代码...]

# 验证修复（GREEN）
# 运行原始 reproduction 代码
# JavaScript
node .review-evidence/round-1/R1-F001-SEC/reproduce.test.js  # GREEN - 应该通过
# Python
# pytest .review-evidence/round-1/R1-F001-SEC/reproduce_test.py  # GREEN
# Go
# go test .review-evidence/round-1/R1-F001-SEC/reproduce_test.go  # GREEN

# 运行项目测试
# JavaScript
npm test -- tests/security/sql-injection.test.js  # GREEN
npm test  # 运行完整测试套件
# Python
# pytest tests/security/test_sql_injection.py  # GREEN
# pytest  # 运行完整测试套件
# Go
# go test ./tests/security/...  # GREEN
# go test ./...  # 运行完整测试套件

# 提交修复（只包含源代码和项目测试）
# JavaScript 示例
git add src/database/user-query.js tests/security/sql-injection.test.js
# Python 示例
# git add app/database/user_query.py tests/security/test_sql_injection.py
# Go 示例
# git add internal/database/user_query.go tests/security/user_query_test.go

git commit -m "fix(security): R1-F001-SEC 防止 SQL 注入

添加参数化查询以防止用户搜索中的 SQL 注入。
添加测试用例以验证注入尝试被拒绝。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"

# 验证代理：验证（使用标准 ID）
# 运行原始 reproduction 代码
# JavaScript
node .review-evidence/round-1/R1-F001-SEC/reproduce.test.js  # 应该通过
npm test -- tests/security/sql-injection.test.js  # 应该通过
# Python
# pytest .review-evidence/round-1/R1-F001-SEC/reproduce_test.py  # 应该通过
# pytest tests/security/test_sql_injection.py  # 应该通过
# Go
# go test .review-evidence/round-1/R1-F001-SEC/reproduce_test.go  # 应该通过
# go test ./tests/security/...  # 应该通过

# 测试变体
cat > .review-evidence/round-1/R1-F001-SEC/verification-result.md << 'EOF'
Status: PASS
- Original reproduction: PASS
- Project test suite: PASS
- Variant 1 (empty string): PASS
- Variant 2 (special chars): PASS
- Regression suite: PASS
EOF
```

## 常见问题

### Q: reproduction 代码可以依赖项目的测试工具吗？
A: 可以，但要在 `counterexample.md` 中说明依赖。例如："需要先运行 `npm install` 安装 jest"。

### Q: 如果问题无法自动化，怎么办？
A: 只有确认无法自动化时才写 `manual-steps.md`，包含无法自动化的原因、环境和账号前提、精确操作序列、观察点及预期/实际行为。主代理须亲自执行并留记录；修复后由独立验证代理重复执行。尽量补充相邻可自动化行为的回归测试。

### Q: reproduction 代码需要外部服务（数据库、API）？
A: 优先使用 mock 或 fixture。如果必须依赖外部服务，在 `counterexample.md` 中说明前置条件和 setup 步骤。

## 手工复现指南

如果需要手工复现某个 finding：

```bash
# 1. 进入 finding 目录（使用标准 ID）
cd .review-evidence/round-1/R1-F001-SEC/

# 2. 查看评审代理的原始 ID
cat original-id.txt  # 显示：SEC-001

# 3. 运行 reproduction 代码（根据项目语言调整命令）
node reproduce.test.js          # JavaScript/TypeScript
npm test reproduce.test.js      # JavaScript with test runner
pytest reproduce_test.py        # Python
go test reproduce_test.go       # Go
mvn test -Dtest=ReproduceTest  # Java
./reproduce.sh                  # Shell scripts
cat manual-steps.md             # 手工复现步骤
```

## Git 策略

`.review-evidence/` 目录**应该提交到版本控制**以保持审计追踪。`.gitignore` 文件不应排除此目录。

## 清理策略

仅在以下情况下删除此目录：
- 整个评审循环被取消，需要重新开始
- 项目被放弃

即使修复完成后，此目录仍作为历史证据，记录评审内容和验证方式。

## 挑战结果文件格式 (challenge-result.md)

挑战代理完成对抗式验证后，必须在 finding 目录中创建 `challenge-result.md`，记录完整的挑战过程和结论。

### 格式模板

```markdown
# 挑战结果

**Finding ID**: R1-F001-SEC
**挑战代理**: [代理名称/ID]
**挑战时间**: [时间戳]

## 结果

[supports / disputes / inconclusive]

## 验证过程

### 1. 重放原始反例

- **路径**: .review-evidence/round-1/R1-F001-SEC/reproduce.test.js 或 `manual-steps.md`
- **命令**: `npm test -- reproduce.test.js`
- **结果**: [成功复现 / 无法复现]
- **手工复现**: [如适用，记录操作人、环境、步骤结果和截图/录屏路径]
- **输出摘要**:
  ```
  [关键输出片段]
  ```

### 2. 尝试推翻的方向

#### 检查规范文档
- [查看的文档路径或 URL]
- [相关引用]

#### 尝试不同输入
- [测试的输入变体]
- [每个变体的结果]

#### 查找正常行为证据
- [检查的代码片段]
- [相关测试用例]

## 挑战证据

[支持 disputes 或 inconclusive 的具体证据]

### 代码片段
```[language]
[相关代码]
```

### 规范引用
[引用的规范文本或文档链接]

### 测试输出
```
[实际运行的命令和输出]
```

### 更小的正常样例（如适用）
[证明类似情况下行为正常的例子]

## 结论

[简短结论，解释为何 supports/disputes/inconclusive]

---

## 主代理处理决策

**最终裁决**: [accepted / rejected / needs-evidence / 降级]

**推理**:
[主代理基于挑战结果的裁决理由]

**如果降级，记录调整**:
- 原严重性: P0
- 调整后严重性: P1
- 调整后描述: [修正的问题描述]
```

### 主代理处理挑战结果的规则

根据挑战代理返回的结果，主代理必须：

1. **`supports`**（挑战失败，支持原意见）
   - 转为 `accepted`
   - 在 `challenge-result.md` 中记录"最终裁决: accepted"

2. **`disputes`**（推翻成功）
   - 重新审查原意见和挑战证据
   - 如果挑战证据充分（如证明反例前提不成立、行为符合规范、或提供了更小的正常样例）：
     - 转为 `rejected`
     - 在 `challenge-result.md` 中记录"最终裁决: rejected"和理由
   - 如果挑战证据部分成立（如影响范围比原意见小、严重性被高估）：
     - 降级处理（如 P1 降为 P2）或修正描述后转 `accepted`
     - 在 `challenge-result.md` 中记录"最终裁决: 降级"和调整细节
   - 如果挑战证据不足以推翻但引入新疑点：
     - 标记为 `needs-evidence`
     - 在 `adjudication.md` 中记录争议点

3. **`inconclusive`**（挑战代理无法确定）
   - 主代理基于现有证据做最终裁决
   - 通常接受原意见（因为已通过阶段 2 验证）
   - 在 `challenge-result.md` 中记录"最终裁决: accepted（基于原验证）"

### Q: 同一个 finding 多次修复失败，如何管理？
A: 保持原始 `round-N/[finding_id]/` 不变，后续轮次的修复记录写入 `verification-result.md` 的追加段落，或创建 `attempt-2.md` 等。
