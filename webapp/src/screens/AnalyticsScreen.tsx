import { useState, useEffect } from "react";
import { fetchExpenses, fetchUserProfile } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

type Period = "today" | "thisweek" | "thismonth" | "thisyear";

export default function AnalyticsScreen() {
    const [period, setPeriod] = useState<Period>("thismonth");
    const [expenses, setExpenses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currency, setCurrency] = useState("PHP");

    useEffect(() => {
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

    // Aggregate spend by category
    const categoryTotals = expenses.reduce((acc: Record<string, number>, exp) => {
        const cat = exp.category || "Other";
        const amt = exp.amount_minor / 100;
        acc[cat] = (acc[cat] || 0) + amt;
        return acc;
    }, {});

    const sortedCategories = Object.entries(categoryTotals)
        .sort(([, a], [, b]) => (b as number) - (a as number));

    const totalSpend = expenses.reduce((sum, exp) => sum + (exp.amount_minor / 100), 0);

    return (
        <div className="p-4 flex flex-col gap-4 h-full">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
            </div>

            <Tabs value={period} onValueChange={(val) => setPeriod(val as Period)} className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="today">Today</TabsTrigger>
                    <TabsTrigger value="thisweek">Week</TabsTrigger>
                    <TabsTrigger value="thismonth">Month</TabsTrigger>
                    <TabsTrigger value="thisyear">Year</TabsTrigger>
                </TabsList>
            </Tabs>

            {error && <div className="text-red-500 p-2">{error}</div>}

            <Card className="bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)] border-[var(--tg-theme-hint-color)] border-opacity-20 shadow-sm flex-1 flex flex-col">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-lg font-bold">Category Breakdown</CardTitle>
                    <span className="text-sm text-[var(--tg-theme-hint-color)]">Total: {currency} {totalSpend.toFixed(2)}</span>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto mt-4 space-y-4">
                    {loading ? (
                        <div className="space-y-4">
                            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                        </div>
                    ) : sortedCategories.length === 0 ? (
                        <div className="text-center text-[var(--tg-theme-hint-color)] py-8">
                            No spending data yet.
                        </div>
                    ) : (
                        sortedCategories.map(([cat, amount]) => {
                            const numericAmount = amount as number;
                            const percentage = totalSpend > 0 ? (numericAmount / totalSpend) * 100 : 0;
                            return (
                                <div key={cat} className="space-y-1">
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="font-semibold">{cat}</span>
                                        <span>{currency} {numericAmount.toFixed(2)}</span>
                                    </div>
                                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                        {/* A generic primary color bar that scales to percentage */}
                                        <div
                                            className="h-full bg-[var(--tg-theme-button-color)] rounded-full transition-all duration-500 ease-in-out"
                                            style={{ width: `${percentage}%` }}
                                        />
                                    </div>
                                    <p className="text-[10px] text-right text-[var(--tg-theme-hint-color)]">{percentage.toFixed(1)}%</p>
                                </div>
                            );
                        })
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
