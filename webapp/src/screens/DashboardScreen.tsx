import { useState, useEffect, useCallback } from "react";
import { HeroTotal } from "../components/HeroTotal";
import { TransactionList } from "../components/TransactionList";
import { EditDrawer } from "../components/EditDrawer";
import { Skeleton } from "../components/ui/skeleton";
import { fetchExpenses, fetchUserProfile, fetchUserTags } from "../lib/api";
import type { ExpenseWithDetails, Period } from "../lib/types";

export function DashboardScreen() {
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

  return (
    <>
      {loading ? (
        <div className="py-6 text-center">
          <Skeleton className="mx-auto mb-2 h-4 w-24" />
          <Skeleton className="mx-auto h-10 w-48" />
          <div className="mt-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
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
      ) : (
        <>
          <HeroTotal
            period={period}
            onPeriodChange={setPeriod}
            expenses={expenses}
            currency={currency}
          />
          <div className="my-3 h-px" style={{ background: "var(--border)" }} />
          <TransactionList
            expenses={expenses}
            onSelectExpense={setSelectedExpense}
          />
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
