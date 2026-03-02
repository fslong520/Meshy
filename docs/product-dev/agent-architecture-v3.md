# Meshy Agent 架构设计 v3

> 融合 [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)、
> [conductor](https://github.com/gemini-cli-extensions/conductor)、
> Claude Code、OpenCode 的调研成果，结合用户反馈重新设计。

---

## 一、设计原则

### 1.1 DRY（Don't Repeat Yourself）在 Agent 设计中的体现

| 原则 | 含义 |
|---|---|
| **一个概念只存在一个地方** | "规划" 只属于 Planner Agent，不应同时是一个 Mode 又是一个 Command |
| **共享的不重复定义** | 所有 Agent 共用的行为（如读取上下文）抽象为 Base Prompt Layer |
| **专业的不放在通用里** | Default Agent 保持最轻量，专业能力通过 Skill 按需注入 |
| **内部逻辑不暴露给用户** | Category 路由、内部 Agent 调用、模型选择对用户透明 |

### 1.2 三层正交模型

```
┌──────────────────────────────────────────────────┐
│  Agent（谁来做）  ×  Mode（怎么做）  ×  Skill（用什么知识）  │
└──────────────────────────────────────────────────┘
```

- **Agent**：决定 System Prompt 和工具权限→「人格」
- **Mode**：决定 AI 的行为节奏和自主性→「风格」
- **Skill**：决定注入的领域知识和专属工具→「技能包」

三者独立选择，自由组合。例如：
- `@Default` + `Standard Mode` + 无 Skill → 普通对话
- `@Default` + `Auto Mode` + `+git-master` → 自主完成 Git 操作
- `@Planner` + `Smart Mode` + `+frontend-ui-ux` → 深度规划前端任务

---

## 二、Mode（工作模式）

> 取代当前的 "Plan / Build" 切换，改为更通用的工作模式概念。

| Mode | UI 标签 | 行为描述 |
|---|---|---|
| **Standard** | `Standard` | 标准对话模式。AI 回答问题、给建议，**不自动执行**。用户明确要求时才行动。 |
| **Smart** | `Smart` | 智能模式。AI 自主判断何时需要阅读代码、搜索文档，会主动查资料但**改动前征求确认**。 |
| **Auto** | `Auto` | 自动模式（对标 OmO 的 `ultrawork`）。AI 全自动执行：探索代码库 → 制定方案 → 编码 → 验证。直到完成或遇到需要人工决策的点。 |

**为什么不叫 Plan / Build**：
- "Plan" 是一种**任务类型**（由 Planner Agent 承担），不应是一种 Mode
- "Build" 太模糊，也容易与 `npm run build` 等概念混淆
- Standard / Smart / Auto 描述的是**自主性梯度**，适用于任何 Agent

**Mode 的 UI 位置**：取代 InputArea 中现有的 `Plan | Build` 按钮组。

---

## 三、Agent（角色定义）

### 3.1 设计思路

- **Default 极简化**：不预设为"编码"Agent，而是一个通用助手，适用于调研、写文案、翻译、编码等任何任务
- **Searcher 拆分**：本地代码搜索和远程文档搜索是两种截然不同的能力，拆分后更专业
- **Builder 更名为 Executor**：避免与 Build Mode 混淆，名字明确表达"按计划执行"
- **内部 Agent 通过 Skill 编排**：不设独立的"内部角色"，而是将 GapAnalyzer 等做成 Planner 的 Skill

### 3.2 用户可选 Agent（InputArea 下拉）

| Agent | Emoji | 一句话描述 | System Prompt 核心 | 工具权限 |
|---|---|---|---|---|
| **Default** | 💬 | 通用 AI 助手 | 简洁通用，无领域预设 | 全部 |
| **Coder** | 💻 | 专注编码的开发者 | 注入 tech-stack、代码规范 | 全部 |
| **Planner** | 📋 | 战略规划师 | 采访模式，输出 spec + plan | 只读 + 写 .meshy/plans/ |
| **Executor** | ⚡ | 按计划逐步执行 | 读取 plan.md，逐 Task 推进 | 全部 |
| **DeepCoder** | 🧠 | 深度编码者 | 给目标不给步骤，自主探索 | 全部 |
| **Advisor** | 👁️ | 架构/技术顾问 | 只分析不写代码 | 只读 |
| **Explorer** | 🔍 | 本地代码搜索 | 快速 Grep + 模式发现 | Grep + 文件读取 |
| **Researcher** | 📚 | 远程文档/库搜索 | 文档检索、API 查询、OSS 搜索 | Web Search + MCP |
| **Reviewer** | ✅ | 代码/方案审查 | 对照规范审查，输出报告 | 只读 |

### 3.3 为什么 Explorer 和 Researcher 要分开

| 维度 | Explorer（本地） | Researcher（远程） |
|---|---|---|
| 数据源 | 当前代码库 | 互联网、NPM、GitHub、文档站 |
| 工具 | `grep`, `find`, `ast-grep`, 文件读写 | `web-search`, `context7`, `MCP` |
| 输出 | 代码片段 + 文件路径 | 文档摘要 + URL 引用 |
| 典型场景 | "找到所有用了 sendRpc 的地方" | "查一下 React 19 的 use() Hook 怎么用" |
| 混在一起的问题 | AI 可能会去搜网页而不是看本地代码 | AI 可能会 grep 本地而不是搜文档 |

### 3.4 Agent 的 Prompt 分层架构（DRY）

```
┌─────────────────────────────────────────┐
│  Layer 0: Base Prompt                   │  ← 所有 Agent 共享
│  • 基础行为准则                           │
│  • 错误处理规范                           │
│  • 格式输出规范                           │
│────────────────────────────────────────│
│  Layer 1: Agent Profile Prompt          │  ← 按 Agent 不同
│  • 角色定义 + 性格                       │
│  • 工具权限声明                          │
│  • 输入→输出契约                        │
│────────────────────────────────────────│
│  Layer 2: Context Injection (可选)      │  ← 按 Workspace 不同
│  • .meshy/context/product.md            │
│  • .meshy/context/tech-stack.md         │
│  • AGENTS.md (如果有)                   │
│────────────────────────────────────────│
│  Layer 3: Skill Injection (可选)        │  ← 按用户选择的 Skill
│  • SKILL.md → 领域知识                  │
│  • Skill 附带的 MCP 工具               │
└─────────────────────────────────────────┘
```

- Default Agent **只看 Layer 0**（最轻量）
- Coder Agent 看 **Layer 0 + 1 + 2**
- 用户选了 `+frontend-ui-ux` Skill 后，追加 **Layer 3**

---

## 四、Command（斜杠命令）

### 4.1 调研结论

| 项目 | Command 数量 | 高频命令 | 设计模式 |
|---|---|---|---|
| **Claude Code** | 56+ | `/init`, `/review`, `/security-review` | 内置 + `.claude/commands/*.md` 自定义 |
| **OpenCode** | 20+ | `/init`, `/compact`, `/new`, `/undo`, `/export` | 内置 TUI 命令 + `.opencode/commands/*.md` 自定义 |
| **OmO** | 8+ | `/init-deep`, `/start-work`, `/refactor`, `/handoff` | 内置 + 自定义，与 Agent 联动 |
| **Conductor** | 6 | `/setup`, `/newTrack`, `/implement`, `/review`, `/revert` | 纯命令驱动 |

Commands 是**确定性的工作流触发器**，与 Agent 的关系是：Command 可以自动选择合适的 Agent。

### 4.2 Meshy 内置命令设计

| Command | 功能 | 自动关联 Agent |
|---|---|---|
| `/init` | 初始化项目上下文（生成 .meshy/context/） | Default |
| `/plan <描述>` | 启动规划流程（生成 spec + plan） | Planner |
| `/start-work` | 从最新 Plan 开始执行 | Executor |
| `/review` | 审查当前变更 | Reviewer |
| `/search <关键词>` | 在代码库中搜索 | Explorer |
| `/research <主题>` | 在网上深度调研 | Researcher |
| `/compact` | 压缩当前上下文 | (系统级) |
| `/new` | 新建会话 | (系统级) |
| `/handoff` | 生成上下文交接文档 | Default |
| `/status` | 查看当前 Plan 的执行状态 | (系统级) |
| `/undo` | 撤销上一步操作 | (系统级) |

**Command 与 Agent 的关系**：
- `/plan` 自动切换到 `@Planner` 并进入采访模式
- `/start-work` 自动切换到 `@Executor` 并加载最新 Plan
- `/review` 自动切换到 `@Reviewer`
- 用户也可以先手动选 Agent 再直接输入内容，不使用 Command

### 4.3 自定义命令

用户可在 `.meshy/commands/` 下创建自定义命令：

```markdown
<!-- .meshy/commands/deploy-review.md -->
# /deploy-review
---
agent: reviewer
description: 部署前的最终审查
---
请按以下标准审查当前代码变更：
1. 安全性：有没有硬编码的密钥或敏感信息
2. 性能：有没有 N+1 查询或不必要的循环
3. 兼容性：有没有 Breaking Change
```

---

## 五、Skill 与 Agent 的编排

### 5.1 Conductor Track 做成 Skill 而非硬标准

用户的不同任务有不同的流程需求。Conductor 的严格 TDD 流程不适合所有场景。

将其做成可选的 **Skill**，用户按需加载：

| Skill 名 | 内容 | 适用场景 |
|---|---|---|
| `+tdd-workflow` | TDD 流程：写测试 → 实现 → 重构 → 验证 | 后端开发、核心逻辑 |
| `+frontend-ui-ux` | UI/UX 设计规范 + 浏览器验证 | 前端开发 |
| `+git-master` | 原子化 commit + rebase + PR | 所有需要 Git 操作的场景 |
| `+deep-research` | 深度调研流程 + 文档输出模板 | 技术调研、竞品分析 |
| `+code-review` | 审查清单 + 安全检查 | 代码审查 |
| `+plan-quality` | Gap 分析 + 漏洞检测 + 严格审查 | 复杂任务规划的质量保障 |
| `+writing` | 技术写作规范 + 文档模板 | 文案、文档、翻译 |

**`+plan-quality` 取代了之前的 GapAnalyzer 内部角色**：
- 不再是一个独立的"内部 Agent"
- 而是 Planner 可以加载的 Skill
- 当用户使用 `@Planner` + `+plan-quality` 时，Planner 会自动执行 Gap 分析

### 5.2 编排示例

```
# 场景 1：快速修 Bug
@Default + Standard Mode → 直接告诉 AI 问题 → AI 修复

# 场景 2：复杂功能开发
@Planner + Smart Mode + +plan-quality → 采访 → 输出 Plan
  ↓
@Executor + Auto Mode + +tdd-workflow → 按 Plan 执行
  ↓
@Reviewer + Standard Mode + +code-review → 审查

# 场景 3：写技术文档
@Default + Smart Mode + +writing → AI 帮写文档

# 场景 4：技术调研
@Researcher + Smart Mode + +deep-research → AI 搜索 + 整理报告

# 场景 5：代码库搜索
@Explorer + Standard Mode → "找到所有 WebSocket 事件的定义"
```

---

## 六、上下文管理

### 6.1 .meshy/ 目录结构

```
.meshy/
├── context/                   ← 项目上下文（/init 生成）
│   ├── product.md             ← 产品定义（可选）
│   ├── tech-stack.md          ← 技术栈偏好（可选）
│   └── workflow.md            ← 工作流规范（可选）
├── plans/                     ← Plan 存储（@Planner 生成）
│   └── <plan_id>/
│       ├── spec.md
│       └── plan.md
├── commands/                  ← 自定义命令
│   └── *.md
└── styleguides/               ← 代码风格指南（可选）
    └── *.md
```

### 6.2 注入策略

| Agent | 自动注入 | 原因 |
|---|---|---|
| Default | 无 | 保持轻量，适用于任何任务 |
| Coder | tech-stack.md + styleguides/ | 编码需要了解技术栈和规范 |
| Planner | product.md + tech-stack.md | 规划需要了解产品和技术背景 |
| Executor | 当前 plan.md + workflow.md | 执行需要了解计划和工作流 |
| Advisor | tech-stack.md | 咨询需要了解技术背景 |
| Reviewer | product.md + styleguides/ | 审查需要了解产品目标和规范 |
| Explorer | 无 | 纯搜索，不需要上下文 |
| Researcher | 无 | 纯搜索，不需要上下文 |

---

## 七、UI 布局

### 7.1 InputArea 最终设计

```
┌─────────────────────────────────────────────────────────┐
│  Toolbar                                                │
│  ┌──────────┐  ┌──────────┐  ┌─────────────┐  ┌──────┐│
│  │💬 Default▾│  │ Model ▾  │  │⚡ Standard ▾ │  │+Skill││
│  └──────────┘  └──────────┘  └─────────────┘  └──────┘│
│  ┌────────────────────────────────────────────────┐    │
│  │ Type your message...                            │    │
│  │ (/ for commands, @ for agents, + for skills)    │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

- **Agent 选择器**（左一）：下拉选择当前 Agent
- **Model 选择器**（左二）：下拉选择模型（已有）
- **Mode 选择器**（左三）：Standard / Smart / Auto
- **Skill 入口**（右侧）：点击显示已加载的 Skill

### 7.2 输入提示与快捷操作

在输入框中输入：
- `/` → 弹出 Command 补全列表
- `@` → 弹出 Agent 切换列表
- `+` → 弹出 Skill 加载列表

---

## 八、与 v2 方案的差异总结

| 维度 | v2 方案 | v3 方案 | 变化原因 |
|---|---|---|---|
| Builder | 独立 Agent | 改名 **Executor** | 避免与 Build 模式混淆 |
| Searcher | 合并为一个 | 拆为 **Explorer + Researcher** | 本地/远程搜索工具完全不同 |
| Plan/Build | Mode 切换 | 改为 **Standard/Smart/Auto** | Plan 是 Agent 职责，Build 太模糊 |
| GapAnalyzer | 内部 Agent | 改为 **+plan-quality Skill** | 通过 Skill 编排更灵活 |
| Track 系统 | 硬性标准 | 拆为 Skills（+tdd-workflow 等） | 不同任务需要不同流程 |
| Default | 注入 product + tech-stack | **无注入** | 保持轻量通用性 |
| Coder | 不存在 | **新增** | 编码场景需要专门的 Agent |
| Commands | 未设计 | **11 个内置 + 自定义** | 调研证明 Command 是高频需求 |

---

## 九、实施优先级

| 优先级 | 内容 | 预估 | 说明 |
|---|---|---|---|
| 🔴 P0 | Agent 选择器 UI（9 个可选 Agent） | 0.5 天 | 替换 `@Manager` |
| 🔴 P0 | Mode 选择器 UI（Standard/Smart/Auto） | 0.5 天 | 替换 Plan/Build 切换 |
| 🔴 P0 | Agent Profile 后端框架 | 1 天 | Prompt 分层 + 权限系统 |
| 🟡 P1 | 内置 Command 系统 | 1.5 天 | `/plan`, `/review`, `/compact` 等 |
| 🟡 P1 | Skill 注入框架增强 | 1 天 | 支持 Agent + Skill 组合 |
| 🟢 P2 | .meshy/context/ 上下文管理 | 1 天 | `/init` 命令生成 |
| 🟢 P2 | Planner 采访模式 | 1.5 天 | spec + plan 输出 |
| 🟢 P2 | Executor 按 Plan 执行 | 2 天 | 依赖 Planner |
| 🔵 P3 | 自定义 Command 系统 | 1 天 | `.meshy/commands/*.md` |
| 🔵 P3 | Explorer / Researcher 专业工具集 | 1.5 天 | 独立工具权限 |

---

## 十、参考资源

- [OmO Commands Reference](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/reference/features.md)
- [Conductor Track System](https://github.com/gemini-cli-extensions/conductor)
- [Claude Code Custom Commands](https://docs.anthropic.com/en/docs/build-with-claude/claude-code)
- [OpenCode TUI Commands](https://opencode.ai/docs/tui)
- [Meshy v1 Agent 对齐方案](file:///c:/mntd/code/Meshy/docs/product-dev/agent-architecture-alignment.md)
- [Meshy v2 Conductor 调研](file:///c:/mntd/code/Meshy/docs/product-dev/conductor-research-and-agent-evolution.md)
