import { useState, useEffect, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { PeriodToggle } from "../components/PeriodToggle";
import { DonutChart } from "../components/DonutChart";
import { CategoryList, type CategoryTotal } from "../components/CategoryList";
import { TransactionList } from "../components/TransactionList";
import { EditDrawer } from "../components/EditDrawer";
import { Skeleton } from "../components/ui/skeleton";
import { fetchExpenses, fetchUserProfile, fetchUserTags } from "../lib/api";
import { getTagConfig } from "../lib/categories";
import { formatAmountShort, parseTags } from "../lib/format";
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
  const [allTags, setAllTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchExpenses(period);
      setExpenses(data);
    } catch (e) {
      console.error("Failed to fetch expenses:", e);
      setExpenses([]);
      setError("Could not load expenses. Please try again.");
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
    fetchUserTags().then(setAllTags).catch(() => {});
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const handleSaved = useCallback(() => {
    loadExpenses();
    fetchUserTags().then(setAllTags).catch(() => {});
  }, [loadExpenses]);

  // Compute tag totals (an expense appears in every tag group it has)
  const totalMinor = expenses.reduce((sum, e) => sum + e.amount_minor, 0);
  const tagMap = new Map<string, { totalMinor: number; count: number }>();
  for (const e of expenses) {
    const tags = parseTags(e.tags);
    const effectiveTags = tags.length > 0 ? tags : ["untagged"];
    for (const tag of effectiveTags) {
      const existing = tagMap.get(tag) || { totalMinor: 0, count: 0 };
      existing.totalMinor += e.amount_minor;
      existing.count++;
      tagMap.set(tag, existing);
    }
  }
  const tagTotals: CategoryTotal[] = Array.from(tagMap.entries())
    .map(([tag, data]) => ({
      category: tag, // CategoryList expects "category" field name
      totalMinor: data.totalMinor,
      count: data.count,
      percentage: totalMinor > 0 ? Math.round((data.totalMinor / totalMinor) * 100) : 0,
    }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  const donutSegments = tagTotals.map((t) => ({
    label: t.category,
    value: t.totalMinor,
    color: getTagConfig(t.category).color,
  }));

  // Drill-down: filter expenses by selected tag
  if (drillDownCategory) {
    const drillDownTag = drillDownCategory;
    const filtered = expenses.filter((e) => {
      const tags = parseTags(e.tags);
      return tags.includes(drillDownTag);
    });

    return (
      <>
        <div className="flex items-center gap-2 py-3">
          <button onClick={onBack} className="p-1">
            <ArrowLeft size={20} color="var(--text-primary)" />
          </button>
          <span className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            #{drillDownTag}
          </span>
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            ({filtered.length})
          </span>
        </div>
        <TransactionList expenses={filtered} onSelectExpense={setSelectedExpense} />
        <EditDrawer
          expense={selectedExpense}
          allTags={allTags}
          onClose={() => setSelectedExpense(null)}
          onSaved={handleSaved}
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
      ) : error ? (
        <div className="py-12 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>{error}</p>
          <button
            onClick={loadExpenses}
            className="mt-3 px-4 py-2 text-sm font-medium"
            style={{ background: "var(--accent)", color: "var(--bg-base)", borderRadius: "var(--radius-md)" }}
          >
            Retry
          </button>
        </div>
      ) : expenses.length === 0 ? (
        <div className="py-12 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
          Not enough data yet — log a few expenses to see insights.
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
              categories={tagTotals}
              currency={currency}
              onCategoryClick={onDrillDown}
            />
          </div>
        </>
      )}

      <EditDrawer
        expense={selectedExpense}
        allTags={allTags}
        onClose={() => setSelectedExpense(null)}
        onSaved={handleSaved}
      />
    </>
  );
}
