/**
 * Format amount from minor units (cents) to display string.
 * formatAmount(2800, "SGD") → "SGD 28.00"
 */
export function formatAmount(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

/**
 * Format amount for display without currency prefix.
 * formatAmountShort(2800) → "28.00"
 */
export function formatAmountShort(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

/**
 * Relative time string from ISO date.
 * Returns "2h ago", "Yesterday", "Mar 9", etc.
 */
export function relativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Group expenses by date for section headers.
 * Returns: [{ label: "Today", expenses: [...] }, { label: "Yesterday", ... }]
 */
export function groupByDate(
  expenses: { occurred_at_utc: string }[]
): { label: string; expenses: typeof expenses }[] {
  const now = new Date();
  const todayStr = toLocalDateStr(now);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toLocalDateStr(yesterday);

  const groups = new Map<string, typeof expenses>();

  for (const expense of expenses) {
    const expenseDate = new Date(expense.occurred_at_utc);
    const dateStr = toLocalDateStr(expenseDate);
    let label: string;
    if (dateStr === todayStr) {
      label = "Today";
    } else if (dateStr === yesterdayStr) {
      label = "Yesterday";
    } else {
      label = expenseDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    }

    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(expense);
  }

  return Array.from(groups.entries()).map(([label, exps]) => ({
    label,
    expenses: exps,
  }));
}

/**
 * Parse tags JSON string safely.
 * parseTags('["lunch","work"]') → ["lunch", "work"]
 * parseTags(null) → []
 */
export function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
