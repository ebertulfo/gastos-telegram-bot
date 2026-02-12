import { getUserByTelegramUserId, setUserTimezone, updateUserOnboardingState, upsertUserForStart } from "./db/users";
import { sendTelegramChatMessage } from "./telegram/messages";
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
  const text = message?.text?.trim();
  if (!message || !text) {
    return false;
  }

  const chatId = message.chat.id;
  const telegramUserId = message.from?.id ?? chatId;

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
    const resolvedTimezone = resolveTimezone(text);
    if (!resolvedTimezone) {
      await sendTimezoneRetry(env, chatId);
      return true;
    }

    await updateUserOnboardingState(env, user.id, {
      timezone: resolvedTimezone,
      onboardingStep: "awaiting_currency"
    });
    await sendCurrencyPrompt(env, chatId);
    return true;
  }

  if (user.onboarding_step === "awaiting_currency") {
    const currency = normalizeCurrency(text);
    if (!currency) {
      await sendCurrencyRetry(env, chatId);
      return true;
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
    if (normalized === "keep current") {
      await updateUserOnboardingState(env, user.id, { onboardingStep: "completed" });
      await sendOnboardingComplete(env, chatId, user.timezone ?? "Unknown", currency ?? "Unknown");
      return true;
    }

    if (normalized === "use suggested") {
      await setUserTimezone(env, user.id, suggestedTimezone);
      await updateUserOnboardingState(env, user.id, { onboardingStep: "completed" });
      await sendOnboardingComplete(env, chatId, suggestedTimezone, currency ?? "Unknown");
      return true;
    }

    await sendTelegramChatMessage(
      env,
      chatId,
      "Please choose one option: Keep current or Use suggested.",
      { keyboard: [["Keep current", "Use suggested"]] }
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
      "You can type a city (example: Manila, Singapore, Bangkok) or an IANA timezone."
    ].join("\n"),
    { keyboard: [["Asia/Manila", "Asia/Singapore"], ["Other"]] }
  );
}

async function sendTimezoneRetry(env: Env, chatId: number) {
  await sendTelegramChatMessage(
    env,
    chatId,
    "I could not resolve that timezone. Type a city (Manila, Singapore, Bangkok) or IANA timezone (Asia/Manila).",
    { keyboard: [["Asia/Manila", "Asia/Singapore"], ["Other"]] }
  );
}

async function sendCurrencyPrompt(env: Env, chatId: number) {
  await sendTelegramChatMessage(
    env,
    chatId,
    "Choose your primary currency (ISO 4217).",
    {
      keyboard: [
        [...PRIORITY_CURRENCIES],
        ["BND", "KHR", "IDR", "LAK", "MYR"],
        ["MMK", "THB", "VND", "Other"]
      ]
    }
  );
}

async function sendCurrencyRetry(env: Env, chatId: number) {
  await sendTelegramChatMessage(
    env,
    chatId,
    "Please send a 3-letter ISO currency code (example: PHP, SGD, USD, EUR).",
    { keyboard: [[...PRIORITY_CURRENCIES], ["BND", "KHR", "IDR", "LAK", "MYR"], ["MMK", "THB", "VND", "Other"]] }
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
    { keyboard: [["Keep current", "Use suggested"]] }
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
