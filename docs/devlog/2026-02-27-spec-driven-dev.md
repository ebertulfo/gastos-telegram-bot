# Slowing Down to Speed Up: Spec-Driven Development

**Date:** 2026-02-26 to 2026-02-27
**Commits:** 17 commits

## What Changed
- Created a Spec-Driven Development (SDD) workflow with templates for architecture specs
- Brainstormed and documented RAG and agentic AI feature roadmap (M5-M11 milestones)
- Drafted architecture specs for totals (M5), review queue (M6), and expense categories (M7)
- Enforced strict Zod data contracts on all OpenAI extraction responses
- Streamlined ingestion UX — cleaner webhook response flow per M1-M3 spec
- Implemented one-shot inferential onboarding: bot infers timezone and currency from the user's first expense message instead of asking a series of questions
- Built interactive review queue dialog in the webapp
- Created a Project Manager agent skill from Google PM framework
- Restructured documentation into logical sub-folders

## Why
After the bootstrap and Mini App sprints, I had a working product but a growing list of ideas with no structure. RAG for semantic expense search, agentic chat for natural language queries, categories, analytics — each feature touched multiple layers. I was about to start coding the AI layer and realized I'd end up with spaghetti if I didn't plan first.

The forcing function was the onboarding flow. The original multi-step wizard asked users to type their city, pick a currency, confirm timezone — three separate interactions before they could log their first expense. That's terrible UX for a bot. But "just make it simpler" isn't a spec. I needed to think through what inferential onboarding actually meant: what signals to use, what to fall back on, how to handle ambiguity.

## Key Decisions
| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Planning approach | Ad-hoc features, Kanban board, Spec-Driven Development | SDD with architecture specs | Features were crossing too many boundaries. Specs force you to think about data flow, edge cases, and migration needs before writing code. |
| Onboarding UX | Multi-step wizard, settings command, inferential one-shot | Inferential one-shot | User sends first message ("coffee 150 pesos"), bot infers currency (PHP) and timezone (Asia/Manila from Telegram locale). Zero onboarding friction. -200 lines of state machine code. |
| OpenAI response handling | Raw JSON parsing, manual types, Zod validation | Zod schemas with `z.infer` | LLM outputs are inherently unreliable. Zod catches malformed responses at the boundary instead of letting bad data propagate into the DB. Also serves as documentation of the expected contract. |
| Category system | Fixed enum, free-text tags, hybrid | Hybrid (specs drafted) | Fixed enums are too rigid, free-text tags are too messy. Spec'd out a hybrid approach where the AI suggests categories but users can override. Didn't implement yet — just got the spec right. |
| Documentation structure | Flat docs folder, wiki, structured sub-folders | Sub-folders: specs/, core/, resources/ | Flat folder was already getting unwieldy. Specs need to be findable by milestone number. |

## How (Workflow)
This session had a distinct two-phase rhythm. First phase (Feb 26 evening + Feb 27 morning): pure documentation and planning. Brainstormed RAG and agentic features, wrote architecture specs, created the SDD workflow and template. Second phase (Feb 27 afternoon): implemented three features directly from the specs.

The SDD workflow proved its value immediately. The one-shot onboarding spec made me realize I could delete the entire onboarding state machine — the inferential approach meant the bot just needs to parse the first message and extract locale signals. The implementation was a net deletion of ~150 lines. That's the best kind of feature: less code, better UX.

The Zod refactor was defensive engineering. I'd already seen OpenAI return unexpected shapes during testing — missing fields, wrong types, extra properties. Wrapping every extraction call in `z.safeParse()` means bad LLM output produces a clean error instead of a runtime crash or corrupt data.

## Metrics
- 17 commits across 2 days
- 27 files changed, ~3,600 lines added, ~350 lines removed
- 6 architecture spec documents written
- 1 workflow template created
- 3 features implemented from specs (ingestion UX, onboarding, review queue)
- Net reduction in onboarding code (~150 lines deleted)
- Zod validation added to all OpenAI response boundaries

## Learnings
- **Specs are not overhead — they're a thinking tool.** The one-shot onboarding design emerged from writing the spec, not from staring at code. Writing "the bot will infer timezone from Telegram locale data" forced me to verify that Telegram actually provides locale data in the user object. It does.
- **Inferential UX > explicit UX for bots.** Every question a bot asks is friction. If you can infer the answer from context (message content, locale, time of day), do that and let users correct later. The correction path is the Review Queue — which I'd already built.
- **Zod at the LLM boundary is non-negotiable.** LLM outputs are probabilistic. Treating them as trusted structured data is a bug waiting to happen. `z.safeParse()` is your airlock.
- **Planning sessions should produce both docs and code.** A planning session that only produces docs feels unproductive. But a planning session that only produces code often misses edge cases. The two-phase approach (plan, then implement from plan) gave me the best of both.
- **Deleting code is a feature.** The one-shot onboarding replaced 273 lines of state machine with ~60 lines of inference logic. Fewer states, fewer bugs, better UX.

## Content Angles
- "Spec-Driven Development for Solo Projects" — why planning matters even when you're the only developer
- "Inferential Onboarding: Stop Asking Users Questions You Can Answer Yourself" — UX pattern for chatbots
- "Zod at the LLM Boundary: Defensive Parsing for AI-Generated Data" — practical pattern with code examples
- "The Session That Deleted More Code Than It Wrote" — how planning leads to simplification
