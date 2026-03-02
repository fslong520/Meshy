# 多智能体协作与自进化平台架构设计 (1.0 演进版)

## 1. 产品愿景与定位
本平台旨在打造一个**“泛用型虚拟劳动力与自进化协作环境”**（Virtual Workforce Environment）。本系统不仅是强大的软件开发引擎，同样擅长且适配**通用型信息处理任务**（如：API 数据查询交互、全网新闻或社交媒体检索与结构化分析等）。
不同于传统的发卡式对话工具，本系统具有以下核心特征：
1.  **动态模型路由分发 (Intelligent Model Routing)**：借鉴 OpenCode 理念，为不同的任务动态分配模型规格。系统在分析意图时使用轻量的“小模型路由器”，若是简单任务则全程交给小模型极速且低成本执行并调配专用子提示词；复杂任务才转移给超大模型做深度推理。
2.  **项目隔离与任务沙盒**：针对单个项目中的单一任务进行自动 Session 切分，切除无关上下文，降低 Token 消耗与幻觉。
3.  **本地智核边缘引擎 (Edge-Computing Engine)**：泛指底层对繁杂任务的支持能力。不仅是用 LSP 支持代码修改（语法实时诊断），更包含将文件防并发读取、越权保护等重逻辑的判断下放至本地底层运行时拦截，避免把高昂的大模型开销浪费在“低智重试”上。
4.  **正反馈自学习飞轮 (EvoMap Capsules)**：记录并提炼每一次智能体成功排错带来的经验（或通过开发者主动点赞触发），生成具备泛化记忆的 Capsule 反哺项目库。

---

## 2. 系统核心架构全景 (System Architecture)

整个平台从底层到应用层分为四层：

### 2.1 L1 - 基础设施层 (Infrastructure & Local Storage)
- **Turso (libSQL)**：
  - **角色**：存放全局和项目级别的 EvoMap 知识胶囊 (Capsule)、全局系统设定、经验（Learnings）。
  - **选择理由**：单文件极速部署，原生支持向量运算引擎（Vector Top-K），能轻松在边缘端实现 RAG 的无缝整合。
- **定制化二进制压缩态存储 (Custom Compressed State Storage)**：
  - **角色**：存放不需要人工手动介入编辑的后台临时执行引擎 State（例如：Agent 待办黑板树、极速挂起时的变量快照上下文、激活的文件描述符记录等）。
  - **选择理由**：彻底摒弃充满括号与冗余键名的 JSON/YAML，采用类似 MessagePack 或 Protobuf/BSON 这类的高压定制化结构。不仅极大削减了磁盘占用体积，更关键的是让短生命周期的 Session 在高频挂起（Suspend）和恢复（Resume）反序列化时实现微秒级冷启动。

### 2.2 L2 - ACI 与智能守护层 (Agent-Computer Interface & Guardrails)
传统的 Agent 直接向 OS 写脚本是十分危险且耗费 Token 的。本项目引入严格封装的 **ACI (Agent-Computer Interface)** 屏障。

1.  **Read/Write/Edit 引擎模块**：
    - 带行号的分页式 Read，杜绝因读取巨大文件导致的 Token 爆炸。
    - **Edit 防并发引擎 (Anti-Race Condition)**：底层以文件的 Hash 值和时间戳作为快照锚点 (Meta-Data Checkout)。如果 LLM 执行改写时发现本地已被他人（或 IDE）修改，底层内核直接打回请求而不消耗任何 API Token。
2.  **LSP 拦截与诊断服务器 (Lint & Compile Guard)**：
    - 内置 MCP 协议包裹的 LSP (Language Server Protocol) 服务。
    - LLM 生成代码后不会直接写入用户可见文件，而是进入虚拟草稿层 (Draft Workspace)。LSP 在毫秒级返回 Syntax Warn 甚至 Type Error 等诊断信息，如果发现致命错误，引擎直接驳回修改，LLM 进行 Self-Correction。
3.  **自动格式化机制 (Formatter 拦截)**：
    - 作为一项**可被关闭的 Option**。如果在配置中开启，LLM 修改后的代码会经过 Prettier/Rustfmt 等执行一次自动格式化。这样可以大幅容忍 LLM 因为“缩进算错少了个空格”而在 Edit File 时反复抛出 "Pattern not match" 错误的低级循环。

### 2.3 L3 - Agent 协作与状态流转层 (Agent Orchestration & State Flow)
1.  **前置智能意图分类器 (LLM Router & Dispatcher)**：
    - 结合刚才提到的“动态路由”，所有发来的自然语言需求首先流入这个本地组件。它挂载着速度极快的小模型，负责解析请求种类（“这是一次普通社交平台 API 爬虫分析”还是“这是底层 Rust 核心引擎重构？”），然后分发完全不同权重的执行模型集群，并组合下发专用的子提示词模版组合。
