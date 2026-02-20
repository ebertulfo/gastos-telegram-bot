# Gastos Telegram Bot - Agent Operating Guide

This repository follows `/Users/edrianbertulfo/Dev/gastos-telegram-bot/tprd.md` as the source of truth.

## Objective

Build a minimal, production-safe Telegram bot that:
- Ingests expense inputs (`text`, `photo`, `voice`)
- Persists raw data immediately and confirms receipt
- Extracts amount and currency asynchronously
- Returns fast calendar-based totals via commands

Detailed correction and review happen in the web app, not in Telegram.

## Non-Negotiable Constraints

- Ack only after raw persistence succeeds.
- Parsing must never block webhook command execution.
- Ingest path target is under `500ms`.
- AI calls run only in queue consumers.
- Store all times in UTC.
- Compute day/week/month/year boundaries in each user's timezone.
- One message maps to one source event.
- Totals commands are pure DB reads.
- Enforce idempotency with unique `(telegram_chat_id, telegram_message_id)`.

## Collaboration Contract

- Product Owner defines outcomes and priorities in `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/TASKS.md`.
- Agents propose a short plan, then execute end-to-end for the selected task.
- Every PR/change must update docs when behavior or decisions change.
- If requirements conflict, pause and ask the Product Owner before implementation.

## Required Workflow

Follow `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/WORKFLOW.md`.

## Required Rules

Follow `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/RULES.md`.

## Decision Logging

Record architecture/product decisions in `/Users/edrianbertulfo/Dev/gastos-telegram-bot/docs/DECISIONS.md`.

## Local Skill

When working on this project, use:
- `gastos-telegram-delivery`: `/Users/edrianbertulfo/Dev/gastos-telegram-bot/.agents/skills/gastos-telegram-delivery/SKILL.md`
- `codex-execution-discipline`: `/Users/edrianbertulfo/Dev/gastos-telegram-bot/.agents/skills/codex-execution-discipline/SKILL.md`

Trigger `gastos-telegram-delivery` for tasks involving webhook ingestion, queue parsing, D1 schema, totals commands, onboarding, or timezone logic.

Trigger `codex-execution-discipline` for non-trivial implementation, bug-fixing, review, or process updates that require explicit planning, re-planning, rigorous verification, and lessons capture.
