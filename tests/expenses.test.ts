import { describe, expect, it, vi } from "vitest";
import { updateExpense, deleteExpense } from "../src/db/expenses";

function mockDb() {
  const run = vi.fn(async () => ({ meta: { changes: 1 } }));
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ bind }));
  return { db: { prepare } as unknown as D1Database, prepare, bind, run };
}

describe("updateExpense", () => {
  it("updates with user_id guard", async () => {
    const { db, prepare, bind } = mockDb();
    await updateExpense(db, 42, 7, { amount_minor: 1500 });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("user_id"));
    expect(bind).toHaveBeenCalledWith(1500, 42, 7);
  });

  it("no-ops on empty updates", async () => {
    const { db, prepare } = mockDb();
    await updateExpense(db, 42, 7, {});
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("deleteExpense", () => {
  it("deletes with user_id guard", async () => {
    const { db, prepare, bind } = mockDb();
    await deleteExpense(db, 42, 7);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("user_id"));
    expect(bind).toHaveBeenCalledWith(42, 7);
  });
});
