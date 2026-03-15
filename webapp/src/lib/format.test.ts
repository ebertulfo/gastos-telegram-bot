process.env.TZ = "Asia/Singapore";

import { describe, test, expect, vi, afterEach } from "vitest";
import { groupByDate } from "./format";

describe("groupByDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("groups expense into Today when local date is today even though UTC date is yesterday", () => {
    // 8:35 AM SGT Mar 15 = 00:35 UTC Mar 15
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:35:00Z"));

    const expenses = [
      // 1:00 AM SGT Mar 15 = 5:00 PM UTC Mar 14
      // UTC date: Mar 14 (yesterday), Local date: Mar 15 (today)
      { occurred_at_utc: "2026-03-14T17:00:00.000Z" },
    ];

    const groups = groupByDate(expenses);
    expect(groups[0].label).toBe("Today");
  });

  test("groups two expenses with same local date together even if UTC dates differ", () => {
    // 8:35 AM SGT Mar 15 = 00:35 UTC Mar 15
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:35:00Z"));

    const expenses = [
      // 8:30 AM SGT Mar 15 = 00:30 UTC Mar 15 → UTC date: Mar 15
      { occurred_at_utc: "2026-03-15T00:30:00.000Z" },
      // 1:00 AM SGT Mar 15 = 5:00 PM UTC Mar 14 → UTC date: Mar 14
      { occurred_at_utc: "2026-03-14T17:00:00.000Z" },
    ];

    const groups = groupByDate(expenses);
    // Both should be "Today" in SGT
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Today");
    expect(groups[0].expenses).toHaveLength(2);
  });

  test("correctly groups Yesterday in local timezone", () => {
    // 8:35 AM SGT Mar 15 = 00:35 UTC Mar 15
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:35:00Z"));

    const expenses = [
      // 11:00 PM SGT Mar 14 = 3:00 PM UTC Mar 14
      // Local date: Mar 14 (yesterday in SGT)
      { occurred_at_utc: "2026-03-14T15:00:00.000Z" },
    ];

    const groups = groupByDate(expenses);
    expect(groups[0].label).toBe("Yesterday");
  });

  test("older dates use formatted date label", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:35:00Z"));

    const expenses = [
      // Mar 13 in SGT
      { occurred_at_utc: "2026-03-13T10:00:00.000Z" },
    ];

    const groups = groupByDate(expenses);
    expect(groups[0].label).toBe("Mar 13");
  });
});
