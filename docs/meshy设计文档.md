# Meshy 设计方案

## 一、项目简介

Meshy 是一个本地优先的多智能体（Multi-Agent）AI 编排框架。它采用 Director 模式——用户扮演导演，调度多个专业化 Agent 协同工作，完成软件开发、信息处理、数据分析等复杂任务。

## 二、系统架构

系统分为四层：

### L1 基础设施层
- **Turso (libSQL)**：嵌入式数据库，存放知识胶囊、全局设定、经验记忆，支持向量检索
- **定制化二进制压缩存储**：存放 Agent 待办黑板树、变量快照等运行时状态，实现微秒级冷启动
- **MCP 主机**：管理各类工具服务的生命周期

### L2 ACI 与智能守护层
Agent 与操作系统之间的安全屏障：
- **文件引擎**：带行号分页读取，基于文件 Hash 和时间戳的并发防冲突
- **LSP 拦截**：代码写入前进行语法和类型诊断，拦截错误修改
- **终端沙盒**：安全的 PTY 终端会话管理
- **安全守卫**：三级权限体系（DANGEROUS / RESTRICTED / SAFE）

### L3 Agent 协作与状态流转层
- **意图路由**：前置小模型分类器，快速判断任务类型并分发
- **Session 隔离**：每个任务独立 Session，切除无关上下文
- **共享黑板**：Agent 间通过结构化数据总线通信，而非自然语言对话
- **RAG 技能检索**：工具描述纳入检索体系，用到时才加载

### L4 人机交互与自进化层
- **Web UI 仪表盘**：React + TypeScript + Vite 构建的图形界面
- **Electron 桌面客户端**：可打包为桌面应用
- **Replay 回放系统**：完整记录 Agent 执行轨迹
- **点赞飞轮**：用户点赞触发自动提炼"知识胶囊"，实现经验复用

## 三、核心模块

### 多 Agent 编排
内置 10 种预设 Agent 角色，每个角色以独立 `.md` 文件定义（位于 `src/core/agents/presets/`）：

| 角色 | 职责 |
|------|------|
| default | 通用助手，问答、文案、翻译、调研 |
| coder | 主力工程师，日常编码 |
| deep-coder | 深度代码分析与大规模重构 |
| explorer | 代码侦察兵，快速搜索与模式发现 |
| executor | 纪律执行者，按计划逐任务推进 |
| advisor | 技术顾问，方案评估与架构建议 |
| planner | 计划制定者，任务拆解与路线规划 |
| reviewer | 代码审查者，质量把关 |
| librarian | 知识库管理员，文档与信息整理 |
| scanner | 项目扫描者，快速了解项目全貌 |

支持在对话中通过 `@agent:角色名` 动态切换，也可由意图路由自动分派。

### 角色预设优化：半文半白风格
Agent 角色预设（`src/core/agents/presets/*.md`）采用**鲁迅式半文半白**风格撰写。这样做的原因有三：

1. **精准**：文言词汇语义边界清晰，没有西式长从句的缠绕，模型理解偏差率低
2. **省 Token**：半文半白行文简洁，以「之、者、也、矣、毋、勿」等单字替代白话文的多字表达。实测 10 个预设文件合计 20,009 字符，若以白话文重写约需 28,000 字符，Token 消耗（以 GPT-4o 计）相应降低约 **30%**。且精准的文言表达减少了模型理解偏差，间接降低了因反复推理而浪费的 Token。
3. **角色鲜明**：冷峻文风天然塑造 Agent 的"人格"特征，使用者一眼就能区分不同角色

这套优化不仅用于预设文件，系统 Prompt、Ritual 规范、技能描述也同样适用。

### LLM Provider 适配
通过适配器模式统一接入多种模型：
- 云端：OpenAI、Claude、Gemini、DeepSeek 等
- 本地：ERNIE（通过 HuggingFace/ModelScope 运行时）

### 工具系统
三层工具架构：
1. **内置工具**：常驻上下文的基本能力（读写文件、终端执行）
2. **ToolPack 预设包**：确定性快速路径
3. **ToolRAG + Lazy 工具**：按需检索加载，避免 Token 浪费

### 技能系统
基于 SKILL.md 规范的本地技能开发框架，支持 RAG 语义检索匹配。

