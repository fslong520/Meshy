# Meshy Agent 架构对齐方案

> 基于 [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) 的深度调研，结合 Meshy 自身定位，制定 Agent 体系对齐路线图。

## 一、oh-my-opencode Agent 体系全景

oh-my-opencode 采用**三层架构**：Planning → Execution → Worker。

### 1.1 核心 Agent 一览

| OmO Agent 名 | 角色 | 职责 | 推荐模型 |
|---|---|---|---|
| **Sisyphus** | 主编排器 | 默认 Agent。规划、委派子任务、并行执行 | Claude Opus 4.6 |
| **Hephaestus** | 深度执行者 | 自主深度工作，给目标不给步骤，端到端完成 | GPT-5.3 Codex |
| **Prometheus** | 战略规划师 | 采访模式，逐步澄清需求，输出详细执行计划 | Claude Opus 4.6 (thinking) |
| **Atlas** | 执行指挥 | 读取 Prometheus 计划，按 Todo 分发子任务 | Claude Sonnet 4.6 |
| **Oracle** | 架构顾问 | 只读顾问，擅长架构决策、复杂 Debug、代码审查 | GPT-5.3 Codex |
| **Metis** | 漏洞分析 | 计划发布前，发现隐藏意图和遗漏 | Claude Opus 4.6 |
| **Momus** | 严苛审查 | 验证计划的清晰度、可验证性、完整度 | GPT-5.2 |
| **Explore** | 快速搜索 | 快速代码库 Grep，模式发现 | Claude Haiku 4.5 |
| **Librarian** | 知识检索 | 文档查询、OSS 代码搜索 | Claude Sonnet 4.5 |
| **Multimodal Looker** | 视觉分析 | 图片/PDF/截图 分析 | Gemini 3 Pro |

### 1.2 Category 任务分类系统

Agent 不直接指定模型，而是通过**语义化分类**自动路由：

| 分类 (Category) | 用途 | 默认模型 |
|---|---|---|
| `visual-engineering` | 前端 / UI / 动画 | Gemini 3 Pro |
| `ultrabrain` | 深层推理、复杂架构 | GPT-5.3 Codex |
| `deep` | 自主探索型问题解决 | GPT-5.3 Codex |
| `quick` | 琐碎修改、单文件改动 | Claude Haiku |
| `writing` | 文档 / 技术写作 | Kimi K2.5 |
| `artistry` | 创意 / 艺术性任务 | Gemini 3 Pro |
| `unspecified-low` | 未分类低复杂度 | Claude Sonnet |
| `unspecified-high` | 未分类高复杂度 | Claude Opus |

### 1.3 核心编排流程

```
用户描述需求
  ↓
Prometheus 采访 → 澄清需求 → 输出 Plan.md
  ↓
Metis 漏洞分析 → 补充遗漏
  ↓
Momus 严格审查 → OKAY / REJECT (循环)
  ↓
/start-work → Atlas 读取 Plan
  ↓
Atlas 分发 task(category=...) → Sisyphus-Junior 执行
  ↓
结果 + 学习经验 回传 Atlas → 下一个任务
```

### 1.4 关键设计原则

1. **语义分类 > 指定模型**：Agent 说 "这是什么类型的工作"，系统自动匹配最优模型
2. **权限隔离**：Oracle / Librarian / Explore 只读，不能写代码，防止越权
3. **防止无限委派**：Sisyphus-Junior 不能再委派子 Agent
4. **经验积累**：子任务结果 + 发现的规律，在后续任务中传递
5. **工作模式二选一**：`ultrawork`（懒人模式，全自动） vs `@plan → /start-work`（精确模式）

---

## 二、Meshy 当前状态 vs 差距分析

### 2.1 当前状态

- InputArea 中的 Agent 选择器写的是 `@Manager`，含义不明
- 没有 Agent 切换机制，所有任务走同一个 LLM
- 没有 Category 分类系统
- 有 Plan / Build 模式切换，但仅在 prompt 前加 `/plan` 前缀
- 有 Skills 系统（已实现注册和扫描）
- 有 MCP 集成（已实现）

