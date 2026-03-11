export type CategoryConfig = {
  name: string;
  emoji: string;
  color: string;
};

const KNOWN_CATEGORIES: Record<string, CategoryConfig> = {
  Food: { name: "Food", emoji: "\uD83C\uDF5C", color: "#f97316" },
  Transport: { name: "Transport", emoji: "\uD83D\uDE97", color: "#3b82f6" },
  Housing: { name: "Housing", emoji: "\uD83C\uDFE0", color: "#8b5cf6" },
  Shopping: { name: "Shopping", emoji: "\uD83D\uDED2", color: "#ec4899" },
  Entertainment: { name: "Entertainment", emoji: "\uD83C\uDFAC", color: "#eab308" },
  Health: { name: "Health", emoji: "\uD83C\uDFE5", color: "#22c55e" },
  Other: { name: "Other", emoji: "\uD83D\uDCE6", color: "#94a3b8" },
};

// Extended palette for future custom categories
const OVERFLOW_COLORS = [
  "#06b6d4", "#14b8a6", "#a855f7", "#f43f5e", "#84cc16",
];

/**
 * Get category config. Returns a consistent config for unknown categories
 * using the overflow color palette (deterministic by index).
 */
export function getCategoryConfig(category: string): CategoryConfig {
  if (KNOWN_CATEGORIES[category]) {
    return KNOWN_CATEGORIES[category];
  }
  // Deterministic color for unknown categories
  const hash = category.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const color = OVERFLOW_COLORS[hash % OVERFLOW_COLORS.length];
  return { name: category, emoji: "\uD83D\uDCE6", color };
}

export function getAllKnownCategories(): string[] {
  return Object.keys(KNOWN_CATEGORIES);
}
