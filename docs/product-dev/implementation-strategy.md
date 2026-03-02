# 多智能体协作平台：核心功能实现与模型兼容性设计

在构筑了一套极速的底层边缘计算逻辑与 L3 协同状态栈后，落到具体的工程实现层面，我们可以深度借鉴 **OpenCode、OpenWork (原 Accomplish) 以及 OpenClaw** 等前沿开源框架在“模型解耦、多级配置与子智能体管理”上的优秀工程范式。

为了加速项目开发并打造一个具备无限挂载能力（Provider-Agnostic）的生产力基座，本项目在底层实现策略上需遵循以下四个核心设计模式：

---

## 1. 多模型接口 (Multi-Provider) 的解耦与抽象

单一依赖 OpenAI 的平台在 2024-2025 年是非常脆弱的。为了像 OpenCode 一样实现 BYOK (Bring Your Own Key) 并做到模型路由，需要实现一套标准的 **Provider Interface**。

### 1.1 架构设计
- **统一网关 (Model Gateway)**：所有的 LLM 请求不直接发往具体 SDK，而是交给平台内部的统一网关。网关层面实现接口：`generateResponse(prompt, context, tools)`。
- **适配器模式 (Adapter Pattern)**：
  - 各大厂商（OpenAI O1/GPT-4o, Anthropic Claude 3.5, Google Gemini Pro 1.5, 以及本地的 Ollama/vLLM）作为具体的 Adapter 实现上述接口。
  - **流式返回的统一化**：底层必须将各大厂商各自独特的 SSE（Server-Sent Events）流式分块，全部映射为平台内部统一的 `AgentStreamChunk` 格式，保障上层前端/CLI 的渲染代码一行都不用改。

### 1.2 动态选型与自动降级 (Fallback)
- 上层任务路由经过判定后，可能本应交给 OpenAI。如果 OpenAI 返回 429 (Rate Limit) 或超时，网关层自动捕获该异常，并降级（Fallback）调用同等权重的 Claude 适配器继续任务，保证 Agent 的可靠性。

---

## 2. 工具调用的跨模型兼容层 (Tool & Skills Compatibility Layer)

不同的模型对外部工具（Functions / Tools / MCP Server）的支持力度差异极大。Gemini 或 Claude 可能自带某种基础能力（如代码运行、网页呈现），而本地 Ollama 则全靠我们给函数去调用。

### 2.1 技能声明与 Markdown-as-Code 架构
- **技能与工具的文件化载体**：整个平台内，所有 MCP 技能、基础能力（Read/Edit）不再被生硬地编码为长串的业务代码，而是落盘为带 Frontmatter 的 Markdown 文档（例如 `.agent/skills/db-search/SKILL.md`）。
  - **Frontmatter 区**：定义底层的结构化参数规范（类 JSON Schema 的超集）以及暴露的 Hook。
  - **Body 区**：定义如何运用这个技能的最佳实践（Best Practices）和提示词指导，在唤醒技能时直接给与 Agent。
- **跨模型动态转译 (Schema Traslation)**：
  - 当发送网络请求前：
    - 若调用 OpenAI，底层转换器将 MD 中的 Frontmatter 映射为 `tools: [{ type: "function", function: {...} }]`
    - 若调用 Anthropic，转换器按照其特有的 `<tool_choice>` 和 XML 参数规则重新封包。
    - **启发式补全**：如果某些小模型压根不支持 `tool_calling` 原生参数，底层会在 System Prompt 尾部使用特定的 Markdown 注入：“*你必须以如下 JSON 格式回复来调用工具：...*”，然后在网关侧用正则强行解析它的回复，从而**让“不支持 Tool Calling”的模型也被迫拥有工具调用能力**。

---

## 3. Subagent (子智能体) 的装配与生命周期

在处理极其复杂的业务或实现类似 OpenClaw 的长期后台常驻守护（Daemon）时，单个主控 Manager 是无法 Cover 所有技术栈的。

