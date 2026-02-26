import { useState, useEffect } from "react";
import { fetchExpenses, fetchUserProfile } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

type Period = "today" | "thisweek" | "thismonth" | "thisyear";

export default function DashboardScreen() {
    const [period, setPeriod] = useState<Period>("thismonth");
    const [expenses, setExpenses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currency, setCurrency] = useState("PHP");

    useEffect(() => {
        // Fetch profile for default currency
        fetchUserProfile().then((profile) => {
            setCurrency(profile.currency || "PHP");
        }).catch(console.error);
    }, []);

    useEffect(() => {
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
    }, [period]);

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
                <Card className="bg-[var(--tg-theme-bg-color)] shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-[var(--tg-theme-hint-color)]">
                            Spend
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading ? <Skeleton className="h-7 w-20" /> : <div className="text-2xl font-bold">{currency} {totalSpend.toFixed(2)}</div>}
                    </CardContent>
                </Card>

                <Card className="bg-[var(--tg-theme-bg-color)] shadow-sm">
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
                            <div key={expense.id} className="flex justify-between items-center bg-[var(--tg-theme-bg-color)] p-3 rounded-lg shadow-sm">
                                <div className="flex flex-col flex-1 truncate pr-2">
                                    <span className="font-medium truncate">{expense.text_raw || "Media Expense"}</span>
                                    <span className="text-xs text-[var(--tg-theme-hint-color)]">
                                        {new Date(expense.occurred_at_utc).toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="font-bold whitespace-nowrap">{expense.currency} {(expense.amount_minor / 100).toFixed(2)}</span>
                                    {expense.needs_review && <span className="text-[10px] bg-red-100 text-red-800 px-1.5 py-0.5 rounded">Review</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </ScrollArea>
        </div>
    );
}
