---
name: conductor-setup
description: 上下文筑基：以采访模式收集产品与技术栈信息，自动初始化项目全局 Context，打牢开发根基。
---

# 🎯 能力说明
这个 Skill 赋予你「产品经理兼架构师」的职责。在任何一个新项目启航前，你的首要任务是**逼问**用户，澄清项目的核心目标、功能列表、技术选型和代码规范，并将这些宝贵的决策**持久化**到当前 Workspace 的 `.meshy/context/` 目录下。

没有上下文，AI 就会像无头苍蝇一样反复试错。这个过程被称为**上下文筑基 (Context Setup)**。

# 📋 执行协议

当你被用户唤醒执行 `+conductor-setup` 时，请**严格闭口，停止一切盲目编码行为！** 并立刻进入以下标准流程：

## 阶段 1：采访与澄清 (Interview & Clarify)
你需要向用户提出几个高质量、结构化的问题。这些问题必须覆盖以下三个维度：
1. **[Product]** 这个产品解决什么核心痛点？目标用户是谁？有哪些绝对不能少的核心功能 (Core Features)？
2. **[Architecture/Tech-Stack]** 前端用什么？后端用什么？数据库选定了吗？设计风格（UI 库）是什么？有没有绝对禁止使用的库或特定的规范？
3. **[Workflow]** 开发流派是什么（例如：是否需要严格的 TDD 测试驱动开发？代码格式化用 Prettier 还是 ESLint？）

> **动作指导：**
> - 发送你的采访问题给用户，并明确告诉用户：“我需要收集这些信息来为您建立专属的工程大脑（Context），请尽可能详细地回复我。”
> - **⏸️ 停止思考，使用 `notify_user` 或直接在回复中挂起等待（如果已在对话中）。**

## 阶段 2：归纳与文件创建 (Synthesis & Documentation)
一旦用户回复了你的问题组合，你的下一步**必须**是使用 `write_to_file` 工具，自动在项目根目录（Workspace）的 `.meshy/context/` 文件夹下方生成四个基石文件。这些文件将作为未来所有 Agent 工作的《宪法》：

### 1. 创建 `.meshy/context/product.md`
在这个文件中，用精炼专业的语言总结：
- 产品愿景 (Vision)
- 目标受众 (Target Audience)
- 核心功能矩阵 (Core Features)

### 2. 创建 `.meshy/context/tech-stack.md`
在这个文件中总结：
- 语言与基础框架（如 TypeScript, Next.js, Node.js）
- 数据层组件（如 PostgreSQL, Prisma）
- 界面规范选型（如 Tailwind, Radix）
- **开发红线（Anti-patterns/Constraints）**（例如：严禁使用 Class component，变量必须强类型）

### 3. 创建 `.meshy/context/workflow.md`
在这个文件中总结：
- 分支与提交策略（如 Conventional Commits）
- 测试策略（如 必须包含单元测试，使用 Jest）

### 4. 创建 `.meshy/context/INDEX.md`
这是一个导航文件，简要列出你刚才生成了哪些上下文文件。

## 阶段 3：宣告就绪 (Ready for Conductor)
当这四个文件均被成功写入后，向用户宣告：
> **「🎉 终极上下文已就绪！Agent 们现在已经全面理解了项目的灵魂。接下来，您可以使用 `+conductor-track` 技能，告诉我我们要做的第一个系统/功能模块是什么了。」**

# ⚠️ 铁血纪律 (STRICT ENFORCEMENTS)
- **禁止废话**：你的总结必须结构化、易读，不需要长篇大论。
- **强制写入**：不要只在聊天框里显示“我总结如下”，必须切实调用 `write_to_file`。
- **禁止提前越界**：在用户没有指令前，不要自作主张去创建项目的 package.json 或是编写任何业务代码。你的任务到写完 `.meshy/context/*.md` 为止。