### 2.2 核心差距

| 维度 | oh-my-opencode | Meshy 现状 |
|---|---|---|
| Agent 角色数量 | 10+ 个专业化角色 | 1 个通用 Agent |
| 任务分类 | 8 种语义分类 + 自定义 | 无 |
| 模型路由 | 按 Category 自动匹配 | 手动选择单一模型 |
| 规划系统 | Prometheus 采访 + Metis + Momus | 仅 `/plan` 前缀 |
| 工具权限 | 按 Agent 角色限制 | 无限制 |
| 子任务委派 | `task()` tool + 后台并行 | 无 |

---

## 三、Meshy Agent 对齐方案（通俗命名版）

> **核心原则**：不照搬希腊神话命名，采用直观、通俗的英文名。

### 3.1 Meshy Agent 角色定义

| Meshy Agent | 对标 OmO | 通俗用途 | InputArea 显示 |
|---|---|---|---|
| **Default** | Sisyphus | 默认主 Agent，接收用户的所有日常指令，自行判断是否委派 | `@Default` |
| **Planner** | Prometheus | 战略规划师，采访模式澄清需求，输出结构化执行计划 | `@Planner` |
| **DeepCoder** | Hephaestus | 深度编码者，给目标不给步骤，自主探索和实现 | `@DeepCoder` |
| **Advisor** | Oracle | 只读顾问，架构咨询、代码审查、复杂 Debug | `@Advisor` |
| **Searcher** | Explore + Librarian | 快速搜索，代码库 Grep + 文档检索 | `@Searcher` |
| **Reviewer** | Momus | 严格审查者，验证计划或代码的完整性 | `@Reviewer` |

### 3.2 Category 分类（中文语义）

| Meshy Category | 对标 OmO | 语义 | 自动路由模型策略 |
|---|---|---|---|
| `frontend` | visual-engineering | 前端 / UI / 样式 | 偏好视觉擅长的模型 |
| `deep-think` | ultrabrain | 深层推理 / 架构决策 | 偏好推理能力强的模型 |
| `quick-fix` | quick | 快速修复 / 小改动 | 偏好速度快的模型 |
| `writing` | writing | 文档 / 技术写作 | 偏好语言表达能力强的模型 |
| `general` | unspecified-low/high | 通用任务 | 使用当前默认模型 |

### 3.3 实现路线图

#### Phase 1：InputArea Agent 选择器（UI 层）

**目标**：将 `@Manager` 改为 `@Default`，并支持切换其他 Agent。

**具体改动**：

1. **`InputArea.tsx`**：将硬编码的 `<option>@Manager</option>` 改为动态列表
2. 新增 Agent 定义常量文件 `web/src/config/agents.ts`
3. Agent 选择变更时，通知后端当前活跃的 Agent Profile

```typescript
// web/src/config/agents.ts
export const AGENTS = [
  { id: 'default',    label: 'Default',    desc: '日常开发助手' },
  { id: 'planner',    label: 'Planner',    desc: '战略规划师' },
  { id: 'deep-coder', label: 'DeepCoder',  desc: '深度编码者' },
  { id: 'advisor',    label: 'Advisor',    desc: '架构顾问（只读）' },
  { id: 'searcher',   label: 'Searcher',   desc: '代码/文档搜索' },
  { id: 'reviewer',   label: 'Reviewer',   desc: '代码审查者' },
] as const
```

#### Phase 2：后端 Agent Profile 系统

**目标**：根据选择的 Agent，切换 System Prompt + 工具权限 + 温度。

**具体改动**：

1. **`src/core/agents/profiles.ts`** [NEW]：定义每个 Agent 的 System Prompt 模板、可用工具白名单/黑名单、温度等参数
2. **`src/core/engine.ts`**：在 `runTask()` 时，根据当前 Agent Profile 注入对应的 System Prompt
3. **`src/index.ts`**：添加 `agent:switch` RPC 处理器

