import { getRecentChatMessages } from "./db/chat-history";
import { insertFeedback, getRecentErrorTraces, updateGithubIssueUrl } from "./db/feedback";
import { getUserByTelegramUserId, updateUserOnboardingState, upsertUserForStart } from "./db/users";
import { insertTagPreferences } from "./db/tag-preferences";
import { createGithubIssue } from "./github";
import { editTelegramMessageText, sendTelegramChatMessage, answerCallbackQuery } from "./telegram/messages";
import { formatTotalsMessage, getTotalsForUserAndPeriod, parseTotalsPeriod } from "./totals";
import type { Env, TelegramUpdate } from "./types";

const PRIORITY_CURRENCIES = ["PHP", "SGD", "USD", "EUR"] as const;
const ASEAN_CURRENCIES = ["BND", "KHR", "IDR", "LAK", "MYR", "MMK", "PHP", "SGD", "THB", "VND"] as const;
export const KNOWN_CURRENCIES = new Set([...PRIORITY_CURRENCIES, ...ASEAN_CURRENCIES]);
const CURRENCY_TO_DEFAULT_TIMEZONE: Record<string, string> = {
  PHP: "Asia/Manila",
  SGD: "Asia/Singapore",
  BND: "Asia/Brunei",
  KHR: "Asia/Phnom_Penh",
  IDR: "Asia/Jakarta",
  LAK: "Asia/Vientiane",
  MYR: "Asia/Kuala_Lumpur",
  MMK: "Asia/Yangon",
  THB: "Asia/Bangkok",
  VND: "Asia/Ho_Chi_Minh",
  USD: "America/New_York",
  EUR: "Europe/Berlin"
};

const DEFAULT_TAGS = [
  "food", "transport", "groceries", "shopping", "coffee",
  "entertainment", "health", "bills", "travel", "subscriptions"
] as const;

