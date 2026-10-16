# 证据归档流程

本文件定义评审循环完成后的证据归档流程，用于长期项目的证据管理和存储优化。

## 归档时机

**仅在以下情况才执行归档**：
- 评审循环已达到 CONVERGED 或 INCOMPLETE 状态
- 最终报告已生成
- 用户明确请求归档（可选）

**不要在评审循环进行中执行归档**，即使某轮已完成。

## 归档范围

### 保留原样（不压缩）

以下文件必须保持可读，不压缩：

```
.review-evidence/
├── baseline.md                    # 基线信息
├── run-state.md                   # 最终状态
├── findings-index.md              # findings 索引
├── screening-log.md               # 筛查日志
└── ARCHIVE-README.md              # 归档说明（归档时生成）
```

### 可选压缩

以下内容可选择性压缩（默认保留原样，用户可要求压缩）：

**轮次证据**（每轮独立压缩）：
```
.review-evidence/round-[N]/
├── inbox/                         # 原始候选证据
├── R[N]-F[XXX]-[CAT]/            # 标准 finding 证据
├── final-audit/                   # 最终审计证据
└── output.log（各目录下）         # 完整命令输出
```

压缩后结构：
```
.review-evidence/
├── baseline.md
├── run-state.md
├── findings-index.md
├── screening-log.md
├── ARCHIVE-README.md
├── archives/
│   ├── round-1.tar.gz            # 第 1 轮完整证据
│   ├── round-2.tar.gz
│   └── final-audit.tar.gz        # 最终审计证据
└── round-1/                       # 保留目录结构（空）
    └── .archived                  # 标记文件，指向压缩包
```

### 必须删除

以下临时内容在归档前必须删除：

```
tests/review/                      # 整个临时测试目录
├── candidates/
├── reproductions/
└── verifications/

.review-evidence/round-[N]/_testdata/   # 所有测试数据（已在收敛前清理）
```

## 归档流程

### 1. 验证前置条件

```bash
# 检查评审状态
grep "overall_status:" .review-evidence/run-state.md
# 必须是 converged 或 incomplete

# 检查最终报告是否存在
ls .review-evidence/final-report.md
```

### 2. 清理临时文件

```bash
# 删除临时测试目录
rm -rf tests/review/

# 删除遗留的 _testdata（如果有）
find .review-evidence/ -type d -name "_testdata" -exec rm -rf {} +

# 验证清理结果
find .review-evidence/ -name "_testdata"  # 应该无结果
ls tests/review/                           # 应该报错：目录不存在
```

### 3. 生成归档说明

创建 `.review-evidence/ARCHIVE-README.md`：

~~~markdown
# Review Evidence Archive

## Archive Info
- Archive date: [ISO 8601]
- Review status: [CONVERGED | INCOMPLETE]
- Total rounds: [N]
- Total findings: [accepted / needs-evidence / rejected / deferred]
- Compression: [none | partial | full]

## Directory Structure
- `baseline.md`: 评审基线和初始状态
- `run-state.md`: 最终运行状态
- `findings-index.md`: 所有 findings 的索引和状态
- `screening-log.md`: 筛查和去重日志
- `final-report.md`: 最终报告
- `archives/`: 压缩的轮次证据（如果启用压缩）
- `round-[N]/`: 轮次证据目录（如果未压缩）

## Accessing Compressed Evidence
If compression is enabled, extract specific rounds:
```bash
# Extract round 1 evidence
tar -xzf .review-evidence/archives/round-1.tar.gz -C .review-evidence/

# Extract specific finding
tar -xzf .review-evidence/archives/round-1.tar.gz \
  -C .review-evidence/ \
  round-1/R1-F001-SEC/
```

## Retention Policy
- **Minimum retention**: Until next major release or 6 months
- **Recommended retention**: 1 year for audit trail
- **Compressed archives**: Can be backed up to cold storage

## Notes
[任何特殊说明，如手工合并的 findings、残余风险等]
~~~

### 4. 可选压缩（用户请求时）

```bash
# 为每轮创建压缩包
cd .review-evidence/
mkdir -p archives

# 压缩第 1 轮
tar -czf archives/round-1.tar.gz round-1/
# 验证压缩包
tar -tzf archives/round-1.tar.gz | head -10
# 创建标记文件
echo "Archived to: archives/round-1.tar.gz" > round-1/.archived
# 删除原始文件（保留目录结构）
find round-1/ -type f ! -name ".archived" -delete

# 重复其他轮次
for round in round-2 round-3 round-4 round-5; do
  if [ -d "$round" ]; then
    tar -czf "archives/${round}.tar.gz" "$round/"
    echo "Archived to: archives/${round}.tar.gz" > "$round/.archived"
    find "$round/" -type f ! -name ".archived" -delete
  fi
done

# 压缩最终审计证据（如果存在）
if [ -d "round-5/final-audit" ]; then
  tar -czf archives/final-audit.tar.gz round-*/final-audit/
fi
```

### 5. 提交归档状态