### 3.1 职责清单：Markdown 为核心的身份载体 (Markdown-as-Config)
- **拒绝隐式硬编码**：在系统目录库内，将不同 Subagent 的身份与挂接能力固化为标准的 Markdown 文件（例如 `.agent/subagents/frontend_specialist.md`）。而不是传统的仅用一小段 JSON。
- **文件结构分离**：
  - **YAML Frontmatter (头部配置)**：供本地系统工程使用，定义该 Agent 绑定的轻量模型版本（如 `model: gemma-2b`）、专用工具白名单（`allowed-tools: [web_search, css_mcp]`）。
  - **Markdown Body (提示词挂载)**：供 LLM 消费使用。正文直接作为 System Prompt 赋予该 Subagent 灵魂（Persona），诸如前端最佳实践、样式库禁忌。系统既读取了工具权限，又拥有了易于人工维护的 Prompt。

### 3.2 显式委派与监督者模式 (Explicit Delegation & Supervisor-Worker)
深度借鉴 **OpenCode** 中对于 Subagent 调度的清晰业务流设计，平台在组件间切换时支持主动指派与被动路由双规机制：
- **触发与委派的双向模型**：
  - **用户前端显式挂载 (@ 唤醒)**：最高权重的触发路线。用户可以直接在 UI 输入框通过 `@FrontendExpert` 显式召唤 Subagent 聚焦处理特定区域。系统调度器截获该信标，越过默认 Manager，直接将该语句直通给特种兵。
  - **主控引擎自主派发 (Manager Delegation)**：或者，全局 Manager Agent 分析需求黑板，并发觉特定任务（如：重构一段 React 样式）并非自身最佳适用范围时，其主动调用内部工具 `[DelegateToAgent]` 将当前节点外包，开启异步的 Worker 处理线程。
- **沙盒隔离与上下文裁剪 (Context Sandboxing)**：
  - 为了防止“幻觉”和节省成本，被拉起的 Subagent 绝对不会获取全局漫长的主干 History。它仅仅会被灌入高度脱水的、由 Manager/Router 专门裁剪出的**具体任务描述**、**极小范围的文件引用**和**特定约束的可用 Tools 白名单**（隔离危险权限）。
- **生命周期与严格回报机制交付**：
  - 子程序 Subagent 在后台完成工作或受阻时，绝不允许越权直接在聊天框向人类刷屏；而是必须将产出和 Diff 回归到指定的 JSON/Report 格式，上报更新到底层的状态流转数据库中，同时交棒给主干 Manager 向用户转述“重构完毕”。一旦 Report 提交，自身实例立即进入 Terminated 销毁阶段释放内存碎片。
---

## 4. 多级配置的级联与合并 (Cascading Configurations)

借由 OpenCode 和 OpenClaw 的思路，系统不能是一个只有单一配置档的玩具。用户的偏好、环境参数必须分为多层级加载，达到 **局部重载（Override）**的功能。

### 4.1 权重加载顺序 (从低到高)
这三层配置在系统启动的头 50 毫秒内会被读取并合并成内存共享对象 (Resolved Config)：
1. **[Global Level] 全局级配置** (`~/.config/opencode/config.yaml`)：
   - 保留全平台通用的 API Keys、默认选择的主模型偏好、UI 主题、网络代理（Proxy）设定。
2. **[Project Level] 项目级配置** (`/path/to/project/.agent/config.yaml`)：
   - 覆盖全局设定！比如这个项目涉及到公司机密，项目级配置里 `provider: ollama`，就会在此次启动中自动屏蔽掉全局设定的 OpenAI，确保数据不上传。
3. **[Session/Runtime Level] 会话级/环境变量级** (命令行参数 `--provider=claude`)：
   - 权重最高，用在临时性、单次运行的覆盖调试或特定的测试任务中。

### 4.2 配置防污染机制
- 坚决杜绝在运行时因为 Agent 的修改把局部配置写进全局文件。Agent 所有的“动态偏好学习”只能限定在第 2 级（项目级）及以下的数据库内，绝对不越权篡改操作系统级别的全局配置文件，保障系统隔离的安全性。
