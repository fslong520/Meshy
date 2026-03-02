---
name: metis-analysis
description: Advanced pre-flight architecture and boundary vulnerability scanner for Planners.
keywords: ["漏洞", "gap", "metis", "分析", "反思", "architecture", "review"]
---

# 🦉 Metis Analysis Protocol: Architectural & Edge-Case Scanning

## 🎯 Protocol Objective
Named after the Titan goddess of good counsel and planning, the **Metis Analysis Protocol** is a mandatory, silent pre-flight reflection phase. Before you (the Agent) finalize and output any complex architecture design, implementation plan, or mass-refactoring strategy to the user, you must run this heuristic vulnerability scanner.

## 🕵️‍♂️ Diagnostic Dimensions (The Scanner)

Before typing your final response, silently evaluate your proposed plan against these 5 dimensions:

### 1. 🕳️ The "Hidden Assumption" Check
- What implicitly assumed preconditions did I rely on?
- Did I assume the database is always available? Did I assume the user input is already sanitized? 
- Did I assume the target file structure follows a specific framework without verifying it?

### 2. 🪚 The "Edge Case & Error Handling" Check
- What happens during a network partition?
- What happens if the payload exceeds memory limits?
- Are errors swallowed, or are they bubbled up with actionable traces? Have I explicitly defined the failure modes?

### 3. 🕸️ The "Over-Engineering vs. Tech Debt" Check (AI Trap)
- Am I introducing unnecessary abstractions (e.g., generic interfaces for a single implementation) just to look smart?
- Conversely, am I hardcoding scalable configurations that will cause massive technical debt in 3 months?

### 4. 🔗 The "Dependency Viability" Check
- Am I proposing to use a library that is notoriously unstable, deprecated, or bloated?
- Is there a native, zero-dependency way to achieve the exact same result safely?

### 5. 📏 The "Definition of Done (DoD)" Check
- Is my plan actionable? Or is it full of vague steps like "Refactor the module"?
- Can a junior developer take my exact steps and know mathematically when they are finished?

## 📝 Required Output Formatting

Once your internal reflection is complete, you must physically manifest your diagnostic results at the **very bottom** of your final response using the exact Markdown format below. 

```markdown
---

## 🦉 Metis Security & Architecture Diagnostic
*I have scanned the proposed plan for structural vulnerabilities.*

- **⚠️ Identified Risks**: [Concise list of the most critical edge cases, missing error handling, or performance bottlenecks you discovered during reflection].
- **🛡️ Mitigation Applied**: [How your proposed plan was modified to preemptively solve these issues, or what fallback mechanisms were put in place].
- **❓ User Clarification Needed**: [If a choice requires business logic context, list the exact yes/no or A/B question you need the user to answer].
```

*(Note: If the scan yields absolutely zero risks—which is extremely rare for complex systems—state: `Diagnostic Clear: No critical structural vulnerabilities detected.`)*
