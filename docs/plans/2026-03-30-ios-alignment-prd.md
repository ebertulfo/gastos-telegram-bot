# PRD: Gastos Telegram Bot — iOS App Alignment

**Date:** 2026-03-30
**Status:** Draft — awaiting review

---

## 1. Context

Gastos now exists as two products:

| | iOS App | Telegram Bot |
|--|---------|-------------|
| **For** | Privacy-conscious users who want everything on-device | Power users who want speed + conversational AI on Telegram |
| **AI** | On-device (Apple Intelligence) | Cloud (OpenAI GPT-5-mini) |
| **Data** | Local-only (SwiftData) | Server-side (Cloudflare D1) |
| **Strength** | Privacy, polish, travel | Conversational logging, multi-expense, agentic Q&A |

The iOS app has been designed with more care — brand voice, design system, data model, features. The Telegram bot needs to catch up. This PRD specs the alignment work.

**Goal:** Full feature parity and brand consistency between iOS app and Telegram bot. The bot is the *power user* product — same identity, same features, plus conversational superpowers.

---

## 2. Scope Overview

| Workstream | What Changes | Size |
|------------|-------------|------|
| **W1: Tags over Categories** | Remove fixed category enum, migrate to flexible user-defined tags | Large — schema migration + AI + Mini App + reports |
| **W2: Brand & Messaging** | Voice guide, system prompt, onboarding, copy | Medium — no schema, lots of copy |
| **W3: Mini App Redesign** | Design tokens, component rebuild, tag-based analytics | Large — full frontend rewrite |
| **W4: Merchant Tracking** | Add merchant field to expenses, extraction, display | Medium — schema + AI + display |
| **W5: Travel Mode** | Trip entity, dual-currency, FX rates, travel detection | Large — new feature across all layers |
| **W6: Export** | JSON/CSV export via bot command + Mini App | Small — new endpoint + formatting |
| **W7: Smart Tag Learning** | Tag association learning from user behavior | Medium — new table + extraction logic |

---

## 3. W1: Tags over Categories

### Current State
- Expenses have a `category` column (TEXT, 7 fixed values: Food, Transport, Housing, Shopping, Entertainment, Health, Other)
- Expenses also have a `tags` column (TEXT, JSON array, max 3 tags)
- AI system prompt maps descriptions to categories
- Mini App groups analytics by category (donut chart, category list)
- `get_financial_report` tool groups by category

### Target State (matches iOS)
- **No category column** — tags are the only grouping mechanism
- Tags are user-defined, flexible, unlimited (but suggest keeping it practical)
- AI extracts tags from context (not from a fixed list)
- Analytics group by tag (an expense with tags ["food", "travel"] counts in both)
- Default tag set seeded during onboarding (same 10 as iOS: food, transport, groceries, shopping, coffee, entertainment, health, bills, travel, subscriptions)

### Schema Changes

```sql
-- Migration: 0010_tags_over_categories.sql

-- Step 1: Ensure all existing category values become tags
-- (handled in application code during migration, not pure SQL)

-- Step 2: Drop category column
-- SQLite doesn't support DROP COLUMN before 3.35.0
-- D1 uses SQLite 3.45+, so this works:
ALTER TABLE expenses DROP COLUMN category;

-- Step 3: Add description column (previously stored only in parse_results)
ALTER TABLE expenses ADD COLUMN description TEXT;
```

```sql
-- Migration: 0010b_user_tag_preferences.sql

CREATE TABLE user_tag_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tag TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'onboarding',
  created_at_utc TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, tag)
);

CREATE INDEX idx_user_tag_prefs ON user_tag_preferences(user_id);
```

**Data migration (application-level):**
- For each expense where `category` is not null and not "Other":
  - Lowercase the category value
  - Prepend it to the tags JSON array (if not already present)
  - e.g., category="Food", tags=["coffee"] → tags=["food", "coffee"]
- "Other" category is discarded (it was the default/catch-all)

### AI Changes

**System prompt — remove:**
- Fixed category list and mapping rules
- `category` parameter from log_expense
- Category enum from edit_expense

**System prompt — add:**
- Tag extraction guidance: "Extract 1-3 relevant tags from the description. Use lowercase. Common tags: food, transport, groceries, shopping, coffee, entertainment, health, bills, travel, subscriptions. But use whatever fits — tags are freeform."
- "If the user has established tags from history, prefer those over inventing new ones."

