import { useState, useEffect } from "react";
import { Drawer } from "vaul";
import type { ExpenseWithDetails } from "../lib/types";
import { formatAmountShort, parseTags } from "../lib/format";
import { updateExpense, deleteExpense } from "../lib/api";
import { TagInput } from "./TagInput";

type EditDrawerProps = {
  expense: ExpenseWithDetails | null;
  allTags: string[];
  onClose: () => void;
  onSaved: () => void;
};

function toDateString(isoDate: string): string {
  return isoDate.slice(0, 10);
}

function getPresets(): { label: string; value: string }[] {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const twoDaysAgo = new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  return [
    { label: "Today", value: today },
    { label: "Yesterday", value: yesterday },
    { label: "2 days ago", value: twoDaysAgo },
  ];
}

function formatDateDisplay(dateStr: string): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function EditDrawer({ expense, allTags, onClose, onSaved }: EditDrawerProps) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [currency, setCurrency] = useState("");
  const [date, setDate] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const open = expense !== null;

  useEffect(() => {
    if (expense) {
      setAmount(formatAmountShort(expense.amount_minor));
      setCurrency(expense.currency);
      setDescription(expense.description || expense.text_raw || "");
      setTags(parseTags(expense.tags));
      setDate(toDateString(expense.occurred_at_utc));
      setShowDatePicker(false);
    }
  }, [expense?.id]);

  const handleOpen = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  const handleSave = async () => {
    if (!expense) return;
    setSaving(true);
    try {
      const amountMinor = Math.round(parseFloat(amount) * 100);
      await updateExpense(expense.id, {
        amount_minor: amountMinor,
        currency,
        description,
        tags,
        occurred_at_utc: date,
      });
      onSaved();
      onClose();
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
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

  const displayDescription = expense?.description || expense?.text_raw || "Unknown";
  const sourceType = expense?.r2_object_key ? "photo" : expense?.text_raw ? "text" : "unknown";
  const loggedTime = expense
    ? new Date(expense.occurred_at_utc).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "";
  const presets = getPresets().filter((p) => p.value !== date);

  const labelStyle = { color: "var(--text-muted)", fontFamily: "var(--font-mono)" };
  const inputStyle = {
    background: "var(--bg-elevated)",
    borderColor: "var(--border-default)",
    color: "var(--text-primary)",
    borderRadius: "var(--radius-md)",
  };

  return (
    <Drawer.Root open={open} onOpenChange={handleOpen} direction="bottom">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/50" />
        <Drawer.Content
          className="fixed inset-0 flex flex-col"
          style={{ background: "var(--bg-base)" }}
        >
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-3">
            {/* Close handle */}
            <div className="flex items-center justify-between mb-4">
              <button onClick={onClose} className="text-sm font-medium" style={{ color: "var(--accent)" }}>
                Close
              </button>
              <div className="h-1 w-9 rounded-full" style={{ background: "var(--border-strong)" }} />
              <div className="w-10" />
            </div>

            {expense && (
              <>
                <div className="mb-5 flex items-start justify-between">
                  <div>
                    <div className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                      {displayDescription}
                    </div>
                    <div className="mt-0.5 text-xs" style={labelStyle}>
                      Expense #{expense.id}
                    </div>
                  </div>
                  <div className="text-2xl font-bold" style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                    {currency} {amount}
                  </div>
                </div>

                <div className="flex flex-col gap-3.5 min-w-0">
                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider" style={labelStyle}>Description</label>
                    <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                      className="w-full border px-3 py-2.5 text-sm" style={inputStyle} />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider" style={labelStyle}>Date</label>
                    <button onClick={() => setShowDatePicker(!showDatePicker)}
                      className="w-full border px-3 py-2.5 text-left text-sm" style={inputStyle}>
                      {date ? formatDateDisplay(date) : "Unknown"}
                    </button>
                    {showDatePicker && (
                      <input type="date" value={date}
                        onChange={(e) => { setDate(e.target.value); setShowDatePicker(false); }}
                        className="mt-1.5 w-full border px-3 py-2.5 text-sm box-border" style={inputStyle} />
                    )}
                    {presets.length > 0 && (
                      <div className="mt-1.5 flex gap-1.5">
                        {presets.map((p) => (
                          <button key={p.value}
                            onClick={() => { setDate(p.value); setShowDatePicker(false); }}
                            className="px-2.5 py-1 text-[11px]"
                            style={{ background: "var(--bg-raised)", color: "var(--text-secondary)", borderRadius: "var(--radius-2xl)", fontFamily: "var(--font-mono)" }}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider" style={labelStyle}>Tags</label>
                    <TagInput tags={tags} allTags={allTags} onChange={setTags} />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] uppercase tracking-wider" style={labelStyle}>Amount</label>
                    <div className="flex gap-2">
                      <input type="text" value={currency} maxLength={3}
                        onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                        className="w-16 border px-2 py-2.5 text-sm text-center uppercase"
                        style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
                      <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                        className="flex-1 border px-3 py-2.5 text-sm" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3.5" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <div className="mb-1.5 text-[11px] uppercase tracking-wider" style={labelStyle}>Source</div>
                  <div className="mb-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    Logged via {sourceType} · {loggedTime}
                  </div>
                  {expense.text_raw && (
                    <div className="px-2.5 py-2 text-xs italic"
                      style={{ background: "var(--bg-raised)", borderLeft: "2px solid var(--border-strong)", color: "var(--text-muted)", borderRadius: "0 var(--radius-sm) var(--radius-sm) 0" }}>
                      "{expense.text_raw}"
                    </div>
                  )}
                </div>

                <div className="mt-5">
                  <button onClick={handleSave} disabled={saving}
                    className="w-full py-3 text-sm font-semibold transition-opacity disabled:opacity-50"
                    style={{ background: "var(--accent)", color: "var(--bg-base)", borderRadius: "var(--radius-md)" }}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button onClick={handleDelete} className="mt-2 w-full py-2.5 text-sm" style={{ color: "var(--danger)" }}>
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
