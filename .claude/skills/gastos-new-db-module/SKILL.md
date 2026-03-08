---
name: gastos-new-db-module
description: Scaffold a new src/db/ module following project conventions. Use when creating a new database query module for a new table or domain entity.
tools: Read, Glob, Grep, Write, Edit
---

# New DB Module Scaffold

Follow this pattern when creating a new `src/db/*.ts` module.

## Step 1: Check existing modules for reference

Run: `ls src/db/` to see current modules. Read one (e.g., `src/db/expenses.ts`) to confirm the current pattern.

## Step 2: Create the new module

Follow these conventions:
- File goes in `src/db/` with a descriptive name (e.g., `src/db/categories.ts`)
- Functions take `D1Database` as first parameter (NOT `Env`)
- Always include `userId: number` parameter for user-scoped queries
- Use Zod schemas for validation and `z.infer<typeof Schema>` for return types
- Export all query functions

## Template

```typescript
import { z } from "zod";

const EntitySchema = z.object({
  id: z.number(),
  user_id: z.number(),
  // ... fields matching the table columns
  created_at: z.string(),
});

type Entity = z.infer<typeof EntitySchema>;

export async function getEntities(
  db: D1Database,
  userId: number
): Promise<Entity[]> {
  const result = await db
    .prepare("SELECT * FROM entities WHERE user_id = ?")
    .bind(userId)
    .all();
  return result.results as Entity[];
}

export async function createEntity(
  db: D1Database,
  userId: number,
  data: Omit<Entity, "id" | "user_id" | "created_at">
): Promise<Entity> {
  // ... implementation
}
```

## Step 3: Update CLAUDE.md if needed

Add the new module to the `db/` functions list in CLAUDE.md's Code Patterns section.

## Rules

- Never accept userId from user/LLM input — always from auth context
- Use `response_format: { type: "json_object" }` if the module involves OpenAI calls
- Keep queries simple — one function per operation
