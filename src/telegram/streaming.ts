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

// Tool-leak detection: catches raw JSON fragments and thinking-out-loud phrases
// that leak into the stream before the SDK classifies them as tool_use
const TOOL_NAMES = Object.keys(TOOL_STATUS_MAP);

const TOOL_LEAK_PATTERNS = [
  /\{"[\s]*$/,              // starts JSON object at end of buffer
  /"name"\s*:\s*"/,         // JSON name field
  /"arguments"\s*:\s*"/,    // JSON arguments field
  /"type"\s*:\s*"function"/ // function type marker
];

const THINKING_PATTERNS = [
  /\bI'll call\s+\w+_\w+/i,   // "I'll call log_expense"
  /\bLet me use\s+\w+_\w+/i,  // "Let me use get_financial_report"
  /\bI need to call\s+\w+/i,  // "I need to call the tool"
  /\bI'll use the\s+\w+/i,    // "I'll use the tool"
  /\bCalling\s+\w+_\w+/i,     // "Calling log_expense"
];

function detectToolLeak(text: string): boolean {
  for (const name of TOOL_NAMES) {
    if (text.includes(name)) return true;
  }
  for (const pattern of TOOL_LEAK_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  for (const pattern of THINKING_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
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
    const prevLength = this.buffer.length;
    this.buffer += delta;

    if (detectToolLeak(this.buffer)) {
      console.warn(`[TOOL_LEAK] Suppressed tool fragment in chat ${this.chatId}`);
      this.buffer = this.buffer.slice(0, prevLength);
      return;
    }

    const elapsed = Date.now() - this.lastSendTime;
    if (elapsed >= THROTTLE_MS && this.buffer !== this.lastSentText) {
      await this.sendDraft(this.buffer);
    }
  }

  async finalize(text?: string): Promise<void> {
    let finalText = text || FALLBACK_TEXT;

    if (detectToolLeak(finalText)) {
      console.warn(`[TOOL_LEAK] Sanitizing final text in chat ${this.chatId}`);
      // Strip thinking patterns first (they include tool names in the match)
      for (const pattern of THINKING_PATTERNS) {
        finalText = finalText.replace(pattern, "");
      }
      for (const pattern of TOOL_LEAK_PATTERNS) {
        finalText = finalText.replace(pattern, "");
      }
      // Strip any remaining bare tool names
      for (const name of TOOL_NAMES) {
        finalText = finalText.replaceAll(name, "");
      }
      finalText = finalText.replace(/\s{2,}/g, " ").trim();
    }

    if (!finalText) finalText = FALLBACK_TEXT;

    if (finalText.length > MAX_MESSAGE_LENGTH) {
      finalText = finalText.slice(0, MAX_MESSAGE_LENGTH - 3) + "...";
    }

    await sendTelegramChatMessage(this.env, this.chatId, finalText);
  }
}
