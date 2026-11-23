# Main Agent Recovery Guide - MVP Adversarial Review Loop

从当前 harness 取得技能目录的绝对路径。要求 Node.js ≥18 和 Git。恢复操作从被评审项目根目录执行。

1. 读取 `.review-evidence/state.json`、`findings.json` 和 `baseline.md` 的 **Test Scope / Regression Policy**。运行以下命令核对当前状态。校验失败先用 `normalize` 重算派生字段，再处理余下错误。

   ```text
   node "<skill-dir>/scripts/reviewctl.js" status
   node "<skill-dir>/scripts/reviewctl.js" validate
   ```

2. 按 `current_phase`、`active_finding` 和 `next_action` 续接。阶段、角色独立性、轮次上限与收敛判定见 `<skill-dir>/SKILL.md` §2–§5；操作见 `references/phase-playbooks.md` 对应章节。检查 `optimistic_repairs` 中已有候选，避免重复实现。状态用 `advance` 或 `record-*` 更新。
3. 从 `review-config.json` 恢复角色模型配置。委派前用 `model-for --role ROLE` 解析并按 `SKILL.md` §0 设置 harness。委派时给出可执行的 reviewctl 绝对路径、baseline 缓存及磁盘预算。实现和验证代理还需 finding 的 severity、高风险路径、各测试命令、质量门禁、长测清单与原始尺度、baseline 结果。只有主代理更新状态。
4. 在 `round_decision` 核对已完成轮数及剩余预算。`progressive` 的轮末 full 可按阶段手册 §5.2 复用。相邻测试按 §5.3 另行登记。终审两阶段、最多三次，第二阶段由新审计代理实跑 full。
