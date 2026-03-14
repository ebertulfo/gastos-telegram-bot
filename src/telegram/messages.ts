import type { Env } from "../types";

type TelegramSendMessageResponse = {
  ok: boolean;
};

type SendMessageOptions = {
  keyboard?: string[][];
  inline_keyboard?: { text: string; callback_data: string }[][];
};

/**
 * Telegram's MarkdownV2 is aggressively strict. It will throw an HTTP 400 error if any of these
 * special characters are present in the text but not explicitly escaped with a backslash.
 * Note: We DO NOT escape `*`, `_`, `~`, `` ` ``, or `[` because we actually want the LLM to use them for formatting.
 */
export function escapeMarkdown(text: string): string {
  // Characters that MUST be escaped in MarkdownV2: _ * [ ] ( ) ~ ` > # + - = | { } . !
  // But we want to allow standard formatting (*bold*, _italic_, `code`, [link](url)).
  // So we ONLY escape the strict punctuation characters that crash the parser when used normally.
  return text.replace(/([#+\-=|{}.!>()])/g, '\\$1');
}

export async function sendTelegramChatMessage(
  env: Env,
  chatId: number,
  text: string,
  options: SendMessageOptions = {}
): Promise<void> {
  let replyMarkup: unknown = undefined;

  if (options.inline_keyboard && options.inline_keyboard.length) {
    replyMarkup = {
      inline_keyboard: options.inline_keyboard
    };
  } else if (options.keyboard && options.keyboard.length) {
    replyMarkup = {
      keyboard: options.keyboard.map((row) => row.map((value) => ({ text: value }))),
      resize_keyboard: true,
      one_time_keyboard: true
    };
  }

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: escapeMarkdown(text),
      parse_mode: "MarkdownV2",
      reply_markup: replyMarkup
    })
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed with status ${response.status}`);
  }

  const json = (await response.json()) as TelegramSendMessageResponse;
  if (!json.ok) {
    throw new Error("Telegram sendMessage returned ok=false");
  }
}

export async function editTelegramMessageText(
  env: Env,
  chatId: number,
  messageId: number,
  text: string,
  options: SendMessageOptions = {}
): Promise<void> {
  let replyMarkup: unknown = undefined;

  if (options.inline_keyboard && options.inline_keyboard.length) {
    replyMarkup = {
      inline_keyboard: options.inline_keyboard
    };
  }

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: escapeMarkdown(text),
      parse_mode: "MarkdownV2",
      reply_markup: replyMarkup
    })
  });

  if (!response.ok) {
    throw new Error(`Telegram editMessageText failed with status ${response.status}`);
  }

  const json = (await response.json()) as TelegramSendMessageResponse;
  if (!json.ok) {
    throw new Error("Telegram editMessageText returned ok=false");
  }
}

export async function answerCallbackQuery(env: Env, callbackQueryId: string, text?: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text
    })
  });

  if (!response.ok) {
    console.error(`Telegram answerCallbackQuery failed with status ${response.status}`);
  }
}

export async function sendChatAction(env: Env, chatId: number, action: "typing" | "upload_photo" | "record_voice" | "upload_voice" | "upload_document" = "typing"): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      action
    })
  });

  if (!response.ok) {
    console.error(`Telegram sendChatAction failed with status ${response.status}`);
  }
}

export async function sendMessageDraft(
  env: Env,
  chatId: number,
  draftId: number,
  text: string,
): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessageDraft`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, draft_id: draftId, text }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Telegram sendMessageDraft failed with status ${response.status}`,
    );
  }
}
