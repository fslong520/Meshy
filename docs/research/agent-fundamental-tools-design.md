# 多智能体协作平台：Agent 基础工具集 (ACI) 架构与实现指南

## 1. 核心理念：Agent-Computer Interface (ACI)
在多智能体协作平台中，单纯赋予大语言模型（LLM）“终端执行权限”是远远不够的。为了让 Agent 安全、高效地理解和修改代码库，必须在 LLM 和底层操作系统之间构建一层专门优化的**智能体-计算机接口 (Agent-Computer Interface, ACI)**。

本指南脱胎于对 Aider、SWE-agent 和 OpenHands 最佳实践的深度调研，详细定义了 Agent 必备的五大基础能力（Read、Edit、Write、Search、AskUser）以及它们在工程上的容错与协同机制。

---

## 2. 基础能力设计规范

### 2.1 增量式与定位读取 (Read)
**痛点**：全量读取一个 2000 行的文件会瞬间消耗巨量 Token，并导致 LLM 注意力涣散（Lost in the middle）。
**能力设计：**
- **Action**: `ReadFile(filepath, start_line?, end_line?)`
- **控制逻辑**：
  1. **按行截取**：允许 Agent 提供行号范围进行精确读取。
  2. **强制分页（防爆机制）**：即便 Agent 未提供行号，底层 API 在遇到超过 500 行的长文件时，也自动强行截断，并在输出尾部提示 `[Warning: File truncated at line 500. Read from line 501 to see more.]`。
  3. **自带行号输出**：返回给 LLM 的文件内容**必须强行附带行号**（如 `12: function init() {`），这是后续执行 Edit 能力的核心基石。

### 2.2 搜索与替换块式的编辑 (Edit)
**痛点**：早期的 Agent 喜欢重写整个文件（Whole-file rewrite），极其缓慢且容易吞掉用户其他逻辑。
**主流最佳实践 (Search & Replace Blocks) 的能力设计：**
- **Action**: `EditFile(filepath, target_content, replacement_content, start_line?, end_line?)`
- **控制逻辑**：
  1. **禁止直接重写全文件**：如果是既有文件的修改，强制 Agent 使用 Search/Replace 范式。
  2. **精准与模糊匹配 (Fuzzy Match)**：Agent 提供的 `target_content` 经常在缩进、换行上与本地文件出现极小偏差。平台需在严格字符串匹配失败时，通过去除两端空白字符或计算 Levenshtein 距离提供一定的模糊匹配容错。
  3. **多点并发修改 (Multi-block Replacing)**：允许 LLM 在一次 Action 中返回一个包含多个 `[SEARCH], [REPLACE]` 块的 JSON 数组，底层顺序执行，避免为了改三个小地方而耗费三次交互循环。
  4. **并发防腐屏障 (Race Condition Guard)**：在执行 Edit 前，必须对比此刻该文件的 Hash 值与 Agent 视野里该文件的 Hash 值。如果用户或其他 Agent 刚刚修改了该文件，必须阻断本次 Edit 并抛出异常："File modified externally. Please read again."，强制 Agent 重新 Read。

### 2.3 文件创建与覆写 (Write)
- **Action**: `WriteFile(filepath, content, overwrite=False)`
- **控制逻辑**：与 Edit 区分开。此工具专门用于创建全新的文件。如果 `overwrite=False` 且文件已存在，则报错并提示 Agent 使用 `EditFile` 工具。这强制区分了“生成新模块”与“修改老逻辑”的思维流。

### 2.4 主动求助机制 (AskUserQuestion)
**痛点**：Agent 在遇到模糊需求、缺失密码凭证、或尝试了多次构建依旧失败时，容易陷入无休止且耗费代币的“死循环”。
- **Action**: `AskUserQuestion(question, context, is_blocking=True)`
- **控制逻辑**：
  - 发送信息到控制台或前端界面，并将该 Agent 的状态挂起（Suspended）。
  - 若 `is_blocking=False`（通常在多 Agent 协作时），Agent 可以去执行 Todo 列表里的其他任务，等用户回答后再回调继续当前任务。

---

## 3. 编辑协同与安全防线 (Guardrails)

让大模型直接修改源码极其危险。参考 SWE-agent 的做法，需要在 ACI 层面部署安全屏障：

### 3.1 强制 "先读后改 (Read-Before-Edit)"
平台内核中需维护一个 `Viewed_Files_Session_Cache`。
除非是全量复写，如果 Agent 试图调用 `EditFile` 修改 `src/utils.js`，但内核发现本次 Session 中并未发生过对 `src/utils.js` 的 `ReadFile` 或 `Search`，底层直接拒绝执行该能力，并反馈：*“You must view the contents of the file before editing it.”*

### 3.2 语法护栏 (Linting Guardrail)
1. **沙盒修改 (Draft mode)**：`EditFile` 被调用后，首先在内存或 `.tmp` 目录下生成变更文件。
2. **后置校验**：触发项目适配的 Linter 工具（如 ESLint, Pylint, rustc --check）。
3. **闭环反馈**：验证通过才真正落盘；如果存在语法错误（如少了一个括号），将 Linter 抛出的错误直接以内部反馈的形式丢回给大模型，让它自己调用 `EditFile` 修正它刚刚弄坏的块（Self-Correction）。

### 3.3 Diff 生成与版本追溯
所有的修改不能是破坏性的“无影手”。每次成功的 Edit 操作后，底层引擎应该立刻生成标准的 Unified Diff 文本。
这不仅方便用户通过 `/undo` 命令进行回滚，还可以直接记录并输入到大模型未来的 Prompt 中，作为其自身执行履历的反思语料。

---

## 4. 落地建议优先顺序

1. **核心第一步**：实现带行号输出的增量 Read，以及基于块替换的 Edit 工具。这直接决定了 Agent 会不会“乱删代码”。
2. **容错第二步**：为 Edit 添加模糊空白字符匹配（这是目前 Aider 解决大模型幻觉输出错位的核心魔法）。
3. **流程第三步**：引入 Linting Guardrail 防线和 “先读后写” 强制判定。
4. **协作第四步**：引入类似 Cursor 的流式询问 AskUserQuestion，打破 Agent 的黑盒自嗨，实现人类协作闭环。
