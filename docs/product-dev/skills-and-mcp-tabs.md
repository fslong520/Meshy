# Skills and MCP Tabs: Product Design

## Overview
As Meshy evolves into a comprehensive AI Agent platform, providing visibility into the agent's capabilities becomes critical. The Web UI currently features a chat-centric interface. This design document outlines the addition of two new dedicated tabs—**Skills** and **MCP Servers**—to give users a birds-eye view and control over the agent's extended capabilities.

## 1. Skills Tab (Agent Capabilities)

### Objective
Provide visibility into the declarative skills (Markdown-based prompts and tool schemas) available in the current workspace (`.agent/skills/` or `.meshy/skills/`).

### User Interface Design
- **List View**: A sidebar or grid displaying all loaded skills.
  - Each item shows the Skill Name, Description, and tags/keywords.
- **Detail View**: 
  - **Frontmatter Info**: Shows declared tools, expected inputs, and version info.
  - **Prompt Body**: A read-only (or editor) view of the actual `SKILL.md` content.
- **Interactions**:
  - **Quick Test**: A button that pre-fills the chat input with `@skill-name ` to quickly invoke it.
  - **Enable/Disable**: (Future) Toggle whether the agent is allowed to route to this skill automatically.
  - **Edit**: (Future) Connect to a Monaco editor to modify the prompt on the fly.

### Data Flow
- **Backend API**: The Daemon provides a `skills:list` RPC or the frontend calls the agent with a `core.listSkills()` tool invocation to fetch metadata.
- **State**: The UI holds a cached list of skills, updating on reconnect or manual refresh.

## 2. MCP Servers Tab (External Integrations)

### Objective
Model Context Protocol (MCP) servers provide crucial external context and tool execution capabilities (e.g., GitHub, Postgres, Browser). Users need to know which servers are running, their health, and what tools they expose.

### User Interface Design
- **Server Dashboard**: A list of configured MCP servers.
- **Status Indicators**:
  - 🟢 Connected
  - 🟡 Connecting / Reconnecting
  - 🔴 Disconnected / Error
- **Server Detail Panel**:
  - **Configuration**: The exact command and arguments used to spawn the server (read from `mcp.json`).
  - **Tools List**: A table showing the tools exposed by this server (Name & Description).
  - **Resources/Prompts**: If the server exposes MCP Resources or Prompts, list them here.
- **Interactions**:
  - **Restart Server**: A button to kill and restart the MCP server process if it hangs.
  - **View Logs**: An expandable section showing the `stderr` output of the MCP process for debugging connection issues.

### Data Flow
- **Backend API**: The Daemon exposes a `mcp:list` RPC returning the current status, exposed tools, and recent logs of all managed MCP servers.
- **Real-time Updates**: The Daemon broadcasts `mcp:status_changed` events so the UI can reflect disconnections or crashes instantly.

## 3. Integration with the Chat Interface

While these tabs provide a dedicated management surface, they also enhance the core Chat tab:
- **@-Mentions**: The `@` menu in the chat input should populate its autocomplete items directly from the Skills registry and MCP tools list.
- **Tool Call Visibility**: When the agent uses an MCP tool, the chat timeline should clearly indicate *which* server processed the request (e.g., `Tool: github_search (via MCP)`).

## Implementation Phasing

**Phase 1: Read-Only Visibility (Current Target)**
- Implement `skills:list` and `mcp:list` RPCs in the Daemon.
- Build the basic list and detail views in the React frontend.
- Show connection statuses for MCP.

**Phase 2: Management & Interactivity**
- Add buttons to restart MCP servers.
- Add an embedded editor for SKILL.md files.
- Add log streaming for MCP debugging.
