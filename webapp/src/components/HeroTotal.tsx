import type { ExpenseWithDetails, Period } from "../lib/types";
import { formatAmountShort } from "../lib/format";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  thisweek: "This Week",
  thismonth: "This Month",
  thisyear: "This Year",
};

const PERIOD_CYCLE: Period[] = ["today", "thisweek", "thismonth", "thisyear"];

type HeroTotalProps = {
  period: Period;
  onPeriodChange: (period: Period) => void;
  expenses: ExpenseWithDetails[];
  currency: string;
};

export function HeroTotal({ period, onPeriodChange, expenses, currency }: HeroTotalProps) {
  const totalMinor = expenses.reduce((sum, e) => sum + e.amount_minor, 0);

  const handleCyclePeriod = () => {
    const idx = PERIOD_CYCLE.indexOf(period);
    const next = PERIOD_CYCLE[(idx + 1) % PERIOD_CYCLE.length];
    onPeriodChange(next);
  };

  return (
    <div className="text-center py-4">
      <button
        onClick={handleCyclePeriod}
        className="text-[11px] uppercase tracking-wider mb-1"
        style={{ color: "var(--text-secondary)" }}
      >
        {PERIOD_LABELS[period]} ▾
      </button>
      <div
        className="text-[32px] font-bold"
        style={{ color: "var(--foreground)", letterSpacing: "-1px" }}
      >
        {currency} {formatAmountShort(totalMinor)}
      </div>
    </div>
  );
}