**Tool changes:**
- `log_expense`: Remove `category` param. Keep `tags` param, increase max from 3 to 5.
- `edit_expense`: Remove `category` param. Add `tags` param (array, nullable). Enable `description` editing (now stored on expenses table, not just parse_results).
- `get_financial_report`: Remove `category` filter. Add `tag` filter (single tag string). Group breakdown by tag instead of category.

### Mini App Changes
- Remove `lib/categories.ts` (emoji + color mapping for 7 categories)
- Analytics: Group by tag instead of category
- Tag colors: Assign dynamically (hash-based or from a palette)
- Tag display: Pills in transaction rows (like iOS)
- Edit drawer: Replace category dropdown with tag input (already has TagInput component)

### API Changes
- `GET /expenses`: Remove category from response, ensure tags is parsed JSON array
- `PUT /expenses/:id`: Accept `tags` array instead of `category`
- New: `GET /tags` already exists — returns user's used tags

---

## 4. W2: Brand & Messaging

### Voice Guide (adopt from iOS)

**Personality:** Friend who's good with money but doesn't lecture. Direct, calm, occasionally cheeky. Speaks from lived experience.

**Tone principles:**
1. Confident but not corporate
2. Direct — short sentences, active voice, no filler
3. Technically honest — don't overstate AI capabilities
4. No finance jargon — "see where money goes" not "comprehensive financial analytics"

**Vocabulary alignment:**

| Use | Don't Use |
|-----|-----------|
| log, track | record, enter, input |
| tags | categories |
| expenses | transactions |
| Travel Mode | travel mode (lowercase) |

**Banned words:** budget, comprehensive, robust, revolutionary, game-changing, simple (as standalone claim)

### System Prompt Rewrite

Current tone is functional and enforcement-heavy. Keep the enforcement rules but add personality:

**Add to system prompt:**
```
You are Gastos — an expense tracker that's fast, honest, and doesn't waste your time.

Personality: You're a friend who's good with money. Direct, calm, occasionally cheeky.
You speak from lived experience, not a finance textbook.

Rules:
- Be concise. 2-5 lines for simple answers.
- Never say "comprehensive", "robust", or "game-changing".
- Never end with "Let me know if you need anything else."
- Use "expenses" not "transactions". Use "tags" not "categories".
- Use em dashes (—) for separators.
```

### Onboarding Redesign

**Current flow:** Currency picker → auto-timezone → "All set"

**New flow (adapted from iOS 5-screen narrative):**

Since Telegram bots can't do full-screen cards, adapt the narrative to a **conversational onboarding sequence**:

```
Message 1 (Philosophy):
"You can't improve what you don't track.

Gastos helps you log expenses in seconds — type, snap a receipt, or send a voice message. Let's get you set up."

Message 2 (Currency):
"What currency do you use most?"
[PHP] [SGD] [USD] [EUR]
[More currencies...]

Message 3 (Tags — new):
"Pick the tags you use most — or skip and Gastos will learn as you go."
[food] [transport] [groceries] [shopping] [coffee]
[entertainment] [health] [bills] [travel] [subscriptions]
[Skip →]

Message 4 (Completion):
"You're all set. Now make yourself proud.

Send me an expense — or use /today, /thisweek, /thismonth to check totals."
```

**Schema impact:**
- Add `onboarding_step` values: `awaiting_currency` → `awaiting_tags` → `completed`
- Store selected tags in `user_tag_preferences` table (source: "onboarding")

### Acknowledgment Messages (keep but refine)

Current ack messages are good. Minor updates for voice alignment:
- Keep the randomized pool approach
- Ensure none use banned vocabulary
- Current messages are already concise and on-brand ✓

### Empty States

**Current:** Error message + retry button (Mini App), "No expenses yet" implied
**Target:** Match iOS copy patterns:
- Feed empty: "No expenses yet"
- Search empty: "Nothing matched — try a different search"
- Analytics empty: "Not enough data yet — log a few expenses to see insights"
- Period empty: "Nothing logged [period]. Send an expense to get started."

### Error Messages

Keep current error copy — it's already concise:
- "Set up first — send /start" ✓
- "You've hit your daily limit — try again tomorrow" ✓
- Refine: "Type a 3-letter currency code (e.g. PHP, SGD, USD, EUR)" ✓

---

## 5. W3: Mini App Redesign

### Design Tokens (from iOS)

Replace current CSS variables with iOS-aligned tokens:

