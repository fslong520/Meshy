# OpenCode × OpenWork × OpenClaw 三项目交叉对照与开发路线映射

> **调研日期**：2026-02-23
> **文档性质**：开发加速参考 — 按需求维度对照三个开源项目的实现，为每个 Phase 的落地提供"抄作业"级别的精确指引。

---

## Executive Summary

| 项目 | 定位 | 技术栈 | 与我们的关系 |
|------|------|--------|-------------|
| **OpenCode** | 开源 AI Coding Agent（终端/桌面/IDE/Web） | TypeScript monorepo, 108K+ Stars | **P0-P2 阶段的核心参考** — ACI 工具链、多模型网关、技能系统、子智能体 |
| **OpenWork** | 基于 OpenCode 构建的"虚拟劳动力"工作台 | OpenCode + Skills + Agents + MCP | **全阶段的上层交互参考** — 技能编排、命令系统、工作流自动化 |
| **OpenClaw** | 自主 AI Agent 平台（消息通道驱动，带手带脚） | TypeScript, Gateway 架构 | **P3-P5 阶段的核心参考** — 守护进程、沙盒隔离、自进化、可观测性 |

**核心洞察**：三个项目恰好覆盖了我们平台从 P0 到 P5 的完整演进链路。OpenCode 解决"怎么让 Agent 安全地写代码"，OpenWork 解决"怎么让多个 Agent 协作完成复杂任务"，OpenClaw 解决"怎么让 Agent 永远在线、自主行动、安全可控"。

---

## 1. Phase 对照总表

### Phase 1 (P0): Core Infrastructure — 核心系统底盘

| 需求项 | 最佳参考 | 具体实现 | 参考文件/URL |
|--------|---------|---------|-------------|
| 多模型网关 `ILLMProvider` | **OpenCode** | Vercel AI SDK + 75+ Provider + `transform.ts` 跨模型转译 | `src/provider/provider.ts` |
| SSE 流式统一 | **OpenCode** | `server.ts` SSE 推送 + 统一 `AgentStreamChunk` | `src/server/server.ts` |
| ReadFile 带行号分页 | **OpenCode** | `read.ts` 支持 `offset`/`limit` 参数 | `src/tool/read.ts` |
| EditFile SEARCH/REPLACE | **OpenCode** | `edit.ts` 精准块替换，绝不全文覆写 | `src/tool/edit.ts` |
| 文件防并发检查 | **OpenCode** | edit 前 Hash/时间戳校验 | `src/tool/edit.ts` |
| Session 状态管理 | **OpenCode** | SQLite 持久化 + 自动 compaction | `src/session/`, `src/storage/` |
| MAX_RETRIES 熔断 | **OpenClaw** | `timeout` + `usage-tracking` 模块 | `docs.openclaw.ai/concepts/usage-tracking` |
| 三级配置级联 | **OpenCode** | Global → Project → CLI 参数 | `src/config/config.ts` |

### Phase 2 (P1): Multi-Agent & Routing — 多智能体与意图路由

| 需求项 | 最佳参考 | 具体实现 | 参考文件/URL |
|--------|---------|---------|-------------|
| 前置意图路由器 | **OpenCode** | `small_model` 配置轻量模型做标题/路由 | `opencode.json` → `small_model` |
| Markdown Subagent 配置 | **OpenCode** | `.opencode/agents/*.md` YAML Frontmatter + 正文 Prompt | `src/agent/agent.ts` |
| 子智能体委派 (Task) | **OpenCode** | `task.ts` 工具 — Manager 发起，Worker 接收裁剪上下文 | `src/tool/task.ts` |
| 上下文沙盒裁剪 | **OpenCode** | 子智能体仅获取最小任务描述 + 工具白名单 | Agent mode: `subagent` |
| Markdown Skill 定义 | **OpenCode** | `SKILL.md` + YAML Frontmatter + 按需加载 | `src/tool/skill.ts` |
| 惰性工具注入 | **OpenCode** | 仅名称+描述注入，调用时才加载完整内容 | `<available_skills>` XML |
| 权限级联合并 | **OpenCode** | 4 层 merge: Base → User → Agent → Override | `src/permission/next.ts` |

### Phase 3 (P2): Guardrails & Workspace UI — 防腐层与工作台

