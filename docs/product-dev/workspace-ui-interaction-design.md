# 多智能体协作平台：Workspace UI 与沉浸式多模态交互设计

一个强大的底层边缘计算和 Agent 调度网关，如果缺乏一个现代化的工作台 UI (Workspace UI) 进行支撑，不仅大模型与环境的解耦感极强，开发者也会陷入“反复复制粘贴”的痛苦中。

深度对标 Cursor、Vscode AI 以及本地多智能体工具的交互痛点，本平台在设计可视化界面（GUI/TUI）时，需引入**“所见即所得的上下文挂载”**与**“多模态并行沙盒”**的 UI 理念，以此终结大模型开发中的“语境缺失”。

---

## 1. 所见即所得的上下文抽取 (Context Extracting UI)

大模型聊天框最大的问题是：让用户手敲描述特定的代码位置或终端报错。这既反直觉又极度浪费 Token。系统需要在 UI 层面实现类似 Cursor Cmd+L / Cmd+K 的理念。

### 1.1 编辑器高亮抽取 (Add Editor Selection to Chat)
*   **交互逻辑**：当用户在集成代码编辑器（Editor）中高亮选中一段代码，或悬浮在某个函数名上时，提供快捷键（如 `Ctrl/Cmd + L`）或悬浮按钮 `[Add to Chat]`。
*   **后端流转**：
    *   这个动作在底层绝不只是“提取了一段 String”。系统会提取一个包含 Metadata 的 Payload：`{ filepath: 'src/main.rs', lines: [45, 60], content: '...', symbol: 'initSystem' }`。
    *   在 Chat Box 中，这段代码会作为一个 **折叠的药丸组件 (Context Pill)** 渲染（例如 `src/main.rs:45-60`），确保输入框依然清爽。大模型发送请求时，这块信息会通过 XML 标签被包装在 System Context 内，精确指导 Agent 改哪里。

### 1.2 终端崩塌抽取 (Add Terminal Output to Chat)
*   **交互逻辑**：终端是排错的第一现场。当构建失败跑出一长串红字报错时，用户在 Terminal 面板圈选报错文字，按 `Ctrl/Cmd + E` (Explain/Error) 直接将该段终端输出引入 Chat。
*   **携带隐式环境变量**：与代码抽取类似，放入 Chat 的不仅仅是那段红字，引擎还会静默带上**“产生这个报错的 Shell 上下文”**（执行的究竟是 `npm run build` 还是 `cargo test`？当前 OS 的版本号是什么？）。从而让 Agent 无需发出愚蠢的追问就能直接给出复盘。

---

## 2. Multi-Agent 并发下的 Terminal 编排

与 Cursor 只有单个 AI 实体不同，在我们的系统中，由于具有 Manager/Coder/Researcher 甚至系统自动分配的 Linter Subagent，可能会出现**多个智能体并发执行多个构建、测试、或扫描任务。** 这对底层的 Terminal UI 管理提出了极高的要求。

### 2.1 任务绑定的沙盒化 Terminal PTY
如果让所有 Agent 把命令输出都乱拉在同一个全局 Terminal 中，不仅用户看不懂，Agent 读取自己输出时也会产生交错污染（Race Condition in Shell）。
*   **设计解法**：系统底层使用虚拟化终端协议（Virtual PTY）。每次 Agent 被 LLM Router 拉起执行一个新 Job，底层的系统为它拉起一个**专属的隐藏态 Terminal Panel**。

### 2.2 UI 呈现：TUI 级别的透明调度视窗
在界面的底部或右侧，设计一个专门的 **“Agent Activity Board (智能体活动控制台)”**：
1. **多标签/手风琴面板 (Accordion Panels)**：
   * 展示当前运行的智能体轨道。比如一行是 `[Researcher ⏳] Running: curl api.news.com`，另一行是 `[Linter 🟢] npm run lint: completed`。
2. **终端透视 (Terminal Peek)**：
   * 用户点击任意一个 Agent 轨道，即可展开它**专属的 Terminal Panel**。用户可以实时看到那个 Agent 敲打入命令、等待进度条、接收日志红绿字体的过程。
3. **人类干预按钮 (Intervention Controls)**：
   * 在每个专属 Panel 旁提供 `[Pause]`, `[Reject]`, `[Accept]` 甚至键盘夺权（直接在那个 Agent 的终端里替它打个 `Yes` 或输入密码）。这完全契合了我们在底层架构中设计的 `AskUserQuestion` 阻断机制。

---

## 3. Inline 极速编辑流 (Inline Quick Edit)

并非所有场景都需要通过长长的“对话面板”来实施修改。针对一些短平快的小重构（例如：为这段代码加上强类型），应当采用原地的悬浮组件。

*   **GUI / TUI 悬浮窗 (Floating Command Pallette)**：
    *   选中代码按快捷键（如 `Ctrl/Cmd + K`），直接在光标处弹出一个长度不到 40 像素高的极简 Input 框。
    *   用户输入：“把这个函数拆分成两个纯函数”。
    *   这不会在主 Chat 历史里留痕！在底层，这是开启了一个极轻量级的、短生命周期的 Session（Session Partitioning 的直观体现），由轻量级 LLM 快速生成 Diff。
*   **Diff 预览与确认 (Diff Review UI)**：
    *   无论是在主会话框指挥的重构，还是 Inline 的修改，底层大模型利用 `EditFile` 工具生成的变动，在真正落盘前，绝不在编辑器里直接“变魔术（瞬移重写）”。
    *   系统应通过本地 Git/LSP 能力，原地展示出**经典的左右或上下对比 (Green/Red Diff View)**。让用户只需点击旁边的 `[Apply]` 或是 `[Discard]`。这种安全感的满足，是 AI 转正为生产工具的最后一步。

---

## 4. 全局检索侧边栏与 File Explorer

因为我们的平台还负责各类非开发的“泛信息化任务”，系统不该只包含当前目录代码库。
*   **混合资源树 (Hybrid Tree View)**：左侧面板不应只挂载本地的文件目录（Local FS Explorer_），还要包括在这个 Workspace 中生成或导入的**外部记忆体 (Project Memory/Turso DB)**。
*   **资源拖拽**：用户可以将左侧的某个本地 PDF 报告文档，或是前置数据库里的某一个“EvoMap 历史报错胶囊”，像拖拽文件一样拖落进主对话框，底层实现自动转义为其对应的内容上下文，发起一轮新的多模态推演。
