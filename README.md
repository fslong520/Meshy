# Meshy — 多智能体协作与自进化 AI 编排框架

> **"You are the Director. The Agents are your actors."**

Meshy 是一个**本地优先**（local-first）的多智能体（Multi-Agent）AI 编排框架。它并非又一个发卡式对话的聊天工具，而是一套**泛用型虚拟劳动力与自进化协作环境**（Virtual Workforce Environment）——既能驱动复杂的软件工程任务，也擅长通用型信息处理（如全网检索、结构化分析、API 编排等）。

---

## 核心特性

### 🎭 多智能体编排
- **Director 模式**：用户扮演导演角色，调度多个专业化 Agent（Planner、Coder、Executor 等）协同工作
- **预设 Agent 角色**：内置多种预设角色，包括 Coder、Explorer、Deep-Coder、Advisor、Executor、Researcher 等
- **动态子 Agent 生成**：支持从对话中动态派生子 Agent 处理特定任务

### 🧠 自进化能力
- **Ritual 系统**：通过 ritual-*.md 文件定义 Agent 的行为规范和反思模式
- **Memory 记忆**：会话记忆、偏好记忆、胶囊式上下文提取
- **技能检索**：基于 RAG 和语义偏差（Skill Bias）的技能动态匹配

### 🔧 工具生态
- **三层工具架构**：
  - 内置工具（Built-in）：常驻注入 LLM context
  - ToolPack 预设包：确定性快速路径
  - ToolRAG + Lazy 工具：按需 BM25 检索
- **MCP 支持**：Model Context Protocol 服务器集成
- **自定义命令注册**：支持用户自定义命令

### 💻 Agent 计算机接口（ACI）
- **终端会话管理**：安全的 PTY 终端操作
- **文件操作**：读写、执行、权限管理
- **进程监控**：后台任务与状态追踪

### 🛡️ 安全与权限
- **沙箱执行**：隔离的代码执行环境
- **权限分级**：DANGEROUS、RESTRICTED、SAFE 权限模式
- **AI 二次审查**：可选的 AI 辅助安全审查

### 🔄 Replay 回放系统
- **完整会话重放**：记录并重放 Agent 执行轨迹
- **策略决策快照**：追踪每一步的工具策略决策
- **黑板状态回溯**：完整的中间状态记录

---

## 目录结构

```
Meshy/
├── src/                          # 核心源代码
│   ├── config/                   # 配置管理
│   ├── core/                     # 核心模块
│   │   ├── aci/                  # Agent 计算机接口
│   │   ├── agents/               # Agent 预设与角色
│   │   ├── commands/             # 自定义命令系统
│   │   ├── context/              # 上下文提取与序列化
│   │   ├── daemon/               # 守护进程服务
│   │   ├── engine/               # 任务引擎
│   │   ├── guard/                # 安全守卫
│   │   ├── harness/              # 测试用例执行框架
│   │   ├── injector/             # 依赖注入
│   │   ├── llm/                  # LLM 适配器（支持多种模型）
│   │   ├── lsp/                  # LSP 客户端/服务端
│   │   ├── mcp/                  # MCP 协议支持
│   │   ├── memory/               # 记忆系统
│   │   ├── plugins/              # 插件系统
│   │   ├── ritual/               # Ritual 加载器
│   │   ├── router/               # 意图路由与解析
│   │   ├── runtime/              # 运行时协议
│   │   ├── sandbox/              # 沙箱执行环境
│   │   ├── security/             # 安全模块
│   │   ├── server/               # 服务器适配器
│   │   ├── session/              # 会话管理
│   │   ├── skills/               # 技能系统
│   │   ├── subagents/            # 子 Agent 管理
│   │   ├── terminal/             # 终端管理
│   │   ├── tool/                 # 工具系统
│   │   ├── workflow/             # 工作流引擎
│   │   └── workspace/            # 工作区管理
│   └── shared/                   # 共享工具
├── web/                          # 前端界面 (React + TypeScript + Vite)
├── .agent/                       # Meshy 配置
│   ├── skills/                   # 技能定义
│   ├── context/                  # 全局上下文
│   └── tmp/                      # 临时文件
└── dist/                         # 构建输出
```

---

## 快速开始

### 安装依赖

```bash
npm install
```

### 构建项目

```bash
npm run build
```

### 运行 Meshy

```bash
npm start
```

### 可用命令

| 命令 | 说明 |
|------|------|
| `npm run build` | 构建 TypeScript 项目 |
| `npm start` | 启动 Meshy |
| `npm run typecheck` | 类型检查 |
| `npm run test` | 运行测试 |

---

## 配置

Meshy 支持多种配置方式，按优先级排序：

1. **环境变量** (.env)
2. **配置文件** (meshy.config.json / meshy.config.yaml)
3. **命令行参数**

### 支持的 LLM Provider

- **云端模型**：OpenAI、Claude、Gemini、DeepSeek 等
- **本地模型**：Vercel AI、百度文心 ERNIE 本地适配器

### 工作区配置

工作区配置位于 src/core/workspace/workspace.ts，支持：
- 根目录设置
- MCP 服务器配置
- 插件加载

---

## 工作原理

### 1. 意图解析 (Intent Routing)
用户输入经过解析，识别意图类别（Code、Terminal、Explore、Memory 等），并决定路由到哪个 Agent 或工具链。

### 2. Agent 编排
基于解析的意图，启动相应的 Agent：
- **Coder**：代码编写与修改
- **Executor**：命令执行
- **Explorer**：项目探索与理解
- **Deep-Coder**：深度代码分析与重构

### 3. 工具执行
Agent 通过工具系统执行任务：
- 内置工具提供基础能力
- ToolPack 提供快速操作集
- MCP 服务器提供扩展能力

### 4. 记忆与反思
执行完成后，通过 Ritual 和 Memory 系统进行反思和记忆，巩固学习成果。

---

## 前端界面

Meshy 提供现代化的 Web 界面：

- **Agent 选择器**：快速切换 Agent 角色
- **模型选择器**：切换不同的 LLM 模型
- **对话面板**：实时交互与消息展示
- **工具策略面板**：可视化工具权限决策
- **输入区域**：支持多模态输入

---

## 技能系统

Meshy 内置多个技能（Skills）用于特定场景：

| 技能 | 用途 |
|------|------|
| `conductor-setup` | 上下文筑基，收集项目信息 |
| `conductor-track` | 需求澄清与拆解 |
| `conductor-implement` | 流水线执行与验证 |
| `conductor-review` | 质量收口验工 |
| `decision-matrix` | 关键决策矩阵分析 |
| `strict-tdd` | 严格 TDD 开发流程 |
| `skill-creator` | 技能创建与管理 |

---

## 安全机制

- **权限分级**：DANGEROUS > RESTRICTED > SAFE
- **沙箱隔离**：代码在隔离环境中执行
- **AI 审查**：可选的二次审查机制
- **工具策略**：细粒度的工具使用控制

---

## License

MIT