import { useState, useEffect } from "react";
import { fetchExpenses, fetchUserProfile, updateExpense } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageSquare } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Period = "today" | "thisweek" | "thismonth" | "thisyear";

export default function DashboardScreen() {
    const [period, setPeriod] = useState<Period>("thismonth");
    const [expenses, setExpenses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currency, setCurrency] = useState("PHP");

    // Review Drawer State
    const [selectedExpense, setSelectedExpense] = useState<any | null>(null);
    const [editAmount, setEditAmount] = useState<string>("");
    const [editCurrency, setEditCurrency] = useState<string>("");
    const [editCategory, setEditCategory] = useState<string>("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        // Fetch profile for default currency
        fetchUserProfile().then((profile) => {
            setCurrency(profile.currency || "PHP");
        }).catch(console.error);
    }, []);

    const loadExpenses = () => {
        setLoading(true);
        fetchExpenses(period)
            .then((data) => {
                setExpenses(data);
                setError(null);
            })
            .catch((err) => {
                setError(err.message || "Failed to load");
            })
            .finally(() => {
                setLoading(false);
            });
    };

    useEffect(() => {
        loadExpenses();
    }, [period]);

    const handleRowClick = (expense: any) => {
        if (!expense.needs_review) return; // Only open drawer for flagged items
        setSelectedExpense(expense);
        setEditAmount((expense.amount_minor / 100).toFixed(2));
        setEditCurrency(expense.currency);
        setEditCategory(expense.category || "Other");
    };

    const handleSaveReview = async () => {
        if (!selectedExpense) return;
        setSaving(true);
        try {
            const amountMinor = Math.round(parseFloat(editAmount) * 100);
            await updateExpense(selectedExpense.id, amountMinor, editCurrency, editCategory);
            setSelectedExpense(null);
            loadExpenses(); // Refresh the list to remove the Review badge
        } catch (err: any) {
            setError(err.message || "Failed to save review");
        } finally {
            setSaving(false);
        }
    };

    const totalSpend = expenses.reduce((sum, exp) => sum + (exp.amount_minor / 100), 0);
    const reviewCount = expenses.filter(e => e.needs_review).length;

    return (
        <div className="p-4 flex flex-col gap-4 h-full">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight">Gastos Dashboard</h1>
            </div>

            <Tabs value={period} onValueChange={(val) => setPeriod(val as Period)} className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="today">Today</TabsTrigger>
                    <TabsTrigger value="thisweek">Week</TabsTrigger>
                    <TabsTrigger value="thismonth">Month</TabsTrigger>
                    <TabsTrigger value="thisyear">Year</TabsTrigger>
                </TabsList>
            </Tabs>

            <div className="grid grid-cols-2 gap-4">
                <Card className="bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)] border-[var(--tg-theme-hint-color)] border-opacity-20 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-[var(--tg-theme-hint-color)]">
                            Spend
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading ? <Skeleton className="h-7 w-20" /> : <div className="text-2xl font-bold">{currency} {totalSpend.toFixed(2)}</div>}
                    </CardContent>
                </Card>

                <Card className="bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)] border-[var(--tg-theme-hint-color)] border-opacity-20 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-[var(--tg-theme-hint-color)]">
                            Transactions
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading ? <Skeleton className="h-7 w-12" /> : <div className="text-2xl font-bold">{expenses.length}</div>}
                        <p className="text-xs text-[var(--tg-theme-hint-color)] mt-1">
                            {reviewCount > 0 ? <span className="text-red-500">{reviewCount} needs review</span> : "All reviewed"}
                        </p>
                    </CardContent>
                </Card>
            </div>

            <h2 className="text-lg font-semibold mt-2">Transactions</h2>

            {error && <div className="text-red-500 p-2">{error}</div>}

            <ScrollArea className="flex-1 rounded-md border p-4 bg-[var(--tg-theme-secondary-bg-color)]">
                {loading ? (
                    <div className="space-y-4">
                        {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                    </div>
                ) : expenses.length === 0 ? (
                    <div className="text-center text-[var(--tg-theme-hint-color)] py-8">
                        No expenses found for this period.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {expenses.map((expense) => (
                            <div
                                key={expense.id}
                                onClick={() => handleRowClick(expense)}
                                className={`flex justify-between items-center p-3 rounded-lg shadow-sm transition-colors ${expense.needs_review ? "bg-red-50 hover:bg-red-100 cursor-pointer border border-red-200" : "bg-[var(--tg-theme-bg-color)]"}`}
                            >
                                <div className="flex flex-col flex-1 truncate pr-2">
                                    <div className={`flex items-center gap-3 overflow-hidden ${expense.needs_review ? "text-red-900" : "text-[var(--tg-theme-text-color)]"}`}>
                                        <MessageSquare className={`w-4 h-4 flex-shrink-0 ${expense.needs_review ? "text-red-500" : "text-[var(--tg-theme-hint-color)]"}`} />
                                        <div className="flex flex-col">
                                            <span className="font-medium truncate">{expense.parsed_description || expense.text_raw || "Media Expense"}</span>

                                            {/* M7: Render Category and Tags */}
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {expense.category && (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                                        {expense.category}
                                                    </span>
                                                )}

                                                {(() => {
                                                    try {
                                                        const tagsArray = JSON.parse(expense.tags || "[]");
                                                        if (Array.isArray(tagsArray) && tagsArray.length > 0) {
                                                            return tagsArray.map((tag: string, i: number) => (
                                                                <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                                                    #{tag}
                                                                </span>
                                                            ));
                                                        }
                                                    } catch (e) {
                                                        // Ignore parse errors on empty tags
                                                    }
                                                    return null;
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                    <span className={`text-xs ${expense.needs_review ? "text-red-700/70" : "text-[var(--tg-theme-hint-color)]"}`}>
                                        {new Date(expense.occurred_at_utc).toLocaleString()}
                                    </span>
                                </div>
                                <div className={`flex flex-col items-end ${expense.needs_review ? "text-red-900" : ""}`}>
                                    <span className="font-bold whitespace-nowrap">{expense.currency} {(expense.amount_minor / 100).toFixed(2)}</span>
                                    {expense.needs_review && <span className="text-[10px] bg-red-500 text-white px-2 py-0.5 rounded font-bold mt-1 shadow-sm">FIX</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </ScrollArea>

            <Dialog open={!!selectedExpense} onOpenChange={(o: boolean) => !o && setSelectedExpense(null)}>
                <DialogContent className="bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)] w-[90vw] rounded-xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Review Extraction</DialogTitle>
                        <DialogDescription>Verify the AI correctly parsed this expense.</DialogDescription>
                    </DialogHeader>
                    {selectedExpense && (
                        <div className="py-4 space-y-4">
                            <div className="bg-muted p-3 rounded-md text-sm border font-mono break-words">
                                "{selectedExpense.text_raw || selectedExpense.parsed_description || "Image/Audio Upload"}"
                            </div>
                            <div className="flex flex-col sm:flex-row gap-4">
                                <div className="space-y-2 flex-1">
                                    <Label>Amount</Label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        value={editAmount}
                                        onChange={(e) => setEditAmount(e.target.value)}
                                        className="text-lg font-bold"
                                    />
                                </div>
                                <div className="space-y-2 w-full sm:w-1/3">
                                    <Label>Currency</Label>
                                    <Select value={editCurrency} onValueChange={setEditCurrency}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="PHP">PHP</SelectItem>
                                            <SelectItem value="SGD">SGD</SelectItem>
                                            <SelectItem value="USD">USD</SelectItem>
                                            <SelectItem value="EUR">EUR</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Category</Label>
                                <Select value={editCategory} onValueChange={setEditCategory}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Food">Food</SelectItem>
                                        <SelectItem value="Transport">Transport</SelectItem>
                                        <SelectItem value="Housing">Housing</SelectItem>
                                        <SelectItem value="Shopping">Shopping</SelectItem>
                                        <SelectItem value="Entertainment">Entertainment</SelectItem>
                                        <SelectItem value="Health">Health</SelectItem>
                                        <SelectItem value="Other">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}
                    <DialogFooter className="flex flex-col sm:flex-row gap-2">
                        <Button variant="outline" onClick={() => setSelectedExpense(null)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSaveReview}
                            disabled={saving}
                            className="font-bold bg-green-600 hover:bg-green-700 text-white"
                        >
                            {saving ? "Saving..." : "Finalize & Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    );
}
