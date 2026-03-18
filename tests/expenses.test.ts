import { describe, expect, it, vi } from "vitest";
import { updateExpense, deleteExpense, getUserTags } from "../src/db/expenses";

function mockDb() {
  const run = vi.fn(async () => ({ meta: { changes: 1 } }));
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ bind }));
  return { db: { prepare } as unknown as D1Database, prepare, bind, run };
}

describe("updateExpense", () => {
  it("updates with user_id guard and returns changes count", async () => {
    const { db, prepare, bind } = mockDb();
    const changes = await updateExpense(db, 42, 7, { amount_minor: 1500 });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("user_id"));
    expect(bind).toHaveBeenCalledWith(1500, 42, 7);
    expect(changes).toBe(1);
  });

  it("returns 0 when no rows matched", async () => {
    const run = vi.fn(async () => ({ meta: { changes: 0 } }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;
    const changes = await updateExpense(db, 999, 7, { amount_minor: 100 });
    expect(changes).toBe(0);
  });

  it("returns 0 on empty updates without querying", async () => {
    const { db, prepare } = mockDb();
    const changes = await updateExpense(db, 42, 7, {});
    expect(prepare).not.toHaveBeenCalled();
    expect(changes).toBe(0);
  });

  it("throws on invalid column names", async () => {
    const { db } = mockDb();
    await expect(
      updateExpense(db, 42, 7, { "malicious_column; DROP TABLE expenses": "oops" })
    ).rejects.toThrow("Invalid update column");
  });
});

describe("deleteExpense", () => {
  it("deletes with user_id guard and returns changes count", async () => {
    const { db, prepare, bind } = mockDb();
    const changes = await deleteExpense(db, 42, 7);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("user_id"));
    expect(bind).toHaveBeenCalledWith(42, 7);
    expect(changes).toBe(1);
  });

  it("returns 0 when no rows matched", async () => {
    const run = vi.fn(async () => ({ meta: { changes: 0 } }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;
    const changes = await deleteExpense(db, 999, 7);
    expect(changes).toBe(0);
  });
});

describe("getUserTags", () => {
  it("extracts and deduplicates tags from all expenses", async () => {
    const all = vi.fn(async () => ({
      results: [
        { tags: '["coffee","lunch"]' },
        { tags: '["lunch","dinner"]' },
        { tags: '[]' },
      ],
    }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const tags = await getUserTags(db, 7);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("SELECT"));
    expect(bind).toHaveBeenCalledWith(7);
    expect(tags).toEqual(["coffee", "dinner", "lunch"]);
  });

  it("returns empty array when no expenses", async () => {
    const all = vi.fn(async () => ({ results: [] }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const tags = await getUserTags(db, 7);
    expect(tags).toEqual([]);
  });
});
