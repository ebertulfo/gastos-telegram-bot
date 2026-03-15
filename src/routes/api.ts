import { Hono } from "hono";
import { validateTelegramInitData } from "../telegram/auth";
import { getExpenses, updateExpense, deleteExpense, getUserTags } from "../db/expenses";
import { parseTotalsPeriod } from "../totals";
import { checkApiRateLimit } from "../rate-limiter";
import { KNOWN_CURRENCIES } from "../onboarding";
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

// Rate Limiting Middleware
apiRouter.use("*", async (c, next) => {
    const allowed = await checkApiRateLimit(c.env, c.get("userId"));
    if (!allowed) {
        return c.json({ error: "Too many requests. Please try again later." }, 429);
    }
    await next();
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

apiRouter.get("/tags", async (c) => {
    const tags = await getUserTags(c.env.DB, c.get("userId"));
    return c.json({ tags });
});

apiRouter.put("/expenses/:id", async (c) => {
    const expenseId = parseInt(c.req.param("id"), 10);
    if (isNaN(expenseId)) {
        return c.json({ error: "Invalid expense ID" }, 400);
    }

    const body = await c.req.json();
    const amount_minor = body.amount_minor;
    const currency = body.currency;
    const category = body.category;
    const tags = body.tags;

    if (amount_minor !== undefined && typeof amount_minor !== "number") {
        return c.json({ error: "amount_minor must be a number" }, 400);
    }
    if (currency !== undefined && typeof currency !== "string") {
        return c.json({ error: "currency must be a string" }, 400);
    }
    if (currency !== undefined && !KNOWN_CURRENCIES.has(currency.toUpperCase())) {
        return c.json({ error: "Unsupported currency code" }, 400);
    }
    if (category !== undefined && typeof category !== "string") {
        return c.json({ error: "category must be a string" }, 400);
    }
    if (tags !== undefined && !Array.isArray(tags)) {
        return c.json({ error: "tags must be an array of strings" }, 400);
    }
    const occurred_at_utc = body.occurred_at_utc;
    if (occurred_at_utc !== undefined && typeof occurred_at_utc !== "string") {
        return c.json({ error: "occurred_at_utc must be a date string (YYYY-MM-DD)" }, 400);
    }

    const updateData: Record<string, unknown> = {};
    if (amount_minor !== undefined) updateData.amount_minor = amount_minor;
    if (currency !== undefined) updateData.currency = currency;
    if (category !== undefined) updateData.category = category;
    if (tags !== undefined) updateData.tags = JSON.stringify(tags);
    if (occurred_at_utc !== undefined) {
        updateData.occurred_at_utc = new Date(`${occurred_at_utc}T12:00:00Z`).toISOString();
    }

    await updateExpense(c.env.DB, expenseId, c.get("userId"), updateData);

    // M9: User Correction - Self Learning Flywheel (Background Sync)
    c.executionCtx.waitUntil((async () => {
        try {
            const updated = await c.env.DB.prepare(
                `SELECT e.source_event_id, e.category, e.tags, e.currency, se.text_raw
                 FROM expenses e
                 JOIN source_events se ON e.source_event_id = se.id
                 WHERE e.id = ?`
            ).bind(expenseId).first<{ source_event_id: number, category: string, tags: string, currency: string, text_raw: string | null }>();

            if (updated && updated.text_raw && updated.text_raw.trim() !== "") {
                const { generateEmbedding } = await import("../ai/openai");
                const embedding = await generateEmbedding(c.env, updated.text_raw);
                if (embedding.length > 0) {
                    await c.env.VECTORIZE.upsert([{
                        id: `expense_${updated.source_event_id}`,
                        values: embedding,
                        metadata: {
                            user_id: c.get("userId"),
                            expense_id: updated.source_event_id,
                            category: updated.category,
                            tags: updated.tags, // already a JSON string in DB
                            currency: updated.currency,
                            raw_text: updated.text_raw
                        }
                    }]);
                }
            }
        } catch (err) {
            console.error("Failed to sync updated embedding to Vectorize:", err);
        }
    })());

    return c.json({ success: true });
});

apiRouter.delete("/expenses/:id", async (c) => {
    const expenseId = parseInt(c.req.param("id"), 10);
    if (isNaN(expenseId)) {
        return c.json({ error: "Invalid expense ID" }, 400);
    }

    const expense = await c.env.DB.prepare(`SELECT source_event_id FROM expenses WHERE id = ?`).bind(expenseId).first<{ source_event_id: number }>();

    await deleteExpense(c.env.DB, expenseId, c.get("userId"));

    if (expense) {
        c.executionCtx.waitUntil((async () => {
            try {
                await c.env.VECTORIZE.deleteByIds([`expense_${expense.source_event_id}`]);
            } catch (err) {
                console.error("Failed to delete embedding from Vectorize:", err);
            }
        })());
    }

    return c.json({ success: true });
});
