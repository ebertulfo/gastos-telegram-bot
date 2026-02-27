import { getUserByTelegramUserId, updateUserOnboardingState, upsertUserForStart } from "./db/users";
import { editTelegramMessageText, sendTelegramChatMessage, answerCallbackQuery } from "./telegram/messages";
import { formatTotalsMessage, getTotalsForUserAndPeriod, parseTotalsPeriod } from "./totals";
import type { Env, TelegramUpdate } from "./types";

const PRIORITY_CURRENCIES = ["PHP", "SGD", "USD", "EUR"] as const;
const ASEAN_CURRENCIES = ["BND", "KHR", "IDR", "LAK", "MYR", "MMK", "PHP", "SGD", "THB", "VND"] as const;
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

export async function handleOnboardingOrCommand(env: Env, update: TelegramUpdate): Promise<boolean> {
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
      await sendTelegramChatMessage(env, chatId, "Finish /start to enable totals.");
      return true;
    }

    if (!user.currency || !user.timezone) {
      await sendTelegramChatMessage(env, chatId, "Finish /start to enable totals.");
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

  if (!user || user.onboarding_step === "completed") {
    return false;
  }

  if (user.onboarding_step === "awaiting_currency") {
    let currency: string | null = null;

    if (callbackQuery?.data?.startsWith("cur:")) {
      currency = callbackQuery.data.slice(4);
      if (messageId) {
        await editTelegramMessageText(env, chatId, messageId, `✅ Currency set to: ${currency}`);
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
      onboardingStep: "completed"
    });

    await sendOnboardingComplete(env, chatId, suggestedTimezone, currency);
    return true;
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

async function sendCurrencyPrompt(env: Env, chatId: number) {
  await sendTelegramChatMessage(
    env,
    chatId,
    [
      "Welcome to Gastos.",
      "Send your expenses as text, photo, or voice.",
      "",
      "To start, choose your primary currency (ISO 4217)."
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

async function sendCurrencyRetry(env: Env, chatId: number) {
  await sendTelegramChatMessage(
    env,
    chatId,
    "Please select or type a 3-letter ISO currency code (example: PHP, SGD, USD, EUR).",
    {
      inline_keyboard: [
        PRIORITY_CURRENCIES.map(c => ({ text: c, callback_data: `cur:${c}` }))
      ]
    }
  );
}



async function sendOnboardingComplete(env: Env, chatId: number, timezone: string, currency: string) {
  await sendTelegramChatMessage(
    env,
    chatId,
    `Setup complete.\nTimezone: ${timezone}\nCurrency: ${currency}\n\nYou can now use /today, /thisweek, /thismonth, /thisyear.`
  );
}

// Exported for tests.
export const onboardingConstants = {
  PRIORITY_CURRENCIES,
  ASEAN_CURRENCIES,
  CURRENCY_TO_DEFAULT_TIMEZONE
};
