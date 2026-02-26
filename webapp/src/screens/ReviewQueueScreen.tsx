import { useState, useEffect } from "react";
import { fetchExpenses, updateExpense, deleteExpense } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

export default function ReviewQueueScreen() {
    const [expenses, setExpenses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [editingExpense, setEditingExpense] = useState<any | null>(null);
    const [editAmount, setEditAmount] = useState("");
    const [editCurrency, setEditCurrency] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const loadQueue = () => {
        setLoading(true);
        // Fetch this month and filter locally for simplicity. 
        // In production, the backend might have a dedicated /review endpoint.
        fetchExpenses("thismonth")
            .then((data) => {
                setExpenses(data.filter(e => e.needs_review_reason));
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        loadQueue();
    }, []);

    const handleEditClick = (expense: any) => {
        setEditingExpense(expense);
        setEditAmount((expense.amount_minor / 100).toString());
        setEditCurrency(expense.currency);
    };

    const handleSave = async () => {
        if (!editingExpense) return;
        setSubmitting(true);
        try {
            const minor = Math.round(parseFloat(editAmount) * 100);
            await updateExpense(editingExpense.id, minor, editCurrency);
            setEditingExpense(null);
            loadQueue(); // Refresh the list
        } catch (e) {
            alert("Failed to update expense");
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!editingExpense) return;
        if (!confirm("Are you sure you want to delete this expense?")) return;

        setSubmitting(true);
        try {
            await deleteExpense(editingExpense.id);
            setEditingExpense(null);
            loadQueue();
        } catch (e) {
            alert("Failed to delete");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="p-4 flex flex-col gap-4 h-full">
            <h1 className="text-2xl font-bold tracking-tight">Review Queue</h1>
            <p className="text-sm text-[var(--tg-theme-hint-color)] mb-2">
                The AI wasn't fully confident about these inputs. Please verify them.
            </p>

            <ScrollArea className="flex-1">
                {loading ? (
                    <div className="space-y-4">
                        {[1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                    </div>
                ) : expenses.length === 0 ? (
                    <div className="text-center py-10 text-[var(--tg-theme-hint-color)]">
                        All caught up! No expenses need review right now.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {expenses.map((expense) => (
                            <Card
                                key={expense.id}
                                className="bg-[var(--tg-theme-bg-color)] shadow-sm cursor-pointer hover:bg-[var(--tg-theme-secondary-bg-color)] transition-colors"
                                onClick={() => handleEditClick(expense)}
                            >
                                <CardContent className="p-4 flex justify-between items-center">
                                    <div className="flex flex-col truncate pr-4">
                                        <span className="font-semibold truncate">{expense.text_raw || "Media / Voice Note"}</span>
                                        <span className="text-xs text-[var(--tg-theme-hint-color)] mt-1">
                                            {new Date(expense.occurred_at_utc).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="font-mono bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 rounded">
                                        {expense.currency} {(expense.amount_minor / 100).toFixed(2)}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </ScrollArea>

            <Dialog open={!!editingExpense} onOpenChange={(open) => !open && setEditingExpense(null)}>
                <DialogContent className="w-[90vw] max-w-md rounded-lg mx-auto bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)] border-[var(--tg-theme-hint-color)] border-opacity-20 translate-y-[-50%] top-[50%]">
                    <DialogHeader>
                        <DialogTitle>Edit Expense</DialogTitle>
                        <DialogDescription className="text-[var(--tg-theme-hint-color)]">
                            Fix any mistakes the AI made extracting data from your message.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="amount" className="text-right font-medium text-[var(--tg-theme-text-color)]">
                                Amount
                            </Label>
                            <Input
                                id="amount"
                                type="number"
                                step="0.01"
                                value={editAmount}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditAmount(e.target.value)}
                                className="col-span-3 bg-[var(--tg-theme-secondary-bg-color)] border-[var(--tg-theme-hint-color)] text-[var(--tg-theme-text-color)]"
                            />
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="currency" className="text-right font-medium text-[var(--tg-theme-text-color)]">
                                Currency
                            </Label>
                            <Input
                                id="currency"
                                value={editCurrency}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditCurrency(e.target.value.toUpperCase())}
                                className="col-span-3 bg-[var(--tg-theme-secondary-bg-color)] border-[var(--tg-theme-hint-color)] text-[var(--tg-theme-text-color)]"
                                maxLength={3}
                            />
                        </div>
                    </div>

                    {editingExpense && editingExpense.text_raw && (
                        <div className="text-sm p-3 bg-[var(--tg-theme-secondary-bg-color)] rounded-md mb-2 italic text-[var(--tg-theme-hint-color)]">
                            "{editingExpense.text_raw}"
                        </div>
                    )}

                    <DialogFooter className="flex-row sm:justify-between gap-2 border-t border-[var(--tg-theme-hint-color)] border-opacity-20 pt-4 mt-2">
                        <Button variant="destructive" onClick={handleDelete} disabled={submitting} className="flex-1 sm:flex-none">
                            Delete
                        </Button>
                        <Button onClick={handleSave} disabled={submitting} className="flex-1 sm:flex-none">
                            Save changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
