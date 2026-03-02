# 多智能体协作与自进化平台：全局系统架构设计与演进考量

在构建一个以“终极目标”为导向的复杂平台时，功能（Feature）可以逐步迭代，但**系统架构必须在 Day 1 就具备全局视野与高度的可扩展性（Extensibility）**。如果初期架构与特定的大模型（如 OpenAI）强绑定，或与特定的状态流转方式强绑定，未来在引入新的模型（如 Gemini、Claude）、新的任务类型（信息抓取、UI生成）或新的交互界面时，将面临极其痛苦的重构底座的梦魇。

本架构设计遵循**六边形架构（Hexagonal Architecture / 端口与适配器模式）**和**插件化（Plugin-based）**设计思想，确保系统各层极度解耦。

---

## 1. 全局架构蓝图 (Global Architecture Blueprint)

系统自上而下分为 5 个核心层级。相邻层级仅通过标准接口（Interfaces）通信，跨层级调用被严格禁止。

```text
+-------------------------------------------------------------+
|               [Layer 1: 表现与交互层 (Presentation)]        |
|  (CLI / TUI / Electron GUI / WebUI / VSCode Extension)      |
+-----------------------------+-------------------------------+
                              | (WebSocket / JSON-RPC)
+-----------------------------v-------------------------------+
|               [Layer 2: 任务编排与发现层 (Orchestration & Discovery)]|
|  - 前置意图路由 (Router)    - 动态技能检索 (Tool RAG Search)|
|  - 共享黑板 (Shared Board)  - 上下文组装与截断引擎          |
+-----------------------------+-------------------------------+
                              |
+-----------------------------v-------------------------------+
|               [Layer 3: 智能体与工具运行时 (Runtime)]       |
|  - Manager/Subagents 挂载   - ACI (读写防爆墙/LSP检测)      |
|  - MCP 主机系统 (延迟注入)  - Markdown Skill 解析器         |
+-----------------------------+-------------------------------+
                              |
+-----------------------------v-------------------------------+
|               [Layer 4: AI 模型抽象网关 (Model Gateway)]    |
|  << Interface: ILLMProvider >>  (统一 Stream 与 Tool 语法)  |
|  [OpenAI API]  [Anthropic]  [Google Gemini]  [Ollama/vLLM]  |
+-----------------------------+-------------------------------+
                              |
+-----------------------------v-------------------------------+
|               [Layer 5: 基础设施与存储介质 (Infrastructure)]|
|  - Turso DB (知识与向量)    - 定制化高压二进制 (临时态)     |
|  - .agent 配置文件持久化    - 磁盘物理文件系统与沙盒Pty     |
+-------------------------------------------------------------+
```

---

## 2. 核心模块重度解耦与扩展性考量 (Extensibility Design)

### 2.1 Layer 4: AI 模型抽象网关 (Model Gateway)
目前各大厂商的 API 在流式返回（SSE 格式）、工具调用（Tool Calling / Function Calling）和角色定义（System vs User vs Developer 指令）上差异巨大。**绝不能在业务代码中出现 `if (provider === 'openai')`。**

*   **设计解法：统一大语言模型接口 (`ILLMProvider`)**
    所有接入的模型必须实现系统的标准接口。网关内部将各大厂商的异构数据抹平：
    1.  **统一输入 (`StandardPrompt`)**：上层传入包含系统设定的结构化 Prompt 对象和平台内部 `JSON Schema` 的 Tools 列表。
    2.  **适配器转译 (Adapter Engine)**：
        *   **OpenAI Adapter**：将标准 Tools 转换为 `tools: [{type: "function"}]`。
        *   **Anthropic Adapter**：将标准 Tools 转换为 `<tool>` XML 标签，并将 System 信息单独剥离放到请求顶层。
        *   **Gemini Adapter**：转换其特有的 `functionDeclarations` 结构。
    3.  **统一流式输出 (`StandardStreamChunk`)**：将 OpenAI 的 `delta`、Claude 的 `content_block_delta`、Gemini 的流式块，统一封装为 `AgentMessageEvent({ type: 'text' | 'tool_call', data: '...' })`。
*   **扩展性考量**：未来如果出了类似于 `DeepSeek` 或全新的模型接口，只需新建一个 `DeepSeekAdapter` 类实现 `ILLMProvider`，注册进 Factory 即可，上层的 Session、Agent 及工具调度代码**一行都不需要改**。

