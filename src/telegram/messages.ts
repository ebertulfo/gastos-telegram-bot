import type { Env } from "../types";

type TelegramSendMessageResponse = {
  ok: boolean;
};

type SendMessageOptions = {
  keyboard?: string[][];
};

export async function sendTelegramChatMessage(
  env: Env,
  chatId: number,
  text: string,
  options: SendMessageOptions = {}
): Promise<void> {
  const replyMarkup =
    options.keyboard && options.keyboard.length
      ? {
          keyboard: options.keyboard.map((row) => row.map((value) => ({ text: value }))),
          resize_keyboard: true,
          one_time_keyboard: true
        }
      : undefined;

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
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