```css
:root {
  /* Backgrounds */
  --bg-base: #0D1117;
  --bg-raised: #161D28;
  --bg-elevated: #1C2433;
  --bg-overlay: #222D3D;
  --bg-nav: #111720;

  /* Text */
  --text-primary: #F0F4F8;
  --text-secondary: #8A9BB0;
  --text-muted: #6B829E;

  /* Accent */
  --accent: #2DCC72;
  --accent-hover: #4DDD8A;
  --danger: #E0454A;
  --warning: #E09A2B;
  --info: #3A78E0;

  /* Borders */
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.10);
  --border-strong: rgba(255, 255, 255, 0.18);
  --border-accent: rgba(45, 204, 114, 0.30);

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-2xl: 28px;

  /* Fonts */
  --font-display: 'Sora', sans-serif;
  --font-mono: 'DM Mono', monospace;
}
```

**Font loading:** Add Google Fonts (Sora 300-800, DM Mono 400-500) to `index.html`.

**Decision — dark mode only:** The iOS app is dark-only. The Mini App should also be dark-only, ignoring Telegram's light theme. This simplifies the design and ensures brand consistency.

### Component Redesign

**Transaction Row:**
- Current: emoji | description | category + tags | time | amount
- New: description | tag pills (colored, rounded) | merchant (muted) | time | amount
- Amount in accent green (positive = danger red for refunds if ever added)
- Tag pills: small rounded badges, hash-based colors from a curated palette

**Hero Total:**
- Current: Large number with period label
- New: Match iOS — large Sora 700 amount, DM Mono period label above, accent green amount
- Period cycling on tap (keep current behavior)

**Analytics (complete rebuild):**
- Current: Donut chart + category list
- New: Tag-based breakdown
  - "BY TAG" section header (DM Mono, muted)
  - Each tag row: tag name | amount | percentage bar (accent green fill)
  - Show top 5, "Show all" toggle for rest
  - Top 3 expenses section below
  - Keep donut chart (adapted for tags — shows top 5-7 tags as slices, rest grouped as "other")

**Edit Drawer:**
- Current: Amount, category dropdown, tags input, date picker
- New: Amount, tags input (pill-based, not comma-separated), merchant field (new), date picker
- Remove category dropdown entirely
- Tag input: Show user's frequent tags as suggestion chips, tap to add

**Empty States:**
- Skeleton loaders ✓ (keep)
- Empty state messages: Use new copy from W2
- No mock data fallback (already enforced)

**Bottom Nav:**
- Current: Dashboard | Analytics (text only)
- New: Dashboard | Analytics with subtle icons, accent green active indicator

### New Screens

**Export Screen (W6):**
- Accessible from a "More" or settings icon
- Format picker: JSON | CSV
- Period picker: This Month | This Year | All Time
- Download button → triggers file download or Telegram file send

---

## 6. W4: Merchant Tracking

### Current State
- No `merchant` field on expenses table
- Description serves as both merchant and note
- AI extracts description but doesn't separate merchant

### Target State (matches iOS)

**Schema:**
```sql
-- Migration: 0011_add_merchant.sql
ALTER TABLE expenses ADD COLUMN merchant TEXT;
```

**AI extraction:**
- System prompt update: "When logging an expense, extract the merchant name separately if identifiable. 'Starbucks coffee 5.60' → merchant: 'Starbucks', description: 'Coffee', tags: ['coffee']"
- `log_expense` tool: Add `merchant` param (string, nullable, max 50 chars)
- `edit_expense` tool: Add `merchant` param (string, nullable)

**Display:**
- Bot messages: "Logged SGD 5.60 — Coffee at Starbucks (food, coffee)"
- Mini App: Merchant shown as muted text below description in transaction row

**Merchant History (stretch goal for W7):**
- Track merchant → tag associations over time
- Auto-suggest tags when a known merchant is detected

---

## 7. W5: Travel Mode

### Current State
- Users have a single `currency` in their profile
- No concept of trips, travel currency, or dual-currency display
- FX conversion not supported

### Target State (matches iOS)

This is the largest workstream. The bot should support:

1. **Trip creation** — `/travel` command or conversational ("I'm in Japan")
2. **Dual-currency logging** — Log in travel currency, show home equivalent
3. **FX rates** — Fetch and cache exchange rates
4. **Travel detection** — Bot could detect timezone mentions or currency switches
5. **Trip analytics** — Total spent on a trip in home currency

### Schema

