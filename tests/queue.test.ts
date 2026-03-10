import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleParseQueueBatch } from "../src/queue";
import type { Env, ParseQueueMessage } from "../src/types";

// Mock the SDK
vi.mock("@openai/agents", () => ({
  run: vi.fn().mockResolvedValue({
    finalOutput: "Logged: PHP 150.00 | Food | lunch",
    rawResponses: [{ usage: { totalTokens: 500 } }],
  }),
  getGlobalTraceProvider: vi.fn(() => ({ forceFlush: vi.fn().mockResolvedValue(undefined) })),
}));

// Mock agent creation
vi.mock("../src/ai/agent", () => ({
  createGastosAgent: vi.fn(() => ({ name: "gastos" })),
}));

// Mock session
vi.mock("../src/ai/session", () => ({
  D1Session: vi.fn().mockImplementation(() => ({})),
}));

// Mock Telegram to prevent real network calls
vi.mock("../src/telegram/messages", () => ({
  sendTelegramChatMessage: vi.fn().mockResolvedValue(undefined),
  sendChatAction: vi.fn().mockResolvedValue(undefined),
}));

// Mock quotas
vi.mock("../src/db/quotas", () => ({
  checkAndRefreshTokenQuota: vi.fn().mockResolvedValue(true),
  incrementTokenUsage: vi.fn().mockResolvedValue(undefined),
}));

// Mock transcription
vi.mock("../src/ai/openai", () => ({
  transcribeR2Audio: vi.fn().mockResolvedValue("coffee 5 dollars"),
}));

function createEnv(): Env {
  return {
    APP_ENV: "test",
    TELEGRAM_BOT_TOKEN: "token",
    OPENAI_API_KEY: "test-openai-key",
    DB: { prepare: vi.fn() } as unknown as D1Database,
    MEDIA_BUCKET: {
      get: vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        httpMetadata: { contentType: "image/jpeg" },
      }),
    } as unknown as R2Bucket,
    VECTORIZE: { upsert: vi.fn(), query: vi.fn(), deleteByIds: vi.fn() } as unknown as VectorizeIndex,
    RATE_LIMITER: {} as unknown as KVNamespace,
    INGEST_QUEUE: {} as Queue,
  };
}

describe("queue processMessage via SDK agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes a text message through the agent and acks", async () => {
    const { run } = await import("@openai/agents");
    const { sendTelegramChatMessage } = await import("../src/telegram/messages");

    const ack = vi.fn();
    const retry = vi.fn();
    const env = createEnv();

    const body: ParseQueueMessage = {
      userId: 7,
      telegramId: 12345,
      timezone: "Asia/Manila",
      currency: "PHP",
      tier: "free",
      text: "coffee 150",
    };

    await handleParseQueueBatch(
      {
        messages: [{ body, ack, retry }],
      } as unknown as MessageBatch<ParseQueueMessage>,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(ack).toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ name: "gastos" }),
      "coffee 150",
      expect.objectContaining({ maxTurns: 10 }),
    );
    expect(sendTelegramChatMessage).toHaveBeenCalledWith(
      env,
      12345,
      "Logged: PHP 150.00 | Food | lunch",
    );
  });

  it("retries on agent failure", async () => {
    const { run } = await import("@openai/agents");
    vi.mocked(run).mockRejectedValueOnce(new Error("model error"));

    const ack = vi.fn();
    const retry = vi.fn();
    const env = createEnv();

    const body: ParseQueueMessage = {
      userId: 7,
      telegramId: 12345,
      timezone: "Asia/Manila",
      currency: "PHP",
      tier: "free",
      text: "coffee 150",
    };

    await handleParseQueueBatch(
      {
        messages: [{ body, ack, retry }],
      } as unknown as MessageBatch<ParseQueueMessage>,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(retry).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();
  });

  it("sends quota exceeded message without running the agent", async () => {
    const { run } = await import("@openai/agents");
    const { checkAndRefreshTokenQuota } = await import("../src/db/quotas");
    const { sendTelegramChatMessage } = await import("../src/telegram/messages");

    vi.mocked(checkAndRefreshTokenQuota).mockResolvedValueOnce(false);

    const ack = vi.fn();
    const retry = vi.fn();
    const env = createEnv();

    const body: ParseQueueMessage = {
      userId: 7,
      telegramId: 12345,
      timezone: "Asia/Manila",
      currency: "PHP",
      tier: "free",
      text: "coffee 150",
    };

    await handleParseQueueBatch(
      {
        messages: [{ body, ack, retry }],
      } as unknown as MessageBatch<ParseQueueMessage>,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(ack).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(sendTelegramChatMessage).toHaveBeenCalledWith(
      env,
      12345,
      expect.stringContaining("limit"),
    );
  });

  it("processes a voice message by transcribing first", async () => {
    const { run } = await import("@openai/agents");

    const ack = vi.fn();
    const retry = vi.fn();
    const env = createEnv();

    const body: ParseQueueMessage = {
      userId: 7,
      telegramId: 12345,
      timezone: "Asia/Manila",
      currency: "PHP",
      tier: "free",
      r2ObjectKey: "voice/abc.ogg",
      mediaType: "voice",
    };

    await handleParseQueueBatch(
      {
        messages: [{ body, ack, retry }],
      } as unknown as MessageBatch<ParseQueueMessage>,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(ack).toHaveBeenCalled();
    // Voice should be transcribed then passed as string
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ name: "gastos" }),
      "coffee 5 dollars",
      expect.objectContaining({ maxTurns: 10 }),
    );
  });

  it("processes a photo message with multimodal input", async () => {
    const { run } = await import("@openai/agents");

    const ack = vi.fn();
    const retry = vi.fn();
    const env = createEnv();

    const body: ParseQueueMessage = {
      userId: 7,
      telegramId: 12345,
      timezone: "Asia/Manila",
      currency: "PHP",
      tier: "free",
      r2ObjectKey: "photos/receipt.jpg",
      mediaType: "photo",
    };

    await handleParseQueueBatch(
      {
        messages: [{ body, ack, retry }],
      } as unknown as MessageBatch<ParseQueueMessage>,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(ack).toHaveBeenCalled();
    // Photo should be passed as AgentInputItem[] with input_image
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ name: "gastos" }),
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.arrayContaining([
            expect.objectContaining({ type: "input_image" }),
          ]),
        }),
      ]),
      expect.objectContaining({ maxTurns: 10 }),
    );
  });
});
