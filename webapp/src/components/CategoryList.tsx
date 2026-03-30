import { ChevronRight } from "lucide-react";
import { getTagConfig } from "../lib/categories";
import { formatAmountShort } from "../lib/format";

export type CategoryTotal = {
  category: string; // actually a tag name — renamed in Phase 2 design
  totalMinor: number;
  count: number;
  percentage: number;
};

type CategoryListProps = {
  categories: CategoryTotal[];
  currency: string;
  onCategoryClick: (category: string) => void;
};

export function CategoryList({ categories, currency, onCategoryClick }: CategoryListProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <div
        className="pb-2 text-[11px] uppercase tracking-wider"
        style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
      >
        By Tag
      </div>
      {categories.map((cat) => {
        const config = getTagConfig(cat.category);
        return (
          <button
            key={cat.category}
            onClick={() => onCategoryClick(cat.category)}
            className="flex items-center justify-between px-2 py-2.5 transition-colors"
            style={{ color: "var(--text-primary)", borderRadius: "var(--radius-md)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="h-2.5 w-2.5"
                style={{ background: config.color, borderRadius: "var(--radius-sm)" }}
              />
              <span className="text-sm font-medium">{cat.category}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span
                className="text-xs"
                style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
              >
                {cat.percentage}%
              </span>
              <span
                className="text-sm font-semibold"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {currency} {formatAmountShort(cat.totalMinor)}
              </span>
              <ChevronRight size={14} color="var(--text-muted)" strokeWidth={1.5} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
