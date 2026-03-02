# Conductor Docs Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `docs/conductor-docs/` 下创建一套面向开发者的多 Agent 协作流程规范文档，基于 `docs/conductor/templates/workflow.md`，不改动现有 `docs/` 内容。

**Architecture:** 采用“分层导览”信息架构，先概览与概念，再流程与质量，再协作与运维，附录提供模板与清单。各文档之间通过相对链接互相引用，避免内容重复。

**Tech Stack:** Markdown 文档、Git。

---

## Task 0: 预检与目录骨架

**Files:**
- Create: `docs/conductor-docs/` 及子目录

**Step 1: 创建目录骨架**

```bash
mkdir -p docs/conductor-docs/00-overview \
  docs/conductor-docs/10-workflow \
  docs/conductor-docs/20-quality \
  docs/conductor-docs/30-collaboration \
  docs/conductor-docs/40-operations \
  docs/conductor-docs/90-appendix
```

**Step 2: 目视确认目录结构**
- 确认 `docs/conductor`（clone）保持不变
- 新目录为 `docs/conductor-docs/`

**Step 3: Commit**
```bash
git add docs/conductor-docs
git commit -m "docs(conductor): add docs directory skeleton"
```

---

## Task 1: 00-overview/00-introduction.md

**Files:**
- Create: `docs/conductor-docs/00-overview/00-introduction.md`

**Step 1: 写入文档内容**

