# Multi-Agent Writing Tool & Architecture Research

## 1. Executive Summary
This document provides a comprehensive research analysis on building a multi-agent writing tool similar to Claude's Agent Teams. It synthesizes architectural patterns for coordination, memory optimization strategies to reduce token usage, and self-improvement mechanisms found in frameworks like OpenClaw and Eigent.

## 2. Agent Teams Architecture
The core philosophy of "Agent Teams" is **Context Isolation** and **Task Specialization**. Instead of a single agent handling a massive context window, the system uses a hierarchical "divide and conquer" approach.

### 2.1 The "Orchestrator-Workers" Pattern
- **Team Lead (Orchestrator):** 
  - **Role:** Maintains the high-level plan (e.g., Article Outline, Style Guidelines). It does *not* generate the bulk of the content.
  - **Responsibility:** Spawns worker agents, assigns tasks, and synthesizes results.
  - **State:** Holds the "Global State" (what has been done, what is next).
- **Workers (Sub-agents):** 
  - **Role:** Ephemeral agents instantiated for a specific, bounded task (e.g., "Research Section A", "Draft Chapter 1").
  - **Context:** Each worker starts with a **fresh, optimized context window** containing only the necessary background info for its specific task.
  - **Lifecycle:** Created -> Execute Task -> Return Result -> Terminate.

### 2.2 Communication Protocol
- **Message Passing:** Agents do not share memory directly. They communicate via structured messages (JSON).
  - **Top-down:** Lead sends a "Task Spec" (Context + Instructions).
  - **Bottom-up:** Worker returns a "Result" (Text/Code/Data).
- **Lateral Communication:** Advanced systems (like OpenClaw) allow `agent-send` where workers can message each other (e.g., Drafter asks Researcher for a specific citation) without going through the Lead.

## 3. Case Studies: Open Source Implementations

### 3.1 OpenClaw (CLI & Protocol Focus)
- **Session Management (`sessions_spawn`):**
  - Uses a strict session model. A "Team Lead" spawns a sub-agent using `/subagents spawn`.
  - This creates a **new, isolated process** with its own memory space.
- **Self-Improvement (ClawHub & Learnings):**
  - **Skill Injection:** Agents can "install" skills from a registry (ClawHub). If a writer needs "academic citation formatting," it downloads that specific skill dynamically.
  - **Learning Loop (`.learnings`):** 
    - Agents maintain a `.learnings/` directory (e.g., `ERRORS.md`, `LEARNINGS.md`).
    - **Feedback:** If a user corrects the agent (e.g., "Don't use passive voice"), the agent records this.
    - **Injection:** These learnings are auto-injected into the system prompt of future sessions, preventing repeated mistakes.

### 3.2 Eigent (Desktop & GUI Focus)
- **Repository:** [https://github.com/eigent-ai/eigent](https://github.com/eigent-ai/eigent)
- **Focus:** Local-first, Enterprise "Workforce", Browser Automation.
- **Architecture:** Based on **CAMEL-AI** framework.
- **Key Features:**
  - **Visual Orchestration:** Users can drag-and-drop to create agent workflows (DAGs).
  - **Browser Automation:** Unlike pure text agents, Eigent agents can drive a browser to research on the web, login to sites, and scrape data directly.
  - **Local State:** Uses a local database to persist the "virtual desktop" state, allowing workflows to pause and resume over days.

## 4. Reducing Short-Term Memory (Context Optimization)
To build an efficient writing tool, you must minimize the "Active Context" (RAM) and rely on "Retrieval" (Disk/Long-term Memory). This saves tokens and improves reasoning.

### 4.1 The "Sliding Window + Summary" Pattern
- **Problem:** Feeding a 10,000-word draft to the AI for every new paragraph is expensive and confuses the model.
- **Solution:**
  1.  **Sliding Window:** The agent only sees the last ~2,000 words for immediate continuity/flow.
  2.  **Rolling Summary:** A background "Memory Agent" constantly reads the chat/draft and updates a `summary.md`.
  3.  **Injection:** The System Prompt receives `[Summary of previous chapters]` + `[Last 2k words]`.
  4.  **Result:** The writer knows the *story arc* and *immediate context* but ignores the middle bulk.

### 4.2 RAG for Writers (Long-Term Memory)
- **Implementation:**
  - **Vector Database:** Index user research notes, character bios, and completed chapters in a vector DB (e.g., Chroma, pgvector).
  - **Query-Time Retrieval:** Before writing "Chapter 4", the agent queries: "What did I say about the protagonist's childhood in Chapter 1?".
  - **Tooling:** Use `grep` (keyword) or Vector Search (semantic) to pull relevant "memories" into the context window *just-in-time*.

### 4.3 Structured Artifacts (The "Workspace" Approach)
- **Concept:** The "Chat History" is ephemeral; the "File System" is the source of truth.
- **Context File:** Maintain a `project-status.md` or `story-bible.md`.
- **Workflow:** Agents read this file at startup to understand the current state, rather than reading 500 chat messages.

## 5. Implementation Roadmap for Your Tool
1.  **Phase 1: The Core Loop**
    - Build a `master.py` script that acts as the "Team Lead".
    - Implement a `spawn_agent(task, context)` function that calls the LLM API with a specific system prompt.
2.  **Phase 2: Memory Optimization**
    - Implement a `summarize_text(text)` function.
    - Create a "Context Manager" that assembles the prompt: `System Instruction + Summary + Relevant Research + Current Task`.
3.  **Phase 3: Self-Improvement**
    - Create a `learnings.md` file.
    - Add a "Review" step where the agent critiques its own work and appends lessons to `learnings.md`.
    - Ensure `learnings.md` is read before every generation task.
