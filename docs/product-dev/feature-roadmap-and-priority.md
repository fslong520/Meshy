# 多智能体协作平台：落地开发路线图与功能优先级清单 (Roadmap & Priority Checklist)

在经历了前面的多维度深度架构调研与产品演进思考后，本系统已经具备了世界级的 Agent-IDE 理论雏形。为了将这些天马行空的设想切实落地，必须要有一套**结构化、分阶段、可验证的基础实施路线图**。

本路线图将按照优先级（Priority, P0~P4）进行严格排序，确保每一阶段的交付都是一个可以运行并在前一阶段基础上演进的可用产品（MVP -> 生产力平台 -> 自进化生态）。

---

## [Phase 1] P0: Core Infrastructure & Single Agent (核心系统底盘与单智能体闭环)
这一阶段的目标，是打造一个基于终端 CLI 但绝不乱删代码的“智能编程助手”。不求花哨炫技，只求**稳定工作，工具完备**。

- [ ] **多模型与兼容网关接入 (Provider & Adapter Gateway)**
  - [ ] 实现模型适配器抽象接口 (`generateResponse`)。
  - [ ] 接入主打编码的大模型（如 OpenAI 官方库或 Anthropic/Claude 3.5）。支持 SSE 逐行流式输出。
  - [ ] 设计内部跨模型 Tool Calling Schema 转换器，保障后续挂多个模型不需要改底层的 tool 声明。
- [ ] **ACI 核心防线建立 (Agent-Computer Interface)**
  - [ ] `ReadFile`：必须带行号返回给 LLM，且对长文件实施（如 500 行自动截断）硬分页。
  - [ ] `EditFile`：抛绝全文复写！必须实现基于 Search/Replace block 甚至更优的 fuzzy match（模糊寻找）。
  - [ ] `WriteFile`：处理全新模块生成。
  - [ ] **脏数据/高并发检查**：在 Edit 动作执行前，本地强制对比 Hash 或 Last-Modified-Time以拦截污染。
- [ ] **高压紧凑的 Session 状态管理**
  - [ ] 抛弃长文本，构建局部的压缩结构体存储当前黑板上的 `Todo`，上文打开过的文件路径集等。
- [ ] **核心日志与熔断器 (Observability MVP)**
  - [ ] 打印详细的 Payload 供肉眼 Debug。
  - [ ] `MAX_RETRIES` 硬编码拦截（防止大模型在本地不停重试，耗干你的 Token 账户）。

---

## [Phase 2] P1: Intention Routing & Multi-Agent Subsystem (局部智核、多模型意图路由体系)
单干搞定后，我们将平台演进为“极尽省钱但能力惊人”的混合模型架构池，引入 Markdown 为载体的技能生态。

- [ ] **前置智能路由与意图分类 (Dispatcher & Local Prompting)**
  - [ ] 部署小模型（如本地 Ollama 驱动或极低价的 1.5B API），接管人话输入并转化为系统动作（如普通闲聊、全局代码找寻、修改核心算法）。
  - [ ] 智能构建专用的上下文组合（System Prompts）。
- [ ] **Markdown 驱动的 Subagent 配置与工具挂载**
  - [ ] 将所有的额外技能（Web Search, PTY 命令执行）包装为 `.agent/skills/xxx.md` 的 Frontmatter 格式。
  - [ ] 构建主控大模型下的多个 Subagent（例如：只管画 UI 图的 `frontend_ui_agent`，只负责查 BUG 的 `tester_agent`），它们依靠读取本地对应的 Markdown 完成初始化。
- [ ] **惰性工具挂载 (Lazy Tool Injection)**
  - [ ] 本地拦截器实现对大模型对话返回时特定字符串意图的动态解析，并在必要时才去挂载具体工具极度庞大的 Schema。

---

## [Phase 3] P2: Real-time Edge Guardrails & Workspace UI (生产级防腐层与沙盒控制台)
在这个阶段，我们的平台从一个脚本工具升格为一个“具备极好交互体验和自我保护能力”的准商业级工程底座。

- [ ] **LSP 代码智能与诊断引擎拦截器 (LSP Proxy Hook)**
  - [ ] 使用本地 LSP Server（不带 UI）实时对 Agent 新增的代码进行语义验证，一旦 Error 立刻发回重改（Self-Correction Without User）。
- [ ] **全隔离虚拟终端 (Multi-PTY Sandbox)**
  - [ ] 在 TUI/GUI 环境下，支持拉起隐藏背景终端，给跑任务的 Agent 提供完全隔离且防止污染的执行舞台。
- [ ] **会话输入框富交互引擎 (/, @, # 控制符)**
  - [ ] `/` 命令引擎：解析强控动作（如：/undo, /explain, /clear）。
  - [ ] `@` 引用拦截：拦截文件拖拽引用、跨角色强召（如 `@reviewer`），后端支持自动抽入 System 区域。
  - [ ] `#` 符号检索：对接 LSP ，输入函数名精准抽取该函数的这十几行代码片段送上云端。

---

## [Phase 4] P3: Self-Evolution & Project Memory (基于向量的领域记忆进化体系)
这使得系统真正有了灵魂。在单个项目中，它不需要再犯自己昨天走过的弯路。

- [ ] **Turso (libSQL) 单目录挂载部署**
  - [ ] 将 Turso / SQLite VSS 嵌进项目的 `.agent/` 文件夹做为记忆池。
- [ ] **经验回放与提取网络 (Reflection & Extraction)**
  - [ ] 完成一个 Task 后，在后台开启“知识提取线程”，扫描当前修改前后的 Diff 和报错点，总结后 Embedding 为向量。
- [ ] **主动人类干预按键飞轮 (The "Like" Button / The "Dislike" Feedback)**
  - [ ] 结合 UI，引入手动点赞封装 Capsule 机制（把好操作永远保留），或者失败强制标记（永远作为 Anti-Pattern 录入 Prompt 库）。

---

## [Phase 5] P4: Generative OS & Cloud Eco-system (生态泛化与云平台交互)
最后阶段，将打破系统作为“单纯编写代码”的藩篱。

- [ ] 接入非开发向的通用 MCP 模型（数据库调优，网络爬虫报告编写，图表自动化生成等泛信息能力）。
- [ ] 开发类似于 Cursor Cmd+L 选区高亮抽取组件、Cmd+K 微型原地差异组件 (Inline Edit) 的完整前端图形系统（ Electron 或 Web IDE 壳）。
- [ ] 建立云端 EvoMap 胶囊共享协议，拉取或贡献某个领域的专门错误修复集装箱。

> **🎯 落地冲刺建议：**
> 初步开发时，**死守 Phase 1 (P0)**。这层基座没有打牢前，任何上层的并发或者多智能体设计都只不过会快速吞噬你的经费余额，并在错误上层层堆砌 Bug。当 P0 这层厚重的 ACI 完美实现时，再解耦和演进将会毫不费力！
