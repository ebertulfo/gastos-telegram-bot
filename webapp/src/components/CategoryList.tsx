import { ChevronRight } from "lucide-react";
import { getCategoryConfig } from "../lib/categories";
import { formatAmountShort } from "../lib/format";

export type CategoryTotal = {
  category: string;
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
    <div className="flex flex-col">
      {categories.map((cat) => {
        const config = getCategoryConfig(cat.category);
        return (
          <button
            key={cat.category}
            onClick={() => onCategoryClick(cat.category)}
            className="flex items-center justify-between rounded-lg px-2 py-2.5 transition-colors"
            style={{ color: "var(--foreground)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: config.color }}
              />
              <span className="text-sm font-medium">{cat.category}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {cat.percentage}%
              </span>
              <span className="text-sm font-semibold">
                {currency} {formatAmountShort(cat.totalMinor)}
              </span>
              <ChevronRight size={14} color="var(--text-secondary)" strokeWidth={1.5} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
