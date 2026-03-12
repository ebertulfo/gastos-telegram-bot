# Full-Stack Tag Editing and Date Correction in One Session

**Date:** 2026-03-11
**Commits:** 9 commits
**PRs:** #3

## What Changed
- Added `GET /api/tags` endpoint that returns all unique tags a user has ever used
- Extended `PUT /expenses/:id` to accept `tags` (string array) and `occurred_at_utc` (ISO date string)
- Created `getUserTags()` database function that extracts unique tags across all user expenses
- Built `TagInput` component: pill-style tag display, inline text input, autosuggest dropdown filtered from existing tags, backspace-to-delete
- Rewrote `EditDrawer` to include tag editing, date picker with presets (today, yesterday, custom date), and proper form state management
- Wired tag fetching into both DashboardScreen and AnalyticsScreen, passing `allTags` through to EditDrawer
- Added tags to mock data for local development
- Extended expense test coverage for the new update fields

## Why
The original expense editing was amount and category only. But after using the bot for a few days, two things became obvious: expenses need tags for any kind of useful filtering (e.g., "work lunch" vs "personal lunch" are both "food"), and the AI sometimes picks the wrong date for messages like "I spent 500 on groceries yesterday." Users need a way to correct both without having to delete and re-log.

Tags also serve as the foundation for future features — budgets per tag, tag-based reports, shared expense splitting. Getting the data model right now avoids a migration later.

## Key Decisions
| Decision | Options Considered | Chosen | Why |
|----------|-------------------|--------|-----|
| Tag storage | Separate tags table with junction table, JSON array column, comma-separated string | JSON array in the expenses table | At this scale (single user, hundreds of expenses), a junction table adds query complexity for zero benefit. D1's SQLite supports `json_each()` for querying into arrays if needed later. Migration to a junction table is straightforward if it ever becomes necessary. |
| Tag input UX | Free-form text only, predefined tag list, autosuggest from history | Autosuggest from existing tags + free-form | Pure free-form leads to inconsistency ("groceries" vs "Groceries" vs "grocery"). Predefined lists are too rigid. Autosuggest encourages reuse while allowing new tags. This is the same pattern Notion and Linear use. |
| Date correction | Calendar picker only, relative presets only, presets + calendar fallback | Presets (today, yesterday) + custom date input | "Yesterday" covers the vast majority of date corrections — the user logged something today that happened yesterday. A full calendar picker is overkill for most cases but necessary for the long tail. Presets first, custom as escape hatch. |
| Tag suggestions source | Hardcoded common tags, per-user history, global across all users | Per-user history via API | Hardcoded tags would be wrong for most users. Global tags leak information between users. Per-user history gives relevant suggestions that improve as the user logs more expenses. |
| Form state management | Controlled inputs with useState, useReducer, form library (react-hook-form) | Plain useState with derived state | The form has 4 fields (amount, category, tags, date). react-hook-form's setup ceremony exceeds the complexity of the form itself. useState is readable and sufficient. |

## How (Workflow)
Started from the database layer and worked up to the UI. First, `getUserTags()` in `src/db/expenses.ts` — a simple `SELECT DISTINCT` equivalent using `json_each()` to unpack the tags array. Then extended `updateExpense()` to handle the new fields. Next, the API route and the `fetchUserTags` client function. Finally, the two new UI components.

The `TagInput` was the most complex piece. The interaction model: a horizontal row of pill-shaped tags, an inline text input that grows with content, a dropdown that appears when typing and filters against existing tags. Pressing Enter or clicking a suggestion adds the tag. Backspace on an empty input removes the last tag. It's a common pattern but fiddly to implement — focus management, dropdown positioning, keyboard navigation all need to work together.

The `EditDrawer` rewrite was necessary because the original only handled amount and category. Adding tags and date meant rethinking the form layout, state initialization (populate from the expense being edited), and save logic (diff against original to only send changed fields).

Wrote the spec and plan first, which helped identify the full-stack surface area before writing code.

## Metrics
- 11 files changed, ~1,416 lines added, ~55 lines removed
- 1 new API endpoint (`GET /api/tags`)
- 1 new component (`TagInput`)
- 1 major component rewrite (`EditDrawer`)
- 1 new database function (`getUserTags`)
- 2 existing tests extended for new update fields
- Full-stack feature: DB -> API -> client -> UI

## Learnings
- **Autosuggest inputs are deceptively complex.** The TagInput handles: rendering pills, inline text input, filtered dropdown, keyboard navigation (arrow keys + enter), click selection, backspace deletion, blur behavior (should the dropdown close?), and focus restoration after tag add/remove. It's maybe 150 lines of JSX but the state transitions took real thought.
- **Date presets eliminate 80% of date picker interactions.** In my own usage, "yesterday" is the correction I make most often. Having it as a one-tap preset instead of navigating a calendar saves significant friction. This is the kind of UX insight that only comes from using your own product.
- **JSON arrays in SQLite are a pragmatic choice at small scale.** The purist move is a junction table. But for a single-user expense tracker, `json_each()` handles the read path, and the write path is just `JSON.stringify(tags)`. The simplicity is worth the theoretical query cost.
- **Spec-first development pays off for full-stack features.** The spec identified that I needed changes in 4 layers (DB, API, client lib, UI components) before I wrote any code. Without it, I probably would have started with the UI and then discovered I needed API changes mid-implementation.

## Content Angles
- "Building an Autosuggest Tag Input in React Without a Library" — the state machine behind pill-style tag editing
- "JSON Arrays vs Junction Tables in SQLite: When Simplicity Wins" — pragmatic data modeling for side projects
- "Full-Stack Feature Development: Database to UI in One Session" — the workflow of building a vertical slice through every layer
