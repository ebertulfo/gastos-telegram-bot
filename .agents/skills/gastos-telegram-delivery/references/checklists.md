# Checklists

## Implementation Checklist

- Raw `source_event` is persisted before any success ack.
- Duplicate webhook events are handled without duplicate inserts.
- Queue message includes source-event linkage.
- Parser writes `parse_results` for every processed event.
- `expenses` is created only when amount and currency are available.
- `needs_review` status is set for uncertain extractions.
- Amount-missing events remain visible as unprocessed in web flow.

## Timezone and Totals Checklist

- User timezone is stored as valid IANA identifier.
- Day/week/month/year boundaries are computed in local timezone.
- Boundaries are converted to UTC for DB filtering.
- `/thisweek` starts Monday `00:00` local time.
- Totals include `final` and `needs_review` statuses.

## Review Checklist

- No webhook-side AI calls.
- Ingest path remains low-latency and non-blocking.
- Data model changes include migration notes.
- Tests cover idempotency and timezone boundaries.
- Docs updated: `TASKS`, `DECISIONS`, and `RULES` as needed.
