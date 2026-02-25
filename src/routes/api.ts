import { Hono } from "hono";
import { validateTelegramInitData } from "../telegram/auth";
import { getExpenses, updateExpense, deleteExpense } from "../db/expenses";
import { parseTotalsPeriod } from "../totals";
import type { Env } from "../types";

// Extend Hono variables to include our authenticated user
type Variables = {
    userId: number;
    timezone: string;
    currency: string;
};

export const apiRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Authentication Middleware
apiRouter.use("*", async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Telegram ")) {
        return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const initData = authHeader.slice("Telegram ".length);
    const validatedData = await validateTelegramInitData(initData, c.env.TELEGRAM_BOT_TOKEN);

    if (!validatedData || !validatedData.user) {
        return c.json({ error: "Invalid Telegram initData signature" }, 401);
    }

    try {
        const telegramUser = JSON.parse(validatedData.user);
        const telegramUserId = telegramUser.id;

        // Fetch the internal user ID and preferences
        const user = await c.env.DB.prepare(
            `SELECT id, timezone, currency FROM users WHERE telegram_user_id = ?`
        )
            .bind(telegramUserId)
            .first<{ id: number; timezone: string | null; currency: string | null }>();

        if (!user) {
            return c.json({ error: "User not found. Please complete bot onboarding first." }, 404);
        }

        if (!user.timezone || !user.currency) {
            return c.json({ error: "User profile incomplete. Please set timezone and currency in bot." }, 400);
        }

        c.set("userId", user.id);
        c.set("timezone", user.timezone);
        c.set("currency", user.currency);

        await next();
    } catch (e) {
        return c.json({ error: "Failed to parse Telegram user data" }, 400);
    }
});

// Endpoints

apiRouter.get("/users/me", (c) => {
    return c.json({
        id: c.get("userId"),
        timezone: c.get("timezone"),
        currency: c.get("currency")
    });
});

apiRouter.get("/expenses", async (c) => {
    const periodParam = c.req.query("period") ?? "thismonth";
    const period = parseTotalsPeriod(`/${periodParam}`);

    if (!period) {
        return c.json({ error: "Invalid period. Use today, thisweek, thismonth, or thisyear." }, 400);
    }

    const expenses = await getExpenses(
        c.env,
        c.get("userId"),
        c.get("timezone"),
        period
    );

    return c.json({ data: expenses });
});

apiRouter.put("/expenses/:id", async (c) => {
    const expenseId = parseInt(c.req.param("id"), 10);
    if (isNaN(expenseId)) {
        return c.json({ error: "Invalid expense ID" }, 400);
    }

    const body = await c.req.json();
    const amount_minor = body.amount_minor;
    const currency = body.currency;

    if (typeof amount_minor !== "number" || typeof currency !== "string") {
        return c.json({ error: "amount_minor (number) and currency (string) are required" }, 400);
    }

    const success = await updateExpense(c.env, c.get("userId"), expenseId, {
        amount_minor,
        currency
    });

    if (!success) {
        return c.json({ error: "Expense not found or update failed" }, 404);
    }

    return c.json({ success: true });
});

apiRouter.delete("/expenses/:id", async (c) => {
    const expenseId = parseInt(c.req.param("id"), 10);
    if (isNaN(expenseId)) {
        return c.json({ error: "Invalid expense ID" }, 400);
    }

    const success = await deleteExpense(c.env, c.get("userId"), expenseId);

    if (!success) {
        return c.json({ error: "Expense not found or delete failed" }, 404);
    }

    return c.json({ success: true });
});
