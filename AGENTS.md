# Main Agent Recovery Guide - MVP Adversarial Review Loop

从本次运行使用的技能定位 `scripts/reviewctl.js`，在被评审项目的 Git 根目录执行。下文 `reviewctl` 是带引号的 Node 命令简写。已有运行沿用 `.review-evidence/`，保留原配置和历史。

```text
node "<技能绝对路径>/scripts/reviewctl.js" status --json
node "<技能绝对路径>/scripts/reviewctl.js" validate
```

1. **定位断点。** 从 JSON 读 `config`、`state.current_phase`、`current_round`、`active_finding`、`next_action` 和 `findings`，对照当前 HEAD、暂存区、已有报告与日志。`next_action` 是阶段提示，每次登记的实际结果以 finding、round 或 audit 记录为准。`overall_status` 已收尾时先检查 `final-report.md`。
2. **按报错恢复。** 只有轮次派生值失配时用 `normalize`，生成视图损坏且底层记录正确时用 `render`。缺 handoff、测试日志或未填的 baseline 字段时，从原角色会话、磁盘材料或实际补跑取得证据，修复后重跑 `validate`。配置或历史损坏且无可靠副本时，保留现场并报告文件和错误。
3. **续接委派。** 核对原会话身份、任务是否仍在执行及已有产物。用 `model-for --role ROLE` 从保存配置解析模型，按 `SKILL.md` §0、§3 和角色模板补派缺失工作。带上 baseline 的测试策略与缓存预算。盲扫阶段仅摘录获准材料。检查 `optimistic_repairs` 中候选的状态、worktree 和基准提交。
4. **只执行尚未完成的动作。** `repair` 中已有修复提交时，先核对 diff、测试和实现报告，再补缺少的 `record-implementation` 或 `advance`。`verification` 按阶段手册 §4 的“失败验证只登记一次”核对结果及剩余预算，再选择转移。
5. **轮末与终审。** 核对本轮门禁和下一 attempt 的聚合记录（阶段手册 §5）。在 `final_audit` 核对当前 attempt 的记录、`blind-scan.md` 和 `targeted-review.md`。盲扫已保存时，由同一审计会话继续定向复核；会话丢失且无法完成本次审计时按 §6.2 登记 `failed`。已登记的结果直接走对应转移。到 `report` 再按 §7 执行 `finalize` 并检查最终报告。
