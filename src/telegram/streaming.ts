import { sendMessageDraft, sendTelegramChatMessage } from "./messages";
import type { Env } from "../types";

const THROTTLE_MS = 1000;
const MAX_MESSAGE_LENGTH = 4096;
const FALLBACK_TEXT = "Something went wrong — try again";

const TOOL_STATUS_MAP: Record<string, string> = {
  log_expense: "Logging your expense...",
  edit_expense: "Updating your expense...",
  delete_expense: "Deleting your expense...",
  get_financial_report: "Looking up your expenses...",
};

export function getToolStatusText(toolName: string): string {
  return TOOL_STATUS_MAP[toolName] ?? "Working on it...";
}

export class StreamingReplyManager {
  private readonly env: Env;
  private readonly chatId: number;
  private readonly draftId: number;
  private buffer = "";
  private lastSentText = "";
  private lastSendTime = 0;
  started = false;

  constructor(env: Env, chatId: number) {
    this.env = env;
    this.chatId = chatId;
    this.draftId = Math.floor(Math.random() * 2_147_483_647);
  }

  async sendDraft(text: string): Promise<void> {
    if (text === this.lastSentText) return;

    try {
      await sendMessageDraft(this.env, this.chatId, this.draftId, text);
      this.lastSentText = text;
      this.lastSendTime = Date.now();
      this.started = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("429")) {
        console.warn(`Draft throttled (429) for chat ${this.chatId}`);
      } else {
        console.error(`Draft send error for chat ${this.chatId}:`, message);
      }
    }
  }

  async appendText(delta: string): Promise<void> {
    this.buffer += delta;

    const elapsed = Date.now() - this.lastSendTime;
    if (elapsed >= THROTTLE_MS && this.buffer !== this.lastSentText) {
      await this.sendDraft(this.buffer);
    }
  }

  async finalize(text?: string): Promise<void> {
    let finalText = text || FALLBACK_TEXT;

    if (finalText.length > MAX_MESSAGE_LENGTH) {
      finalText = finalText.slice(0, MAX_MESSAGE_LENGTH - 3) + "...";
    }

    await sendTelegramChatMessage(this.env, this.chatId, finalText);
  }
}