```sql
-- Migration: 0012_travel_mode.sql

CREATE TABLE trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  emoji TEXT,
  travel_currency TEXT NOT NULL,
  start_date_utc TEXT NOT NULL,
  end_date_utc TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at_utc TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_trips_user ON trips(user_id);
CREATE INDEX idx_trips_active ON trips(user_id, is_active);

-- Add travel fields to expenses
ALTER TABLE expenses ADD COLUMN converted_amount_minor INTEGER;
ALTER TABLE expenses ADD COLUMN home_currency TEXT;
ALTER TABLE expenses ADD COLUMN exchange_rate REAL;
ALTER TABLE expenses ADD COLUMN exchange_rate_date TEXT;
ALTER TABLE expenses ADD COLUMN exchange_rate_source TEXT;
ALTER TABLE expenses ADD COLUMN trip_id INTEGER REFERENCES trips(id);

-- FX rate cache
CREATE TABLE exchange_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  rate_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'api',
  fetched_at_utc TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_currency, to_currency, rate_date)
);
```

### Bot Commands

| Command | Purpose |
|---------|---------|
| `/travel` | Start/manage Travel Mode |
| `/travel Japan JPY` | Quick-start a trip |
| `/endtrip` | End current trip |
| `/trips` | List past and active trips |

**Conversational activation:**
- "I'm in Tokyo" → Agent detects travel context → Suggests starting Travel Mode
- "Log 500 yen for ramen" → If no active trip, asks if user wants to start one

### Expense Logging During Travel

When Travel Mode is active:
1. Default currency switches to travel currency
2. Each expense is logged in travel currency
3. Home equivalent calculated and stored (locked at log time)
4. Bot reply: "Logged JPY 500 — Ramen (food)\n~SGD 4.85 at JPY 1 = SGD 0.0097"

### FX Rate Strategy

| Priority | Source | When |
|----------|--------|------|
| 1 | Live API | Online, rate not cached today |
| 2 | Cached rate | Rate fetched today already |
| 3 | Bundled fallback | Offline / API failure |

**API source:** frankfurter.app (free, no API key, ECB data, ~30 currencies)
**Cache:** D1 `exchange_rates` table
**Bundled:** JSON file with ~30 common currency pairs, updated at deploy time

### Analytics

- Trip summary: Total spent in travel currency + home equivalent
- Trip breakdown by tag
- Accessible via `/trips` command and Mini App

### Mini App Changes

- Trip selector in analytics
- Dual-currency display in transaction rows during trips
- Travel banner (when active trip)

---

## 8. W6: Export

### Commands

| Command | Output |
|---------|--------|
| `/export` | Prompt: JSON or CSV? Period? |
| `/export csv thismonth` | Direct file send |
| `/export json thisyear` | Direct file send |

### Formats

**CSV columns:** date, amount, currency, description, merchant, tags (comma-sep), converted_amount, home_currency, exchange_rate, trip

**JSON:** Full-fidelity nested structure matching iOS format:
```json
{
  "exported_at": "2026-03-30T12:00:00Z",
  "currency": "SGD",
  "expenses": [{
    "amount": 12.50,
    "currency": "SGD",
    "description": "Lunch",
    "merchant": "Hawker Center",
    "tags": ["food"],
    "date": "2026-03-30",
    "travel": {
      "converted_amount": 12.50,
      "home_currency": "SGD",
      "exchange_rate": 1.0,
      "trip_label": null
    }
  }]
}
```

### Delivery
- Generate file in Worker
- Send as Telegram document (sendDocument API)
- Also available via Mini App (download button)

---

## 9. W7: Smart Tag Learning

### Current State
- Tags come from AI extraction only (no learning)
- No memory of what tags a user has used before

### Target State (matches iOS 4-tier system)

**Tier 1 — Keyword mapping** (hardcoded, fast):
- "coffee" → food, coffee
- "uber", "grab" → transport
- "netflix" → subscriptions, entertainment
- ~20 rules, same as iOS

**Tier 2 — User tag associations** (learned):

```sql
-- Migration: 0013_tag_associations.sql
CREATE TABLE tag_associations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  word TEXT NOT NULL,
  tag TEXT NOT NULL,
  frequency INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'auto',
  created_at_utc TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, word, tag)
);

CREATE INDEX idx_tag_assoc_user_word ON tag_associations(user_id, word);
```

**Learning triggers:**
- User confirms a tag suggestion → increment frequency
- User adds a tag via edit → create association for description words
- Onboarding tag selection → seed associations (source: "onboarding")

**Tier 3 — Expense history** (frequency-based):
- Look at past expenses with matching words in description
- If >50% have a certain tag, suggest it

**Tier 4 — Semantic similarity** (Vectorize):
- Already have Vectorize embeddings for expenses
- Use to find semantically similar past expenses and inherit their tags
- Lowest priority, only when Tiers 1-3 produce nothing

### Integration with AI

- Before AI extraction, run Tiers 1-3 to pre-suggest tags
- Pass suggestions to system prompt: "The user's tag history suggests these tags for this expense: [food, coffee]. Use them if they fit."
- AI can override suggestions if context makes them wrong

