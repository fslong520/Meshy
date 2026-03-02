# 多Agent协作文档重构设计（基于 workflow.md）

## Context
我们需要为多 Agent 协作 AI 工具整理一套“可执行、可审计”的文档体系，参考 `docs/conductor/templates/workflow.md` 的规范与术语，同时保持现有 `docs/` 不动，新增独立的新结构文档目录。目标是让开发者快速理解协作流程与质量门，并在执行中有可操作的规范指引。

## 用户输入与约束
- 参考文件：`docs/conductor/templates/workflow.md`
- 输出位置：**新增** `docs/conductor-docs/`（保留当前 clone 的 `docs/conductor`）
- 受众：开发者；语言：中文为主
- 不包含可运行示例/配置模板；可保留“纯文本模板”
- 不更新现有 docs 入口（README/index）
- 现有 `docs/` 仅含 `product-dev/` 与 `research/`，保持不改动
- 结构参考但不与 workflow.md 一一对应，允许重构
- 采用“分层导览（Layered Overview)”信息架构

## 推荐方案（分层导览 IA）
以“概览 → 核心概念 → 工作流 → 质量 → 协作 → 运维 → 附录”组织，兼顾新人理解与执行查找，且便于后续扩展。

### 目录结构（IA）
```
docs/conductor-docs/
  00-overview/
    00-introduction.md              # 背景、目标、适用范围、阅读路径
    01-core-concepts.md             # 计划/任务/阶段/检查点/工件
    02-terminology.md               # 术语表
  10-workflow/
    00-guiding-principles.md        # 指导原则
    01-standard-task-workflow.md    # 标准任务流程
    02-phase-checkpoint-protocol.md # 阶段验证与检查点协议
  20-quality/
    00-quality-gates.md             # 质量门
    01-testing-requirements.md      # 测试要求
    02-definition-of-done.md        # 完成定义
  30-collaboration/
    00-code-review-process.md       # 评审流程
    01-commit-guidelines.md         # 提交规范
    02-git-notes-usage.md           # Git Notes 规范与模板
  40-operations/
    00-development-commands.md      # 开发命令（按项目定制）
    01-deployment-workflow.md       # 发布流程
    02-emergency-procedures.md      # 紧急流程
  90-appendix/
    00-templates.md                 # 纯文本模板汇总
    01-checklists.md                # 检查清单汇总
    02-change-log.md                # 规范变更记录
```

## workflow.md → 新结构映射（H3级）
- **Guiding Principles** → `10-workflow/00-guiding-principles.md`
  - 计划为真相源；技术栈前置记录；TDD；>80%覆盖；UX优先；CI 非交互
- **Task Workflow / Standard Task Workflow** → `10-workflow/01-standard-task-workflow.md`
  - 选任务→标记进行中→Red→Green→Refactor→覆盖率→偏离记录→提交→git notes→写回 plan→提交 plan
- **Phase Completion Verification and Checkpointing Protocol** → `10-workflow/02-phase-checkpoint-protocol.md`
  - 触发条件→范围界定→改动清单→补测试→执行测试→手工验证计划→用户确认→checkpoint→git notes→写回 plan→提交 plan
- **Quality Gates** → `20-quality/00-quality-gates.md`
- **Testing Requirements** → `20-quality/01-testing-requirements.md`
  - 单元/集成/移动
- **Definition of Done** → `20-quality/02-definition-of-done.md`
- **Code Review Process** → `30-collaboration/00-code-review-process.md`
- **Commit Guidelines** → `30-collaboration/01-commit-guidelines.md`
- **Git Notes Usage**（从步骤 9/7 提炼）→ `30-collaboration/02-git-notes-usage.md`
- **Development Commands** → `40-operations/00-development-commands.md`
- **Deployment Workflow** → `40-operations/01-deployment-workflow.md`
- **Emergency Procedures** → `40-operations/02-emergency-procedures.md`
- **Appendix** → `90-appendix/*`（模板、清单、变更记录）

## 内容边界与写作规范
- **面向开发者中文**，描述规范、流程、定义与检查清单
- **不包含可运行示例/配置**（如 YAML/JSON/CLI）
- **保留纯文本模板**（如 plan.md / tech-stack.md / git notes）
- **不改旧 docs，不更新入口**
- 章节内引用 `workflow.md` 的强制要求与“不得跳过”的步骤

## 交付物
1. 新目录 `docs/conductor-docs/` 下完整文档
2. 文档间交叉引用（概念↔流程↔质量）
3. 规范变更记录 `90-appendix/02-change-log.md`

## 风险与处理
- **目录重名冲突**：保留 `docs/conductor`（clone），新文档写入 `docs/conductor-docs`
- **信息重复**：通过概念页统一定义，其他章节引用

## 下一步（写作计划概要）
- 逐文件重写：先 Overview → Workflow → Quality → Collaboration → Operations → Appendix
- 统一术语与模板
- 生成变更记录并初始化版本
