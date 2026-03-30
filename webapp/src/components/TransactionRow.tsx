import type { ExpenseWithDetails } from "../lib/types";
import { getTagConfig } from "../lib/categories";
import { formatAmountShort, relativeTime, parseTags } from "../lib/format";

type TransactionRowProps = {
  expense: ExpenseWithDetails;
  onClick: (expense: ExpenseWithDetails) => void;
};

export function TransactionRow({ expense, onClick }: TransactionRowProps) {
  const tags = parseTags(expense.tags);
  const description = expense.description || expense.text_raw || "Unknown";
  const isReview = expense.status === "needs_review";
  const primaryTag = tags[0];
  const tagConfig = primaryTag ? getTagConfig(primaryTag) : null;

  return (
    <button
      onClick={() => onClick(expense)}
      className="flex w-full items-center justify-between py-3 text-left"
      style={{
        background: isReview ? "var(--review-bg)" : "transparent",
        borderRadius: isReview ? "var(--radius-md)" : 0,
        paddingLeft: isReview ? "10px" : 0,
        paddingRight: isReview ? "10px" : 0,
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center text-[10px] font-medium"
          style={{
            background: tagConfig ? `${tagConfig.color}18` : "var(--bg-raised)",
            color: tagConfig?.color ?? "var(--text-muted)",
            borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {primaryTag ? primaryTag.slice(0, 3) : "..."}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {description}
            </span>
            {isReview && (
              <span
                className="shrink-0 px-1.5 py-0.5 text-[9px] font-semibold"
                style={{
                  background: "var(--review-bg)",
                  color: "var(--review-badge)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                REVIEW
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            {tags.slice(0, 3).map((tag) => {
              const cfg = getTagConfig(tag);
              return (
                <span
                  key={tag}
                  className="py-0.5 px-1.5 text-[10px]"
                  style={{
                    background: `${cfg.color}15`,
                    color: cfg.color,
                    borderRadius: "var(--radius-2xl)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {tag}
                </span>
              );
            })}
            <span className="text-[10px] ml-0.5" style={{ color: "var(--text-muted)" }}>
              {tags.length > 0 && "· "}{relativeTime(expense.occurred_at_utc)}
            </span>
          </div>
        </div>
      </div>
      <span
        className="shrink-0 text-sm font-semibold ml-3"
        style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
      >
        -{formatAmountShort(expense.amount_minor)}
      </span>
    </button>
  );
}
