/**
 * Tag color utilities for the Mini App.
 * Assigns deterministic colors to tags based on hash.
 * Phase 2 will replace this with the full iOS design system.
 */

export type TagConfig = {
  name: string;
  color: string;
};

const TAG_PALETTE = [
  "#f97316", "#3b82f6", "#8b5cf6", "#ec4899", "#eab308",
  "#22c55e", "#06b6d4", "#14b8a6", "#a855f7", "#f43f5e",
  "#84cc16", "#94a3b8",
];

function hashString(s: string): number {
  return s.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
}

export function getTagConfig(tag: string): TagConfig {
  const color = TAG_PALETTE[hashString(tag) % TAG_PALETTE.length];
  return { name: tag, color };
}

// Legacy compat — CategoryList and AnalyticsScreen reference these
export type CategoryConfig = TagConfig;
export function getCategoryConfig(tag: string): TagConfig {
  return getTagConfig(tag);
}
export function getAllKnownCategories(): string[] {
  return [];
}