### 记忆系统
三类记忆：会话记忆（当前对话上下文）、偏好记忆（用户习惯）、胶囊记忆（跨会话知识沉淀）。

## 四、与 openKylin 的集成

### 部署方式
```
openKylin 2.0 SP2
├── Meshy Electron 桌面客户端（Web UI + UKUI 主题适配）
├── Meshy Daemon 守护进程（Node.js 后端 + Agent 运行时）
├── ERNIE 本地模型推理引擎（通过 HuggingFace/ModelScope）
└── Turso 知识库（libSQL 嵌入式数据库）
```

### 集成要点
- 已集成 ERNIE-4.5-0.3B 模型，通过 `LocalERNIEAdapter` 启动 Python 子进程加载运行
- ERNIE 模型承担两级职能：意图分类（低功耗本地路由）和对话推理（用户可切换使用）
- 内置 `local-ernie` provider，可通过 Web UI 模型选择器一键切换
- 意图路由采用三级兜底：关键词匹配 → ERNIE-0.3B 分类 → 远端 LLM 分类
- Electron 桌面客户端深度适配 UKUI 主题
- 基于 openKylin maintainer mode 的脚本执行和硬件访问能力
- 全本地运行，数据不出系统，保障隐私

## 五、技术亮点

1. **Token 优化**：
   - LSP 代替 LLM 做代码定位、本地拦截并发冲突、延迟工具注入、Prompt Caching
    - **角色预设半文半白化**：Agent 提示词以鲁迅式文言撰写，较白话文省约 30% Token，且语义更精准
2. **本地优先**：核心能力在本地运行，离线可用，无 API 调用成本
3. **万物皆 RAG**：工具描述纳入检索体系，支持无限技能挂载
4. **事件驱动**：Agent 通过黑板数据总线协作，支持并行团队模式

## 六、应用场景

- **智能桌面助手**：通过自然语言操控文件整理、信息检索、文档生成
- **开发辅助**：多 Agent 协作完成编码、测试、文档编写
- **信息处理**：数据抓取 → 结构化分析 → 报告生成

## 七、代码结构

### 入口
| 文件 | 功能 |
|------|------|
| `src/index.ts` | 主入口。解析 CLI 参数（server/run/interactive），初始化各模块，启动任务引擎或守护进程 |

### 配置
| 文件 | 功能 |
|------|------|
| `src/config/index.ts` | 基于 Zod 的配置 schema 定义与加载。管理 provider 配置、UI 主题、模型列表 |

### 核心模块 (src/core/)