| 需求项 | 最佳参考 | 具体实现 | 参考文件/URL |
|--------|---------|---------|-------------|
| LSP 诊断拦截 | **OpenCode** | `lsp/` 实验性工具 — goToDefinition, findReferences 等 | `src/lsp/client.ts` |
| 多 PTY 沙盒终端 | **OpenClaw** | `exec` + `pty: true` + `background` + Docker 隔离 | `docs.openclaw.ai/gateway/background-process` |
| `/` 斜杠命令 | **OpenCode** | Markdown 命令定义 + `$ARGUMENTS` + Shell 注入 | `.opencode/commands/*.md` |
| `@` 提及路由 | **OpenCode** | `@agent-name` 直接调用子智能体 | `docs/agents/#subagents` |
| `#` 符号引用 | **需自研** | 三个项目均无原生支持 | — |
| 执行模式 (SMART/YOLO) | **OpenClaw** | 8 层工具限制 + `elevated` 提权 + `sandbox` 模式 | `docs.openclaw.ai/tools/multi-agent-sandbox-tools` |
| AskUser 阻断 | **OpenCode** | `question` 工具 — Agent 挂起等待用户回答 | `src/tool/question.ts` |

### Phase 4 (P3): Self-Evolution — 自进化体系

| 需求项 | 最佳参考 | 具体实现 | 参考文件/URL |
|--------|---------|---------|-------------|
| 向量知识库部署 | **OpenClaw** | Memory 系统 + 语义搜索 | `docs.openclaw.ai/concepts/memory` |
| 经验回放提取 | **OpenClaw** | Session 录像 (Markdown) + `memory_search` | `~/.openclaw/workspace/sessions/` |
| Reflection Agent | **OpenClaw** | `llm_task` 工具 + Ritual 文件体系 | `SOUL.md`, `BOOTSTRAP.md` |
| 点赞飞轮反馈 | **需自研** | OpenClaw 有 Ritual 基础，但无显式点赞 UI | — |
| 上下文压缩 | **OpenCode** | 隐藏 `compaction` Agent 自动运行 | `src/session/compaction.ts` |

### Phase 5 (P4): Generative OS — 生态泛化

| 需求项 | 最佳参考 | 具体实现 | 参考文件/URL |
|--------|---------|---------|-------------|
| 通用 MCP 接入 | **OpenCode** | `opencode.json` → `mcp` 配置节 | `docs/mcp-servers/` |
| Cmd+L 选区抽取 | **OpenCode** | Desktop/Web App 中的 Context Pill 组件 | `packages/desktop/`, `packages/web/` |
| Cmd+K Inline Edit | **需自研** | OpenCode 无原生 Inline Edit UI | — |
| 守护进程 + Heartbeat | **OpenClaw** | Gateway Daemon + HEARTBEAT.md 脉冲 | `docs.openclaw.ai/gateway/heartbeat` |
| 云端胶囊共享 | **需自研** | 三个项目均无云端共享协议 | — |

---

## 2. 架构层对照

### Layer 1: 表现与交互层

```
┌────────────────────────────────────────────────────────┐
│                    我们的设计                           │
│   CLI / TUI / Electron GUI / WebUI / VSCode Extension  │
├────────────────────────────────────────────────────────┤
│   OpenCode 的实现                                      │
│   Ink TUI / Web App / Desktop (Tauri) / IDE Extension  │
│   → packages/cli, packages/web, packages/desktop       │
├────────────────────────────────────────────────────────┤
│   OpenClaw 的实现                                      │
│   TUI / Dashboard / WebChat / 消息通道 (WA/TG/Slack)   │
│   → openclaw tui, openclaw dashboard                   │
└────────────────────────────────────────────────────────┘
```

### Layer 2: 编排与发现层

```
┌────────────────────────────────────────────────────────┐
│   我们的设计: Router + Blackboard + Tool RAG           │
├────────────────────────────────────────────────────────┤
│   OpenCode: small_model 路由 + skill 发现 +            │
│             session compaction + task 委派              │
├────────────────────────────────────────────────────────┤
│   OpenClaw: Binding 路由 + Heartbeat 调度 +            │
│             agent_send 跨 Agent 通信 + lobster 工作流  │
└────────────────────────────────────────────────────────┘
```

### Layer 3: 运行时

```
┌────────────────────────────────────────────────────────┐
│   我们的设计: Manager/Subagent + ACI + MCP + Skills    │
├────────────────────────────────────────────────────────┤
│   OpenCode: 7 原生 Agent + Markdown Agent 定义 +       │
│             15 内置工具 + SKILL.md 按需加载             │
├────────────────────────────────────────────────────────┤
│   OpenClaw: Multi-Agent 隔离 + exec/process 工具链 +   │
│             Docker 沙盒 + 8 层工具限制                  │
└────────────────────────────────────────────────────────┘
```