```typescript
// src/core/agents/profiles.ts 示例结构
export interface AgentProfile {
  id: string
  label: string
  systemPrompt: string
  temperature: number
  toolRestrictions: {
    mode: 'allowlist' | 'blocklist'
    tools: string[]
  }
  preferredModel?: string  // 可选：覆盖用户选择的模型
}
```

#### Phase 3：Category 任务分类系统

**目标**：支持主 Agent 将子任务按 Category 委派到不同模型。

**具体改动**：

1. **`src/core/agents/categories.ts`** [NEW]：定义 Category 到模型的映射
2. **`src/core/agents/task-tool.ts`** [NEW]：实现 `task()` 工具，供主 Agent 调用以委派子任务
3. 在 LLM Tool List 中注入 `task` 工具定义

#### Phase 4：Planner 采访模式

**目标**：`@Planner` Agent 进入采访模式，逐步澄清需求后输出结构化 Plan。

**具体改动**：

1. Planner Agent 的 System Prompt 定义采访流程
2. Plan 输出为 `.meshy/plans/*.md`，可被 Default Agent 读取执行
3. 在 UI 中支持 `/start-work` 命令，触发 Plan 的执行

---

## 四、AI 实施指导（供后续开发引用）

### 4.1 Phase 1 实施要点

当 AI 实现 Phase 1 时，应遵循以下要点：

1. **不要破坏现有功能**：Agent 选择器是**新增 UI 元素**，不影响消息发送逻辑
2. **默认选中 `Default`**：用户打开页面时，Agent 应为 `Default`，等同于当前行为
3. **选择器样式**：使用与 ModelSelector 一致的下拉菜单样式，而非原生 `<select>`
4. **Agent 切换通知**：前端通过 `sendRpc('agent:switch', { agentId })` 通知后端
5. **后端暂存**：即使 Phase 2 未实现，后端也应接受并存储当前 Agent 状态

### 4.2 Phase 2 实施要点

1. **System Prompt 模板化**：每个 Agent 的 System Prompt 应从模板文件加载，支持热更新
2. **工具权限是硬限制**：Advisor 和 Searcher 的只读限制必须在 Tool 调用层强制执行
3. **温度差异化**：Default 和 DeepCoder 使用低温度 (0.1)，Planner 使用中等温度 (0.3)
4. **模型覆盖是可选的**：如果用户手动选择了模型，Agent 的 `preferredModel` 不应强制覆盖

### 4.3 Phase 3 实施要点

1. **`task()` 工具定义**：必须包含 `category` 和 `prompt` 两个参数
2. **防止无限委派**：由 `task()` 派生的子 Agent 不能再调用 `task()`
3. **经验传递**：子任务的结果和发现应以结构化方式返回给主 Agent，供后续参考

### 4.4 命名原则（后续实施必须遵守）

- ❌ 不要用希腊神话名：Sisyphus, Prometheus, Hephaestus
- ❌ 不要用含糊术语：Manager, Worker, Agent-1
- ✅ 使用动词/名词直觉命名：Default, Planner, DeepCoder, Advisor, Searcher, Reviewer
- ✅ 每个名字一看就懂它干什么

---

## 五、优先级建议

| 优先级 | Phase | 预估工作量 | 价值 |
|---|---|---|---|
| 🔴 P0 | Phase 1：InputArea Agent 选择器 | 0.5 天 | 立即改善 UX，消除 `@Manager` 困惑 |
| 🟡 P1 | Phase 2：Agent Profile 系统 | 2 天 | 差异化体验，不同 Agent 有不同专长 |
| 🟢 P2 | Phase 3：Category 分类 | 3 天 | 多模型协同，任务自动路由 |
| 🔵 P3 | Phase 4：Planner 采访模式 | 2 天 | 复杂任务的结构化规划流程 |

---

## 六、参考资源

- [OmO Overview](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/guide/overview.md)
- [OmO Orchestration Guide](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/guide/orchestration.md)
- [OmO Features Reference](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/reference/features.md)
- [OmO Configuration](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/reference/configuration.md)
