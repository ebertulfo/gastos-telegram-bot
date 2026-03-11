import { useState, useEffect, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { PeriodToggle } from "../components/PeriodToggle";
import { DonutChart } from "../components/DonutChart";
import { CategoryList, type CategoryTotal } from "../components/CategoryList";
import { TransactionList } from "../components/TransactionList";
import { EditDrawer } from "../components/EditDrawer";
import { Skeleton } from "../components/ui/skeleton";
import { fetchExpenses, fetchUserProfile } from "../lib/api";
import { getCategoryConfig } from "../lib/categories";
import { formatAmountShort } from "../lib/format";
import type { ExpenseWithDetails, Period } from "../lib/types";

const PERIOD_OPTIONS = [
  { value: "thisweek", label: "Week" },
  { value: "thismonth", label: "Month" },
  { value: "thisyear", label: "Year" },
];

type AnalyticsScreenProps = {
  drillDownCategory: string | null;
  onDrillDown: (category: string) => void;
  onBack: () => void;
};

export function AnalyticsScreen({ drillDownCategory, onDrillDown, onBack }: AnalyticsScreenProps) {
  const [period, setPeriod] = useState<Period>("thismonth");
  const [expenses, setExpenses] = useState<ExpenseWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("SGD");
  const [selectedExpense, setSelectedExpense] = useState<ExpenseWithDetails | null>(null);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchExpenses(period);
      setExpenses(data);
    } catch (err) {
      console.error("Failed to load expenses:", err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchUserProfile().then((profile) => {
      if (profile.currency) setCurrency(profile.currency);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  // Compute category totals
  const totalMinor = expenses.reduce((sum, e) => sum + e.amount_minor, 0);
  const categoryMap = new Map<string, { totalMinor: number; count: number }>();
  for (const e of expenses) {
    const cat = e.category || "Other";
    const existing = categoryMap.get(cat) || { totalMinor: 0, count: 0 };
    existing.totalMinor += e.amount_minor;
    existing.count++;
    categoryMap.set(cat, existing);
  }
  const categoryTotals: CategoryTotal[] = Array.from(categoryMap.entries())
    .map(([category, data]) => ({
      category,
      totalMinor: data.totalMinor,
      count: data.count,
      percentage: totalMinor > 0 ? Math.round((data.totalMinor / totalMinor) * 100) : 0,
    }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  const donutSegments = categoryTotals.map((cat) => ({
    label: cat.category,
    value: cat.totalMinor,
    color: getCategoryConfig(cat.category).color,
  }));

  // Drill-down: filter expenses by selected category
  if (drillDownCategory) {
    const filtered = expenses.filter((e) => e.category === drillDownCategory);
    const catConfig = getCategoryConfig(drillDownCategory);

    return (
      <>
        <div className="flex items-center gap-2 py-3">
          <button onClick={onBack} className="p-1">
            <ArrowLeft size={20} color="var(--foreground)" />
          </button>
          <span className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
            {catConfig.emoji} {drillDownCategory}
          </span>
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
            ({filtered.length})
          </span>
        </div>
        <TransactionList expenses={filtered} onSelectExpense={setSelectedExpense} />
        <EditDrawer
          expense={selectedExpense}
          onClose={() => setSelectedExpense(null)}
          onSaved={loadExpenses}
        />
      </>
    );
  }

  return (
    <>
      <div className="py-4">
        <PeriodToggle options={PERIOD_OPTIONS} value={period} onChange={(v) => setPeriod(v as Period)} />
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="mx-auto h-28 w-28 rounded-full" />
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      ) : expenses.length === 0 ? (
        <div className="py-12 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
          No spending data yet.
        </div>
      ) : (
        <>
          <DonutChart
            segments={donutSegments}
            total={formatAmountShort(totalMinor)}
            currency={currency}
          />
          <div className="mt-6">
            <CategoryList
              categories={categoryTotals}
              currency={currency}
              onCategoryClick={onDrillDown}
            />
          </div>
        </>
      )}

      <EditDrawer
        expense={selectedExpense}
        onClose={() => setSelectedExpense(null)}
        onSaved={loadExpenses}
      />
    </>
  );
}