### Layer 4: 模型网关

```
┌────────────────────────────────────────────────────────┐
│   我们的设计: ILLMProvider + Adapter Pattern            │
├────────────────────────────────────────────────────────┤
│   OpenCode: Vercel AI SDK + 75+ Providers +            │
│             transform.ts 跨模型适配                     │
├────────────────────────────────────────────────────────┤
│   OpenClaw: Model Failover + Provider 配置 +           │
│             model.byProvider 按模型选择策略              │
└────────────────────────────────────────────────────────┘
```

### Layer 5: 基础设施

```
┌────────────────────────────────────────────────────────┐
│   我们的设计: Turso DB + 二进制压缩态 + .agent 文件     │
├────────────────────────────────────────────────────────┤
│   OpenCode: SQLite 本地存储 + .opencode/ 配置 +        │
│             AGENTS.md / SKILL.md 文件体系               │
├────────────────────────────────────────────────────────┤
│   OpenClaw: ~/.openclaw/ 状态目录 + Session 存储 +     │
│             Memory 持久化 + Ritual 文件体系              │
└────────────────────────────────────────────────────────┘
```

---

## 3. 核心模式提取：可直接复用的设计模式

### 模式 1: Markdown-as-Config (三项目共识)

**共识**：三个项目都采用 Markdown + YAML Frontmatter 作为 Agent/Skill/Command 的定义载体。

```markdown
---
name: my-agent
description: 做什么事情
mode: subagent
model: provider/model-id
temperature: 0.3
tools:
  write: false
  bash: ask
permission:
  bash:
    "git *": allow
    "rm *": deny
---
你的 System Prompt 在正文区域。
Frontmatter 供系统工程解析，Body 供 LLM 消费。
```

**可复用度**: ⭐⭐⭐⭐⭐ — 直接采用此模式定义我们的 `.agent/skills/` 和 `.agent/subagents/`。

### 模式 2: Lazy Tool Injection (OpenCode 首创)

**模式**：不预加载所有工具 Schema，仅注入名称+描述索引，Agent 按需调用时才加载完整定义。

```
系统启动 → 仅注入 <available_skills> 列表（轻量）
Agent 判断需要 → 调用 skill({ name: "xxx" })
系统加载 → 完整 SKILL.md 注入上下文（重量）
使用完毕 → 自然淡出
```

**可复用度**: ⭐⭐⭐⭐⭐ — 完美匹配我们的"万物皆 RAG"设计理念。

### 模式 3: Permission Cascade (OpenCode + OpenClaw 共识)

**模式**：多级权限从宽到严逐层收窄，每层只能进一步限制，不能恢复上层禁止。

```
OpenCode:  Base defaults → User perms → Agent perms → Override perms
OpenClaw:  Profile → Provider → Global → Provider → Agent → Sandbox → Subagent
```

**可复用度**: ⭐⭐⭐⭐⭐ — 直接采用，并扩展为我们的 SMART 5 级模式。

### 模式 4: Agent Isolation by Workspace (OpenClaw 独创)

**模式**：每个 Agent 独占 Workspace + Auth + Session，物理隔离而非逻辑隔离。

```
~/.openclaw/agents/<agentId>/
├── agent/auth-profiles.json    # 独立认证
├── sessions/                   # 独立会话
workspace-<agentId>/            # 独立文件系统
├── AGENTS.md                   # 独立行为规则
├── SOUL.md                     # 独立人格
└── skills/                     # 独立技能
```

**可复用度**: ⭐⭐⭐⭐ — 在 Agent Teams 阶段采用。

### 模式 5: Hidden System Agents (OpenCode 独创)

**模式**：内部系统任务（标题生成、上下文压缩、摘要）由隐藏的专用 Agent 执行，而非主 Agent 兼任。

```
compaction Agent → 自动压缩长上下文
title Agent      → 生成会话标题
summary Agent    → 生成变更摘要
```

**可复用度**: ⭐⭐⭐⭐⭐ — 极佳的职责分离模式。

### 模式 6: Ritual File Evolution (OpenClaw 独创)

**模式**：通过一组命名约定的 Markdown 文件，让 Agent 拥有可进化的"灵魂"。

