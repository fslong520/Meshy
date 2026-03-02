# OpenCode 深度技术调研：可直接对照开发的实现参考

> **调研日期**：2026-02-23
> **调研对象**：[sst/opencode](https://github.com/anomalyco/opencode) (v1.2.10, 108K+ Stars, TypeScript)
> **调研目的**：提取与"多智能体协作平台"需求高度贴合的架构设计、代码模式与实现细节，作为加速开发的第一手参考。

---

## Executive Summary

OpenCode 是当前最成熟的开源 AI Coding Agent，其架构已从早期的 Go 单体演进为 TypeScript monorepo (packages/opencode, packages/sdk, packages/web, packages/desktop 等)。它在 **多模型抽象网关**、**ACI 工具链**、**Markdown 驱动的技能/智能体系统**、**权限级联** 等维度上的实现，与我们的平台需求有极高重合度。

---

## 1. 多模型抽象网关 (Provider Gateway)

### 1.1 架构概览

| 维度 | OpenCode 实现 | 对应我们的设计层 |
|------|--------------|-----------------|
| 入口 | `packages/opencode/src/provider/provider.ts` | Layer 4: AI 模型抽象网关 |
| 适配器 | 基于 [Vercel AI SDK](https://ai-sdk.dev/) + [Models.dev](https://models.dev) | `ILLMProvider` 接口 |
| 流式统一 | SSE via `packages/opencode/src/server/server.ts` | `StandardStreamChunk` |
| 转译层 | `packages/opencode/src/provider/transform.ts` | Adapter Engine |

### 1.2 关键实现细节

**支持 75+ 提供商**，通过统一的 `npm` 包机制接入：
```json
{
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": { "baseURL": "http://localhost:11434/v1" },
      "models": {
        "llama2": { "name": "Llama 2" }
      }
    }
  }
}
```

**关键代码文件（可直接参考）**：
- `packages/opencode/src/provider/provider.ts` — Provider 工厂，实例化各驱动
- `packages/opencode/src/provider/transform.ts` — 跨模型 payload 转译（tool_use ↔ tool_calls）
- `packages/opencode/src/provider/models.ts` — 模型元数据与限制定义
- `packages/opencode/src/provider/sdk/copilot/` — GitHub Copilot 特殊适配器示例

**认证管理**：API Keys 通过 `/connect` 斜杠命令交互式配置，统一存储在 `~/.local/share/opencode/auth.json`。

**自动降级 (Fallback)**：通过 `provider` 配置的 `baseURL` 和网关层错误捕获实现。

### 1.3 与我们需求的映射

| 我们的需求 | OpenCode 的解法 | 可复用程度 |
|-----------|----------------|-----------|
| 统一 `ILLMProvider` 接口 | Vercel AI SDK 做底层抽象 | ⭐⭐⭐⭐⭐ 直接可用 |
| OpenAI/Claude/Gemini 适配器 | `transform.ts` 做格式转换 | ⭐⭐⭐⭐ 高度参考 |
| 统一流式输出 `AgentMessageEvent` | SSE 服务端推送 | ⭐⭐⭐⭐ 架构可照搬 |
| 本地 Ollama/vLLM 接入 | `@ai-sdk/openai-compatible` 模式 | ⭐⭐⭐⭐⭐ 开箱即用 |
| 自动降级重试 | 网关层错误捕获 + fallback provider | ⭐⭐⭐ 需自研 |

---

## 2. ACI 核心工具链 (Agent-Computer Interface)

### 2.1 内置工具全清单

OpenCode 提供 **15 个内置工具**，全部定义在 `packages/opencode/src/tool/` 目录：

| 工具名 | 功能 | 代码文件 | 关键特性 |
|--------|------|---------|---------|
| `read` | 读取文件 | `read.ts` | **支持 offset/limit 分页**，大文件不会撑爆上下文 |
| `edit` | 修改文件 | `edit.ts` | **SEARCH/REPLACE 块模式**，绝不全文覆写 |
| `write` | 创建/覆写文件 | `write.ts` | 新建文件使用 |
| `patch` | 应用补丁 | `patch.ts` | 支持 diff 格式 |
| `bash` | 执行 Shell | `bash.ts` | 沙盒化命令执行 |
| `grep` | 正则搜索 | `grep.ts` | 底层使用 ripgrep |
| `glob` | 模式匹配 | `glob.ts` | 文件发现 |
| `list` | 目录列表 | `list.ts` | 带 glob 过滤 |
| `lsp` | LSP 集成 | `lsp.ts` | **实验性** — goToDefinition, findReferences, hover 等 |
| `skill` | 技能加载 | `skill.ts` | 按需加载 SKILL.md |
| `todowrite` | 任务管理 | `todowrite.ts` | 追踪多步骤任务进度 |
| `todoread` | 读取任务 | `todoread.ts` | 读取当前任务列表状态 |
| `webfetch` | 抓取网页 | `webfetch.ts` | 获取 URL 内容 |
| `websearch` | 搜索网页 | `websearch.ts` | 基于 Exa AI |
| `question` | 向用户提问 | `question.ts` | **阻断机制** — Agent 挂起等待用户回答 |

### 2.2 Edit 工具的 SEARCH/REPLACE 模式

```text
// packages/opencode/src/tool/edit.txt 定义的用法：
Use SEARCH/REPLACE blocks to identify and modify code.
```

**核心逻辑**：Agent 提供要替换的精确文本块（SEARCH），以及替换后的文本（REPLACE）。底层通过模糊匹配 + 行号定位实现精准编辑，避免全文覆写导致的 Token 浪费和并发冲突。

### 2.3 LSP 集成

```
packages/opencode/src/lsp/
├── client.ts    # LSP 客户端，与语言服务器通信
├── server.ts    # LSP 服务器管理（启动/停止/生命周期）
└── ...
```

**实验性功能**（需 `OPENCODE_EXPERIMENTAL_LSP_TOOL=true`）：
- `goToDefinition` — 跳转到定义
- `findReferences` — 查找引用
- `hover` — 悬浮信息
- `documentSymbol` / `workspaceSymbol` — 符号搜索
- `goToImplementation` — 跳转实现
- `prepareCallHierarchy` / `incomingCalls` / `outgoingCalls` — 调用关系

### 2.4 权限控制系统

```json
{
  "permission": {
    "edit": "allow",
    "bash": "ask",
    "webfetch": "allow",
    "mymcp_*": "deny"
  }
}
```

三级权限：`allow`（直接执行）| `ask`（需用户确认）| `deny`（禁用）。支持通配符匹配。

### 2.5 与我们需求的映射

| 我们的需求 | OpenCode 的解法 | 可复用程度 |
|-----------|----------------|-----------|
| 带行号分页的 ReadFile | `read.ts` + offset/limit | ⭐⭐⭐⭐⭐ |
| SEARCH/REPLACE EditFile | `edit.ts` SEARCH/REPLACE 块 | ⭐⭐⭐⭐⭐ |
| 文件防并发 (Hash/Timestamp) | edit 前的文件校验机制 | ⭐⭐⭐⭐ |
| LSP 诊断拦截 | `lsp/` 目录实验性工具 | ⭐⭐⭐ 需扩展 |
| AskUser 阻断 | `question` 工具 | ⭐⭐⭐⭐⭐ |
| 执行沙盒模式 (SMART/YOLO) | `permission` 三级体系 | ⭐⭐⭐⭐ 需增强 |

---

## 3. 智能体系统 (Agent System)

### 3.1 原生智能体清单

| Agent 名 | 模式 | 用途 | 工具权限 |
|----------|------|------|---------|
| `build` | primary | 默认主力开发智能体 | 全部允许 |
| `plan` | primary | 规划分析，不修改代码 | edit 全部 deny |
| `general` | subagent | 通用子智能体，多步骤研究 | 大部分允许，deny todo |
| `explore` | subagent | 快速代码探索，只读 | 仅 grep/glob/list/bash/read |
| `compaction` | 隐藏 | 上下文压缩 | 全部 deny |
| `title` | 隐藏 | 生成会话标题 | 全部 deny, temp=0.5 |
| `summary` | 隐藏 | 生成会话摘要 | 全部 deny |

### 3.2 智能体定义方式

**方式一：JSON 配置 (opencode.json)**
```json
{
  "agent": {
    "code-reviewer": {
      "description": "Reviews code for best practices",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "You are a code reviewer...",
      "tools": { "write": false, "edit": false }
    }
  }
}
```

**方式二：Markdown 文件**
```markdown
<!-- .opencode/agents/review.md -->
---
description: Reviews code for quality
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
tools:
  write: false
  edit: false
  bash: false
permission:
  bash:
    "git diff": allow
    "git log*": allow
---
You are in code review mode. Focus on:
- Code quality and best practices
- Potential bugs and edge cases
```

### 3.3 子智能体委派机制 (Task Tool)

```
packages/opencode/src/tool/task.ts
```

- **主控 Agent** 通过内置 `task` 工具发起子任务委派
- **上下文沙盒**：子智能体仅接收裁剪后的最小上下文
- **生命周期**：完成后结果汇总回主控，子会话可通过 `Leader+Right/Left` 导航
- **权限继承**：`permission.task` 字段控制哪些子智能体可被调用

### 3.4 权限级联合并规则

```
Base defaults → User-level permissions → Agent-specific defaults → Agent config overrides
```

合并通过 `PermissionNext.merge()` 实现，位于 `packages/opencode/src/permission/next.ts`。

### 3.5 与我们需求的映射

| 我们的需求 | OpenCode 的解法 | 可复用程度 |
|-----------|----------------|-----------|
| Markdown 驱动的 Subagent 配置 | `.opencode/agents/*.md` | ⭐⭐⭐⭐⭐ 完美匹配 |
| Manager/Worker 委派模式 | `task.ts` 工具 | ⭐⭐⭐⭐ |
| 上下文裁剪与沙盒隔离 | 子智能体仅接收最小上下文 | ⭐⭐⭐⭐ |
| `@agent:` 显式唤醒 | `@` 提及调用子智能体 | ⭐⭐⭐⭐⭐ |
| 权限级联覆盖 | 4 层合并策略 | ⭐⭐⭐⭐⭐ |

---

## 4. 技能系统 (Skill System)

### 4.1 技能定义格式

```markdown
<!-- .opencode/skills/git-release/SKILL.md -->
---
name: git-release
description: Create consistent releases and changelogs
license: MIT
compatibility: opencode
metadata:
  audience: maintainers
  workflow: github
---
## What I do
- Draft release notes from merged PRs
- Propose a version bump
## When to use me
Use this when preparing a tagged release.
```

### 4.2 技能发现路径（优先级从高到低）

1. `.opencode/skills/<name>/SKILL.md` — 项目级
2. `~/.config/opencode/skills/<name>/SKILL.md` — 全局级
3. `.claude/skills/<name>/SKILL.md` — Claude 兼容
4. `.agents/skills/<name>/SKILL.md` — 通用 Agent 兼容

### 4.3 按需加载机制 (Lazy Injection)

```xml
<!-- 技能列表注入到 skill 工具描述中 -->
<available_skills>
  <skill>
    <name>git-release</name>
    <description>Create consistent releases and changelogs</description>
  </skill>
</available_skills>
```

**加载流程**：
1. Agent 在工具描述中看到可用技能列表（仅名称+描述）
2. 需要时调用 `skill({ name: "git-release" })` 加载完整内容
3. 完整的 SKILL.md 正文被注入到当前上下文
4. 使用完毕后在后续消息中自然淡出

### 4.4 权限控制

```json
{
  "permission": {
    "skill": {
      "*": "allow",
      "internal-*": "deny",
      "experimental-*": "ask"
    }
  }
}
```

### 4.5 与我们需求的映射

| 我们的需求 | OpenCode 的解法 | 可复用程度 |
|-----------|----------------|-----------|
| Markdown Skill 文件定义 | SKILL.md + YAML Frontmatter | ⭐⭐⭐⭐⭐ 完美匹配 |
| 延迟热启动注入 | `skill` 工具按需加载 | ⭐⭐⭐⭐⭐ |
| 工具即知识 RAG | 仅注入名称+描述的轻量索引 | ⭐⭐⭐⭐ |
| 双轨激活（主动/被动） | 用户 `@skill:` 或 Agent 自主调用 | ⭐⭐⭐⭐ |

---

## 5. 会话管理与上下文优化

### 5.1 关键代码文件

| 文件 | 功能 |
|------|------|
| `src/session/index.ts` | 会话生命周期管理 |
| `src/session/compaction.ts` | 上下文压缩（长对话摘要） |
| `src/session/summary.ts` | 会话总结生成 |
| `src/session/message.ts` | 消息结构定义 |
| `src/storage/schema.sql.ts` | SQLite 持久化 Schema |

### 5.2 上下文压缩策略

- **自动触发**：当上下文窗口接近模型限制时，隐藏的 `compaction` Agent 自动运行
- **压缩方式**：总结旧消息、移除冗余工具输出，保留关键状态
- **持久化**：会话存储在本地 SQLite 数据库，支持分支和历史回溯

### 5.3 与我们需求的映射

| 我们的需求 | OpenCode 的解法 | 可复用程度 |
|-----------|----------------|-----------|
| Session 状态管理 | SQLite 本地存储 | ⭐⭐⭐⭐ |
| `/summarize` 压缩 | `compaction` 隐藏 Agent | ⭐⭐⭐⭐⭐ |
| Session 切片池 | 每个子任务独立 session | ⭐⭐⭐⭐ |
| Token 消耗追踪 | 内置 token 计数 | ⭐⭐⭐ |

---

## 6. 配置系统 (Configuration)

### 6.1 多级配置体系

```
[全局] ~/.config/opencode/opencode.json
  ↓ 被覆盖
[项目] <project>/.opencode/opencode.json 或 opencode.json
  ↓ 被覆盖
[环境变量/CLI 参数] --provider=claude 等
```

### 6.2 配置文件结构

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": { /* 模型提供商配置 */ },
  "agent": { /* 智能体定义 */ },
  "permission": { /* 权限规则 */ },
  "command": { /* 自定义斜杠命令 */ },
  "plugin": [ /* 插件列表 */ ],
  "small_model": "openai/gpt-5-nano",
  "share": "enabled",
  "default_agent": "build"
}
```

### 6.3 与我们需求的映射

| 我们的需求 | OpenCode 的解法 | 可复用程度 |
|-----------|----------------|-----------|
| 三级配置级联 | Global → Project → Session | ⭐⭐⭐⭐⭐ 完美匹配 |
| 配置防污染 | Agent 不能越权修改全局配置 | ⭐⭐⭐⭐ |
| YAML/JSON 配置格式 | JSON + JSON Schema 验证 | ⭐⭐⭐⭐⭐ |

---

## 7. 斜杠命令与 UI 交互

### 7.1 自定义命令系统

**Markdown 命令定义**：
```markdown
<!-- .opencode/commands/test.md -->
---
description: Run tests with coverage
agent: build
model: anthropic/claude-3-5-sonnet-20241022
---
Run the full test suite with coverage report.
Focus on the failing tests and suggest fixes.
```

**支持的特殊语法**：
- `$ARGUMENTS` / `$1` `$2` — 命令参数
- `` !`command` `` — 注入 Shell 输出
- `@file.ts` — 引用文件内容

### 7.2 内置命令

`/init`, `/undo`, `/redo`, `/share`, `/help`, `/connect`, `/models`, `/compact`

### 7.3 @ 提及调用

用户通过 `@agent-name` 在消息中直接调用特定子智能体。

### 7.4 与我们需求的映射

| 我们的需求 | OpenCode 的解法 | 可复用程度 |
|-----------|----------------|-----------|
| `/` 斜杠命令 | Markdown 命令定义 + 内置命令 | ⭐⭐⭐⭐⭐ |
| `@` 提及路由 | `@agent-name` 子智能体调用 | ⭐⭐⭐⭐ |
| `#` 符号引用 | 暂无原生支持 | ⭐ 需自研 |

---

## 8. 关键源码文件速查表

| 模块 | 路径 | 说明 |
|------|------|------|
| Provider 工厂 | `src/provider/provider.ts` | 模型实例化 |
| 格式转译 | `src/provider/transform.ts` | 跨模型 payload 适配 |
| Agent 定义 | `src/agent/agent.ts` | 7 个原生 Agent + 权限合并 |
| Agent 提示词 | `src/agent/prompt/*.txt` | 各 Agent 的 System Prompt |
| 工具注册表 | `src/tool/registry.ts` | 工具注册与发现 |
| 文件编辑 | `src/tool/edit.ts` | SEARCH/REPLACE 核心 |
| 任务委派 | `src/tool/task.ts` | 子智能体调度 |
| LSP 客户端 | `src/lsp/client.ts` | 语言服务器通信 |
| 会话管理 | `src/session/index.ts` | 会话生命周期 |
| 上下文压缩 | `src/session/compaction.ts` | 长对话压缩 |
| 权限引擎 | `src/permission/next.ts` | 权限合并逻辑 |
| 配置加载 | `src/config/config.ts` | 多级配置解析 |
| HTTP Server | `src/server/server.ts` | SSE 流式推送 |
| 存储 Schema | `src/storage/schema.sql.ts` | SQLite 持久化 |
| TUI 组件 | `src/cli/cmd/tui/component/` | Ink React 终端 UI |

---

## Sources

[1] OpenCode 官方文档 — https://opencode.ai/docs/ (2026-02-21 更新)
[2] anomalyco/opencode GitHub — https://github.com/anomalyco/opencode (108K+ Stars)
[3] DeepWiki OpenCode 架构分析 — https://deepwiki.com/sst/opencode/
[4] Moncef Abboud "How Coding Agents Actually Work: Inside OpenCode" — https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/
[5] OpenCode Agent Skills 官方文档 — https://opencode.ai/docs/skills/
[6] OpenCode Tools 官方文档 — https://opencode.ai/docs/tools/
[7] OpenCode Agents 官方文档 — https://opencode.ai/docs/agents/
[8] OpenCode Commands 官方文档 — https://opencode.ai/docs/commands/
[9] OpenCode Providers 官方文档 — https://opencode.ai/docs/providers/
