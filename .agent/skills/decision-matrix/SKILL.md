---
name: decision-matrix
description: Forces the AI to pause and output a comparative decision matrix at critical technical crossroads instead of guessing.
keywords: ["decision", "matrix", "多选", "方案", "反思", "option", "crossroads", "comparison"]
---

# ⚖️ Multi-Option Decision Matrix Protocol

## 🎯 Protocol Objective
As an AI, you are statistically predisposed to pick the most "popular" or "probable" path when faced with an architectural or technical fork in the road. However, in production environments, the "most popular" choice is often contextually wrong. 
When the **Decision Matrix Protocol** is active, you are strictly forbidden from unilaterally making irreversible or highly consequential technical decisions. You must halt execution, map the topology of available options, and demand human arbitration.

## 🚦 Triggers (When to activate)
You must immediately halt your normal workflow and trigger this protocol when you encounter:
1. **Library / Framework Selection**: E.g., choosing between `Zustand` vs `Redux`, or `Axios` vs `Fetch API`.
2. **Architecture Patterns**: E.g., choosing between Long-Polling, WebSockets, or Server-Sent Events (SSE) for realtime data.
3. **Database Schema Design**: E.g., embedding JSONB documents vs normalizing into relational join tables.
4. **Destructive Operations**: Any mass-deletion or mass-refactoring where the semantic intent of the user was slightly ambiguous.

## 🛑 The Procedure
1. **Halt Execution**: Do not write the code. Do not run the shell commands.
2. **Identify Candidates**: Select $N$ (usually 2 to 4) distinct, viable, and professional approaches to the problem.
3. **Construct the Matrix**: Build a highly readable Markdown table comparing the candidates across empirical dimensions.

## 📝 Required Output Formatting

Your response MUST end with the following structure, acting as a hard breakpoint in the conversation:

```markdown
### ⏸️ Execution Halted: Technical Crossroads Reached

Before we proceed, we need to finalize the architectural direction for this feature. I have mapped out the viable paths below.

| Dimension / Aspect | Option A: [Name/Tech] | Option B: [Name/Tech] | Option C: [Name/Tech] |
| :--- | :--- | :--- | :--- |
| **Core Paradigm** | [Brief conceptual summary] | [Brief conceptual summary] | [Brief conceptual summary] |
| **🟢 Pros** | • Benefit 1<br>• Benefit 2 | • Benefit 1<br>• Benefit 2 | • Benefit 1<br>• Benefit 2 |
| **🔴 Cons** | • Drawback 1<br>• Drawback 2 | • Drawback 1<br>• Drawback 2 | • Drawback 1<br>• Drawback 2 |
| **⏱️ Dev Time** | Low/Medium/High | Low/Medium/High | Low/Medium/High |
| **⚙️ Maintainability**| [Rating + 1 word context] | [Rating + 1 word context] | [Rating + 1 word context] |

**🤖 AI Recommendation**: I lean towards **[Option X]** because [One sentence data-driven justification based on current project root context].

**💡 Custom Idea**: Or, if you have another direction in mind:
> 💬 **Please reply with your selected Option (A, B, C) or provide your own custom idea. I will proceed immediately upon your reply.**
```

Do not proceed until the user explicitly responds with their choice.
