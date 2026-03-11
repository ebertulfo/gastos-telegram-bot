# Building a Production AI Product with Agentic Engineering

Gastos is an AI-powered expense tracker on Telegram. But this isn't a story about what it does — it's about how it was built, and what happens when you use AI agents not just in your product, but to build it.

## What is Agentic Engineering?

There's a phrase I keep coming back to: **agentic engineering**. It's not just "vibe coding" or "AI-assisted development." It's a specific thing.

Gastos uses OpenAI's models to classify user intent, extract expenses from receipts, and answer questions about spending patterns. That's the product layer. But the same kind of AI — Claude, specifically — helped architect the queue system, implement the database migrations, write the test suite, and deploy the whole thing to Cloudflare Workers.

The AI that powers the bot was also the AI that helped build the bot.

That's agentic engineering. You're not just using AI as a feature. You're using it as a collaborator across the entire development lifecycle — from planning to implementation to testing to deployment. And when you start treating it that way, something interesting happens: you stop thinking about what *you* can build and start thinking about what *you and your agents* can build. The ceiling moves.

I want to be clear — this isn't about replacing the developer. I'm deeply involved at every step. I spec features, review code, make architectural decisions, and catch things the AI misses. But the AI handles the grunt work, the boilerplate, the "I know how to do this but it'll take me 45 minutes" tasks. It compresses time. And when you build infrastructure on top of that compression, it compounds.

## Phase 1: Antigravity (0 to 1)

I discovered Google's Antigravity through YouTube videos. The reviews were impressive, so I gave it a shot.

Google's models are amazing at getting you from 0 to 1. I'm not being hyperbolic — they're legitimately smart enough to handle complicated workflows for building production apps. You describe what you want, and it builds something that works. Not perfect, but *works*.

One thing I learned early: you can create skills that cover gaps in your own knowledge. I'm not a security expert, but I know enough to know I need to think about it. So I did my research on things like prompt injection prevention and auth patterns, turned that into a skill, and plugged that hole. The AI doesn't just use your expertise — it can use *curated* expertise that you've assembled.

With Antigravity, I got to a working Telegram bot with real features: expense logging via text, photos, and voice messages. User onboarding. Natural language querying ("how much did I spend on food last week?"). A Mini App built with React where users can update and manage their expenses. It even suggested building the Mini App in the first place — I was reading the Telegram docs and it surfaced the idea. When I heard you could build an app *within* Telegram, I was sold. No separate domain, no separate auth, no separate deployment. Everything stays in one place.

That was a solid foundation. But it wasn't the final form.

## Phase 2: The Switch to Claude Code

My company had a hackathon, and through it I got access to Claude Code. I figured I'd try it out on Gastos.

Within a day, I knew I was switching.

Claude Code was better out of the box in ways that mattered to me. The plugins were incredibly helpful. The docs were clearer. There were far more resources about how to use it effectively — blog posts, examples, community guides. Antigravity had raw power, but Claude Code had an *ecosystem*.

But the biggest difference was how it felt to work with. Antigravity was more like delegation — here's what I want, go build it, come back when you're done. Claude Code is more like collaboration. It's more human-in-the-middle friendly. I found myself more involved in speccing and planning, not because I had to be, but because the tool made that involvement feel natural and productive.

And it goes deeper. Where Antigravity would give me a working solution, Claude Code would give me a working solution *and* surface edge cases I hadn't considered, suggest architectural improvements, and ask clarifying questions that made the final result better. It felt like working with a senior engineer who happens to type at the speed of light.

The switch wasn't painless — I had to migrate my workflows, rebuild some of the context I'd established — but it paid off fast. Features that were taking me multiple sessions to get right started landing in one.

## Phase 3: Building the Dev Infrastructure

Here's where things got interesting. And also where I started to go a little crazy.

The pain point was context. I kept maxing out Claude Code's context window. Every conversation, I'd burn through tokens explaining the same project context, the same patterns, the same architectural decisions. CLAUDE.md — the project instruction file that Claude Code reads at the start of every conversation — was getting bloated. I was cramming everything in there: architecture notes, code patterns, testing instructions, deployment steps, database conventions. It was turning into a novel.

The solution was to build infrastructure *for the AI*.

I created **4 custom skills**:
- `assess-task-size` — classifies every task as trivial, small, medium, or large, and maps it to a pipeline of required steps
- `d1-migration` — a checklist for database migrations (because I kept forgetting steps)
- `new-db-module` — scaffolds a new database module following existing patterns
- `rollback` — emergency deployment rollback procedure

I created **3 specialist subagents**:
- A Cloudflare specialist for Workers, D1, R2, KV, Queues, and Vectorize questions
- A Telegram specialist for Bot API, webhooks, and Mini App questions
- An OpenAI specialist for API, Agents SDK, and prompt engineering questions

Each subagent has its own context — its own focused set of docs and instructions. They do their research and report back only what the parent agent needs. This was the key insight that made CLAUDE.md slim again: **not everything needs to live in the main context**. Distribute knowledge to specialists, and let them surface only what's relevant.

