# 多智能体协作平台：对话框富交互架构与语法设计 (/, @, #)

在基于文本与多智能体交互的平台中，单纯的自然语言输入不足以精细化控制大模型的**上下文（Context）**、**工具挂载（Tools）**和**运作模式（Modes）**。深度对标 Cursor、GitHub Copilot Chat 以及 Aider 等业界顶尖的 AI IDE 体系，我们需要在会话输入框（Chat Input）中实现一套基于特定前缀 (`/`, `@`, `#`) 的操作符语法。

本文档用以指导平台前端输入框（TUI 或 Web GUI）的解析引擎设计以及后端状态机对接。

---

## 1. 核心交互语法定义

这三种控制符号在职责上有着明确的边界划分：
*   `/` (Slash) -> **改变行为与执行特定指令 (Action & Mode)**
*   `@` (At) -> **注入显式上下文与定向路由 (Context & Routing)**
*   `#` (Hash) -> **引用抽象实体与符号记录 (Abstract Reference)**

### 1.1 `/` (Slash Commands) - 行为/模式修饰符
斜杠命令主要用于跨过大模型的不可控性，直接指示本地调度系统改变当前 Session 的状态，或者强制 Agent 遵守某种特定的输出模式。

**落地设计建议**：
*   **模式切换**：
    *   `/ask <question>`：强制 Agent 仅进行问答，绝对不要使用 EditFile 去修改代码。
    *   `/plan <task>`：强制进入架构规划模式，仅输出结构化的任务拆解清单。
    *   `/execute` 或 `/do`：直接允许 Agent 拿到最高终端权限开始自主执行。
*   **平台内建指令**：
    *   `/clear`：切断当前 Session 的长对话，强行序列化生成快照并开启一个干净的 Context。
    *   `/summarize`：在长线任务中调用，命令本地引擎将上文百条对话压缩为一段核心记忆。
    *   `/undo`：触发系统的底层 Git / ACI Diff 回滚操作，丢弃上一次 LLM 的代码编辑。
    *   `/test`：不与 LLM 聊天，直接让本地系统跑一遍当前文件的单元测试并把报错载入对话框。

### 1.2 `@` (Mentions) - 命名空间联想与显式上下文注入
这是 AI 编程工具中使用频率最高的交互。它允许用户用极低的成本，**“强行”**把本来没在 Agent 视界里的文件、人或工具拽入当前会话。

为了处理海量的潜在选项，我们深度参考 Antigravity 等顶级系统的设计，**为 `@` 引入“基于命名空间的级联悬浮菜单 (Cascaded Namespace Dropdown)” 与严格的触发防误判逻辑**：

*   **防误触触发器**：`@` 符号只有在其**前面是一个空格，或者是位于输入行首**时（如 `帮我找一下 @...`），才会触发系统的拦截面板。如果紧跟在英文字符后（如 `user@email.com`），将被当做纯文本无视。

*   **第一级分类菜单 (Top-Level Categories)**：当有效敲下 `@` 之后，输入框上浮呈现系统的第一级分类（Category），包括不仅限于：`Files`, `Directories`, `Code Context Items`, `Terminal`, `Conversation`, `MCP Servers`, `Skills` 以及 `Agents`。

*   **级联选择与冒号命名空间 (`@namespace:value`)**：
    1. **技能与 MCP 按需外挂**：当用户在下拉列表中选择 `MCP Servers` 后，输入框的字符将自动补全为 `@mcp:`。
    2. **二级精确过滤**：此时，悬浮菜单会变成二级列表，展示所有可用的服务器。如果你继续输入或选择 `browsermcp`，最终在输入栏落锤的标签将转化为 `@mcp:browsermcp:`。后台根据该特殊标签将其 JSON Schema 塞入上下文。（注：如果是 Subagent，则是类似 `@agent:FrontendExpert`）
    3. **物理与状态节点挂载**：对于其余的第一级分类也是同理（如 `@file:src/math.ts`, `@terminal:recent`, 或指代长对话记忆历史的 `@conversation:last`.系统直接在底层去抽取相关的流转换源。

### 1.3 `#` (References) - 抽象记录与语义符号引用
如果说 `@` 是挂载具体实体，那么 `#` 则是连接业务流、云端数据或者代码抽象语法树（AST）中特定节点的纽带。

**落地设计建议**：
*   **云端与系统实体引用**：
    *   `#123`：自动调用 MCP 抓取 GitHub 或 Jira 上 Issue `123` 的标题、报错内容及描述，注入系统提示词。
    *   `#PR-45`：引用特定 Pull Request 的 Diff 详情。
*   **代码级符号引用 (Symbol Reference)**：
    *   `#calculateTotal` 或 `#AuthService`：结合前面已设计的 LSP 底座，前端解析到该特殊符号时，去本地检索库里把 `calculateTotal` 的**函数签名、文档注释以及它附近的上下文**切片提出来送给大模型，而不是把整个几千行的文件都送过去。
*   **终端与报错实体**：
    *   `#terminal` 或 `#errors`：直接把最近 50 行的 Terminal 崩溃日志，或 LSP 报错看板里的信息抓出来作为入参。

---

## 2. 前后端工程实现架构思考

在代码实现层面，这些富文本交互绝不能纯图省事直接当成 String 发给 OpenAI，这会让模型一头雾水。必须要在**前端解析与后端预处理拦截器**上做文章。

### 2.1 UI 层的 Tokenizer 与悬浮补全
*   **输入框体验 (Omnibar TextInput)**：当用户键入 `/`, `@`, `#` 的瞬间，前端必须触发相应的 Auto-complete 悬浮面板（类似于 IDE 里的代码补全）。
*   **实体化 (Entity Tag)**：当用户选中了 `@src/main.rs`，这在输入框里不应该只是普通的字符串，而应变成一个不可修改中间字符的“药丸（Pill / Tag）”组件。这代表它是一个明确的物理资源。

### 2.2 Controller 预处理引擎 (Pre-processing Engine)
用户的请求 `发送` 后，首先进入本地的 **Pre-processor** 机制。
设想用户输入：`@agent:CodeReviewer 请帮我修复源自 #102_Issue 里的问题，核心报错代码在 @file:src/order.js 的 #submitOrder`。

拦截器解析流水线 (Pipeline)：
1.  **解析 Routing 命名空间**：发现 `@agent:CodeReviewer`，不再走主干模型，动态挂载 CodeReviewer 的系统提示词 (Persona)。
2.  **解析 Fetchers / Pointers**：
    *   遇到 `#102_Issue`，异步调用相关脚本/MCP 抓取 Issue 正文。
    *   遇到 `@file:src/order.js`，读取该物理文件。
    *   遇到 `#submitOrder`，利用 LSP 或 AST 定位 `submitOrder` 在 `order.js` 里的起止行号，精确只截取这 30 行。
3.  **拼装 Payload 对象**：
    将上述所有异步获取的数据，结构化地**包裹在特定 XML/Markdown 标签中**，安插在发往大模型的 Payload 头部，最后附上用户指令：“请帮我修复...”。
    *(参考格式：`<context_file name="src/order.js">...</context_file>`)*

### 2.3 消灭对话冗余 (Token Optimization)
引入这一套语法体系的终极目的还是**节省 Token 并且明确大模型的目标**。通过精准使用 `@` 和 `#` 获取行级片段，以及使用 `/` 指定确定的状态路线，我们可以避免 Agent 发散式地调用 `glob`、`read_file` 去海捞针，从而真正打造出极速互动的 AI 开发体感。
