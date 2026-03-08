---
name: gastos-d1-migration
description: Create and apply D1 database migrations. Use when adding tables, columns, indexes, or modifying the database schema. Triggers on mentions of migrations, schema changes, new tables, new columns, ALTER TABLE, or database changes.
tools: Read, Glob, Grep, Bash, Write, Edit
---

# D1 Migration Checklist

Follow this checklist when creating a new D1 migration.

## Step 1: Determine the next migration number

Run:
```bash
ls migrations/ | sort -n | tail -1
```

The next migration should be the next sequential number (e.g., if last is `0005_`, next is `0006_`).

## Step 2: Create the migration file

File naming convention: `migrations/NNNN_description.sql`

Examples:
- `migrations/0006_add_categories_table.sql`
- `migrations/0007_add_index_on_expenses_date.sql`

Write the SQL migration. Use `IF NOT EXISTS` for CREATE TABLE. Include comments explaining the change.

## Step 3: Update `src/types.ts` if needed

If the migration adds new bindings or changes the Env type, update `src/types.ts`.

## Step 4: Update or create `src/db/*.ts` module if needed

If the migration adds a new table, create a corresponding db module following project conventions:
- Function takes `D1Database` directly (not `Env`)
- Inject `user_id` from auth context
- Use `z.infer<typeof Schema>` for return types

## Step 5: Apply the migration locally

Run:
```bash
npx wrangler d1 migrations apply gastos-db --local
```

## Step 6: Run tests to verify

Run: `npm run check && npm run test`

## Step 7: Apply to remote (production)

Only after tests pass and the change is committed:
```bash
npx wrangler d1 migrations apply gastos-db --remote
```

## Rules

- Never modify existing migration files — always create new ones
- Always use `IF NOT EXISTS` for safety
- Keep migrations small and focused — one concern per file
