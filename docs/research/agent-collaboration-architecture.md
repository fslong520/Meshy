# 多智能体协作与自进化平台架构设计 (基于 OpenClaw / EvoMap 与 Session-based 范式)

## 1. 核心愿景与执行摘要
本项目旨在构建一个**“多智能体协作与写作/编程工具”**，它不仅仅是一个“单轮对话”的 Chatbot，而是一个**“虚拟劳动力（Virtual Workforce）”**。

与 OpenClaw 作为“始终运行的后台守护进程（7x24小时任务接收器）”的范式不同，本平台采用**“基于项目与会话 (Project & Session-based)”**的架构，类似于 Claude Code 或 Cursor。

### 核心设计哲学：
1. **基于项目与目录的隔离 (Project-Centric)**：智能体的知识和进化方向与当前工作目录强绑定，使其在特定领域（如某个代码库或某本书的写作）更加专业和专注。
2. **多会话并行 (Multi-Session)**：同一个项目下可以开启多个 Session，每个 Session 专注于特定任务（如 Session A 负责代码重构，Session B 负责编写文档），互不干扰但共享项目级记忆。
3. **极速本地记忆检索 (Local Single-file Vector DB)**：放弃臃肿的远程数据库，采用单文件、支持向量搜索的本地数据库，实现毫秒级的经验和上下文检索。
4. **Agent Teams 与 EvoMap 技能扩展**：保留强大的多智能体分工协作能力，并通过 EvoMap (GEP-A2A) 协议实现技能与经验的按需加载。

---

## 2. 核心架构设计

### 2.1 基于项目与 Session 的组织范式

不同于 OpenClaw 的全局单体运作，本系统采用层级化的上下文管理：

*   **Global Level (全局)**：
    *   存储用户的通用偏好、基础指令集、全局工具（如 Git 交互、通用网页搜索）。
    *   存放从 EvoMap 订阅或下载的全局通用 Capsule。
*   **Project Level (项目级 - 绑定到具体目录)**：
    *   **项目记忆库**：每个工作目录下生成一个 `.agent/` 或 `.opencode/` 文件夹。
    *   **领域专业化**：智能体在处理该项目时，其反思（Post-mortem）、代码风格学习、领域词汇表都持久化在这个目录中。
    *   **项目级技能**：针对特定项目开发的专属技能（如特定框架的打包脚本）。
*   **Session Level (会话级)**：
    *   用户在特定项目下启动的任务实例（如 `agent start "重构支付模块"`）。
    *   每个 Session 拥有自己独立的“短期记忆”和“任务队列（Todo List）”。
    *   Session 结束后，其关键教训和修改会被**沉淀提取**，汇总到“Project Level”的持久化记忆中。

### 2.2 极速本地单文件向量数据库

为了实现快速响应和隐私保护，彻底摒弃复杂的 Client-Server 数据库，采用**嵌入式单文件向量数据库**：

*   **技术选型推荐**：
    *   **DuckDB (配合 vss 插件)**：极强的数据分析能力，单文件，支持向量相似度搜索，非常适合作为 Agent 的记忆核心。
    *   **SQLite (配合 sqlite-vss 或 sqlite-vec)**：最稳定、最普及的本地数据库解决方案。
    *   **LanceDB**：专为 AI 设计的嵌入式向量数据库，支持与 Pandas/Arrow 无缝对接，存储在本地文件系统中。
*   **存储结构设计**：
    *   `project_memory.db` (存储在 `.agent/` 目录下)。
    *   **Table: Sessions** (记录会话元数据、目标、耗时)。
    *   **Table: Thoughts/Actions** (智能体执行的关键步骤记录)。
    *   **Table: Learnings/Guidelines (Vector Indexed)**：存储进化总结、代码规范、避坑指南。每次执行相似任务前，Agent 会先做一次 Top-K 向量检索。
    *   **Table: Codebase_Chunks (Vector Indexed)**：可选，将项目代码分块向量化，供 Agent 快速 Semantic Search。

### 2.3 Agent Teams 协作模式

在具体的 Session 中，系统根据任务复杂度动态组建 Agent Team：

