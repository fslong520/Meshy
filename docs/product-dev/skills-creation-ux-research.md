# Skills 创建流程 UX 调研与设计参考

本文档总结了业界领先的 AI IDE（如 Cursor, Roo Code）在自定义 Agent/Skill/Rule 方面的用户体验（UX）设计，并为 Meshy 的 Skills 管理面板提供优化建议。

## 1. 业界竞品调研

### 1.1 Cursor IDE (.mdc Rules)
Cursor 推出了 `.mdc` (Markdown Component) 格式来管理自定义的 AI 规则（Rules）。

- **核心概念**：将领域知识、提问模版、代码规范以 Markdown 文件形式存放在项目的 `.cursor/rules/` 目录下。
- **触发机制**：通过 YAML Frontmatter 定义被动触发条件（如 `globs: ["*.ts"]`）或自动挂载（`alwaysApply: true`）。
- **创建方式**：
  1. **纯净文件流**：鼓励用户直接通过 IDE 新建 `.mdc` 文件，提供 YAML + Markdown 的直接编辑体验。
  2. **AI 辅助生成**：用户可以在 Chat 面板里对 AI 说：“根据当前项目总结一份前端 React 的规范，并保存为 cursor rule”，AI 会在幕后直接生成文件。
- **UX 特点**：极大程度依赖开发者的“文件配置”习惯，UI 面板相对弱化，侧重于与底层文件系统的深度绑定。

### 1.2 Roo Code (Custom Modes)
Roo Code (前身 Cline) 允许用户创建自定义的 "Modes"（特定角色的 AI Agent）。

- **核心概念**：定义独立的 AI Persona（例如：文档专员、测试工程师），每个 Mode 拥有自己的系统提示词和工具权限。
- **创建方式**：
  1. **对话式创建 (Recommended)**：在对话框直接说 "Create a new mode called 'Documentation Writer'"，AI 会引导并自动生成配置。
  2. **表单 UI 创建**：在设置面板 (Modes page) 点击 "Create New Mode"，提供一个结构化的表单：
     - Name (名称)
     - Slug (唯一标识)
     - Role Definition (角色定义：You are a...)
     - Available Tools (按组勾选权限，如 `read, edit, browser, mcp`)
     - Custom Instructions (具体指令)
  3. **底层配置编辑**：直接修改 `.roomodes` 配置文件。
- **UX 特点**：结构化表单结合了自然语言能力。极大地降低了门槛，同时提供了工具级别的颗粒度控制。

### 1.3 通用 AI Builder 平台 (MindStudio, Coze 等)
- 提供丰富的拖拽式画布 (Visual Canvas) 或者表单。
- 强调 Prompt 优化提示（AI 帮你完善你的 Prompt）。
- 可以绑定外挂知识库或插件 (Plugins/Tools)。

### 1.4 Anthropic & Openwork (Meta-Skill Pattern)
近期在 `anthropics/skills` 和 `openwork` 等项目中出现了一种极佳的模式：**Meta-Skill (元技能)**，最典型的代表就是 `skill-creator`。
- **核心概念**：系统内置一个专门用于“创建其他 Skill”的 AI Agent（即 `skill-creator`）。
- **交互流程**：
  1. 用户在对话流中输入 `/skill-creator`。
  2. AI 接管职责，成为你的“构思伙伴 (thought partner)”。它不会一上来就让你填表，而是通过一问一答的方式：
     - "你想让你的新 Skill 做什么？"
     - "你能举个例子吗？"
     - "你需要这个 Skill 访问哪些本地工具或系统命令吗？"
  3. AI 会通过反问来挖掘缺失的上下文（如验证逻辑、边界条件）。
  4. 当信息收集完毕后，AI 会自动帮你按照最佳实践（如 Claude 的长提示词结构）生成完整的 XML 或 Markdown 格式的 Skill 描述文件。
- **UX 特点**：将“配置过程”转变为“对话式教练引导”。这解决了用户“面对空表单不知如何下笔”的核心痛点，是由 AI 原生能力驱动的顶级交互体验。

---

## 2. 对 Meshy Skills UI 的优化启示

目前我们在 `RightPanel` 中实现的是一个纯粹的“文本框编辑”，用户需要手敲 YAML Frontmatter 和长篇的指令。这对于普通用户来说门槛较高，且非常容易出错。

结合调研结果，我们需要对 "Create Skill" 的交互流进行以下升级：

### 🔄 演进阶段 1：结构化表单 (Structured Form)
抛弃单一的 `<textarea>`，转而使用结构化表单来生成 `.md` 文件：
- **基础信息区**：Name（名称，自动转 kebab-case 为文件名）、Description（简短描述）。
- **标签区**：Keywords 输入框（支持按回车生成 tag）。
- **指令输入区**：大文本框专供填充具体的 Markdown 提示词。
- *后端依然调用原有的 `skill:save`，前端负责将这些字段拼装成带有标准 Frontmatter 的 Markdown 文本。*

### 🤖 演进阶段 2：Meta-Skill 对话式创建 (类似 skill-creator)
参考 Anthropic 的模式，我们在 UI 层引入一种全自动但又重度参与的创建流程：
- 在 Create 模态框中提供一个 **"Start Skill Creator Chat"** 的入口（或者在主对话栏输入 `/skill-creator`）。
- 这会激活一个预设好的系统提示词（`skill-creator.md`），使当前的 Assistant 变成“提示词工程师”。
- 助理会通过交互式提问，帮助用户梳理需求边界、预期输入输出。
- 在对话的最后一步，AI 会主动调用 `skill:save` RPC 接口，或者推入一个包含草稿表单的 approval 流程，自动把讨论结果固化为右侧面板里的一个正式 Skill。

### ⚙️ 演进阶段 3：工具权限绑定
- 类似 Roo Code，允许用户在创建 Skill 时，通过 Checklist (复选框) 的形式关联特定的 MCP Server 或本地内置工具（Tool Packs）。
- 将选中的工具注入到 YAML Frontmatter 的 `tools` 字段中。

## 3. 下一步行动计划 (Action Items)

我们将结合上述调研，将目前的交互进行跨越式升级：
1. **重构表单 UI**：重写 `RightPanel -> SkillsTab -> showCreate`，细化为 Name、Description、Instructions 独立控件组合，作为快速创建和编辑的底层支撑。
2. **实现 skill-creator 链路**：
   - 编写一个核心的 `system-skill-creator` Prompt。
   - 当用户在聊天界面输入 `/skill-creator`，或在右侧面板点击 **"✨ Create with Builder"** 按钮时，切入对话流。
   - 对话流的最终产物是一张带有 `(Save to Registry)` 确认按钮的消息卡片，同意后自动调用保存接口完成创建。