Then I added a **workflow state tracker** — a JSON file at `/tmp/gastos-workflow-state.json` that tracks which pipeline steps have been completed for the current task. Pre-commit hooks block the commit if tests haven't passed. Pre-deploy hooks block deployment if verification is incomplete. Warning hooks flag if code review or simplification steps were skipped.

([Decision journal: custom skills, subagents, and workflow hooks](../decision-journal.md#decision-build-custom-skills-subagents-and-workflow-hooks))

Is this over-engineered? Maybe. But it works. And more importantly, it compounds.

## The Compounding Effect

Here's a concrete example of compounding.

When I first built Gastos, I wrote my own tool-calling loop for the AI agent. You call the model, it says "I want to call log_expense with these arguments," you execute the tool, feed the results back, and repeat until the model is done. It's maybe 100 lines of manual orchestration — parsing tool calls, handling errors, managing conversation state, verifying the model actually did what it said it would do.

Then I decided to migrate to OpenAI's Agents SDK, which handles all of that for you. `run(agent, input, { session, maxTurns: 10 })` replaces the entire loop.

The migration took **1 hour** to get working, plus **30 minutes** to debug.

([Decision journal: OpenAI Agents SDK migration](../decision-journal.md#decision-openai-agents-sdk-over-raw-chat-completions))

That's fast for a migration that touches the core AI pipeline of the entire product. But the speed wasn't because the task was simple — it's because the infrastructure was already there. The task size assessment skill told Claude Code this was a "large" task, which triggered the full pipeline: brainstorm, plan, worktree, TDD, verification, review. The Cloudflare specialist handled questions about queue integration. The OpenAI specialist knew the Agents SDK patterns. The state tracker ensured every step completed before deployment.

Each piece of infrastructure I'd built made this specific task faster. And the Agents SDK migration itself made *future* tasks faster, because the agent code was now cleaner and more capable. That's the compounding effect. Every tool you build makes the next feature cheaper.

Another example: daily token quotas. I have $10 in OpenAI API credits. That's my entire budget. I needed per-user daily quotas to prevent some asshole from spamming the bot and burning through my credits. The `d1-migration` skill handled the database schema. The `new-db-module` skill scaffolded the query module. The `assess-task-size` skill routed it through the right pipeline. What could have been a full afternoon of work landed in about an hour — including tests.

## The Meta-Layer

There's something delightfully recursive about all of this.

I use Claude Code to build Gastos. Gastos uses OpenAI to process expenses. To make Claude Code better at building Gastos, I build custom skills and subagents. Those skills and subagents are themselves built using Claude Code. Which means I'm using Claude Code to build the tools that make Claude Code better at building Gastos.

It's turtles all the way down.

But the recursion isn't just cute — it's genuinely useful. When I built the `assess-task-size` skill, Claude Code helped me define the heuristics. When those heuristics turned out to be wrong for certain edge cases, Claude Code helped me refine them. The AI improved the AI that improved the AI's ability to build the product.

This is what I mean by agentic engineering being a *practice*, not a one-time setup. You're constantly tuning the feedback loop. Making the agent smarter. Giving it better context. Building guardrails so it doesn't do dumb things. And then using the now-smarter agent to build the next thing, which gives you ideas for how to make it even smarter.

The CLAUDE.md file — the one that was bloated and unwieldy — is now tight. It has commands, architecture, code patterns, testing notes, and a workflow section that references the skills and subagents. Everything the AI needs, nothing it doesn't. Getting there was an iterative process of adding things, realizing they were cluttering the context, extracting them into subagents, and refining what stays in the main file.

## What I'd Do Differently

I'd lean harder into existing plugins earlier.

When I started with Claude Code, I built a custom spec-driven development workflow. I was proud of it — task classification, pipeline enforcement, state tracking. Then I discovered a plugin called Superpowers that does essentially the same thing. Brainstorming, planning, TDD, verification, code review — all built in, all tested by a community of users.

I still use my custom skills alongside Superpowers, and the combination is powerful. But I burned time building things that already existed. The lesson: before you build infrastructure for your AI tooling, check what's already out there. The Claude Code ecosystem is growing fast, and someone has probably solved your problem.

I'd also invest in proper request tracing earlier. Right now, there's no correlation ID linking a Telegram webhook to its queue message to its parse result. When something goes wrong in production, I'm grepping logs manually. That's the kind of cross-cutting concern that's easy to add early and painful to retrofit later.

And honestly? I'd switch to Claude Code sooner. Antigravity was great for the 0-to-1 phase, and I'm genuinely grateful for it. But once I had a working product and needed to iterate, refactor, and build infrastructure, Claude Code's collaboration model was a better fit. If I were starting over, I'd probably still use Antigravity for the initial spike — it's incredibly fast at generating a working prototype — and then switch to Claude Code for everything after.

---

The arc of this story is simple: I started with one AI tool, switched to a better one, then built infrastructure on top of it that makes everything compound. Each layer makes the next layer faster. The bot gets smarter. The development process gets faster. The infrastructure gets more capable.

Gastos is a side project. It tracks my expenses. But the way it's built — the agentic engineering approach — is something I'm now applying to everything I work on. Use AI agents in your product. Use them to build your product. Build tools that make them better. Watch it compound.

That's the best thing humans ever invented: tools that help you build better tools.