---

## 10. Execution Plan

### Phase 1: Foundation (do first — everything else depends on this)

| Task | Workstream | Size | Dependency |
|------|-----------|------|------------|
| Categories → tags migration (schema + data) | W1 | Large | None |
| Add description column to expenses + backfill | W1 | Medium | Schema migration |
| User tag preferences table + onboarding seeding | W2 | Small | Schema migration |
| Update AI tools (remove category, expand tags, enable description edit) | W1 | Medium | Schema migration |
| Update system prompt (tags + voice guide) | W1 + W2 | Medium | Tool changes |
| Update `get_financial_report` (group by tag) | W1 | Medium | Schema migration |
| Update bot response formats | W2 | Small | Prompt changes |
| Update onboarding (narrative + tag selection) | W2 | Medium | Tag preferences table |

### Phase 2: Mini App Redesign

| Task | Workstream | Size | Dependency |
|------|-----------|------|------------|
| Design tokens + fonts (CSS) | W3 | Small | None |
| Transaction row redesign (tag pills) | W3 | Medium | W1 complete |
| Hero total redesign | W3 | Small | Design tokens |
| Analytics rebuild (tag-based) | W3 | Large | W1 complete |
| Edit drawer (tags + merchant) | W3 | Medium | W1 + W4 |
| Empty states + copy | W3 | Small | W2 |
| Bottom nav + polish | W3 | Small | Design tokens |

### Phase 3: Feature Parity

| Task | Workstream | Size | Dependency |
|------|-----------|------|------------|
| Merchant field (schema + extraction) | W4 | Medium | Phase 1 |
| Smart tag learning (associations table) | W7 | Medium | Phase 1 |
| Export command + file generation | W6 | Small | Phase 1 |
| Travel Mode (schema + trips) | W5 | Large | Phase 1 |
| Travel Mode (FX rates + conversion) | W5 | Large | Trips schema |
| Travel Mode (bot commands + display) | W5 | Medium | FX rates |
| Travel Mode (Mini App integration) | W5 | Medium | Phase 2 + trips |

### Phase 4: Polish

| Task | Workstream | Size | Dependency |
|------|-----------|------|------------|
| Motion/animation (Mini App) | W3 | Small | Phase 2 |
| Merchant history + autocomplete | W4 | Small | Phase 3 |
| Tag learning from edits | W7 | Small | Phase 3 |
| End-to-end testing | All | Medium | All phases |

---

## 11. Out of Scope

These exist in one or both products but are **not** part of this alignment effort:

- Budget/goal setting (neither product has it, not planned)
- iCloud sync (iOS-only concern)
- Siri/Spotlight (iOS-only, no Telegram equivalent)
- Apple Watch (iOS-only)
- Notification content alignment (existing notification system stays as-is)
- Multi-user/household features
- Recurring expense templates

---

## 12. Risks & Decisions Needed

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Categories → tags is a breaking change for existing users | Existing expenses lose category grouping | Data migration maps categories to tags before column drop |
| Mini App dark-only might conflict with Telegram light theme users | Some users prefer light mode | Accept this — brand consistency > theme flexibility |
| Travel Mode is a large feature | Could delay everything | Phase 3 can ship independently; Phases 1+2 are valuable on their own |
| FX rate API dependency (frankfurter.app) | Rate limits, downtime | Bundled fallback rates + D1 cache |
| Tag explosion (too many freeform tags) | Messy analytics | AI guidance to prefer existing tags; show "merge tag" in Mini App eventually |

### Decisions Made

1. **FX API provider** — frankfurter.app (free, no API key needed)
2. **Donut chart** — Keep it in the tag-based analytics redesign
3. **Description editing** — Include in this effort (Phase 1, W1 — add `description` column to expenses)
4. **Onboarding tag storage** — Separate `user_tag_preferences` table

---

## 13. Success Criteria

After all phases ship:

- [ ] No `category` column exists in the database
- [ ] All expenses use tags as primary grouping
- [ ] Bot personality matches iOS voice guide
- [ ] Onboarding tells the Gastos story (not just config)
- [ ] Mini App uses iOS design tokens (colors, fonts, radii)
- [ ] Mini App analytics groups by tag
- [ ] Merchant field exists and is extracted by AI
- [ ] Travel Mode works (trips, dual-currency, FX rates)
- [ ] Export available as bot command (JSON + CSV)
- [ ] Tag learning improves suggestions over time
- [ ] Brand vocabulary is consistent (expenses, tags, log/track)
