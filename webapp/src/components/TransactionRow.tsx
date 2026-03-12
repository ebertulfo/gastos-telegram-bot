import type { ExpenseWithDetails } from "../lib/types";
import { getCategoryConfig } from "../lib/categories";
import { formatAmountShort, relativeTime, parseTags } from "../lib/format";

type TransactionRowProps = {
  expense: ExpenseWithDetails;
  onClick: (expense: ExpenseWithDetails) => void;
};

export function TransactionRow({ expense, onClick }: TransactionRowProps) {
  const cat = getCategoryConfig(expense.category);
  const tags = parseTags(expense.tags);
  const description = expense.parsed_description || expense.text_raw || "Unknown";
  const isReview = expense.status === "needs_review";

  return (
    <button
      onClick={() => onClick(expense)}
      className="flex w-full items-center justify-between py-2.5 text-left"
      style={{
        background: isReview ? "var(--review-bg)" : "transparent",
        borderRadius: isReview ? "6px" : 0,
        paddingLeft: isReview ? "8px" : 0,
        paddingRight: isReview ? "8px" : 0,
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm"
          style={{ background: isReview ? "var(--review-bg)" : "var(--surface)" }}
        >
          {cat.emoji}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="truncate text-sm font-medium"
              style={{ color: "var(--foreground)" }}
            >
              {description}
            </span>
            {isReview && (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold"
                style={{ background: "var(--review-bg)", color: "var(--review-badge)" }}
              >
                REVIEW
              </span>
            )}
          </div>
          <div
            className="flex items-center gap-1 text-[11px]"
            style={{ color: "var(--text-secondary)" }}
          >
            <span>{expense.category}</span>
            {tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded px-1.5 py-0.5"
                style={{ background: "var(--surface)", fontSize: "10px" }}
              >
                #{tag}
              </span>
            ))}
            <span style={{ color: "var(--border)" }}>·</span>
            <span>{relativeTime(expense.occurred_at_utc)}</span>
          </div>
        </div>
      </div>
      <span
        className="shrink-0 text-sm font-semibold ml-2"
        style={{ color: "var(--foreground)" }}
      >
        -{formatAmountShort(expense.amount_minor)}
      </span>
    </button>
  );
}
