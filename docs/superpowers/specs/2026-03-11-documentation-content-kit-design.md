# Documentation Content Kit — Design Spec

**Date:** 2026-03-11
**Status:** Approved

## Objective

Create comprehensive documentation for Gastos Telegram Bot that serves multiple purposes:
- Landing page foundation
- Blog posts (technical, product, process)
- LinkedIn content
- Portfolio/showcase piece for Agentic Engineering

## Target Audiences

1. **Potential employers / recruiters** — engineering skills + decision-making
2. **Developer community** — learn from / replicate the approach
3. **Potential users** — understand the product and start using it
4. **Collaborators** — context for landing page and content creation

## Approach: Decision-First

The decision journal is the backbone. All derivative narratives are filtered views of the journal through different lenses. This was chosen because:
- The user specifically wants to convey the decision-making process
- The Antigravity → Claude Code migration is inherently chronological
- A decision journal is rare, differentiated content
- Derivative docs become easier to write as filtered views

## File Structure

```
docs/content/
├── decision-journal.md          # The backbone — all decisions, chronological
├── narratives/
│   ├── product-story.md         # User/landing page angle
│   ├── technical-story.md       # Engineering angle
│   ├── process-story.md         # Agentic Engineering angle
│   └── combined-story.md        # The full picture
└── user-guide.md                # How to use the bot
```

## Decision Journal Structure

Organized in chronological phases. Each decision follows this format:

```
### Decision: [Title]
**Context:** What situation prompted this decision
**Options considered:** What alternatives existed
**Choice:** What we picked and why
**Outcome:** What happened as a result
```

### Phases

| Phase | Theme | Key Decisions |
|-------|-------|---------------|
| **Phase 0: Problem** | Why build this at all | Personal pain point, existing apps too heavy, Telegram as daily driver |
| **Phase 1: Foundation** | Platform & stack choices | Why Telegram over standalone app, why Cloudflare Workers over Vercel/Railway, why D1 over Postgres/Supabase, why Hono |
| **Phase 2: AI Architecture** | How the AI works | Why async queue processing (15min vs 30s), why OpenAI for the bot's LLM, why intent classification, why userId injected via closures (security) |
| **Phase 3: Features** | Product shape | Why multimodal (photo/voice), why semantic search via Vectorize, why conversational memory with 10-msg window, why token quotas |
| **Phase 4: Tooling Evolution** | How it was built | Why Antigravity initially (0→1), what triggered the switch to Claude Code, how skills/subagents/hooks changed velocity |
| **Phase 5: Production** | Shipping it | Why Mini App for analytics, why proactive notifications, why rate limiting, cost control strategy |

## Derivative Narratives

### `product-story.md` — "Expense tracking shouldn't require opening an app"

**Audience:** Potential users, non-technical readers, landing page visitors
**Tone:** Conversational, benefit-driven. No architecture talk.
**Length:** ~1000-1500 words

1. The problem — existing expense trackers require too much friction
2. The insight — you already tell people what you spent on in chat
3. How it works — text, photo, or voice → categorized in seconds
4. Smart features — natural language Q&A, semantic search, reports
5. The Mini App — charts and editing without leaving Telegram

### `technical-story.md` — "From Telegram message to categorized expense in seconds"

**Audience:** Developers, engineering hiring managers, tech community
**Tone:** Technical but accessible. Show the thinking, not just the implementation.
**Length:** ~2000-2500 words

1. System overview — Cloudflare Workers + D1 + Queues + OpenAI Agents SDK
2. The async architecture — webhook returns 200, queue-based processing
3. AI agent design — Agents SDK tool calling, session management, multimodal
4. Security model — row-level security via closures
5. Semantic search — Vectorize embeddings, exact-match-first fallback
6. Cost control — token quotas, rate limiting, selective indexing
7. Database design — immutable source events, normalized expenses, chat history windowing
8. Architecture diagram — webhook → queue → agent → tools → D1

### `process-story.md` — "Building a production AI product with Agentic Engineering"

**Audience:** Developers interested in AI-assisted dev, Claude Code users, LinkedIn
**Tone:** Personal, narrative-driven. First-person voice.
**Length:** ~2000-2500 words

1. What is Agentic Engineering — framing
2. Phase 1: Antigravity (0→1) — what it helped with, where it hit limits
3. Phase 2: Claude Code (1→production) — what triggered the switch
4. Phase 3: Building dev infrastructure — skills, subagents, workflow state, hooks
5. The compounding effect — each tool made the next feature faster
6. Concrete examples — real time savings and velocity gains
7. What I'd do differently — honest retrospective

### `combined-story.md` — "Gastos: A Case Study in Agentic Product Engineering"

**Audience:** Portfolio reviewers, hiring managers, collaborators who want the full picture
**Tone:** Case study format — structured, evidence-driven, with measurable outcomes where available.
**Length:** ~3000-4000 words

1. Executive summary — one-paragraph pitch (problem, solution, how it was built)
2. The problem (from product story)
3. Decision journal highlights — 5-7 most interesting fork-in-the-road moments with outcomes
4. The architecture (from technical story, condensed)
5. How it was built (from process story, condensed)
6. Results & metrics — concrete numbers (features shipped, development velocity, cost per user, etc.)
7. What's next — future plans

### `user-guide.md` — "Getting Started with Gastos"

**Tone:** Short, scannable, screenshot-friendly.
**Length:** ~500-800 words

1. Start the bot — search @GastosBot, press /start
2. Set up — choose currency, timezone
3. Log expenses — text, photo, voice examples
4. Ask questions — natural language query examples
5. Quick commands — /today, /thisweek, /thismonth, etc.
6. Mini App — dashboard, analytics, review queue

## Cross-Referencing Rules

- Each narrative opens with a 2-sentence "what is Gastos" so it stands alone
- Narratives link back to `decision-journal.md#decision-name` for full context but never require the reader to follow the link
- No narrative depends on another narrative — fully independent slices

## Writing Order

1. `decision-journal.md` — source of truth (requires user input on "why" behind decisions)
2. `user-guide.md` — easy win, grounds the product
3. `product-story.md` → `technical-story.md` → `process-story.md`
4. `combined-story.md` — weaves best parts of all three

## Content Extraction Guide

How each doc feeds downstream content:

| Source Doc | → Landing Page | → Blog Post | → LinkedIn |
|-----------|---------------|-------------|------------|
| `product-story.md` | Hero section, features, CTA | "Why I built Gastos" post | Short product announcement |
| `technical-story.md` | Architecture section (optional) | Deep-dive technical post | Thread on architecture decisions |
| `process-story.md` | "Built with AI" badge/section | "Agentic Engineering" post | The viral post — personal story |
| `combined-story.md` | Full "About" page | Long-form case study | Link target from shorter posts |
| `user-guide.md` | "How it works" section | N/A | N/A |
| `decision-journal.md` | N/A (internal reference) | Decision-focused series | Individual decision snippets |

## Maintenance

- Decision journal gets appended when new major decisions are made
- Narratives get a revision pass after major milestones (e.g., Agents SDK migration completion, open-source launch)
- Technical story documents the current architecture state; note the Agents SDK migration is in-progress and the doc should reflect the state at time of writing

## Open Items

- Decision journal will have `[YOUR INPUT NEEDED]` tags where the codebase shows the *what* but only the user knows the *why*
- Screenshots for user guide TBD
- Bot username TBD (placeholder: @GastosBot)
