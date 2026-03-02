# 进阶指挥法：高维 AI 编排体系 (Advanced AI Orchestration)

> **"You are the Director. The Agents are your actors."**

仅仅了解 `Conductor Workflow`（Setup -> Track -> Implement -> Review）能让你像一个稳重的项目经理一样交付中型功能。但要真正释放 Meshy 多 Agent 系统的全部潜能，你需要掌握跨技能组合、并发协作、以及微距操控的高阶技巧。

本文面向**追求极致代码质量与架构掌控力**的高阶程序员。

---

## 一、铁血组合技 (The Ironclad Combos)

单个 Skill 是单一维度的规则强化，而**组合触发**则能产生类似化学反应的极强防御层。

### 1. 架构防御阵线：`+conductor-track` ✖️ `+decision-matrix`
**适用场景**：你要重构核心鉴权模块，或者引入一个新的微服务。此时，极容易因为 AI 的“幻觉级果断”走上一条死路。
**触发连招**：
> `+conductor-track +decision-matrix 我们要废弃 session 登录，改用基于 Redis 的微服务 JWT 签发。请给出业务 Track 与方案对比。`

**效果**：
Planner 在生成 `spec.md` 和 `plan.md` 之前，会强制被 `decision-matrix` 打断。它会抛出 3 种 JWT 刷新的实现方案（双 Token 轮转 vs 白名单），等你定好基调后，再落笔生成不可篡改的 `plan.md`。

### 2. 极致质量闭环：`+conductor-implement` ✖️ `+strict-tdd`
**适用场景**：你在写算法、解析器，或是极为敏感的支付扣款逻辑。
**触发连招**：
> `+conductor-implement <track-id> +strict-tdd`

**效果**：
无情执行机器遇到了魔鬼教练。在 Implement 阶段试图完成 `[ ] Task 1.1: 编写佣金计算器` 时，AI 不敢直接在 `src/` 里写业务逻辑。它会被强制转入 `tests/`，写出 `commission.test.ts`，运行测试（由于没有业务代码必定标红 🔴），然后才能动手写业务让它变绿 🟢，最后重构 🔵 收尾。

---

## 二、异步并发压制：终端控制流

在 Meshy Phase 7 更新后，系统已支持 **Background Terminal & Command Execution**。高级指挥官应善于利用这一盲点视角的巨大优势。

### 1. 前后端双开护航
不要再让前端出 Mock 数据了。真实战场上，你应该：
1. 召唤 Agent：`启动后端服务 npm run dev`。此命令会通过 `run_command` 生效，获得一个 `CommandId`，服务长驻云中。
2. 正常走 `+conductor-implement` 做前端页面。
3. 如果前端报跨域错或 500！AI 可以瞬间调取 `command_status [CommandId]` 偷窥后端服务滑动窗口输出的 Exception 报错栈。**这是真正意义上的全栈联调！**

### 2. E2E 快照黑盒验收
在 `+conductor-review` 阶段，为了防止大模型自己骗自己（“我看我写的代码没毛病”），你可以在 `.meshy/context/workflow.md` 中立下一个规矩：
> *"所有核心组件 review 之前，必须在后台跑一遍 Cypress/Playwright，截图发给我看。"*

借助 `run_command` 唤起带 headless 的自动化测试甚至截图脚本，再辅以 Visual Regression 检测。

---

## 三、降维与升维打击策略

大模型不是万能的，成本与时间也是宝贵的。你需要学会辨别何时用高炮，何时用步枪。

### 1. 降维操作（微操修正）
当你走在 `+conductor-implement` 流水线中，发现 Phase 2 渲染列表的一个 CSS 颜色稍微重了一点点。
**不要立刻打断计划流**。
你应该暂时忽略它，打开一个平行的 Workspace，或者直接召唤底层的 `Default` Agent：
> `@Default 帮我把 App.tsx 第 30 行的 text-gray-800 换成 600。`
让轻量级特种兵解决微瑕，而不去惊动正在走重流程的 Builder。

### 2. 升维操作（推翻重来）
如果 `+metis-analysis` 在审视你的计划时，警告你当前的数据库选型完全支撑不了高并发，或者是 `+conductor-review` 打出了 🔴 致命驳回。
你应该立刻切换回战略维度：
> `@Planner 打开 .meshy/plans/xxx/spec.md，加上一行对 Redis 缓冲池的支持说明，然后自动向下级连修改所有的 plan.md !`

---

## 四、打造自定义 Micro-Team (扩展指南)

这套体系并非定死。由于 `.meshy/context` 是标准的 Markdown 文件集，你可以随时使用自己的脚本扩编队伍。

例如：新增一个专门做国际化的 Agent 叫 `@i18n-master`。
你只需要让它永远阅读 `.meshy/context/product.md`，然后给它发号施令。只要底层的数据金字塔（Context -> Track -> Plan）是稳固的，上面挂多少个牛鬼蛇神的专用 Agent，你的代码都不会乱。

**记住：AI 时代，最稀缺的不再是写代码的能力，而是将系统复杂度降解为无歧义工单的指挥艺术。**
