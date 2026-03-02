# Conductor 调研 & Meshy Agent 架构演进方案

> 基于 [gemini-cli-extensions/conductor](https://github.com/gemini-cli-extensions/conductor) 深度调研，结合
> [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) 已有分析，重新设计 Meshy 的 Agent 体系。

---

## 一、Conductor 核心理念

### 1.1 Context-Driven Development（上下文驱动开发）

Conductor 的哲学是：**把"项目上下文"当作与代码同等重要的受管资产**，而不是让 AI 每次重新推测。

通过 `/conductor:setup` 一次性生成以下上下文文件，所有后续的 AI 交互都建立在此基础之上：

| 文件 | 用途 |
|---|---|
| `conductor/product.md` | 产品定义（用户画像、产品目标、核心功能） |
| `conductor/product-guidelines.md` | 产品规范（文风、品牌调性、视觉标识） |
| `conductor/tech-stack.md` | 技术栈偏好（语言、框架、数据库、约束） |
| `conductor/workflow.md` | 工作流规范（TDD、Commit 策略、验收标准） |
| `conductor/code_styleguides/` | 代码风格指南（按语言分目录） |
| `conductor/tracks.md` | 所有 Track 的汇总状态 |

> **对 Meshy 的启发**：Meshy 的 Workspace 概念可以扩展为承载这些上下文文件。Agent 在执行任务时
> 自动读取当前 Workspace 的上下文，而非每次靠 System Prompt 硬编码规则。

### 1.2 Track 工作单元

Conductor 的每个任务不是一个简单的 prompt，而是一个 **Track**（轨道），包含：

```
conductor/tracks/<track_id>/
├── spec.md       ← 需求规格（我们要做什么、为什么）
├── plan.md       ← 执行计划（分 Phase → Task，每个 Task 有明确的验收标准）
└── metadata.json ← 元数据（状态、时间戳、关联 commit）
```

Track 的生命周期：

```
/conductor:newTrack "Add dark mode"
  ↓
AI 生成 spec.md（采访用户 → 明确需求）
  ↓
AI 生成 plan.md（分阶段 → 拆任务 → 定验收标准）
  ↓
用户审阅 plan → 确认
  ↓
/conductor:implement
  ↓
AI 按 plan.md 逐个执行 Task
  ↓
每个 Phase 结束 → 自动化测试 → 手动验证 → Checkpoint commit
  ↓
/conductor:review
  ↓
AI 对照 product-guidelines.md 审查完成质量
```

### 1.3 Phase Checkpoint 机制

每完成一个 Phase，Conductor 会：

1. 运行自动化测试，确保无回归
2. 生成**手动验证方案**，指导用户验证效果
3. 创建 Checkpoint commit + Git Notes（附审验报告）
4. 记录 commit SHA 到 plan.md，支持按 Phase/Task 粒度的 git-aware 回退

> **对 Meshy 的启发**：Meshy 的 Session 系统可以引入类似的 Phase Checkpoint 概念，让每一轮主要操作
> 都有可审计、可回退的快照点。

---

## 二、与 oh-my-opencode 对比分析

| 维度 | Conductor | oh-my-opencode | Meshy 当前 |
|---|---|---|---|
| **核心定位** | 流程管理（项目经理） | 多 Agent 编排（工头）  | 通用对话 Agent |
| **Context 管理** | 持久化文件（product.md 等） | AGENTS.md 层级注入 | 无 |
| **任务分解** | Track → Phase → Task | Plan → Todo → Subtask | Session 内简单对话 |
| **Agent 角色** | 无（单一 AI + 严格流程） | 10+ 个专业化 Agent | 1 个通用 "Manager" |
| **规划系统** | spec.md → plan.md | Prometheus 采访 → Plan | `/plan` 前缀 |
| **验证机制** | Phase Checkpoint + 手动验证 | Todo Enforcer + Momus | 无 |
| **回退能力** | Git-aware 按 Track/Phase 回退 | 无自动回退 | 无 |
| **模型策略** | 单一模型 | 多模型自动路由 | 手动选择 |
| **可操作性** | 命令触发（/conductor:xxx） | Agent 选择（Tab 切换） | 无 |

### 2.1 关键洞察：两者互补

- **Conductor 解决"做什么"和"怎么验证"**：它专注于流程和质量保障
- **oh-my-opencode 解决"谁来做"和"用什么模型做"**：它专注于 Agent 分工和模型路由

Meshy 应该**同时吸收两者的精华**：
1. 从 Conductor 学习：上下文管理 + Track 生命周期 + 验证机制
2. 从 oh-my-opencode 学习：Agent 角色分工 + 用户可主动触发的工作模式

---

## 三、对之前方案的反思

### 3.1 Agent 角色不够丰富的问题

之前的 6 个角色（Default / Planner / DeepCoder / Advisor / Searcher / Reviewer）缺少：

- **没有"执行者"角色**：谁负责按 Plan 逐步执行？
- **没有"验证者"角色**：谁负责在 Phase 完成后跑测试和检查？
- **没有"上下文管理"角色**：谁负责初始化和维护项目上下文？

### 3.2 Category 依赖模型的问题

之前方案中 Category（如 `frontend` → Gemini, `deep-think` → GPT）存在一个关键问题：

> **Category 是为「主 Agent 委派子任务」设计的**，普通用户无法（也不应该）手动触发。
> 用户在 InputArea 看到的应该是 **Agent**，而不是 Category。

Category 应该是**内部路由机制**，对用户透明。用户只需选择 Agent，Agent 内部根据任务性质自动使用 Category。

---

## 四、Meshy Agent 架构演进方案（v2）

### 4.1 设计原则

1. **Agent 是用户触发的，Category 是内部路由的**
2. **Agent 不仅是 System Prompt 的切换，更是工作流程的切换**
3. **每个 Agent 有明确的输入→输出契约**
4. **上下文不靠 System Prompt 硬编码，而来自 Workspace 的持久化文件**

### 4.2 重新设计的 Agent 体系

#### 🟢 用户直接选择的 Agent（InputArea 下拉菜单）

| Agent | 用途 | 工作模式 | 启发自 |
|---|---|---|---|
| **Default** | 日常开发助手，处理各种编码任务 | 直接对话，自主判断如何行动 | OmO Sisyphus |
| **Planner** | 战略规划师，针对复杂任务进行需求澄清和计划制定 | 采访模式 → 输出 spec.md + plan.md | OmO Prometheus + Conductor newTrack |
| **Builder** | 按计划执行者，读取 Plan 逐 Task 执行 | 读取 plan.md → 按 Phase/Task 推进 → Phase 结束做 Checkpoint | Conductor implement |
| **DeepCoder** | 深度编码者，给目标不给步骤，自主探索 | 自主研究代码库 → 端到端完成 | OmO Hephaestus |
| **Advisor** | 架构顾问，只读分析不动代码 | 读取代码库 → 输出分析/建议 | OmO Oracle |
| **Reviewer** | 代码/计划审查者 | 对照规范审查 → 输出审查报告 | OmO Momus + Conductor review |
| **Searcher** | 代码/文档搜索专家 | 快速 Grep + 文档检索 → 返回结果 | OmO Explore + Librarian |

#### 🔵 内部角色（用户不直接选择，由其他 Agent 调用）

| 内部 Agent | 用途 | 何时被调用 |
|---|---|---|
| **GapAnalyzer** | 计划漏洞分析 | Planner 完成初始计划后自动调用 |
| **Worker** | 按 Category 分类的子任务执行者 | Default/Builder 委派具体子任务时 |

### 4.3 Conductor 启发的新增功能

#### 功能 1：Workspace Context（项目上下文）

借鉴 Conductor 的 `/conductor:setup`，在 Meshy 的 Workspace 目录下维护：

```
.meshy/
├── context/
│   ├── product.md          ← 产品定义
│   ├── tech-stack.md       ← 技术栈偏好
│   └── workflow.md         ← 工作流规范
├── plans/
│   ├── <plan_id>/
│   │   ├── spec.md         ← 需求规格
│   │   ├── plan.md         ← 执行计划
│   │   └── metadata.json   ← 元数据
│   └── index.md            ← 所有 Plan 汇总
└── styleguides/            ← 代码风格指南
```

- 用户可通过 **`/setup`** 命令触发上下文初始化
- 所有 Agent 在执行任务时自动读取 `.meshy/context/` 下的文件
- 减少 System Prompt 体积，提升上下文相关性

#### 功能 2：Plan 生命周期

借鉴 Conductor 的 Track 系统 + OmO 的 Prometheus：

```
用户选择 @Planner → 描述需求
  ↓
Planner 采访模式 → 澄清需求 → 输出 spec.md
  ↓
Planner 生成 plan.md（Phase → Task → 验收标准）
  ↓
(可选) GapAnalyzer 自动分析遗漏
  ↓
用户审阅 Plan → 确认
  ↓
用户切换到 @Builder → /start-work
  ↓
Builder 逐 Phase 执行：
  - 选取下一个 Task → 标记 [~]
  - 编写代码 → 测试
  - 完成 → 标记 [x]
  - Phase 结束 → Checkpoint（运行测试 + 提示验证）
  ↓
完成后切换 @Reviewer → /review
  ↓
Reviewer 对照 spec + guidelines 审查
```

#### 功能 3：Phase Checkpoint

借鉴 Conductor 的验证协议：

- 每个 Phase 完成后，自动运行配置好的测试命令
- 生成手动验证建议（基于任务类型：前端 → 给出 URL 和操作步骤，后端 → 给出 API 请求示例）
- 等待用户确认后才进入下一个 Phase
- 记录 Phase 的 Git commit SHA，支持按 Phase 回退

### 4.4 Agent 切换流程（UI 交互）

```
┌─────────────────────────────────────────┐
│  InputArea                              │
│  ┌──────────┐  ┌──────────┐  ┌───────┐ │
│  │ @Default ▾│  │ Model ▾  │  │ Plan ▾│ │
│  └──────────┘  └──────────┘  └───────┘ │
│  ┌─────────────────────────────────────┐│
│  │ Type your message...               ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘

Agent 下拉菜单展开时：
┌──────────────────────────────┐
│ 🟢 Default    日常开发助手    │  ← 默认选中
│ 📋 Planner    战略规划师      │
│ 🔨 Builder    按计划执行     │
│ 🧠 DeepCoder  深度编码       │
│ 👁️ Advisor    架构顾问       │
│ 🔍 Searcher   搜索专家       │
│ ✅ Reviewer   代码审查       │
└──────────────────────────────┘
```

### 4.5 各 Agent 的核心参数

| Agent | 温度 | 工具权限 | 上下文注入 | 特殊行为 |
|---|---|---|---|---|
| Default | 0.1 | 全部 | product + tech-stack | 标准对话 |
| Planner | 0.3 | 只读 + 写 .meshy/plans/ | product + tech-stack + workflow | 采访模式，输出 spec + plan |
| Builder | 0.1 | 全部 | plan.md + tech-stack + workflow | 按 plan 逐步执行，Phase Checkpoint |
| DeepCoder | 0.1 | 全部 | product + tech-stack | 自主探索，不需要 plan |
| Advisor | 0.2 | 只读 | product + tech-stack | 只分析不写代码 |
| Reviewer | 0.2 | 只读 | plan + product-guidelines | 审查和验证 |
| Searcher | 0.1 | Grep + 搜索 | 无 | 快速返回搜索结果 |

---

## 五、与之前方案的差异

| 维度 | v1 方案 | v2 方案（本文） | 变化原因 |
|---|---|---|---|
| Agent 数量 | 6 | 7 + 2 内部 | 新增 Builder 和 GapAnalyzer，解决"执行"和"验证"缺口 |
| Category | 用户可见 | 纯内部路由 | 用户不需要关心模型路由细节 |
| 项目上下文 | 无 | .meshy/context/ 持久化文件 | Conductor 的核心启发 |
| Plan 系统 | 仅 `/plan` 前缀 | 完整的 spec → plan → implement 生命周期 | Conductor Track 系统 |
| 验证流程 | 无 | Phase Checkpoint + 审查 | Conductor 验证协议 |
| 回退能力 | 无 | Git-aware 按 Phase 回退 | Conductor revert 命令 |

---

## 六、实施优先级

| 优先级 | 内容 | 预估 | 依赖 |
|---|---|---|---|
| 🔴 P0 | InputArea Agent 选择器 (7 个 Agent) | 0.5 天 | 无 |
| 🔴 P0 | Agent Profile 后端 (System Prompt + 权限) | 1 天 | P0 UI |
| 🟡 P1 | Workspace Context 文件系统 (.meshy/context/) | 1 天 | 无 |
| 🟡 P1 | Planner 采访模式 (spec + plan 输出) | 1.5 天 | Context |
| 🟢 P2 | Builder 按 Plan 执行 + Phase Checkpoint | 2 天 | Planner |
| 🟢 P2 | Reviewer 审查模式 | 1 天 | Builder |
| 🔵 P3 | 内部 Category 路由 + Worker | 2 天 | Agent 系统 |
| 🔵 P3 | Git-aware 按 Phase 回退 | 1.5 天 | Builder |

---

## 七、参考资源

- [Conductor README](https://github.com/gemini-cli-extensions/conductor)
- [Conductor workflow.md 模板](https://github.com/gemini-cli-extensions/conductor/blob/main/templates/workflow.md)
- [OmO Overview](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/guide/overview.md)
- [OmO Orchestration Guide](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/guide/orchestration.md)
- [OmO Features Reference](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/reference/features.md)
- [Meshy 之前的 Agent 对齐方案](file:///c:/mntd/code/Meshy/docs/product-dev/agent-architecture-alignment.md)