### 2.2 Layer 3 & Layer 2: “万物皆 RAG”——工具描述的向量化与延迟注入 (Everything as RAG & Lazy Tool Injection)
如果系统内挂载了上百个业务技能（搜网页、查 Jira、连数据库、读飞书），传统的做法是在会话启动时将所有的 Tool Schema JSON 全部塞进上下文，这会导致巨大的 Token 浪费，乃至直接把大模型撑爆，且非常容易引发“幻觉调用”。

*   **设计解法：工具即知识 (Tool as Knowledge) 与大沙盒按需加载**
    架构设计在这一层打破了“知识”和“工具”的界限。我们**将所有的 MCP Server 定义与 Skills 配置档，彻底纳入系统的 RAG (Retrieval-Augmented Generation) 体系中**：
    1.  **静态/闭环能力常驻**：平台始终仅把危及架构核心流转的 **ACI 基础工具（ReadFile带行号、EditFile防并发、CLI沙盒执行）** 常驻在上下文中。
    2.  **原生结构化目录与本地 Raw 检索 (Local Raw Retrieval)**：抛弃将技能说明强行封装进向量库的繁重做法。平台严格遵循现代行业规范的目录结构，将每个技能封装在 `.agent/skills/<skill-name>/SKILL.md` 文件中。系统不再做冷封存 Embedding，而是直接在内存中建立一个基于这些 `SKILL.md` 头部 YAML Frontmatter 以及 MCP 配置文件描述的轻量级 Raw 索引，实现无状态的动态查询。
    3.  **双轨激活机制 (Dual-track Activation)**：
        *   **主动显式检索 (User Prompt Namespace Routing)**：采用具有命名空间的前置拦截器，如 `@mcp:` 或 `@skill:`。当用户在输入框打出 `@mcp:` 并悬停（不输入后缀）时，前端 UI 将根据类别展示所有可用的列表内容框，允许用户上下滚动选择；若直接输入打出 `@mcp:finance-mcp: 帮我看看股票` 或 `@skill:pet-video: 开始写分镜` 时，拦截器将直接根据请求挂载这些组件。
        *   **被动启发式扫描 (Heuristic Keyword/Semantic Search)**：当用户仅给出泛型需求（如：“帮我查下这周纳斯达克的指数”），Layer 2 的 Router 利用内存里的 Raw 索引进行高速比对。底层甚至仅凭关键词命中，就能发现并定位到 `finance-mcp` 这个底层资源模块。
    4.  **延迟热启动注入 (Lazy Injection & Raw File Read)**：无论是哪种轨迹命中了工具，底层的运行主机此时才会真正拉起通信，或者利用本地 **File System (I/O)** 即时去读取被选中的那个 `SKILL.md` 完整的提示词与能力定义，并临时组合拼接到发往大模型网关的请求 Payload `tools: []` 中。并在推演结束后予以卸载。
*   **扩展性考量**：这一“将工具抽象为检索召回内容 (Retrieve Tools via RAG)”的系统级机制彻底解除了框架对“工具库上限”的恐惧。平台变成了一套具备“无限挂载槽”且基础消耗极低的运行时（Runtime）。

### 2.3 Layer 2: 协作与调度的状态机引擎 (State Machine Orchestration)
业务逻辑不能跟聊天输入框强绑定。用户说一句，大模型回一句，再调个工具说一句，这种“死循环式”的执行流一旦遇到复杂任务一定会状态崩溃。

*   **设计解法：基于事件与状态的数据总线 (Event-Driven Blackboard)**
    *   引入一个在本地内存/压缩存储中运转的**状态流转机 (State Machine)**。
    *   Agent 不再直接控制聊天框。Agent 的每次推理结果（如计划了一批任务），是去**修改黑板总线上的 JSON 数据结构**。
    *   Manager 观察黑板数据的变化，决定是挂起自己唤醒 Subagent（如 Coder），还是认为任务结束向人类汇报。
*   **前沿实验性补充：群组化兵团 (Agent Teams)**
    紧跟 Anthropic 等大厂提出的并行体系理念，平台状态机额外支持 **Orchestrator-Worker 团队模式**。当遇到巨型需求（如：从头写一个 C 编译器或分析跨部门全年财报），不再是单线接力，而是拉起一个 `@CompilerTeam` 团队群组。该团队的 Lead Agent 直接把任务并行发给底层的数据库专家、画图助手、文档专家等 Worker Agents；总线支持汇总这些并行返回的数据流，极大提升任务天花板。
