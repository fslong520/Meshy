# OpenClaw 深度技术调研：可直接对照开发的实现参考

> **调研日期**：2026-02-23
> **调研对象**：[OpenClaw](https://docs.openclaw.ai/) (原名 Moltbot/Clawdbot, TypeScript)
> **调研目的**：提取与"多智能体协作平台"中守护进程、沙盒执行、自动化调度、安全护栏、可观测性、自进化机制相关的设计模式与实现细节。

---

## Executive Summary

OpenClaw 是一个"有手有脚"的自主 AI Agent 平台——它不仅能对话，还能直接操控文件系统、浏览器、终端命令、消息通道（WhatsApp/Telegram/Discord/Slack 等），并通过 Heartbeat 调度器实现主动式的后台常驻。其 **Gateway 架构**、**多智能体隔离沙盒**、**分层安全策略**、**自进化 Ritual 文件体系** 与我们平台在 P3-P5 阶段的需求高度匹配。

---

## 1. Gateway 守护进程架构 (Daemon Architecture)

### 1.1 核心架构

OpenClaw 的核心是一个 **长生命周期的 Gateway 守护进程**，作为所有 AI Agent 操作的单一控制平面。

```
┌─────────────────────────────────────────────┐
│           Gateway Daemon (Port 18789)       │
│  ┌─────────┬──────────┬──────────────────┐  │
│  │ WebSocket│ REST API │  Event Bus       │  │
│  │ Server   │ Endpoint │  (agent/chat/    │  │
│  │          │          │   health/cron)   │  │
│  └─────────┴──────────┴──────────────────┘  │
│                    ↕                         │
│  ┌──────────────────────────────────────┐   │
│  │      Channel Adapters               │   │
│  │  WhatsApp │ Telegram │ Discord │ ... │   │
│  └──────────────────────────────────────┘   │
│                    ↕                         │
│  ┌──────────────────────────────────────┐   │
│  │     Agent Runtime (per-agent)       │   │
│  │  Workspace │ Session │ Tools │ Auth  │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### 1.2 关键特性

| 特性 | 实现细节 |
|------|---------|
| **长驻运行** | `openclaw gateway` 命令启动守护进程 |
| **无头部署** | Docker/Podman + systemd Quadlets，rootless 容器管理 |
| **Heartbeat 心跳** | 周期性唤醒 Agent 处理收件箱、监控任务、执行维护 |
| **事件总线** | 发射 `agent`, `chat`, `presence`, `health`, `heartbeat`, `cron` 事件 |
| **多网关** | 支持多个 Gateway 实例并行运行 |
| **健康检查** | `openclaw health` + 内置健康端点 |
| **Gateway 锁** | 防止多实例冲突 |

### 1.3 Heartbeat vs Cron 调度

| 维度 | Heartbeat | Cron |
|------|-----------|------|
| **触发方式** | 内部脉冲，Agent 自主检查 | 固定时间间隔触发 |
| **定义文件** | `HEARTBEAT.md` 模板 | `openclaw cron` CLI 管理 |
| **用途** | "现在有什么需要关注的？" | "每周一早9点执行X" |
| **灵活性** | 高——Agent 可自主判断是否行动 | 低——固定时间固定任务 |

### 1.4 与我们需求的映射

| 我们的需求 | OpenClaw 的解法 | 可复用程度 |
|-----------|----------------|-----------|
| 后台守护进程 (Daemon) | Gateway 长驻进程 | ⭐⭐⭐⭐⭐ |
| 无头化支持 (Headless) | Docker + systemd 部署 | ⭐⭐⭐⭐ |
| WebSocket/REST API 前后端分离 | Gateway 暴露 WS + REST | ⭐⭐⭐⭐⭐ |
| Telemetry Hooks | 事件总线 emit 机制 | ⭐⭐⭐⭐ |

---

## 2. 多智能体路由与沙盒隔离

### 2.1 Agent 隔离模型

OpenClaw 中每个 Agent 是一个 **完全隔离的"大脑"**：

```
~/.openclaw/
├── agents/
│   ├── main/
│   │   ├── agent/
│   │   │   └── auth-profiles.json    # 独立认证
│   │   └── sessions/                 # 独立会话存储
│   ├── coding/
│   │   ├── agent/
│   │   └── sessions/
│   └── family/
│       ├── agent/
│       └── sessions/
├── workspace/                        # main 的工作区
├── workspace-coding/                 # coding 的工作区
└── workspace-family/                 # family 的工作区
```

**关键设计**：
- **Workspace 隔离**：每个 Agent 独立的文件系统工作区
- **Auth 隔离**：认证信息按 Agent 分离，绝不共享
- **Session 隔离**：聊天历史和路由状态完全独立
- **人格隔离**：每个 Agent 有独立的 `AGENTS.md`、`SOUL.md`、`USER.md`

### 2.2 消息路由 Binding 机制

```json
{
  "bindings": [
    {
      "agentId": "coding",
      "match": {
        "channel": "telegram",
        "accountId": "coding-bot"
      }
    },
    {
      "agentId": "family",
      "match": {
        "channel": "whatsapp",
        "peer": { "kind": "group", "id": "120363xxx@g.us" }
      }
    }
  ]
}
```

**路由优先级**（最具体优先）：
1. `peer` 精确匹配（DM/群组/频道 ID）
2. `parentPeer` 匹配（线程继承）
3. `guildId + roles`（Discord 角色路由）
4. `guildId` / `teamId`
5. `accountId` 匹配
6. 频道级匹配（`accountId: "*"`）
7. 回退到默认 Agent

### 2.3 沙盒配置

```json
{
  "agents": {
    "list": [
      {
        "id": "personal",
        "sandbox": { "mode": "off" }
      },
      {
        "id": "family",
        "sandbox": {
          "mode": "all",
          "scope": "agent",
          "docker": {
            "setupCommand": "apt-get update && apt-get install -y git curl"
          }
        },
        "tools": {
          "allow": ["read"],
          "deny": ["exec", "write", "edit", "apply_patch", "browser"]
        }
      }
    ]
  }
}
```

**沙盒模式**：
| 模式 | 行为 |
|------|------|
| `off` | 不沙盒化，直接在宿主机运行 |
| `all` | 所有操作都在 Docker 容器中运行 |
| `non-main` | 仅非主会话沙盒化 |

**沙盒作用域**：
| 作用域 | 行为 |
|--------|------|
| `session` | 每个会话一个容器 |
| `agent` | 每个 Agent 一个容器 |
| `shared` | 所有 Agent 共享容器 |

### 2.4 与我们需求的映射

| 我们的需求 | OpenClaw 的解法 | 可复用程度 |
|-----------|----------------|-----------|
| Agent Teams 群组化兵团 | Multi-Agent 隔离架构 | ⭐⭐⭐⭐⭐ |
| 多模态虚拟专家看板 | 独立 Workspace + Session 隔离 | ⭐⭐⭐⭐ |
| 沙盒化 Terminal PTY | Docker 容器 + PTY 支持 | ⭐⭐⭐⭐⭐ |
| 消息路由 Binding | 确定性 Binding 规则 | ⭐⭐⭐⭐ |

---

## 3. 工具系统与执行控制

### 3.1 核心工具清单

| 工具 | 功能 | 文档 |
|------|------|------|
| `exec` | Shell 命令执行 | 支持 PTY、后台运行、超时、提权 |
| `process` | 后台进程管理 | 监控长时间运行的任务 |
| `read` / `write` / `edit` | 文件操作 | 类似 OpenCode |
| `apply_patch` | 应用补丁 | diff 格式修改 |
| `browser` | 浏览器自动化 | OpenClaw 托管的 Chromium |
| `sessions_*` | 会话管理 | 列表/历史/发送/生成 |
| `memory_*` | 记忆系统 | 搜索/获取持久化记忆 |
| `cron` | 定时任务 | 管理周期性任务 |
| `gateway` | 网关控制 | 管理 Gateway 状态 |
| `agent_send` | Agent 间通信 | 跨 Agent 消息传递 |
| `llm_task` | LLM 子任务 | 委派给其他模型 |
| `lobster` | 工作流引擎 | 带审批门控的组合管道 |

### 3.2 exec 工具详细参数

```json
{
  "tool": "exec",
  "parameters": {
    "command": "npm test",
    "workdir": "/project",
    "env": { "NODE_ENV": "test" },
    "pty": true,
    "elevated": false,
    "timeout": 1800,
    "background": false,
    "yieldMs": 10000
  }
}
```

**关键行为**：
- `pty: true` — 分配伪终端，支持交互式命令
- `background: true` — 立即后台化
- `yieldMs` — 超过此时间自动后台化（默认 10s）
- `elevated` — 提权到宿主机执行（需显式允许）
- `timeout` — 超时自动 kill（默认 1800s）

### 3.3 工具限制层级

```
1. Tool profile (tools.profile)
2. Provider tool profile (tools.byProvider[provider].profile)
3. Global tool policy (tools.allow / tools.deny)
4. Provider tool policy (tools.byProvider[provider].allow/deny)
5. Agent-specific tool policy (agents.list[].tools.allow/deny)
6. Agent provider policy
7. Sandbox tool policy
8. Subagent tool policy
```

每一层只能进一步限制，不能恢复上层已禁止的工具。

### 3.4 工具组快捷方式

| 组名 | 包含工具 |
|------|---------|
| `group:runtime` | exec, bash, process |
| `group:fs` | read, write, edit, apply_patch |
| `group:sessions` | sessions_list, sessions_history, sessions_send, sessions_spawn, session_status |
| `group:memory` | memory_search, memory_get |
| `group:ui` | browser, canvas |
| `group:automation` | cron, gateway |
| `group:messaging` | message |

### 3.5 与我们需求的映射

| 我们的需求 | OpenClaw 的解法 | 可复用程度 |
|-----------|----------------|-----------|
| 全隔离虚拟终端 (Multi-PTY) | exec + pty + background | ⭐⭐⭐⭐⭐ |
| SMART 模式分级审批 | 8 层工具限制 + elevated | ⭐⭐⭐⭐⭐ |
| 白名单/黑名单过滤 | allow/deny + tool groups | ⭐⭐⭐⭐⭐ |
| 熔断器 (Circuit Breaker) | timeout + usage tracking | ⭐⭐⭐⭐ |

---

## 4. 安全与护栏体系

### 4.1 安全审计工具

```bash
openclaw security audit          # 基础安全检查
openclaw security audit --deep   # 深度扫描
openclaw security audit --fix    # 自动修复
openclaw security audit --json   # JSON 输出
```

### 4.2 Elevated 提权模式

```json
{
  "tools": {
    "elevated": {
      "enabled": true,
      "allowlist": ["+15551234567"]
    }
  }
}
```

- 仅白名单内的用户可以触发提权操作
- 提权后 Agent 可在宿主机直接执行命令
- 每个 Agent 可独立禁用提权

### 4.3 形式化验证

OpenClaw 提供了 **形式化安全模型验证**，通过数学证明的方式验证配置安全性。

### 4.4 与我们需求的映射

| 我们的需求 | OpenClaw 的解法 | 可复用程度 |
|-----------|----------------|-----------|
| SMART 三级审批 | elevated + allowlist + ask | ⭐⭐⭐⭐⭐ |
| AI 二次审阅 | 可通过 llm_task + approval gate 实现 | ⭐⭐⭐⭐ |
| YOLO 模式 | elevated + sandbox off | ⭐⭐⭐⭐ |
| 安全审计 | `security audit` CLI | ⭐⭐⭐⭐⭐ |

---

## 5. 可观测性与调试

### 5.1 日志系统

```bash
openclaw logs                          # 查看日志
tail -f ~/.openclaw/logs/gateway.log   # 实时追踪
```

- **结构化日志**：按模块分类（routing, sandbox, tools, agent）
- **macOS OSLog**：集成 Unified Logging
- **OpenTelemetry**：`diagnostics-otel` 扩展，支持导出到 Prometheus/Jaeger

### 5.2 会话录像与重放

- 所有交互存储在 `~/.openclaw/workspace/sessions/` 中
- 结构化 Markdown 格式，包含完整的"思考过程"和工具输出
- 支持全量重放 Agent 的决策链路

### 5.3 Token 与成本追踪

- 内置 `usage-tracking` 模块
- 按 Agent、按会话统计 Token 消耗
- 可设置成本上限触发 Circuit Breaker

### 5.4 Dashboard

```bash
openclaw dashboard    # 启动 Web 仪表盘
openclaw tui          # 终端 UI
```

### 5.5 与我们需求的映射

| 我们的需求 | OpenClaw 的解法 | 可复用程度 |
|-----------|----------------|-----------|
| 全链路可观测日志 | 结构化日志 + OpenTelemetry | ⭐⭐⭐⭐⭐ |
| Session 录像重放 | sessions/ 目录 Markdown 存储 | ⭐⭐⭐⭐ |
| Token 计费侧写 | usage-tracking 模块 | ⭐⭐⭐⭐⭐ |
| DevTools 面板 | Dashboard + TUI | ⭐⭐⭐⭐ |

---

## 6. 自进化与记忆系统

### 6.1 Ritual 文件体系

OpenClaw 通过一套 **Ritual 文件** 实现 Agent 的自我进化：

| 文件 | 用途 | 可编辑者 |
|------|------|---------|
| `AGENTS.md` | 定义 Agent 行为规则和工具使用指南 | 用户 + Agent |
| `SOUL.md` | 长期核心人格和进化模式 | 用户 |
| `IDENTITY.md` | 当前名称和个性 | 用户 |
| `USER.md` | 用户偏好和上下文 | 用户 |
| `BOOTSTRAP.md` | 一次性初始化仪式 | 用户 |
| `HEARTBEAT.md` | 心跳循环的指令 | 用户 + Agent |
| `BOOT.md` | 启动时加载的指令 | 用户 |
| `TOOLS.md` | 工具使用补充说明 | 用户 |

### 6.2 Memory 记忆系统

```bash
openclaw memory search "deployment patterns"
openclaw memory get <memory-id>
```

- Agent 可通过 `memory_search` / `memory_get` 工具查询历史经验
- 记忆以结构化方式持久化存储
- 支持语义搜索（基于向量化）

### 6.3 Compaction 压缩机制

- 长会话自动触发上下文压缩
- 保留关键决策和状态信息
- Session Pruning 清理过期数据

### 6.4 自我编码能力

在 `elevated` 模式下，Agent 可以：
- 使用 `apply_patch` 修改自己的 Workspace 文件
- 更新 `AGENTS.md` 添加新的行为规则
- 创建新的 Skills 扩展自身能力
- 修改 `HEARTBEAT.md` 调整自主行为模式

### 6.5 与我们需求的映射

| 我们的需求 | OpenClaw 的解法 | 可复用程度 |
|-----------|----------------|-----------|
| EvoMap 知识胶囊 | Memory 记忆系统 + Ritual 文件 | ⭐⭐⭐⭐ |
| 经验回放与提取 | Session 录像 + Memory 搜索 | ⭐⭐⭐⭐ |
| 点赞飞轮反馈 | BOOTSTRAP.md 初始化仪式 | ⭐⭐⭐ 需扩展 |
| Turso 向量存储 | Memory 持久化（非 Turso） | ⭐⭐⭐ 需替换存储层 |

---

## 7. 关键路径速查表

| 路径 | 说明 |
|------|------|
| `~/.openclaw/openclaw.json` | 主配置文件 |
| `~/.openclaw/workspace/` | 默认 Agent 工作区 |
| `~/.openclaw/agents/<id>/` | 各 Agent 的独立状态 |
| `~/.openclaw/logs/` | 日志目录 |
| `~/.openclaw/skills/` | 全局共享技能 |
| `workspace/AGENTS.md` | Agent 行为定义 |
| `workspace/SOUL.md` | 人格与进化模式 |
| `workspace/HEARTBEAT.md` | 心跳循环指令 |
| `workspace/sessions/` | 会话历史 |

---

## Sources

[1] OpenClaw 官方文档索引 — https://docs.openclaw.ai/llms.txt
[2] OpenClaw Multi-Agent Routing — https://docs.openclaw.ai/concepts/multi-agent
[3] OpenClaw Multi-Agent Sandbox & Tools — https://docs.openclaw.ai/tools/multi-agent-sandbox-tools
[4] OpenClaw Background Exec and Process Tool — https://docs.openclaw.ai/gateway/background-process
[5] OpenClaw Security — https://docs.openclaw.ai/gateway/security
[6] OpenClaw Gateway Architecture — https://docs.openclaw.ai/concepts/architecture
[7] Auth0 "Securing OpenClaw" — https://auth0.com/blog/five-step-guide-securing-moltbot-ai-agent/
[8] AccuKnox "OpenClaw Security: Sandboxing" — https://accuknox.com/blog/openclaw-security-ai-agent-sandboxing-aispm
[9] Milvus "What Is OpenClaw?" — https://milvus.io/blog/openclaw-formerly-clawdbot-moltbot-explained-a-complete-guide-to-the-autonomous-ai-agent.md
[10] Sahara AI "ClawGuard: Verifiable Guardrails" — https://saharaai.com/blog/openclaw-agent-guardrails
