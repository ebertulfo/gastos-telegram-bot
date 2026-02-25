# **The Ultimate Antigravity Agent Workflow Guide**

This guide adapts the five core AI workflow paradigms (Always-on instructions, Skills, Sub-agents, Hooks, and MCP Servers) to **Google Antigravity's** agent-first architecture. By implementing these, you will optimize your context window, automate redundant tasks, and leverage Antigravity's Agent Manager to its full potential.

## **Directory Structure Overview**

To set this up, you will create a specific structure at the root of your repository:

your-project/  
├── .antigravityrules           \# 1\. Always-on instructions (The CLAUDE.md equivalent)  
├── .antigravity/               \# Antigravity specific workspace folder  
│   ├── workflows/              \# 2\. On-demand Skills (Invoked via '/')  
│   │   ├── code-review.md  
│   │   └── security-audit.md  
│   └── terminal-policy.json    \# 4\. Hooks / Terminal Guardrails  
├── .vscode/                    \# (Antigravity inherits VS Code configs)  
│   └── settings.json           \# 5\. MCP Server configurations  
└── src/                        \# Your code

## **1\. Always-On Instructions (.antigravityrules)**

**Concept:** The CLAUDE.md equivalent. These are non-negotiable, always-in-context instructions that Antigravity reads during the **Planning** phase of every task.

**How to set it up in Antigravity:**

1. Create a file named .antigravityrules in the root of your project.  
2. Because Antigravity agents read this globally, keep it strictly to high-level architectural rules to save tokens.

**Example .antigravityrules:**

\# Global Project Rules  
\- \*\*Language\*\*: TypeScript (Strict Mode enabled). Never use \`any\`.  
\- \*\*Package Manager\*\*: Use \`pnpm\`. Do NOT use \`npm\` or \`yarn\`.  
\- \*\*Styling\*\*: Tailwind CSS.   
\- \*\*Agent Behavior\*\*: Before generating code, always output a structured Implementation Plan Artifact for my approval.

## **2\. On-Demand Skills (Saved Workflows)**

**Concept:** Specialized, on-demand instructions that only load when requested. In Antigravity, these are implemented as **Workflows**, which can be invoked in the Agent Side Panel using the / command.

**How to set it up in Antigravity:**

1. Create a folder: .antigravity/workflows/.  
2. Create markdown files for specific tasks. Antigravity will index these and make them available as slash commands.

**Example: .antigravity/workflows/code-review.md**

\# Skill: PR Code Review  
When executing a \`/code-review\`, analyze the current git diff and focus on:  
1\. Identifying potential memory leaks or infinite loops.  
2\. Verifying that the code adheres to our \`.antigravityrules\`.  
3\. Emitting a summary Artifact with a list of required changes.

**Usage:** In the Antigravity Agent Panel (Cmd \+ L), type /code-review and hit enter. The agent will load this specific context only for this interaction.

## **3\. Sub-Agents (The Agent Manager)**

**Concept:** Specialized AI assistants running in isolated context windows. This is where Antigravity truly outshines traditional IDEs.

**How to set it up in Antigravity:**

Instead of managing sub-agents through text prompts, you orchestrate them using Antigravity's **Agent Manager** (Mission Control).

1. Press **Cmd \+ E** (Mac) or **Ctrl \+ E** (Windows/Linux) to toggle from the Editor View to the **Agent Manager**.  
2. Click **New Task** to spawn a completely isolated agent.  
3. **Delegate specific tasks:** You can spawn one agent to handle backend testing and another to handle frontend CSS.  
   * *Agent 1 (Model: Gemini 3.1 Pro):* "Read src/auth.ts and write Jest tests."  
   * *Agent 2 (Model: Gemini 3 Flash):* "Go through all .tsx files and update the button padding to p-4."  
4. These agents run asynchronously. They won't clutter your main editor context, and they will generate verifiable **Artifacts** (like Diffs and Test Output logs) for you to review once they are done.

## **4\. Hooks (Terminal Policies & Agent Autonomy)**

**Concept:** Event-driven automations and terminal safety guards. Because Antigravity agents can autonomously browse the web and execute terminal commands, "Hooks" are handled via **Terminal Execution Policies**.

**How to set it up in Antigravity:**

1. Open Antigravity Settings \-\> Search for Terminal Policy.  
2. Set your global policy to **Auto** (Agent decides when to ask permission) or **Turbo** (Always execute).  
3. To mimic deterministic hooks (like blocking destructive commands), configure your Allow/Deny lists in the workspace settings or a .antigravity/terminal-policy.json file.

**Example .antigravity/terminal-policy.json:**

{  
  "terminalPolicy": "Turbo",  
  "denyList": \[  
    "rm \-rf",  
    "dropdb",  
    "npm publish",  
    "git push \--force"  
  \],  
  "allowList": \[  
    "pnpm test",  
    "pnpm run lint",  
    "pnpm run build"  
  \],  
  "preTaskHooks": {  
    "onAgentStart": "pnpm run lint \--fix"   
  }  
}

*Note: Setting a preTaskHooks ensures that before the agent begins coding, it automatically formats the workspace, mimicking life-cycle hooks.*

## **5\. MCP Servers (External Tools)**

**Concept:** Connecting the AI to external services (GitHub, Postgres, Sentry) using the Model Context Protocol. Antigravity supports MCP natively.

**How to set it up in Antigravity:**

1. You configure MCP servers the same way you would in standard AI editors (often via settings.json).  
2. Open .vscode/settings.json (Antigravity inherits this config file format).  
3. Add your MCP servers:

{  
  "mcp.servers": {  
    "postgres": {  
      "command": "npx",  
      "args": \["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@localhost/mydb"\]  
    },  
    "github": {  
      "command": "npx",  
      "args": \["-y", "@modelcontextprotocol/server-github"\]  
    }  
  }  
}

**Usage:** When chatting with an agent in the Side Panel or Manager, simply type @ to bring up the context menu. Select **@postgres** to let the agent query your database, or **@github** to let it pull issue context directly into its isolated context window.

## **Decision Matrix: When to use what in Antigravity**

| Feature | Best For | Context Window Impact | How to trigger in Antigravity |
| :---- | :---- | :---- | :---- |
| **.antigravityrules** | Non-negotiable project standards (e.g., TS strict, tabs vs spaces). | **High** (Loaded every session) | Automatic (Always on) |
| **Workflows (/)** | Task-specific expertise (e.g., Code Review, Deployment checklist). | **Low** (Only loads when invoked) | Type /workflow-name in chat |
| **Agent Manager** | Large, complex refactors, generating new apps, parallel debugging. | **Zero** (Runs in an isolated thread) | Cmd+E \-\> New Task |
| **Terminal Policies** | Guardrails, auto-formatting, preventing destructive actions. | **None** (System level) | Triggered on Agent terminal use |
| **MCP Servers (@)** | Querying external data (Databases, Sentry logs, Jira tickets). | **Variable** (Depends on query size) | Type @mcp-name in chat |

