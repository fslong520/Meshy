# 多智能体协作平台：任务会话切分与上下文优化架构设计

## 1. 核心挑战与业务背景
在长周期的软件开发或复杂项目任务中，任务会跨越多个甚至数十个生命周期。传统的“大单体长对话（Long Context Chat）”范式面临着难以解决的痛点：
- **Context 膨胀与资金成本**：如果每次重新拉起会话都要把以前改过的“核心基座文件”一股脑灌入，Token 开销激增且速度极慢。
- **多会话边界模糊**：开发者可能同时进行多个特性的开发（例如，Session A 修 Bug，Session B 做新功能）。如果不做隔离，过去对话内容里的闲杂信息会让模型“分心”出现幻觉（Lost in the middle）。
- **状态不连续**：当前 Agent 的“工作台状态”（包括打开了哪些文件、当前任务进度）如果不靠大量前置文本带入，一旦重启程序就会丢失。

基于上述背景，我们必须通过**架构手段**解决：如何让 Agent “记住该记住的经验”，同时“不用每次重复读庞大的基础文件”。

---

## 2. 业界前沿技术调研 (2024-2025 SOTA)

通过对 Cursor、Aider 以及 Anthropic/OpenAI 最佳实践的深度调研，解决“代码膨胀与多轮会话衔接”的最优路径分为以下几个方向：

### 2.1 提示词缓存层 (Prompt Caching) - 游戏规则改变者
- **原理**：LLM 接口级特性（Anthropic 与 OpenAI 皆支持）。只要系统向模型提交的开头特定长度的 Prompt 的 Hash 不变，模型后台就会直接复用上一次保留在显存里的 KV Cache。
- **作用**：**这是解决“重复读大文件”最直接的技术。** 我们可以把百 KB 级别的不变核心框架文件、全局 API 文档、规范，推送到 Prompt 的前端固定区域。每次启动新 Session 或发送新指令时，前置大文件免计费且在数毫秒内读取完毕，极大地降低开销并实现“永久加载”。

### 2.2 AST 抽象语法树与代码地图 (RepoMap)
- **原理**：借鉴 Aider 范式。不喂给模型全量的代码内容，而是利用 Tree-sitter 等工具，只抽取全库（或重要目录）的类名、函数签名、文件关系，生成一个极度紧凑的 "RepoMap"。
- **作用**：大模型拥有极强的脑补和推导能力。通过几十 KB 的大纲，它就能知道项目之前的 Session 留下了什么类。当它切实需要修改其中某个函数体时，再精准赋予局部调用的能力，取代传统的整个大文件注入。

### 2.3 分层记忆与状态快照 (Hierarchical Memory & Agent Checkpoints)
- **原理**：
  - 将记忆分为：**工作台记忆 (Working Set)** + **提取式档案记忆 (Archival Memory)**。
  - **快照恢复 (Session Checkpoints)**：基于类似 LangGraph 的状态快照机制。将 Agent 做到一半的 `Tool Calls 历史`、`被激活编辑文件的路径`、`未完成的 Todo List` 固化为 JSON 快照。当下一次唤醒时，跳过历史废话，直接反序列化进入“就绪状态”。

---

## 3. 当前平台的架构落地设计

为了与 `.agent_memory.db` 结合，我们设计一套“会话动态分区提取”架构，放置在 Multi-Agent 平台的基座层：

### 3.1 Session 自动切割与快照体系 (Partitioning)

将原先的单串流会话切割为具有独立生命周期的 Session 对象，每个任务在创建时被沙盒化：

1. **Session 生命流控制**：
   - 所有的长开发任务由 `Manager Agent` 拆解为多个子目标。每个子目标是一个独立的 Session `(e.g., SID-10x)`。
   - Session `SID-10x` 的工作台上，仅存在与当前任务相关的**脏文件差异（Git Diffs）**和**激活文件集合（Active File Set）**。

2. **Session 休眠与恢复 (Suspend & Resume)**：
   - 当任务挂起，生成 `.agent/sessions/{SID-10x}.snapshot.json`。
   - 内部包含：`Status`, `To-do`, `Working Files`, `Reflections (本阶段得出的避坑点)`。
   - 重启时，系统并非加载海量的对话 log，而是加载这个精简 Snapshot 从而迅速重建场景上下文。

### 3.2 动态按需组装的 Context Payload (性能最优解)

为了最大化利用 API 的 **Prompt Caching**，同时避免反复读取大文件，最终发给 LLM 的 Payload 必须严格遵循“由静到动”的分层构造法则：

```text
[缓存区头部] -- 只要以下内容不改，重复请求耗时下降将近 80%
1. System Protocol (系统规范、角色设定)
2. Project Memory (从本地 Vector DB 中提取的所有历史排坑指南、全局知识)
3. RepoMap (全局代码函数和类签名概览缩略图)
4. Core Files (可选：如果在项目中被高频引用且极少改动的大型核心基座文件，也可放此)

[动态区尾部] -- 频繁变化区，按实际计算资源
5. Active Session State (当前 Session 的 Todo 和刚唤醒的快照内容)
6. Active Opened Files (当前子任务正在直接修改的 1~3 个文件全文)
7. Current User Message (用户最新输入的话)
```

### 3.3 RAG 与语义化符号召回 (Symbol-level RAG)

考虑到先前 Session 完成了大量特定代码（例如 `Auth Service`），新代码要调用它们，但新 Session 不能预知并打开整个文件：
- **符号级索引体系 (Index)**：把之前的代码不仅做 AST 解析，同时把代码切分保存进 `project_memory.db`。
- **本地查询能力 (Fetch)**：赋予 Worker Agent 一个内部查询能力。当 Agent 从 RepoMap 看到有 `authenticateUser` 函数，但需了解其内部异常结构时，无需读整个 `auth.js`，而是发送内部命令局部截取（`ViewCodeItem(auth.js // authenticateUser)`）。

---

## 4. 实施阶段路线图 (Implementation Roadmap)

1. **Phase 1: 引入 RepoMap & 分层 Prompt (短期高 ROI)**
   - 开发脚本，利用 `ctags` 或 `tree-sitter` 在项目启动和产生大范围改动时自动刷新 `Project-Map.md`。
   - 重构框架向底层的拼文逻辑，将 Payload 拆为 Static 和 Dynamic 两部分，拥抱 Prompt Caching。

2. **Phase 2: 快照管理 (Session Checkpointing)**
   - 取消传统的无边界长对话窗口。提供 `Session Manager` 面板。
   - 实现每个命令执行后对工作台文件集合、当前目标的脏状态保存，支持 `save / restore` 切换会话视角。

3. **Phase 3: 反思提取通道自动写入 (Self-Reflection to Storage)**
   - 在 Session Archive 结束时，触发一次大模型背调功能（后台任务）。
   - 让模型提炼“这个 Session 做软件开发留下了哪些能复用的业务核心逻辑及排坑建议”，然后合并更新至 `project_memory.db` 这颗知识库大脑里。以此完成过去会话向未来会话的轻量级知识传递链。
