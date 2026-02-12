import { describe, expect, it } from "vitest";
import { formatTotalsMessage, getPeriodUtcRange, parseTotalsPeriod } from "../src/totals";

describe("parseTotalsPeriod", () => {
  it("maps known commands", () => {
    expect(parseTotalsPeriod("/today")).toBe("today");
    expect(parseTotalsPeriod("/thisweek")).toBe("thisweek");
    expect(parseTotalsPeriod("/thismonth")).toBe("thismonth");
    expect(parseTotalsPeriod("/thisyear")).toBe("thisyear");
    expect(parseTotalsPeriod("/unknown")).toBeNull();
  });
});

describe("getPeriodUtcRange", () => {
  const now = new Date("2026-02-12T12:00:00.000Z");

  it("computes today range in Asia/Manila", () => {
    const range = getPeriodUtcRange(now, "Asia/Manila", "today");
    expect(range.startUtc.toISOString()).toBe("2026-02-11T16:00:00.000Z");
    expect(range.endUtc.toISOString()).toBe("2026-02-12T15:59:59.999Z");
  });

  it("computes monday-start week range in Asia/Manila", () => {
    const range = getPeriodUtcRange(now, "Asia/Manila", "thisweek");
    expect(range.startUtc.toISOString()).toBe("2026-02-08T16:00:00.000Z");
    expect(range.endUtc.toISOString()).toBe("2026-02-15T15:59:59.999Z");
  });
});

describe("formatTotalsMessage", () => {
  it("formats output contract", () => {
    const text = formatTotalsMessage({
      currency: "SGD",
      period: "today",
      totals: {
        totalMinor: 123456,
        count: 18,
        needsReviewCount: 3
      }
    });

    expect(text).toContain("Today");
    expect(text).toContain("Total: SGD 1,234.56");
    expect(text).toContain("Count: (18 expenses)");
    expect(text).toContain("Needs review: 3 need confirmation");
  });
});
