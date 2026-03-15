import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { StreamingReplyManager, getToolStatusText } from "../src/telegram/streaming";
import type { Env, ParseQueueMessage } from "../src/types";

// Mock telegram messages module
vi.mock("../src/telegram/messages", () => ({
  sendMessageDraft: vi.fn().mockResolvedValue(undefined),
  sendTelegramChatMessage: vi.fn().mockResolvedValue(undefined),
}));

function createEnv(): Env {
  return {
    APP_ENV: "test",
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
    OPENAI_API_KEY: "test-key",
    DB: {} as D1Database,
    MEDIA_BUCKET: {} as R2Bucket,
    VECTORIZE: {} as VectorizeIndex,
    RATE_LIMITER: {} as KVNamespace,
    INGEST_QUEUE: {} as Queue<ParseQueueMessage>,
  };
}

describe("StreamingReplyManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sendDraft sends a draft and sets started to true", async () => {
    const { sendMessageDraft } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    expect(manager.started).toBe(false);
    await manager.sendDraft("Hello");
    expect(manager.started).toBe(true);
    expect(sendMessageDraft).toHaveBeenCalledWith(
      expect.objectContaining({ TELEGRAM_BOT_TOKEN: "token" }),
      12345,
      expect.any(Number),
      "Hello",
    );
  });

  it("sendDraft skips API call when text matches lastSentText", async () => {
    const { sendMessageDraft } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    await manager.sendDraft("Hello");
    await manager.sendDraft("Hello");

    expect(sendMessageDraft).toHaveBeenCalledTimes(1);
  });

  it("appendText accumulates buffer and sends after throttle window", async () => {
    const { sendMessageDraft } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    // First append should send immediately (no prior send)
    await manager.appendText("Hello ");
    expect(sendMessageDraft).toHaveBeenCalledTimes(1);
    expect(sendMessageDraft).toHaveBeenCalledWith(
      expect.anything(),
      12345,
      expect.any(Number),
      "Hello ",
    );

    // Second append within throttle window should NOT send
    await manager.appendText("world");
    expect(sendMessageDraft).toHaveBeenCalledTimes(1);

    // After 1 second, next append should send accumulated buffer
    vi.advanceTimersByTime(1000);
    await manager.appendText("!");
    expect(sendMessageDraft).toHaveBeenCalledTimes(2);
    expect(sendMessageDraft).toHaveBeenLastCalledWith(
      expect.anything(),
      12345,
      expect.any(Number),
      "Hello world!",
    );
  });

  it("finalize sends final message via sendTelegramChatMessage when draft was started", async () => {
    const { sendTelegramChatMessage } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    await manager.sendDraft("draft text");
    await manager.finalize("Final formatted text");

    expect(sendTelegramChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ TELEGRAM_BOT_TOKEN: "token" }),
      12345,
      "Final formatted text",
    );
  });

  it("finalize sends directly when no draft was ever sent", async () => {
    const { sendTelegramChatMessage, sendMessageDraft } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    await manager.finalize("Direct message");

    expect(sendMessageDraft).not.toHaveBeenCalled();
    expect(sendTelegramChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ TELEGRAM_BOT_TOKEN: "token" }),
      12345,
      "Direct message",
    );
  });

  it("finalize uses fallback text when given empty string", async () => {
    const { sendTelegramChatMessage } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    await manager.finalize("");

    expect(sendTelegramChatMessage).toHaveBeenCalledWith(
      expect.anything(),
      12345,
      "Something went wrong — try again",
    );
  });

  it("finalize truncates text exceeding 4096 characters", async () => {
    const { sendTelegramChatMessage } = await import("../src/telegram/messages");
    const manager = new StreamingReplyManager(createEnv(), 12345);

    const longText = "a".repeat(5000);
    await manager.finalize(longText);

    const sentText = vi.mocked(sendTelegramChatMessage).mock.calls[0][2];
    expect(sentText.length).toBe(4096);
    expect(sentText.endsWith("...")).toBe(true);
  });

  it("sendDraft logs warning and does not throw on HTTP 429", async () => {
    const { sendMessageDraft } = await import("../src/telegram/messages");
    vi.mocked(sendMessageDraft).mockRejectedValueOnce(
      new Error("Telegram sendMessageDraft failed with status 429"),
    );

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const manager = new StreamingReplyManager(createEnv(), 12345);

    // Should not throw
    await manager.sendDraft("Hello");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("429"),
    );
    consoleSpy.mockRestore();
  });

  it("sendDraft logs and does not throw on other errors", async () => {
    const { sendMessageDraft } = await import("../src/telegram/messages");
    vi.mocked(sendMessageDraft).mockRejectedValueOnce(
      new Error("Telegram sendMessageDraft failed with status 500"),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const manager = new StreamingReplyManager(createEnv(), 12345);

    await manager.sendDraft("Hello");

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("getToolStatusText", () => {
  it("returns specific text for known tools", () => {
    expect(getToolStatusText("log_expense")).toBe("Logging your expense...");
    expect(getToolStatusText("edit_expense")).toBe("Updating your expense...");
    expect(getToolStatusText("delete_expense")).toBe("Deleting your expense...");
    expect(getToolStatusText("get_financial_report")).toBe("Looking up your expenses...");
  });

  it("returns default text for unknown tools", () => {
    expect(getToolStatusText("unknown_tool")).toBe("Working on it...");
  });
});
