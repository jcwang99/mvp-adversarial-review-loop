---
name: mvp-adversarial-review-loop
description: 对已完成的 MVP 执行有证据、可审计的多代理评审与 TDD 修复循环。适用于用户要求检查并修复产品、功能、安全、可靠性、API、性能、可访问性或运维问题的场景；达到流程上限仍未满足收敛条件时，必须报告未完成。
---

# MVP 对抗式评审循环

## 目标与资料路由

以可重放证据确认缺陷，以独立验证确认修复。主代理对 finding 和最终收敛负责；子代理提供独立评审、挑战、实现或复核结果，不替主代理作最终裁决。

- [references/review-protocol.md](references/review-protocol.md)：角色选择、评审输出、finding 裁决、挑战/补强、轮次边界和收敛规则。评审和裁决阶段按需读取。
- [references/evidence-structure.md](references/evidence-structure.md)：证据目录、状态检查点、索引和记录格式。初始化证据目录时读取。
- [references/tdd-and-commit.md](references/tdd-and-commit.md)：实现任务、RED-GREEN-REFACTOR、工作区隔离和提交验收。进入修复阶段时读取。

不要默认加载所有参考文件；只读取当前阶段需要的资料。详细规则以对应参考文件为准，不在本入口重复定义。

## 关键约束

1. **主代理保留判断权。** 子代理的结论是输入，不是事实。主代理负责范围、契约、状态与收敛裁决；常规复现可委派给独立代理，但主代理必须检查其证据。任何 finding 进入修复前都必须有主代理确认的失败证据。
2. **证据目录是持久事实来源。** 在 .review-evidence/ 中维护 baseline.md、run-state.md 和 findings-index.md。完整 reproduction、命令输出和阶段记录写入相应文件；敏感值先脱敏。对话只保留摘要和路径。
3. **每次交接都要压缩状态。** 子代理返回短摘要、finding ID、文件路径、命令/退出状态摘要和阻塞项，不要在回复中重复完整代码、日志或裁决历史。每个代理返回、finding 状态变化、提交、验证或轮次切换后，更新 run-state.md。下一阶段只读取该检查点和当前工作所需的 finding 文件。
4. **串行控制共享工作区。** 默认同时只运行一个子代理。每个评审角色使用独立的 inbox 子目录；不得依赖临时 ID 在不同角色之间唯一。未经用户明确授权，不并发评审或进行真实外部写入。
5. **先证明，再修复；提交必须隔离。** 每个 accepted finding 都须先确认失败，再按 TDD 修复、运行回归、检查差异并独立复核。修复提交只包含当前 finding 的实现和测试，不包含 .review-evidence/。不得覆盖基线中的用户改动。
6. **区分失败、未知和阻塞。** 环境不可用或证据不充分时不能标 rejected 或 verified。未完成的核验保持未完成，并记录阻塞原因。
7. **报告真实收敛状态。** 遵循评审协议的轮次上限、覆盖率和收敛条件。没有完成要求的复核时，报告 INCOMPLETE，不以测试绿灯或“未发现问题”代替证据。

## 工作流

### 0. 建立基线

在启动代理前，主代理确认 MVP 范围、验收标准、技术栈、当前 HEAD、工作区改动、测试/构建命令和基线结果。创建 .review-evidence/ 并初始化 baseline.md、run-state.md、findings-index.md。没有 Git 时仍可评审，但不得声称已提交。

### 1. 独立评审

按项目风险选择互补角色，使用 review-protocol.md 中的提示模板。每个角色只读检查项目文件，将每条候选 finding 和完整反例材料写到自己的 inbox 目录，并按规定的短格式返回结果。主代理收到并记录一个角色的交接后再启动下一个。

### 2. 主代理裁决

主代理先把纯偏好、明确范围外的新功能要求等非 finding 记录到 screening-log.md，再去重并为可能代表现存具体风险的候选分配标准 ID。将常规复现委派给未提交该候选的独立代理；主代理检查复现材料、结果和关键输出后作决定。高风险、争议或证据异常项由主代理加验。需要挑战的 finding 必须先完成挑战再裁决。按 review-protocol.md 更新 finding 记录、索引和轮次覆盖率。证据或环境不足时保留 needs-evidence，不猜测结论。

### 3. TDD 修复与提交

仅处理 accepted finding。每次只处理一个 finding；实现代理按 tdd-and-commit.md 留存 RED、修复、测试、差异和提交记录。主代理检查证据与提交边界后，才进入独立复核。

### 4. 独立复核

由未参与该 finding 实现的验证代理复现原始问题、检查项目回归测试并尝试相邻变体。只有按 review-protocol.md 完成验证并返回 pass 才标记 verified；主代理兜底时适用相同标准并记录执行者。fail 回到修复或新增 finding；inconclusive 保持 accepted 但未 verified，先解决阻塞再继续收敛判断。

### 5. 迭代、终审与报告

按 review-protocol.md 的有界轮次继续评审。当前轮所有 accepted finding 均 verified 后，才进入下一轮；未解决的验证阻塞转为 INCOMPLETE。终审先进行不提供历史 finding 和裁决记录的独立扫描；新发现必须回到普通裁决流程，修复后当前终审失效并在下一轮重审。记录扫描结果后，再提供已修复 finding 清单做定向复核。最终报告从 screening-log.md、findings-index.md 和 run-state.md 汇总轮次、状态、证据、测试、提交、风险和收敛结论。