*   **扩展性考量**：未来要增加新的并发 Agent 角色（如增加一个专门审核漏洞的 SecurityAgent），只要让它订阅黑板上的 `[Code_Modified]` 事件即可。它和原来的 Coder Agent 在代码级完全解耦。并且基于 Agent Teams 的预留，平台具备了无限提升并发解决复杂能力任务的上限潜能。

### 2.4 Layer 1: 交互界面的无头化支持 (Headless Architecture)
如果您一开始用在终端 (CLI) 里打日志的方式开发，未来要加 GUI 或做成 VS Code 插件时，会发现表现层和逻辑层死死缠绕。

*   **设计解法：完全基于 RPC 协议的前后端分离**
    *   底层的多智能体引擎作为后台守护进程 (Daemon) 运行，暴露标准的 WebSocket 或 Local REST API。
    *   终端 CLI (如 Ink/Ratatui)、桌面 GUI 客户端 (如 Electron/Tauri) 或者 VS Code Webview 仅仅是前台“渲染器”。它们通过事件流（Event Stream）监听 `[Terminal Output]`, `[Agent Thinking]`, `[Diff Proposed]` 请求并呈现。
*   **扩展性考量**：这是打造一流产品的关键。您可以先开发一个极简的 CLI 跑通所有逻辑。到了 P3 阶段要开发酷炫的“类似 Cursor 悬浮窗选区抽取”功能时，只需开发全新的 UI 连接到原有引擎监听事件，而引擎内部对 UI 是毫不关心的。

---

## 3. 架构韧性与自我演化的底层预留 (Resilience & Evolution)

除了应对功能增长，架构还需考虑应对“错误”以及实现“自进化”：

### 3.1 防腐层兜底与安全沙盒模式 (Anti-Corruption Layer & Execution Modes)
系统核心层（业务引擎、本地文件防并发、CLI 执行环境）与 LLM 之间必须拥有一层防腐墙。无论某个开源模型返回了多么荒谬的语法树或者非标准的参数，都可以被 ACL 自动拦截重试。
**重点借鉴 Xagent (xorbitsai) 的前沿底层沙盒设计**，我们在这一层为 ACI 工具链注入了 5 个级别的**强制执行沙盒模式 (Execution Modes)**：
1. **SMART 模式 (推荐推荐)**：引入三级智能审批。
    * 第一级：白名单直通 (Whitelist) - 如 `read_file`, `git status` 这种绝对安全的读操作系统允许 Agent 自动跑。
    * 第二级：黑名单阻断 (Blacklist) - 诸如 `rm -rf`, `DROP TABLE` 强制拦截，抛出审批对话框让人类确认。
    * 第三级：AI 二次审阅 (AI Review) - 对于未知的命令或带有高风险参数（如更新云端配置），引擎启动一个轻量级的二次审阅模型来进行交叉判定。
2. **DEFAULT 模式**：所有修改系统的行为（Write, Command）都需要人类点击一次 Approve。
3. **PLAN 模式**：Agent 必须先发出一份长期的 Plan（使用内部标记 `<plan>`），一旦制定不许修改，严格按部就班执行避免跑偏。
4. **ACCEPT_EDITS 模式**：约束大模型的修改仅限于编辑现有文件，剥夺新建目录或执行 Shell 命令的权限。
5. **YOLO 模式 (You Only Live Once)**：彻底放权。Agent 在没有任何人类拦截的情况下执行一切命令（仅限于极其确信自身代码隔离在远端沙盒时的终极自动化跑批任务）。

### 3.2 Telemetry 与经验萃取勾子 (Hooks)
    在系统的请求发往网关之前与收到结果之后，预留 `middlewares` 或 `hooks`（如 `onSessionComplete`, `onActionFailed`）。
    未来实现“EvoMap 知识胶囊提取”机制时，只需挂载一个后台处理函数在 `onSessionComplete` 事件上，去遍历这次 Session 的状态录像，然后计算生成的向量写入 Layer 5 的 Turso DB。主平台逻辑毫不知情。

## 4. 总结

凭借这套 **接口标准化网关 (Provider Agnostic)** + **黑板事件总线 (Event-Driven Blackboard)** + **无头守护进程 (Headless Daemon)** 的现代六边形架构：
您的研发可以在早期专注打磨“单个引擎+单一模型”的闭环；而在未来的生命周期中，无论是接入千奇百怪的模型 API，还是无限增加的子任务智能体，或是更炫酷的客户端形态，这座架构大厦都能够稳如泰山地通过“横向扩展插件”接纳它们，避免了牵一发而动全身的重构灾难。