2.  **Session 切片池 (Session Partitioning)**：
    - 根据判定生成的任务包裹进入独立的 Session（如：Id 0xA1）。系统不会在池中暴力合并过去一周聊天历史，每个 Session 只需加载自己极简的上下文底座（Project-map 概览 + 专属 Turso 排坑记忆）。
3.  **多模态虚拟专家看板 (Shared Context Board)**：
    - 不管是开发者间的协同（比如 Coder Agent 配合 QA Agent），还是执行泛信息操作时的协同（比如 Scraper Agent 去查新闻接口，Writer Agent 等待数据进行报告总结）。子 Agent 之间的数据互传与状态通报警报，全部靠刷新底层的二进制黑板结构进行，严禁互相直接发送冗长自然语言聊天导致 Token 崩盘。
4.  **MCP 技能动态延迟注入 (Lazy Tool/Skill Injection)**：
    - 作为全栈/泛用 Agent，系统中可能挂载上百个 MCP (Model Context Protocol) 或 Skills 工具包。若每次发消息都在 payload 里的 `tools: []` 字段注册所有工具的 Schema 参数细节，会每一轮白白浪费大量 Token。
    - **启发式唤醒机制**：底层默认不在 API 请求中下发笨重的结构化 Tool Schema（除非是读写文件的看家基础能力）。相反，在 System Prompt 中仅用短短几行文本给 Agent “打个广告”：“*如果你需要搜索新闻，你有 `news_mcp` 可以用；若是查数据库，你有 `sql_mcp` ...*”。
    - 当模型回复表明它想要调用 `news_mcp` 时，本地拦截器才会真正去拉取 `news_mcp` 的详细 Schema 参数喂给模型开始走 Tool Calling 循环。以此实现工具的按需惰性加载。

### 2.4 L4 - 人机交互与自进化飞轮层 (Human Feedback & Self-Evolution)
1.  **AskUser 阻断机制**：
    - 当系统发现不可调和的依赖冲突、遇到缺失系统权限等硬错误，底层不会让 Agent 去执行十几次无意义的重试。Agent 会调用原生的 AskUser 工具让自身在本地挂起（Suspension），把确认权交给用户（相当于抛出一个 CLI prompt）。
2.  **强化学习点赞飞轮 (The "Like" Button Capsule Generator)**：
    - 当一整套复杂的重构任务，Agent 完美且高超地执行完毕后，开发者可以在终端或控制台点击**“赞 (Thumbs-up)”**。
    - 这个动作会唤醒后台的一个专门负责总结的 Reflection Agent。它会调取刚结束的 Session 的操作序列（包括怎么试错、最终怎么避坑），浓缩为一条全新的 **Capsule (知识胶囊)**。
    - 这条胶囊立刻被向量化并插入进该 Workspace 专属的 Turso 库中。下次再遇到同类任务，Agent 将自带这种高超的业务思维。

---

## 3. “Token 开销优化”核心思考总结

> 在 AI 编程赛道，衡量调度引擎是否优秀的唯一标准就是：“到底有没有让好钢（Token）用在刀刃（深度推理）上？”
> 现有的产品设计在这方面的防守策略如下：

1.  **消灭盲人摸象**：对于“重命名变量”、“寻找声明位置”，这些需要反复 Grep 和读文件的操作，直接由 **LSP-based MCP Server** 代劳，瞬间输出行号位置返回。
2.  **消灭并发与语法智障错**：对于极细微的文件修改错位、并发导致的行号漂移、缩进导致的覆盖错，全部在本地通过 **LSP 错误拦截** 与 **本地并发时间戳 Meta 比对** 驳回，不再送回云端的大模型去耗费算力理解。
3.  **消灭冗余工具声明 (Tool Context Bloat)**：废除把所有 MCP Servers 的底层描述和巨大 Schema JSON 每次硬塞进上下文的传统做法。转向“轻量化提示词启发挂载”，用到什么技能再去动态搜索解锁这个 MCP 的详细能力规范，为“长聊天”大幅减负。
4.  **消灭背景知识污染**：利用 **Prompt Caching** 的头文件锁定技术（把全局文档缩略图锁在缓存里）。用轻量级的 JSON 快照来管理特定任务正在修改的少量文件。

这套“重逻辑判断留给本地系统工程，非确定性创新留给云端 LLM” 的混合架构，能最高效地让平台真正实现生产力级的、不耗尽算力资金的虚拟劳动力运作理念。