export async function handleOnboardingOrCommand(env: Env, update: TelegramUpdate, ctx?: ExecutionContext): Promise<boolean> {
  const message = update.message;
  const callbackQuery = update.callback_query;
  const isMessage = !!message;
  const isCallback = !!callbackQuery;

  if (!isMessage && !isCallback) {
    return false;
  }

  const chatId = message?.chat.id ?? callbackQuery?.message?.chat.id;
  const telegramUserId = message?.from?.id ?? callbackQuery?.from?.id;
  const messageId = message?.message_id ?? callbackQuery?.message?.message_id;

  if (!chatId || !telegramUserId) {
    return false;
  }

  const text = message?.text?.trim() ?? "";

  if (text === "/start") {
    await upsertUserForStart(env, telegramUserId, chatId);
    await sendCurrencyPrompt(env, chatId);
    return true;
  }

  const user = await getUserByTelegramUserId(env, telegramUserId);

  const totalsPeriod = parseTotalsPeriod(text);
  if (totalsPeriod) {
    if (!user || user.onboarding_step !== "completed") {
      await sendTelegramChatMessage(env, chatId, "Set up first — send /start");
      return true;
    }

    if (!user.currency || !user.timezone) {
      await sendTelegramChatMessage(env, chatId, "Set up first — send /start");
      return true;
    }

    const totals = await getTotalsForUserAndPeriod(env, {
      userId: user.id,
      currency: user.currency,
      timezone: user.timezone,
      period: totalsPeriod
    });
    await sendTelegramChatMessage(
      env,
      chatId,
      formatTotalsMessage({
        currency: user.currency,
        totals,
        period: totalsPeriod
      })
    );
    return true;
  }

  // Handle /feedback and /bug commands
  const feedbackMatch = text.match(/^\/(feedback|bug)\s*(.*)/s);
  if (feedbackMatch) {
    const type = feedbackMatch[1] as "feedback" | "bug";
    const feedbackText = feedbackMatch[2].trim();

    if (!feedbackText) {
      const hint = type === "feedback"
        ? "Tell me what's on your mind:\n/feedback your message here"
        : "Describe the issue you're seeing:\n/bug describe the problem here";
      await sendTelegramChatMessage(env, chatId, hint);
      return true;
    }

    if (!user || user.onboarding_step !== "completed") {
      await sendTelegramChatMessage(env, chatId, "Set up first — send /start");
      return true;
    }

    // Gather context
    const chatMessages = await getRecentChatMessages(env.DB, user.id, 20);
    const errorTraces = type === "bug" ? await getRecentErrorTraces(env.DB, user.id) : [];

    // Insert to D1
    const feedbackId = await insertFeedback(env.DB, {
      userId: user.id,
      telegramChatId: chatId,
      type,
      text: feedbackText,
      chatContext: chatMessages.length > 0 ? JSON.stringify(chatMessages.map(m => m.id)) : null,
      errorContext: errorTraces.length > 0 ? JSON.stringify(errorTraces) : null,
    });

    // Reply to user
    const replyText = type === "feedback"
      ? "Thanks for your feedback!"
      : "Thanks for reporting this bug!";
    await sendTelegramChatMessage(env, chatId, replyText);

    // Fire-and-forget GitHub Issue creation
    if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
      const minId = chatMessages.length > 0 ? chatMessages[0].id : 0;
      const maxId = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1].id : 0;

      const issueBody = [
        "## User Report",
        feedbackText,
        "",
        "## User Context",
        `- Telegram Chat ID: ${chatId}`,
        `- Timezone: ${user.timezone} | Currency: ${user.currency} | Tier: ${user.tier}`,
        `- Reported at: ${new Date().toISOString()}`,
        `- Feedback row ID: ${feedbackId}`,
        "",
        "## Recent Chat History",
        `${chatMessages.length} messages (IDs: ${minId}-${maxId})`,
        "```",
        `npx wrangler d1 execute gastos-db --remote --command "SELECT id, role, content, created_at_utc FROM chat_history WHERE user_id = ${user.id} ORDER BY created_at_utc DESC LIMIT 20"`,
        "```",
        "",
        "## Recent Errors",
        `${errorTraces.length} error traces found.`,
        "```",
        `npx wrangler d1 execute gastos-db --remote --command "SELECT trace_id, span_name, error_message, started_at_utc FROM traces WHERE user_id = ${user.id} AND status = 'error' ORDER BY started_at_utc DESC LIMIT 3"`,
        "```",
      ].join("\n");

      const issueTitle = `[${type}] User ${chatId}: ${feedbackText.slice(0, 60)}`;
      const issueLabels = [type];

      const githubWork = async () => {
        const url = await createGithubIssue(env.GITHUB_TOKEN!, env.GITHUB_REPO!, {
          title: issueTitle,
          body: issueBody,
          labels: issueLabels,
        });
        if (url) {
          await updateGithubIssueUrl(env.DB, feedbackId, url);
        }
      };

      if (ctx) {
        ctx.waitUntil(githubWork());
      } else {
        // No ExecutionContext (tests) — run inline but don't await
        githubWork().catch(() => {});
      }
    }

    return true;
  }

  if (!user || user.onboarding_step === "completed") {
    return false;
  }

  if (user.onboarding_step === "awaiting_currency") {
    let currency: string | null = null;

    if (callbackQuery?.data?.startsWith("cur:")) {
      currency = callbackQuery.data.slice(4);
      if (messageId) {
        await editTelegramMessageText(env, chatId, messageId, `Currency set to: ${currency}`);
      }
      await answerCallbackQuery(env, callbackQuery.id);
    } else if (text) {
      currency = normalizeCurrency(text);
    }

    if (!currency) {
      if (text) {
        await sendCurrencyRetry(env, chatId);
        return true;
      }
      return false;
    }

    const suggestedTimezone = CURRENCY_TO_DEFAULT_TIMEZONE[currency] ?? "UTC";

    await updateUserOnboardingState(env, user.id, {
      currency,
      timezone: suggestedTimezone,
      onboardingStep: "awaiting_tags"
    });

    await sendTagSelectionPrompt(env, chatId);
    return true;
  }

  if (user.onboarding_step === "awaiting_tags") {
    // Handle tag toggle callbacks
    if (callbackQuery?.data?.startsWith("tag:")) {
      const tag = callbackQuery.data.slice(4);

      if (tag === "done" || tag === "skip") {
        // Finalize tag selection
        const selectedTags = parseSelectedTagsFromMessage(callbackQuery.message);

        if (tag === "done" && selectedTags.length > 0) {
          await insertTagPreferences(env.DB, user.id, selectedTags, "onboarding");
        }

        await updateUserOnboardingState(env, user.id, {
          onboardingStep: "completed"
        });

        if (messageId) {
          const tagSummary = selectedTags.length > 0
            ? `Tags: ${selectedTags.join(", ")}`
            : "No tags selected — Gastos will learn as you go";
          await editTelegramMessageText(env, chatId, messageId, tagSummary);
        }
        await answerCallbackQuery(env, callbackQuery.id);
        await sendOnboardingComplete(env, chatId);
        return true;
      }

      // Toggle tag selection — update the keyboard
      await answerCallbackQuery(env, callbackQuery.id);
      if (messageId) {
        const currentSelected = parseSelectedTagsFromMessage(callbackQuery.message);
        const isSelected = currentSelected.includes(tag);
        const newSelected = isSelected
          ? currentSelected.filter(t => t !== tag)
          : [...currentSelected, tag];

        await editTelegramMessageText(
          env, chatId, messageId,
          buildTagSelectionText(newSelected),
          buildTagKeyboard(newSelected)
        );
      }
      return true;
    }

    // Text input during tag selection — skip to completion
    if (text) {
      await updateUserOnboardingState(env, user.id, {
        onboardingStep: "completed"
      });
      await sendOnboardingComplete(env, chatId);
      return true;
    }

    return false;
  }

  return false;
}

