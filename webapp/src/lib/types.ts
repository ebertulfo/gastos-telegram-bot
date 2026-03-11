export type ExpenseWithDetails = {
  id: number;
  source_event_id: number;
  amount_minor: number;
  currency: string;
  occurred_at_utc: string;
  status: "final" | "needs_review";
  text_raw: string | null;
  r2_object_key: string | null;
  needs_review_reason: boolean;
  parsed_description: string | null;
  category: string;
  tags: string; // JSON array stored as string
};

export type Period = "today" | "thisweek" | "thismonth" | "thisyear";

export type Tab = "dashboard" | "analytics";
