# 证据归档

仅在用户要求归档、已完成 `finalize` 且 `.review-evidence/final-report.md` 已生成时执行。从项目根目录运行 `reviewctl status --json` 确认最终状态。保留项目约定的保存期限和存储位置。

## 保存内容

- 保留可直接阅读的最终报告、基线、配置、状态、findings、索引和筛查记录。基线 full 的结构化证据与原始日志、授权凭据、乐观修复记录以及各轮引用的文件随运行一并保存。
- 每轮归档包括原始 inbox、裁决与验证报告、轮末回归及相邻测试的记录、该轮所有终审 attempt 与已登记的原始日志。保留证据所引用的 Git 提交。
- `INCOMPLETE`、待手工合并及其他需要复查的 finding 保留其复现用例、验证文件、fixture 和合并指南。临时文件清理由阶段手册 §7.3 统一处理。

## 压缩与取回

1. 默认保留目录原样。用户选择压缩时，将已完成的轮次分别写入新的归档文件。将配置、最终状态、轮次、归档路径、SHA-256、未完成项和恢复位置记入 `.review-evidence/ARCHIVE-README.md`。
2. 将压缩包解到空的临时目录，按相对路径及内容哈希与原目录逐文件核对。校验失败时保留原件。仅在已要求释放空间且验证成功后，才清理有完整副本的已完成材料。保留用户原有文件和未完成项。
3. 查看某项证据时，先在独立目录解出对应轮次。需要运行 `reviewctl validate` 时，在原项目对应的 Git 历史下恢复所有被引用的相对路径。还原前核对归档哈希与目标路径，避免覆盖现有工作。

例如，从项目根目录压缩一轮并查看清单（目标目录已创建、归档文件名未被占用）：

```sh
tar -czf .review-evidence/archives/round-1.tar.gz -C .review-evidence round-1
tar -tzf .review-evidence/archives/round-1.tar.gz
```
