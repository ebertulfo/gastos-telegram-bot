import type { ExpenseWithDetails } from "../lib/types";
import { groupByDate } from "../lib/format";
import { TransactionRow } from "./TransactionRow";

type TransactionListProps = {
  expenses: ExpenseWithDetails[];
  onSelectExpense: (expense: ExpenseWithDetails) => void;
};

export function TransactionList({ expenses, onSelectExpense }: TransactionListProps) {
  const groups = groupByDate(expenses);

  if (expenses.length === 0) {
    return (
      <div className="py-12 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        No expenses yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <div key={group.label}>
          <div
            className="pb-1.5 pt-4 text-[11px] uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            {group.label}
          </div>
          <div className="flex flex-col divide-y [&>*+*]:border-[var(--border)]">
            {(group.expenses as ExpenseWithDetails[]).map((expense) => (
              <TransactionRow
                key={expense.id}
                expense={expense}
                onClick={onSelectExpense}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