```
SOUL.md      → 长期人格（谁是我？我追求什么？）
IDENTITY.md  → 短期身份（我叫什么？今天的风格？）
BOOTSTRAP.md → 一次性初始化仪式
HEARTBEAT.md → 主动脉冲时的行为指令
USER.md      → 用户偏好和上下文
```

**可复用度**: ⭐⭐⭐⭐ — 在 EvoMap 自进化阶段参考。

---

## 4. 差异分析：三个项目都没解决的问题（需我们自研）

| 需求 | 现状 | 自研方向 |
|------|------|---------|
| `#` 符号引用 (AST 级) | 三项目均无 | 结合 LSP 的 `documentSymbol` 实现精准代码片段抽取 |
| Cmd+K Inline Edit 悬浮窗 | OpenCode 有桌面版但无此功能 | 参考 Cursor 的 Inline Diff 组件 |
| EvoMap 知识胶囊云端共享 | OpenClaw 有本地 Memory，无云端共享 | 设计胶囊发布/订阅协议 |
| 点赞/踩反馈飞轮 | 三项目均无显式 UI | 在 Session 完成后提供反馈按钮，触发 Reflection Agent |
| Turso 向量存储集成 | OpenCode 用 SQLite，OpenClaw 用自有 Memory | 接入 Turso + SQLite VSS |
| 黑板事件总线 (Blackboard) | OpenCode 用 EventBus，OpenClaw 用 Gateway Events | 设计专用的黑板数据结构 + 事件订阅模型 |
| AI 二次审阅 (AI Review) | OpenClaw 有基础支持但非专用 | 设计轻量审阅模型 + 交叉判定逻辑 |

---

## 5. 落地冲刺建议：按 Phase 的"抄作业"路径

### P0 冲刺（2-3 周）
1. **先克隆 OpenCode 的 `src/provider/` 目录**，搭建模型网关
2. **复制 OpenCode 的 `src/tool/{read,edit,write,bash,grep,glob}.ts`**，搭建 ACI 工具链
3. **参考 `src/session/` 和 `src/storage/`**，实现 SQLite Session 管理
4. **参考 `src/config/config.ts`**，实现三级配置级联

### P1 冲刺（2-3 周）
1. **参考 `src/agent/agent.ts`**，实现 Markdown Agent 定义体系
2. **参考 `src/tool/task.ts`**，实现子智能体委派
3. **参考 `src/tool/skill.ts` + SKILL.md 规范**，实现技能按需加载
4. **参考 `src/permission/next.ts`**，实现权限级联合并

### P2 冲刺（3-4 周）
1. **参考 OpenCode 的 `src/lsp/`**，接入 LSP 诊断
2. **参考 OpenClaw 的 `exec + pty + Docker`**，实现沙盒化终端
3. **参考 OpenCode 的 `commands/` 体系**，实现斜杠命令
4. **自研 `#` 符号引用**，结合 LSP documentSymbol

### P3 冲刺（3-4 周）
1. **参考 OpenClaw 的 Memory 系统**，接入 Turso 向量存储
2. **参考 OpenClaw 的 Ritual 文件体系**，设计 EvoMap 胶囊
3. **参考 OpenCode 的 `compaction` Agent**，实现经验提取

### P4-P5 冲刺（持续迭代）
1. **参考 OpenClaw 的 Gateway + Heartbeat**，实现守护进程
2. **参考 OpenCode 的 Desktop/Web App**，开发 GUI 壳
3. **自研云端胶囊共享协议**

---

## Sources

[1] OpenCode 官方文档 — https://opencode.ai/docs/
[2] anomalyco/opencode GitHub — https://github.com/anomalyco/opencode
[3] OpenClaw 官方文档 — https://docs.openclaw.ai/
[4] DeepWiki OpenCode 架构分析 — https://deepwiki.com/sst/opencode/
[5] Auth0 "Securing OpenClaw" — https://auth0.com/blog/five-step-guide-securing-moltbot-ai-agent/
[6] SkillMD "opencode-primitives" — https://skillmd.ai/skills/opencode-primitives/
[7] Milvus "What Is OpenClaw?" — https://milvus.io/blog/openclaw-formerly-clawdbot-moltbot-explained-a-complete-guide-to-the-autonomous-ai-agent.md
[8] pookie "AI Coding Agents Advanced Guide" — https://www.youtube.com/watch?v=DAaw7Ao_zUc