function normalizeCurrency(input: string): string | null {
  const currency = input.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return null;
  }

  return currency;
}

function buildTagSelectionText(selectedTags: string[]): string {
  if (selectedTags.length === 0) {
    return "Pick the tags you use most — or skip and Gastos will learn as you go.";
  }
  return `Selected: ${selectedTags.join(", ")}\n\nTap to toggle, then hit Done.`;
}

function buildTagKeyboard(selectedTags: string[]): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const row1 = DEFAULT_TAGS.slice(0, 5).map(tag => ({
    text: selectedTags.includes(tag) ? `${tag} ✓` : tag,
    callback_data: `tag:${tag}`
  }));
  const row2 = DEFAULT_TAGS.slice(5, 10).map(tag => ({
    text: selectedTags.includes(tag) ? `${tag} ✓` : tag,
    callback_data: `tag:${tag}`
  }));

  const actionRow: Array<{ text: string; callback_data: string }> = [];
  if (selectedTags.length > 0) {
    actionRow.push({ text: "Done", callback_data: "tag:done" });
  }
  actionRow.push({ text: "Skip", callback_data: "tag:skip" });

  return { inline_keyboard: [row1, row2, actionRow] };
}

/**
 * Parse selected tags from the message text.
 * Selected tags appear as "tag ✓" in button text, so we parse from the keyboard.
 */
function parseSelectedTagsFromMessage(message: any): string[] {
  if (!message?.reply_markup?.inline_keyboard) return [];
  const selected: string[] = [];
  for (const row of message.reply_markup.inline_keyboard) {
    for (const btn of row) {
      if (btn.text?.endsWith(" ✓") && btn.callback_data?.startsWith("tag:")) {
        selected.push(btn.callback_data.slice(4));
      }
    }
  }
  return selected;
}

async function sendCurrencyPrompt(env: Env, chatId: number) {
  await sendTelegramChatMessage(
    env,
    chatId,
    [
      "You can't improve what you don't track.",
      "",
      "Gastos helps you log expenses in seconds — type, snap a receipt, or send a voice message. Let's get you set up.",
      "",
      "What currency do you use most?",
    ].join("\n"),
    {
      inline_keyboard: [
        PRIORITY_CURRENCIES.map(c => ({ text: c, callback_data: `cur:${c}` })),
        ["BND", "KHR", "IDR"].map(c => ({ text: c, callback_data: `cur:${c}` })),
        ["LAK", "MYR", "MMK"].map(c => ({ text: c, callback_data: `cur:${c}` })),
        ["THB", "VND"].map(c => ({ text: c, callback_data: `cur:${c}` }))
      ]
    }
  );
}

async function sendTagSelectionPrompt(env: Env, chatId: number) {
  await sendTelegramChatMessage(
    env,
    chatId,
    buildTagSelectionText([]),
    buildTagKeyboard([])
  );
}

async function sendCurrencyRetry(env: Env, chatId: number) {
  await sendTelegramChatMessage(
    env,
    chatId,
    "Type a 3-letter currency code (e.g. PHP, SGD, USD, EUR) or pick one below:",
    {
      inline_keyboard: [
        PRIORITY_CURRENCIES.map(c => ({ text: c, callback_data: `cur:${c}` }))
      ]
    }
  );
}

async function sendOnboardingComplete(env: Env, chatId: number) {
  await sendTelegramChatMessage(
    env,
    chatId,
    [
      "You're all set. Now make yourself proud.",
      "",
      "Send me an expense — or use /today, /thisweek, /thismonth to check totals.",
    ].join("\n")
  );
}

// Exported for tests.
export const onboardingConstants = {
  PRIORITY_CURRENCIES,
  ASEAN_CURRENCIES,
  CURRENCY_TO_DEFAULT_TIMEZONE,
  DEFAULT_TAGS
};
