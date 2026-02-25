import { getUserByTelegramUserId, setUserTimezone, updateUserOnboardingState, upsertUserForStart } from "./db/users";
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
  VND: "Asia/Ho_Chi_Minh"
};

const CITY_TO_TIMEZONE: Record<string, string> = {
  manila: "Asia/Manila",
  singapore: "Asia/Singapore",
  bangkok: "Asia/Bangkok",
  jakarta: "Asia/Jakarta",
  "kuala lumpur": "Asia/Kuala_Lumpur",
  "ho chi minh": "Asia/Ho_Chi_Minh",
  hanoi: "Asia/Ho_Chi_Minh",
  "phnom penh": "Asia/Phnom_Penh",
  vientiane: "Asia/Vientiane",
  yangon: "Asia/Yangon",
  "bandar seri begawan": "Asia/Brunei",
  davao: "Asia/Manila",
  cebu: "Asia/Manila"
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
    await sendTimezonePrompt(env, chatId);
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

  if (user.onboarding_step === "awaiting_timezone") {
    let resolvedTimezone: string | null = null;

    if (callbackQuery?.data?.startsWith("tz:")) {
      resolvedTimezone = callbackQuery.data.slice(3);
      if (messageId) {
        await editTelegramMessageText(env, chatId, messageId, `✅ Timezone set to: ${resolvedTimezone}`);
      }
      await answerCallbackQuery(env, callbackQuery.id);
    } else if (text) {
      resolvedTimezone = resolveTimezone(text);
    }

    if (!resolvedTimezone) {
      if (text) {
        await sendTimezoneRetry(env, chatId);
        return true;
      }
      return false;
    }

    await updateUserOnboardingState(env, user.id, {
      timezone: resolvedTimezone,
      onboardingStep: "awaiting_currency"
    });
    await sendCurrencyPrompt(env, chatId);
    return true;
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

    await updateUserOnboardingState(env, user.id, {
      currency,
      onboardingStep: "awaiting_currency_timezone_confirmation"
    });

    const suggestedTimezone = CURRENCY_TO_DEFAULT_TIMEZONE[currency];
    if (suggestedTimezone && user.timezone && suggestedTimezone !== user.timezone) {
      await sendCurrencyTimezoneConfirmation(env, chatId, user.timezone, suggestedTimezone, currency);
      return true;
    }

    await updateUserOnboardingState(env, user.id, {
      onboardingStep: "completed"
    });
    await sendOnboardingComplete(env, chatId, user.timezone ?? "Unknown", currency);
    return true;
  }

  if (user.onboarding_step === "awaiting_currency_timezone_confirmation") {
    const currency = user.currency;
    const suggestedTimezone = currency ? CURRENCY_TO_DEFAULT_TIMEZONE[currency] : undefined;
    if (!suggestedTimezone) {
      await updateUserOnboardingState(env, user.id, { onboardingStep: "completed" });
      await sendOnboardingComplete(env, chatId, user.timezone ?? "Unknown", currency ?? "Unknown");
      return true;
    }

    const normalized = text.toLowerCase();
    let isAccept = false;
    let isReject = false;

    if (callbackQuery?.data === "tz_confirm:keep") {
      isReject = true;
      await answerCallbackQuery(env, callbackQuery.id);
      if (messageId) {
        await editTelegramMessageText(env, chatId, messageId, `✅ Kept existing timezone: ${user.timezone}`);
      }
    } else if (callbackQuery?.data === "tz_confirm:use") {
      isAccept = true;
      await answerCallbackQuery(env, callbackQuery.id);
      if (messageId) {
        await editTelegramMessageText(env, chatId, messageId, `✅ Updated timezone to: ${suggestedTimezone}`);
      }
    } else if (normalized === "keep current") {
      isReject = true;
    } else if (normalized === "use suggested") {
      isAccept = true;
    }

    if (isReject) {
      await updateUserOnboardingState(env, user.id, { onboardingStep: "completed" });
      await sendOnboardingComplete(env, chatId, user.timezone ?? "Unknown", currency ?? "Unknown");
      return true;
    }

    if (isAccept) {
      await setUserTimezone(env, user.id, suggestedTimezone);
      await updateUserOnboardingState(env, user.id, { onboardingStep: "completed" });
      await sendOnboardingComplete(env, chatId, suggestedTimezone, currency ?? "Unknown");
      return true;
    }

    await sendTelegramChatMessage(
      env,
      chatId,
      "Please choose one option: Keep current or Use suggested.",
      {
        inline_keyboard: [
          [
            { text: "Keep current", callback_data: `tz_confirm:keep` },
            { text: "Use suggested", callback_data: `tz_confirm:use` }
          ]
        ]
      }
    );
    return true;
  }

  return false;
}

function resolveTimezone(input: string): string | null {
  const trimmed = input.trim();
  if (isValidIanaTimezone(trimmed)) {
    return trimmed;
  }

  const cityKey = trimmed.toLowerCase().replace(/\s+/g, " ");
  const resolved = CITY_TO_TIMEZONE[cityKey];
  if (resolved && isValidIanaTimezone(resolved)) {
    return resolved;
  }

  return null;
}

function normalizeCurrency(input: string): string | null {
  const currency = input.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return null;
  }

  return currency;
}

function isValidIanaTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

async function sendTimezonePrompt(env: Env, chatId: number) {
  await sendTelegramChatMessage(
    env,
    chatId,
    [
      "Welcome to Gastos.",
      "Send your expenses as text, photo, or voice.",
      "",
      "First, set your timezone.",
      "Select an option below or type a city (example: Manila, Singapore, Bangkok)."
    ].join("\n"),
    {
      inline_keyboard: [
        [
          { text: "Asia/Manila", callback_data: "tz:Asia/Manila" },
          { text: "Asia/Singapore", callback_data: "tz:Asia/Singapore" }
        ],
        [
          { text: "Asia/Bangkok", callback_data: "tz:Asia/Bangkok" },
          { text: "Asia/Jakarta", callback_data: "tz:Asia/Jakarta" }
        ]
      ]
    }
  );
}

async function sendTimezoneRetry(env: Env, chatId: number) {
  await sendTelegramChatMessage(
    env,
    chatId,
    "I could not resolve that timezone. Try selecting an option or typing a city like Manila or Singapore.",
    {
      inline_keyboard: [
        [
          { text: "Asia/Manila", callback_data: "tz:Asia/Manila" },
          { text: "Asia/Singapore", callback_data: "tz:Asia/Singapore" }
        ]
      ]
    }
  );
}

async function sendCurrencyPrompt(env: Env, chatId: number) {
  await sendTelegramChatMessage(
    env,
    chatId,
    "Choose your primary currency (ISO 4217).",
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

async function sendCurrencyTimezoneConfirmation(
  env: Env,
  chatId: number,
  currentTimezone: string,
  suggestedTimezone: string,
  currency: string
) {
  await sendTelegramChatMessage(
    env,
    chatId,
    `Currency ${currency} is usually used with ${suggestedTimezone}. Keep your current timezone (${currentTimezone})?`,
    {
      inline_keyboard: [
        [
          { text: "Keep current", callback_data: `tz_confirm:keep` },
          { text: "Use suggested", callback_data: `tz_confirm:use` }
        ]
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