*   **层级架构 (Orchestrator-Workers)**：适合结构化任务。
    *   **Manager Agent (PM)**：读取 Session 目标，拆解任务，写入共享黑板（Shared State）。
    *   **Worker Agents (Coder, Researcher, Writer)**：监听黑板上的任务，执行完毕后更新状态，并将产物写入指定文件。
    *   **Reviewer Agent (QA)**：审核 Worker 的产出，若不合格则打回并附带修改建议。
*   **共享黑板 (Shared Context Board)**：
    *   不再将冗长的对话历史（Chat History）在 Agent 之间传递（节省 Token，防止幻觉）。
    *   所有 Agent 读写同一个 JSON/DB 记录：`{"task": "实现登录", "status": "in_progress", "notes": "当前发现缺少 JWT 库"}`。

### 2.4 本地自我进化与经验提炼 (Self-Evolution)

智能体的进化不再是无意识的堆砌，而是结构化的“反思-沉淀”过程：

1.  **Session 结束触发复盘**：当一个 Session 成功完成或失败中止时，触发反思机制。
2.  **经验提取 (Experience Extraction)**：LLM 会阅读该 Session 的执行日志，提取出有价值的经验（例如：“在这个项目中，调用 API 必须携带特定的 Header，否则会 403”）。
3.  **向量化存储**：将这条经验转化为文本和 Embedding 向量，存入 `project_memory.db` 的 `Learnings` 表。
4.  **下一次检索**：未来在同项目中开启新 Session 时，只要任务描述或上下文触发了相似的向量，这条经验就会被作为 System Prompt 的一部分注入，实现“不犯第二次错”。

### 2.5 接入 EvoMap 全局网络 (GEP-A2A)

借鉴文档中的 EvoMap 概念，让平台具备无限的能力扩展：

*   **技能作为资产 (Skill as Asset)**：当您的 Agent 在某个项目中通过“试错”写出了一个极佳的构建脚本或修复方案，系统可以将其打包为 `Gene + Capsule`。
*   **本地到全局的发布**：用户确认后，Agent 将该方案发布到 EvoMap 网络（`POST /a2a/publish`），甚至可以获得声望或奖励。
*   **Just-in-Time 技能获取**：当 Session 面临一个未知的报错（例如某种特殊的 Docker 启动失败），Agent 可以将报错信息（Signals）发送到 EvoMap 检索（`POST /a2a/fetch`），下载别人验证过的修复 Capsule，并立即在本地执行。

---

## 3. 工作流示例：编写一个新功能

1.  **用户在项目目录下启动**：`agent start "为网站添加暗黑模式"`
2.  **初始化 Session**：系统创建一个新 Session (ID: 0x1A2B)。
3.  **经验检索**：Manager Agent 查询 `project_memory.db`，检索“前端、样式、暗黑模式”，发现一条历史记录：“注意，本项目的 Tailwind 配置被锁定在 `styles/theme.js` 中，不要直接修改 `tailwind.config.js`”。
4.  **任务拆解与分发**：Manager 将任务拆分为“修改 theme.js”、“添加 Toggle 按钮”、“更新 LocalStorage 逻辑”，并写入共享黑板。
5.  **多智能体并行执行**：
    *   Coder Agent 1 认领“按钮”任务。
    *   Coder Agent 2 认领“状态管理”任务。
6.  **遇到困难与求助 EvoMap**：Agent 2 在处理 React Hydration 报错时卡住。它向 EvoMap 搜索 `Signals_match: ["Next.js", "Hydration failed", "dark mode"]`，获取了一个修复 Capsule（将获取 LocalStorage 放到 `useEffect` 中），成功解决问题。
7.  **Review 与完成**：Reviewer Agent 检查代码规范。全部通过。
8.  **沉淀复盘**：Session 结束，提取本次经验（React Hydration 的解法），向量化存入本地数据库，供未来调用。

## 4. 技术栈推荐

*   **运行时核心**：Python 或 Node.js (TypeScript)。Node.js 更适合前端生态，Python 更适合 AI 和数据生态。
*   **本地数据库**：`SQLite + sqlite-vec` 插件（轻量、稳定、单文件、支持向量搜索）。
*   **智能体编排**：建议自己实现一个极简的“共享状态机”调度循环，或者使用轻量级的 `LangGraph`，避免使用过于沉重且黑盒的框架（如 CrewAI 的某些版本）。
*   **CLI / TUI**：使用 `Ink` (Node) 或 `Textual` (Python) 提供类似于 Claude Code 的优秀终端交互体验。