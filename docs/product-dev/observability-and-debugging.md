# 多智能体协作平台：可观测性体系与调试工具链设计 (Observability & Debugging)

在多智能体系统（Multi-Agent System）中，AI 的黑盒特性会导致难以排查的“幽灵 Bug”（例如 Agent 陷入死循环、拿到了错误的文件上下文、或者因为格式错误不停重试）。为了支撑大规模的项目落地甚至商用，必须在核心架构中内置极其完备的**开发模式（Dev Mode）**、**可观测性日志（Observability）**与**调试面板（Debug Tools）**。

---

## 1. 全链路可观测性日志体系 (Traceability Logs)

当开启 `--dev` 或 `DEV_MODE=true` 时，底层引擎不再只是向终端输出类似“Thinking...”的简陋动画，而是将所有 Agent 的行为抽丝剥茧。

### 1.1 结构化多维日志流 (Structured Log Streams)
为了方便排查，日志内容必须按照角色与阶段进行分级和打标：
*   **[LLM Payload Trace]**：在每次向 OpenAI/Anthropic/Ollama 等 Provider 发起网络请求的前后，全量打印 `Raw Prompt`、`Tool Schema` 以及原始返回的 JSON。这是排查“大模型到底看没看到这个工具”的唯一途径。
*   **[ACI Execution Trace]**：记录底层 Agent-Computer Interface 所拦截的动作。例如：`[ACI] Agent-Coder 尝试 WriteFile /src/app.js (Hash: xxxxx) -> [Result] 拦截：文件并发已被修改`。
*   **[LSP / Linter Trace]**：记录本地诊断工具对 Agent 草稿代码的拦截结果。例如：`[LSP-Guard] Syntax Error at line 42 -> Sent back to Agent`。
*   **[Token & Cost Metrics]**：实时计费侧写。每次交互必须伴随输出该次交互耗费的 Prompt Tokens、Completion Tokens，以及累积消耗（美元/人民币估算），方便开发者找出“Token 刺客”。

### 1.2 日志持久化与时间漫游 (Log Archiving)
*   **专用调试日志舱**：所有的 Dev Log 全部以 `.jsonl` 格式按时间戳或 Session ID 分离存放在 `.agent/logs/` 目录下。
*   **重播与断点机制 (Replay & Checkpointing)**：基于这套详尽的日志结构，在后续版本中，可以为平台开发一个 `Replay` 工具。开发者载入某个崩溃的 Session Log，系统一步步还原当时的黑板状态，帮助分析哪一步 Agent 开始“发疯”。

---

## 2. 可视化调试面板与开发者工具 (DevTools for Agents)

对于如此复杂的系统，纯文本日志依然让人眼花缭乱。需要在系统自带的 Web GUI 或者 TUI 中嵌入一个专门的 **“Developer Tools”**（类似 Chrome 的 F12 面板）。

### 2.1 状态检视器 (State Inspector)
*   **共享黑板监控 (Blackboard Monitor)**：实时展示内存中/定制压缩文件里当前 Session 的树状状态。包括：所有正在运行的 Subagents、目前已激活（Active）的文件列表、当前解析出的 Todo List 等。让开发者对系统到底挂载了多少上下文一目了然。

### 2.2 工具调用游乐场 (MCP/Skill Playground)
*   **模拟沙盒**：由于很多 MCP 工具或本地 Skill 可能编写有误，导致大模型无法调用。系统中应提供一个独立于 LLM 的 CLI 工具或界面，允许人类开发者直接手工模拟输入 JSON Payload 去调用特定的 Skill。这是隔离验证“是模型太笨不会用”还是“这个工具的返回本身就挂了”的最佳实践。

### 2.3 提示词与预处理审计 (Prompt Audit Window)
*   在前端界面，除了给用户看的 UI 对话外，增加一个隐藏的 `[</> View Raw Context]` 按钮。点击后完整呈现：经过了 `@` 抽取、经过了 Turso 记忆提取后，最终究竟拼接出了怎样一坨几万字的 System Prompt 喂给了大模型。

---

## 3. 防崩塌死循环熔断器 (Infinite Loop Circuit Breaker)

*   **最大尝试次数阈值 (Max Retries & Tool Call Depth)**：Agent 在修复 Linter 报错或执行某些工具时，极易左右互搏（尝试 A 失败 -> 尝试 B 失败 -> 再尝试 A）。底层引擎必须设置硬性阈值（例如 `MAX_TOOL_LOOP=5`）。一旦触达，系统立刻 Throw Error 并在终端打印血红色的 `Circuit Breaker Triggered: Too many continuous failures.`，并将控制权交还给人类。
