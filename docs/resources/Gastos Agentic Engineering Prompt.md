# **MISSION: Implement "Agentic Engineering" Infrastructure for Gastos**

**Context:** We are upgrading our development workflow for the "Gastos" project from traditional manual coding to "Agentic Engineering." We want to optimize this repository specifically for YOU (the Antigravity Agent) so you can plan, execute, validate, and compound your capabilities autonomously.

Please read the following 5 pillars of our new architecture and execute the Action Items below to bootstrap this infrastructure.

## **1\. Context Engineering (The Second Brain)**

**Concept:** The agent needs precise domain knowledge, not just code context. If it's not in the codebase, it doesn't exist for the agent.

**Antigravity Implementation:** We will use a dedicated docs/agent\_context folder and Model Context Protocol (MCP).

* **Action Item 1:** Create a docs/agent\_context/ directory. Inside, create a gastos\_architecture.md file outlining the core stack, database schema rules, and business logic for Gastos (e.g., currency conversion rules, receipt scanning pipeline).  
* **Action Item 2:** Draft a plan for adding a custom MCP server (like Qdrant or a local Retriever MCP) to our mcp\_config.json so you can quickly search our specific SDK docs and past design decisions.

## **2\. Agentic Validation**

**Concept:** The agent must be able to self-validate its work visually and programmatically without human bottlenecks.

**Antigravity Implementation:** We will leverage Antigravity's native Browser Agent, automated Artifacts, and terminal tools.

* **Action Item 3:** Create a standard Antigravity **Workflow** command (e.g., /validate-ui) that instructs your Browser Agent sub-system to launch the Gastos dev server, navigate to the changed page, take screenshots, and verify UI state.  
* **Action Item 4:** Set up logging in our codebase specifically formatted for you to read during your validation loops (e.g., outputting JSON logs to a .agent\_logs/ directory).

## **3\. Agentic Tooling**

**Concept:** Eliminate any friction that forces a human to step in.

**Antigravity Implementation:** We will build custom Antigravity **Skills** and CLI tools.

* **Action Item 5:** Identify the top 2 most repetitive tasks in the Gastos workflow (e.g., database migrations, scaffolding a new expense form). Create an Antigravity **Skill** for them so you have specialized expertise loaded on demand when dealing with these tasks.  
* **Action Item 6:** Write a brief specification for a CLI script (scripts/agent\_db\_seed.sh) that you can trigger automatically to reset the testing database without asking me.

## **4\. Agentic Codebases**

**Concept:** Codebases should be optimized for AI consistency, not just human readability.

**Antigravity Implementation:** We will establish strict Antigravity **Rules**.

* **Action Item 7:** Create a set of Global **Rules** for this workspace. These rules must enforce our "golden principles":  
  * Define exactly how to structure new files.  
  * Mandate strict JSDoc/Python docstrings for your own future context.  
  * Ban competing frameworks or legacy patterns (specify what they are).  
  * Instruct you to aggressively delete dead code when you refactor.

## **5\. Compound Engineering**

**Concept:** Every tool, context doc, and rule must be committed to the repository so the agent's intelligence compounds over time.

**Antigravity Implementation:** Version control for agent behavior.

* **Action Item 8:** Ensure all the Rules, Workflows, Skills, and Context files created in the previous steps are properly staged. Generate a commit message summarizing the "V1 Agentic Infrastructure" setup.  
* **Action Item 9:** Generate a SUMMARY.md Artifact of this entire setup session so we can pass it as context for our next major feature build.

**Execution Instructions for Antigravity:**

Please operate in **Planning Mode** first. Generate an "Implementation Plan" Artifact detailing exactly what files you will create and the contents of the Antigravity Rules and Workflows you will establish. Pause for my review before executing.