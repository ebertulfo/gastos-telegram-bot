import { useState, useEffect, useCallback } from "react";
import { HeroTotal } from "../components/HeroTotal";
import { TransactionList } from "../components/TransactionList";
import { EditDrawer } from "../components/EditDrawer";
import { Skeleton } from "../components/ui/skeleton";
import { fetchExpenses, fetchUserProfile } from "../lib/api";
import { MOCK_EXPENSES } from "../lib/mock-data";
import type { ExpenseWithDetails, Period } from "../lib/types";

export function DashboardScreen() {
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
    } catch {
      if (import.meta.env.DEV) console.info("[dev] API unreachable, using mock data");
      setExpenses(MOCK_EXPENSES);
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
        onClose={() => setSelectedExpense(null)}
        onSaved={loadExpenses}
      />
    </>
  );
}
