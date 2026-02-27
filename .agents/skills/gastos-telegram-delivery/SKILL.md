---
name: gastos-telegram-delivery
description: Use this skill when implementing or reviewing Gastos Telegram Bot features spanning webhook ingestion, queue parsing, D1 schema, onboarding, totals commands, idempotency, and timezone-safe calendar queries.
---

# Gastos Telegram Delivery

Use this skill for any task that touches the product flow in `/Users/edrianbertulfo/Dev/gastos-telegram-bot/tprd.md`.

## Required Inputs

- Product constraints from `/Users/edrianbertulfo/Dev/gastos-telegram-bot/tprd.md`
- Repository operating rules from `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/RULES.md`
- Active milestones from `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/TASKS.md`

## Execution Flow

1. Confirm milestone and acceptance criteria in `docs/core/TASKS.md`.
2. **Spec-Driven Design**: Before writing any code, duplicate `docs/core/SPEC_TEMPLATE.md` into `docs/specs/[feature-name].md`.
3. Define the Intent, explicit Data Contracts, and Constraints.
4. **Approval Gate**: Wait for the Product Owner to explicitly approve the Spec document before proceeding.
5. Execute the design strictly based on the approved Spec. Keep all timestamps UTC at rest.
6. Compute calendar boundaries in user timezone only at query time.
7. Add or update tests before finalizing.

## Non-Negotiables

- No AI calls in webhook request path.
- Ack only after raw event persistence.
- Idempotent handling of duplicate Telegram updates.
- Totals commands must be pure DB reads.
- Week boundaries are Monday to Sunday in user timezone.

## What to Validate Before Completion

Use `/Users/edrianbertulfo/Dev/gastos-telegram-bot/.agents/skills/gastos-telegram-delivery/references/checklists.md`.

## Escalation Conditions

Stop and ask the Product Owner when:
- A change conflicts with `tprd.md`.
- A schema decision changes data model semantics.
- A command response contract changes user-visible behavior.
