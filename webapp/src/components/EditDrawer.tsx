import { useState } from "react";
import { Drawer } from "vaul";
import type { ExpenseWithDetails } from "../lib/types";
import { getCategoryConfig, getAllKnownCategories } from "../lib/categories";
import { formatAmountShort, parseTags } from "../lib/format";
import { updateExpense, deleteExpense } from "../lib/api";

type EditDrawerProps = {
  expense: ExpenseWithDetails | null;
  onClose: () => void;
  onSaved: () => void;
};

export function EditDrawer({ expense, onClose, onSaved }: EditDrawerProps) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);

  const open = expense !== null;

  const handleOpen = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
      setAmount("");
      setCategory("");
    }
  };

  const handleSave = async () => {
    if (!expense) return;
    setSaving(true);
    try {
      const effectiveAmount = amount || formatAmountShort(expense.amount_minor);
      const amountMinor = Math.round(parseFloat(effectiveAmount) * 100);
      const effectiveCategory = category || expense.category;
      await updateExpense(expense.id, amountMinor, expense.currency, effectiveCategory);
      onSaved();
      onClose();
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
      setAmount("");
      setCategory("");
    }
  };

  const handleDelete = async () => {
    if (!expense || !confirm("Delete this expense?")) return;
    try {
      await deleteExpense(expense.id);
      onSaved();
      onClose();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // Initialize form values when expense appears
  const displayAmount = amount || (expense ? formatAmountShort(expense.amount_minor) : "");
  const displayCategory = category || (expense?.category ?? "");
  const tags = expense ? parseTags(expense.tags) : [];
  const description = expense?.parsed_description || expense?.text_raw || "Unknown";
  // Determine source type
  const sourceType = expense?.r2_object_key
    ? "photo"
    : expense?.text_raw
      ? "text"
      : "unknown";
  const loggedTime = expense
    ? new Date(expense.occurred_at_utc).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <Drawer.Root open={open} onOpenChange={handleOpen}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 flex flex-col rounded-t-xl"
          style={{ background: "var(--background)", maxHeight: "85vh" }}
        >
          <div className="overflow-y-auto px-4 pb-6 pt-3">
            {/* Drag handle */}
            <div className="mx-auto mb-4 h-1 w-9 rounded-full" style={{ background: "var(--border)" }} />

            {expense && (
              <>
                {/* Header */}
                <div className="mb-5 flex items-start justify-between">
                  <div>
                    <div className="text-xl font-bold" style={{ color: "var(--foreground)" }}>
                      {description}
                    </div>
                    <div className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                      Expense #{expense.id}
                    </div>
                  </div>
                  <div className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
                    {expense.currency} {displayAmount}
                  </div>
                </div>

                {/* Editable fields */}
                <div className="flex flex-col gap-3.5">
                  {/* Category */}
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      Category
                    </label>
                    <select
                      value={displayCategory}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full rounded-lg border px-3 py-2.5 text-sm"
                      style={{
                        background: "var(--surface-hover)",
                        borderColor: "var(--border)",
                        color: "var(--foreground)",
                      }}
                    >
                      {getAllKnownCategories().map((c) => {
                        const cfg = getCategoryConfig(c);
                        return (
                          <option key={c} value={c}>
                            {cfg.emoji} {c}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Date */}
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      Date
                    </label>
                    <div
                      className="rounded-lg border px-3 py-2.5 text-sm"
                      style={{
                        background: "var(--surface-hover)",
                        borderColor: "var(--border)",
                        color: "var(--foreground)",
                      }}
                    >
                      {expense.occurred_at_utc
                        ? new Date(expense.occurred_at_utc).toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })
                        : "Unknown"}
                    </div>
                  </div>

                  {/* Tags */}
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      Tags
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                          style={{ background: "var(--surface)", color: "var(--text-secondary)" }}
                        >
                          #{tag}
                        </span>
                      ))}
                      {tags.length === 0 && (
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          No tags
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      Amount
                    </label>
                    <div className="flex gap-2">
                      <div
                        className="flex w-16 items-center justify-center rounded-lg border text-sm"
                        style={{
                          background: "var(--surface-hover)",
                          borderColor: "var(--border)",
                          color: "var(--foreground)",
                        }}
                      >
                        {expense.currency}
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        value={displayAmount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="flex-1 rounded-lg border px-3 py-2.5 text-sm"
                        style={{
                          background: "var(--surface-hover)",
                          borderColor: "var(--border)",
                          color: "var(--foreground)",
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Source section */}
                <div className="mt-5 border-t pt-3.5" style={{ borderColor: "var(--border)" }}>
                  <div className="mb-1.5 text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                    Source
                  </div>
                  <div className="mb-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Logged via {sourceType} · {loggedTime}
                  </div>
                  {expense.text_raw && (
                    <div
                      className="rounded-md border-l-2 px-2.5 py-2 text-xs italic"
                      style={{
                        background: "var(--surface-hover)",
                        borderColor: "var(--border)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      "{expense.text_raw}"
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-5">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full rounded-lg py-3 text-sm font-semibold transition-opacity disabled:opacity-50"
                    style={{
                      background: "var(--primary)",
                      color: "var(--primary-foreground)",
                    }}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={handleDelete}
                    className="mt-2 w-full py-2.5 text-sm"
                    style={{ color: "var(--destructive)" }}
                  >
                    Delete Expense
                  </button>
                </div>
              </>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