```markdown
# 介绍

## 背景与目标
本目录为多 Agent 协作开发流程的**规范文档**，基于 `docs/conductor/templates/workflow.md` 重构整理。目标是：
- 让开发者在协作开发中有**明确可执行**的流程与质量门
- 让执行过程**可审计、可追溯**（plan、checkpoint、git notes）
- 保持规范一致，避免“经验式”随意变更

## 适用范围
- 适用于涉及多 Agent 协作的研发任务
- 适用于需要明确质量门、阶段检查点的项目

## 读者
- 主要读者：开发者 / 技术负责人
- 其他读者：项目管理者（理解流程与检查点）

## 阅读路径
- 新人入门：
  1) `00-overview/01-core-concepts.md`
  2) `10-workflow/01-standard-task-workflow.md`
- 需要执行流程：
  - 直接阅读 `10-workflow/*`
- 质量与验收：
  - 阅读 `20-quality/*`

## 与现有 docs 的关系
- 本文档**新增**在 `docs/conductor-docs/` 下
- 现有 `docs/`（product-dev、research）**不改动**

## 规范等级
- **MUST**：必须遵守
- **SHOULD**：建议遵守
- **MAY**：可选

## 相关文档
- [核心概念](./01-core-concepts.md)
- [术语表](./02-terminology.md)
- [规范变更记录](../90-appendix/02-change-log.md)
```

**Step 2: 复核**
- 确认链接路径有效（相对路径）
- 不包含可运行示例

**Step 3: Commit**
```bash
git add docs/conductor-docs/00-overview/00-introduction.md
git commit -m "docs(conductor): add introduction"
```

---

## Task 2: 00-overview/01-core-concepts.md

**Files:**
- Create: `docs/conductor-docs/00-overview/01-core-concepts.md`

**Step 1: 写入文档内容**

```markdown
# 核心概念

本章定义多 Agent 协作流程中的关键工件与概念。

## 工件（Artifacts）
- **plan.md**：任务与阶段的权威清单，所有工作以此为真相源（MUST）。
- **tech-stack.md**：技术栈的正式记录，变更必须先更新（MUST）。
- **git notes**：任务/阶段的审计摘要，记录“做了什么 & 为什么”。
- **checkpoint**：阶段完成后的固定提交点，用于审计与回滚。

## 任务（Task）
- 在 `plan.md` 中以列表管理
- 任务有生命周期：未开始 → 进行中 → 完成

## 阶段（Phase）
- 由多个任务组成
- 阶段完成时必须执行“阶段验证与检查点协议”

## 质量门（Quality Gates）
- 在任务完成前必须满足的一组质量条件
- 例如：测试通过、覆盖率、风格校验、安全检查

## 完成定义（DoD）
- 任务最终“可交付”的一致性标准

## 关联关系（简述）
- task 属于 phase
- phase 完成触发 checkpoint
- git notes 记录每个 task / phase 的摘要

## 相关文档
- [标准任务流程](../10-workflow/01-standard-task-workflow.md)
- [阶段检查点协议](../10-workflow/02-phase-checkpoint-protocol.md)
- [质量门](../20-quality/00-quality-gates.md)
```

**Step 2: 复核**
- 术语与 workflow.md 保持一致

**Step 3: Commit**
```bash
git add docs/conductor-docs/00-overview/01-core-concepts.md
git commit -m "docs(conductor): add core concepts"
```

---

## Task 3: 00-overview/02-terminology.md

**Files:**
- Create: `docs/conductor-docs/00-overview/02-terminology.md`

**Step 1: 写入文档内容**

```markdown
# 术语表

| 术语 | 定义 | 关联文档 |
| --- | --- | --- |
| Task | `plan.md` 中的最小工作单元 | 10-workflow/01-standard-task-workflow.md |
| Phase | 由多个任务组成的阶段 | 10-workflow/02-phase-checkpoint-protocol.md |
| Checkpoint | 阶段完成后的固定提交点 | 10-workflow/02-phase-checkpoint-protocol.md |
| Git Notes | 任务/阶段的审计摘要 | 30-collaboration/02-git-notes-usage.md |
| Quality Gates | 任务完成前必须满足的质量条件 | 20-quality/00-quality-gates.md |
| DoD | Definition of Done，完成定义 | 20-quality/02-definition-of-done.md |
| TDD | 测试驱动开发 | 10-workflow/01-standard-task-workflow.md |
| CI | 持续集成；要求非交互模式 | 10-workflow/00-guiding-principles.md |

## 相关文档
- [核心概念](./01-core-concepts.md)
```

**Step 2: 复核**
- 确认相对路径一致

**Step 3: Commit**
```bash
git add docs/conductor-docs/00-overview/02-terminology.md
git commit -m "docs(conductor): add terminology"
```

---

## Task 4: 10-workflow/00-guiding-principles.md

**Files:**
- Create: `docs/conductor-docs/10-workflow/00-guiding-principles.md`

**Step 1: 写入文档内容**

```markdown
# 指导原则

本章节为多 Agent 协作的最高优先级原则。

## 原则清单
1. **计划为真相源（MUST）**
   - 所有任务必须记录在 `plan.md`
2. **技术栈先行记录（MUST）**
   - 技术栈变更必须先更新 `tech-stack.md`
3. **TDD（MUST）**
   - 先写失败测试，再实现功能
4. **覆盖率 >80%（SHOULD）**
   - 新增模块需达到覆盖率目标
5. **用户体验优先（MUST）**
   - 所有决策需优先考虑用户体验
6. **非交互与 CI 友好（MUST）**
   - 使用非交互命令；如需一次性运行，设置 `CI=true`

## 相关文档
- [标准任务流程](./01-standard-task-workflow.md)
```

**Step 2: 复核**
- 与 workflow.md 原则一致

**Step 3: Commit**
```bash
git add docs/conductor-docs/10-workflow/00-guiding-principles.md
git commit -m "docs(conductor): add guiding principles"
```

---

## Task 5: 10-workflow/01-standard-task-workflow.md

**Files:**
- Create: `docs/conductor-docs/10-workflow/01-standard-task-workflow.md`

**Step 1: 写入文档内容**

```markdown
# 标准任务流程

所有任务必须严格遵循以下生命周期。

## 流程概览
1) 选择任务 → 2) 标记进行中 → 3) Red → 4) Green → 5) Refactor → 6) 覆盖率 → 7) 记录偏离 → 8) 提交代码 → 9) Git Notes → 10) 更新 plan → 11) 提交 plan

## 步骤明细
### 1. 选择任务（MUST）
- 从 `plan.md` 顺序选择下一个任务

### 2. 标记进行中（MUST）
- 将任务状态由 `[ ]` 改为 `[~]`

### 3. Red（MUST）
- 先写失败测试
- 运行测试确认失败

### 4. Green（MUST）
- 实现最小代码使测试通过
- 运行测试确认通过

### 5. Refactor（SHOULD）
- 在测试保障下重构，提高可读性

### 6. 覆盖率（SHOULD）
- 运行覆盖率，确保 >80%

### 7. 记录偏离（MUST）
- 若技术栈变更，必须先更新 `tech-stack.md`

### 8. 提交代码（MUST）
- 只提交与该任务相关的改动

### 9. Git Notes（MUST）
- 记录任务摘要与“为什么”

### 10. 更新 plan（MUST）
- 将任务状态改为 `[x]` 并记录 commit SHA

### 11. 提交 plan（MUST）
- 单独提交 `plan.md` 更新

## 产出物
- 任务提交
- Git Notes
- plan.md 中的完成记录

## 相关文档
- [阶段检查点协议](./02-phase-checkpoint-protocol.md)
- [Git Notes 使用](../30-collaboration/02-git-notes-usage.md)
```

**Step 2: 复核**
- 步骤与 workflow.md 保持一致

**Step 3: Commit**
```bash
git add docs/conductor-docs/10-workflow/01-standard-task-workflow.md
git commit -m "docs(conductor): add standard task workflow"
```

---

## Task 6: 10-workflow/02-phase-checkpoint-protocol.md

**Files:**
- Create: `docs/conductor-docs/10-workflow/02-phase-checkpoint-protocol.md`

**Step 1: 写入文档内容**

```markdown
# 阶段验证与检查点协议

当某任务完成且该任务也结束一个阶段时，必须执行本协议。

## 触发条件
- 任务完成且它是阶段最后一个任务

## 协议步骤
1. **宣布开始（MUST）**
   - 明确告知进入阶段验证与检查点流程
2. **确定阶段范围（MUST）**
   - 从 `plan.md` 获取上次 checkpoint SHA
3. **列出改动文件（MUST）**
   - 获取本阶段的改动清单
4. **补齐测试（MUST）**
   - 对非文档代码文件确保存在测试
5. **执行自动化测试（MUST）**
   - 先声明将运行的命令，再执行
6. **提出人工验证计划（MUST）**
   - 必须基于 `product.md`、`product-guidelines.md`、`plan.md`
   - 必须给出可执行的步骤与预期结果
7. **等待用户确认（MUST）**
   - 未确认不得继续
8. **创建检查点提交（MUST）**
   - 创建 checkpoint commit
9. **附加审计报告（MUST）**
   - 使用 git notes 记录验证报告
10. **更新 plan（MUST）**
    - 在阶段标题记录 checkpoint SHA
11. **提交 plan（MUST）**
    - 单独提交

## 相关文档
- [标准任务流程](./01-standard-task-workflow.md)
- [Git Notes 使用](../30-collaboration/02-git-notes-usage.md)
```

**Step 2: 复核**
- 步骤顺序与 workflow.md 一致

**Step 3: Commit**
```bash
git add docs/conductor-docs/10-workflow/02-phase-checkpoint-protocol.md
git commit -m "docs(conductor): add phase checkpoint protocol"
```

---

## Task 7: 20-quality/00-quality-gates.md

**Files:**
- Create: `docs/conductor-docs/20-quality/00-quality-gates.md`

**Step 1: 写入文档内容**

```markdown
# 质量门

在标记任务完成前，必须满足以下质量门。

## 质量门清单
- 测试通过
- 覆盖率满足要求（>80%）
- 代码遵循风格指南
- 公共函数/方法有文档
- 类型安全
- 无静态分析错误
- 移动端可用（如适用）
- 文档更新完成（如适用）
- 无新增安全漏洞

## 相关文档
- [测试要求](./01-testing-requirements.md)
- [完成定义](./02-definition-of-done.md)
```

**Step 2: Commit**
```bash
git add docs/conductor-docs/20-quality/00-quality-gates.md
git commit -m "docs(conductor): add quality gates"
```

---

## Task 8: 20-quality/01-testing-requirements.md

**Files:**
- Create: `docs/conductor-docs/20-quality/01-testing-requirements.md`

**Step 1: 写入文档内容**

```markdown
# 测试要求

## 单元测试
- 每个模块必须有对应测试
- 使用合适的测试夹具
- 外部依赖必须 mock
- 覆盖成功与失败场景

## 集成测试
- 覆盖完整用户流程
- 验证数据库事务
- 认证与授权路径

## 移动测试（如适用）
- 实机测试
- 触控交互
- 响应式布局
- 弱网性能
```

**Step 2: Commit**
```bash
git add docs/conductor-docs/20-quality/01-testing-requirements.md
git commit -m "docs(conductor): add testing requirements"
```

---

## Task 9: 20-quality/02-definition-of-done.md

**Files:**
- Create: `docs/conductor-docs/20-quality/02-definition-of-done.md`

**Step 1: 写入文档内容**

```markdown
# 完成定义（DoD）

任务完成必须满足：
1. 需求实现
2. 单元测试完成且通过
3. 覆盖率达标
4. 文档更新（如适用）
5. 静态分析通过
6. 移动端可用（如适用）
7. plan.md 已记录
8. 代码已提交
9. git notes 已附加
```

**Step 2: Commit**
```bash
git add docs/conductor-docs/20-quality/02-definition-of-done.md
git commit -m "docs(conductor): add definition of done"
```

---

## Task 10: 30-collaboration/00-code-review-process.md

**Files:**
- Create: `docs/conductor-docs/30-collaboration/00-code-review-process.md`

**Step 1: 写入文档内容**

```markdown
# 代码评审流程

## 自查清单
- 功能正确，边界处理
- 代码风格一致
- 测试充分，覆盖率达标
- 无明显安全风险
- 性能合理
- 移动端体验良好（如适用）

## 评审原则
- 先功能与安全，后风格
- 聚焦增量改动
- 明确可执行反馈
```

**Step 2: Commit**
```bash
git add docs/conductor-docs/30-collaboration/00-code-review-process.md
git commit -m "docs(conductor): add code review process"
```

---

## Task 11: 30-collaboration/01-commit-guidelines.md

**Files:**
- Create: `docs/conductor-docs/30-collaboration/01-commit-guidelines.md`

**Step 1: 写入文档内容**

```markdown
# 提交规范

## 提交消息格式
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

## 类型
- feat
- fix
- docs
- style
- refactor
- test
- chore

## 规则
- 一个任务对应一个主要提交
- 描述清晰且可追溯
```

**Step 2: Commit**
```bash
git add docs/conductor-docs/30-collaboration/01-commit-guidelines.md
git commit -m "docs(conductor): add commit guidelines"
```

---

## Task 12: 30-collaboration/02-git-notes-usage.md

**Files:**
- Create: `docs/conductor-docs/30-collaboration/02-git-notes-usage.md`

**Step 1: 写入文档内容**

```markdown
# Git Notes 使用规范

## 目的
- 记录任务/阶段的审计摘要
- 说明“做了什么”和“为什么”

## 何时使用
- 每个任务完成后
- 每个阶段 checkpoint 后

## 内容模板（纯文本）
```
Task: <task name>
Summary: <what changed>
Files: <created/modified files>
Why: <reason>
```

## 阶段验证报告模板（纯文本）
```
Phase: <phase name>
Automated Tests: <command + result>
Manual Verification: <steps + expected outcome>
User Confirmation: <yes/no + notes>
```
```

**Step 2: Commit**
```bash
git add docs/conductor-docs/30-collaboration/02-git-notes-usage.md
git commit -m "docs(conductor): add git notes usage"
```

---

## Task 13: 40-operations/00-development-commands.md

**Files:**
- Create: `docs/conductor-docs/40-operations/00-development-commands.md`

**Step 1: 写入文档内容**

```markdown
# 开发命令

> 本章节为占位模板，需按项目实际填写。

## Setup
- <INSTALL COMMAND>
- <DB MIGRATION COMMAND>

## Daily Development
- <START DEV SERVER>
- <RUN TESTS>
- <LINT>

## Before Committing
- <FORMAT>
- <TYPE CHECK>
- <FULL TEST SUITE>
```

**Step 2: Commit**
```bash
git add docs/conductor-docs/40-operations/00-development-commands.md
git commit -m "docs(conductor): add development commands template"
```

---

## Task 14: 40-operations/01-deployment-workflow.md

**Files:**
- Create: `docs/conductor-docs/40-operations/01-deployment-workflow.md`

**Step 1: 写入文档内容**

```markdown
# 发布流程

## 预发布清单
- 测试通过
- 覆盖率达标
- 无静态分析错误
- 环境变量配置完毕
- 数据库迁移准备完成
- 备份已完成

## 发布步骤
1. 合并到主分支
2. 打标签并发布
3. 执行迁移
4. 验证部署

## 发布后
- 监控错误与指标
- 收集反馈
```

**Step 2: Commit**
```bash
git add docs/conductor-docs/40-operations/01-deployment-workflow.md
git commit -m "docs(conductor): add deployment workflow"
```

---

## Task 15: 40-operations/02-emergency-procedures.md

**Files:**
- Create: `docs/conductor-docs/40-operations/02-emergency-procedures.md`

**Step 1: 写入文档内容**

```markdown
# 紧急流程

## 生产故障
1. 创建 hotfix 分支
2. 先写失败测试
3. 最小修复
4. 全面测试
5. 立即部署
6. 记录事故

## 数据丢失
1. 停止写操作
2. 从备份恢复
3. 验证完整性
4. 记录事故
5. 更新备份流程

## 安全事件
1. 立即轮换密钥
2. 审核访问日志
3. 修复漏洞
4. 通知受影响用户（如适用）
5. 更新安全流程
```

**Step 2: Commit**
```bash
git add docs/conductor-docs/40-operations/02-emergency-procedures.md
git commit -m "docs(conductor): add emergency procedures"
```

---

## Task 16: 90-appendix/00-templates.md

**Files:**
- Create: `docs/conductor-docs/90-appendix/00-templates.md`

**Step 1: 写入文档内容**

```markdown
# 模板汇总（纯文本）

## plan.md 模板
```
# Plan

## Phase 1: <Phase Name>
- [ ] <Task 1>
- [ ] <Task 2>

## Phase 2: <Phase Name>
- [ ] <Task 1>
```

## tech-stack.md 模板
```
# Tech Stack

## Language
- <language>

## Frameworks
- <frameworks>

## Database
- <database>

## Testing
- <testing tools>
```

## Git Notes 模板
```
Task: <task name>
Summary: <what changed>
Files: <created/modified files>
Why: <reason>
```
```

**Step 2: Commit**
```bash
git add docs/conductor-docs/90-appendix/00-templates.md
git commit -m "docs(conductor): add templates"
```

---

## Task 17: 90-appendix/01-checklists.md

**Files:**
- Create: `docs/conductor-docs/90-appendix/01-checklists.md`

**Step 1: 写入文档内容**

```markdown
# 检查清单汇总

## 任务完成前
- [ ] 测试通过
- [ ] 覆盖率达标
- [ ] 风格检查
- [ ] 文档更新
- [ ] Git Notes 已附加

## 阶段完成
- [ ] 执行阶段验证协议
- [ ] 用户确认
- [ ] Checkpoint 提交

## 代码评审
- [ ] 功能正确
- [ ] 质量门通过
- [ ] 安全与性能检查
```

**Step 2: Commit**
```bash
git add docs/conductor-docs/90-appendix/01-checklists.md
git commit -m "docs(conductor): add checklists"
```

---

## Task 18: 90-appendix/02-change-log.md

**Files:**
- Create: `docs/conductor-docs/90-appendix/02-change-log.md`

**Step 1: 写入文档内容**

```markdown
# 规范变更记录

## 2026-02-26
- 初始化 docs/conductor-docs 文档体系
```

**Step 2: Commit**
```bash
git add docs/conductor-docs/90-appendix/02-change-log.md
git commit -m "docs(conductor): add change log"
```

---

## Task 19: 全文链接与一致性检查

**Files:**
- Modify: `docs/conductor-docs/**/*.md`

**Step 1: 逐文件核对链接**
- 确认相对路径与标题一致
- 不包含可运行示例/配置

**Step 2: Commit**
```bash
git add docs/conductor-docs
git commit -m "docs(conductor): normalize cross-links"
```

---

## Verification
- 目视检查所有文档存在且路径正确
- 确认未修改 `docs/product-dev` 与 `docs/research`
- 确认 `docs/conductor`（clone）未被覆盖

---

Plan complete and saved to `docs/plans/2026-02-26-conductor-docs-implementation-plan.md`. Two execution options:

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration
2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