| 目录/文件 | 功能 |
|-----------|------|
| **engine/index.ts** | TaskEngine — 中枢执行引擎（~1657行）。串联 LLM、工具、沙箱、Session 的主循环 |
| **router/intent.ts** | 意图路由。三级分类：关键词 → ERNIE-0.3B 本地模型 → 远端 LLM。输出 RoutingDecision |
| **router/input-parser.ts** | 输入解析，处理 @mention 等特殊语法 |
| **session/state.ts** | Session 状态定义（active/suspended/archived）、黑板数据结构 |
| **session/manager.ts** | Session 生命周期管理（创建、加载、保存、删除、压缩） |
| **session/replay.ts** | Replay 回放系统，记录和重放 Agent 执行轨迹 |
| **llm/resolver.ts** | Provider 管理器。多 provider 注册、运行时切换模型、跨协议调用 |
| **llm/local-ernie.ts** | LocalERNIEAdapter — 通过 Python 子进程加载 ERNIE-4.5-0.3B，通过 stdin/stdout JSON-RPC 通信 |
| **llm/provider.ts** | LLM Provider 基类 |
| **llm/vercel-ai.ts** | Vercel AI SDK 适配器 |
| **llm/opencode-direct.ts** | OpenCode 直接调用适配器 |
| **tool/registry.ts** | 工具注册中心。双层架构：内置工具（常驻）+ 惰性工具（按需加载） |
| **tool/catalog.ts** | 工具目录，管理懒加载工具的索引 |
| **tool/tool-pack.ts** | 工具预设包，固定快速路径 |
| **tool/manifest.ts** | 工具清单定义（权限分类、超时、重试） |
| **skills/registry.ts** | 技能注册，扫描 .agent/skills/ 目录下的 SKILL.md |
| **skills/retrieval.ts** | 技能检索，基于关键词 + 语义偏差的 RankedSkill 排序 |
| **memory/store.ts** | 持久化存储（Turso/libSQL），技能同步、胶囊存取 |
| **memory/reflection.ts** | Reflection Agent，用户点赞时自动提炼知识胶囊 |
| **memory/consolidation.ts** | 记忆整合，跨 Session 的知识归并 |
| **memory/retrieval.ts** | 记忆检索，基于向量 Top-K |
| **workspace/manager.ts** | Workspace 管理器，管理工作区注册和切换 |
| **workspace/workspace.ts** | 单个 Workspace 定义，包含 rootPath、MCP 主机、记忆存储、快照管理 |
| **daemon/server.ts** | 守护进程。WebSocket JSON-RPC 事件流，支持前后端双向通信 |
| **terminal/manager.ts** | 终端管理器。通过 child_process.spawn 管理 PTY 会话 |
| **aci/index.ts** | Agent-Computer Interface，Agent 与操作系统的桥接层 |
| **mcp/host.ts** | MCP 协议主机，管理 MCP 服务器连接和生命周期 |
| **lsp/client.ts** | LSP 客户端，连接语言服务器进行代码诊断 |
| **lsp/server.ts** | LSP 服务器端实现 |
| **sandbox/execution.ts** | 沙箱执行环境 |
| **sandbox/permission.ts** | 沙箱权限控制 |
| **sandbox/reviewer.ts** | AI 二次审查器 |
| **security/modes.ts** | 执行模式定义（DANGEROUS/RESTRICTED/SAFE） |
| **security/guard.ts** | 安全守卫 |
| **subagents/loader.ts** | 子 Agent 加载和生命周期管理 |
| **agents/presets/** | Agent 角色预设（10 个 .md 文件）：advisor、coder、deep-coder、default、executor、explorer、librarian、planner、reviewer、scanner |
| **plugins/loader.ts** | 插件加载器 |
| **plugins/registry.ts** | 插件注册中心 |
| **plugins/runtime/** | 运行时组件：MCP 持久化、MCP 投影、技能偏差 |
| **ritual/loader.ts** | Ritual 加载器，执行 Agent 行为规范和反思流程 |
| **workflow/engine.ts** | 工作流引擎 |
| **server/harness/adapter.ts** | 测试用例执行适配器 |
| **server/plugins/adapter.ts** | 服务端插件适配器 |
| **guard/diagnostic.ts** | 诊断护栏，在工具执行前校验 Agent 输出 |
| **context/extractor.ts** | 项目上下文提取 |
| **context/repo-map.ts** | 仓库地图构建 |
| **commands/loader.ts** | 自定义命令加载 |
| **runtime/protocol.ts** | 运行时协议类型定义 |
| **injector/lazy.ts** | 懒加载依赖注入 |

### Shared 工具
| 文件 | 功能 |
|------|------|
| `src/shared/replay-*.ts` | Replay 相关工具函数（合约定义、事件派生、导出规范化、步骤投影） |

### Web 前端
| 文件/目录 | 功能 |
|-----------|------|
| `web/src/main.tsx` | React 入口 |
| `web/src/App.tsx` | 主应用组件 |
| `web/src/components/` | UI 组件 |
| `web/src/store/` | 状态管理 |
| `web/vite.config.ts` | Vite 构建配置 |

### 脚本
| 文件 | 功能 |
|------|------|
| `scripts/ernie_intent_server.py` | ERNIE-4.5-0.3B Python 常驻服务，通过 stdin/stdout 与 Node.js 进程通信 |

## 八、当前进度

- [x] 核心 Agent 运行时引擎
- [x] 多模型 Provider 适配
- [x] 文件读写、终端执行等基础工具
- [x] Session 管理与上下文隔离
- [x] 技能系统与 RAG 检索
- [x] Web UI 界面
- [x] Agent 角色预设半文半白优化（鲁迅式文言，省 Token 且精准）
- [x] ERNIE 本地模型集成（LocalERNIEAdapter + intent 分类 + provider 切换）
- [ ] Electron 桌面客户端封装
- [ ] openKylin 安装脚本