```bash
# 提交归档变更
git add .review-evidence/
git commit -m "chore(review): archive evidence after [CONVERGED|INCOMPLETE] review

- Archive date: [date]
- Total rounds: [N]
- Findings: [accepted/needs-evidence/rejected/deferred]
- Compression: [enabled/disabled]
- Temporary files cleaned up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 归档验证清单

完成归档后，检查以下项：

- [ ] `tests/review/` 目录已删除
- [ ] 所有 `_testdata/` 目录已删除
- [ ] `ARCHIVE-README.md` 已生成
- [ ] 核心索引文件（baseline.md、run-state.md、findings-index.md、screening-log.md）保持可读
- [ ] 如果启用压缩：所有 `archives/*.tar.gz` 可以正常解压
- [ ] 如果启用压缩：每个压缩的轮次目录都有 `.archived` 标记文件
- [ ] 归档状态已提交到版本控制

## 解压恢复流程

如果需要查看压缩的证据：

```bash
# 解压单个轮次
cd .review-evidence/
tar -xzf archives/round-1.tar.gz

# 解压特定 finding
tar -xzf archives/round-1.tar.gz round-1/R1-F001-SEC/

# 解压所有轮次（仅在需要重新审查时）
cd archives/
for archive in *.tar.gz; do
  tar -xzf "$archive" -C ../
done
```

## 存储优化

### 压缩率估算

典型项目的压缩效果：
- output.log 文件：70-90% 压缩率（文本日志）
- counterexample.md、*-result.md：50-70% 压缩率
- 临时测试文件（已删除）：不占用空间
- 总体：预计减少 60-80% 存储空间

### 冷存储建议

对于长期项目，可以将归档进一步迁移到冷存储：

1. **保留在主仓库**：
   - baseline.md、run-state.md、findings-index.md、screening-log.md
   - final-report.md
   - ARCHIVE-README.md

2. **迁移到冷存储**（S3 Glacier、Azure Archive 等）：
   - `archives/*.tar.gz`
   - 在 ARCHIVE-README.md 中记录冷存储位置

3. **从版本控制中移除**（保留在 .gitignore）：
   - 大型 output.log 文件（如果未压缩）
   - 压缩包（如果已备份到冷存储）

## 特殊情况处理

### 未收敛的评审（INCOMPLETE）

- 保留所有证据，不删除任何内容
- 在 ARCHIVE-README.md 中明确标注未收敛原因
- 可选择性压缩已完成的轮次，但保留未完成的轮次原样

### 手工合并的 findings（blocked_by_user_changes）

- 在 ARCHIVE-README.md 的 Notes 中列出所有 blocked_by_user_changes 的 findings
- 保留这些 findings 的完整证据（不压缩），以便将来手工合并
- 提供明确的手工合并建议和代码路径

### 残余风险（needs-evidence with clear_claim_lacking_env）

- 在 ARCHIVE-README.md 的 Notes 中列出所有残余风险
- 保留这些 findings 的证据（可压缩），以便在环境具备后重新验证

## 自动化归档脚本

主代理可以使用以下模板生成归档脚本：

```bash
#!/bin/bash
# Auto-generated archive script for MVP Adversarial Review Loop
# Generated: [ISO 8601]

set -e

REVIEW_DIR=".review-evidence"
STATUS=$(grep "overall_status:" "$REVIEW_DIR/run-state.md" | awk '{print $2}')

if [[ "$STATUS" != "converged" && "$STATUS" != "incomplete" ]]; then
  echo "Error: Review not finished (status: $STATUS)"
  exit 1
fi

echo "=== Cleaning temporary files ==="
rm -rf tests/review/
find "$REVIEW_DIR" -type d -name "_testdata" -exec rm -rf {} + 2>/dev/null || true

echo "=== Generating archive README ==="
cat > "$REVIEW_DIR/ARCHIVE-README.md" << 'EOF'
# Review Evidence Archive
[生成的内容]
EOF

if [[ "$1" == "--compress" ]]; then
  echo "=== Compressing evidence ==="
  mkdir -p "$REVIEW_DIR/archives"
  # [压缩命令]
fi

echo "=== Archive complete ==="
echo "Status: $STATUS"
echo "Review directory: $REVIEW_DIR"
```

## 归档后的工作流

归档完成后：

1. **短期（1 个月内）**：
   - 核心索引文件可直接查看
   - 如需详细证据，解压对应轮次

2. **中期（1-6 个月）**：
   - 压缩包仍在主仓库
   - 可随时解压查看

3. **长期（6 个月以上）**：
   - 考虑迁移到冷存储
   - 在主仓库保留索引和最终报告
   - 需要时从冷存储恢复

## 版本控制策略

### 推荐做法

- **提交到版本控制**：
  - 所有核心索引文件（baseline.md、run-state.md、findings-index.md、screening-log.md）
  - 最终报告（final-report.md）
  - ARCHIVE-README.md
  - 小型压缩包（< 10 MB）

- **不提交到版本控制**（添加到 .gitignore）：
  - 大型压缩包（> 10 MB）
  - 未压缩的 output.log 文件（> 1 MB）

- **.gitignore 示例**：
  ```
  .review-evidence/archives/*.tar.gz
  .review-evidence/round-*/output.log
  .review-evidence/**/_testdata/
  tests/review/
  ```

### 备份策略

- **主仓库**：核心索引 + 小型压缩包
- **CI/CD artifacts**：完整压缩包（保留 90 天）
- **冷存储**：完整压缩包（长期保留）
