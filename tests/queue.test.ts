import { describe, expect, it, vi, beforeEach } from "vitest";
import { extractForSourceEvent, handleParseQueueBatch } from "../src/queue";
import * as openai from "../src/ai/openai";
import type { Env } from "../src/types";

// Mock the AI module entirely to test M7 Geographic parameters
vi.mock("../src/ai/openai", () => ({
  extractAmountCurrencyFromText: vi.fn(),
  extractAmountCurrencyFromR2Image: vi.fn(),
  transcribeR2Audio: vi.fn()
}));

// Mock Telegram to prevent real network calls
vi.mock("../src/telegram/messages", () => ({
  sendTelegramChatMessage: vi.fn().mockResolvedValue({})
}));

// Provide a mock db that spies on SQL binds
function createEnv(shouldFail = false, captureBinds: any[] = []): Env {
  const run = vi.fn(async () => {
    if (shouldFail) {
      throw new Error("db failure");
    }
    return {};
  });
  const first = vi.fn(async () => ({
    id: 42,
    user_id: 7,
    message_type: "photo", // mock as photo so it hits Vision
    text_raw: null,
    r2_object_key: "receipt.jpg",
    received_at_utc: "2026-02-12T10:00:00.000Z",
    user_currency: "PHP",
    user_timezone: "Asia/Manila",
    telegram_id: 12345
  }));
  const prepare = vi.fn((query: string) => {
    if (query.includes("FROM source_events")) {
      return { bind: vi.fn(() => ({ first })) };
    }
    return {
      bind: vi.fn((...args) => {
        captureBinds.push(...args);
        return { run };
      })
    };
  });

  return {
    APP_ENV: "test",
    TELEGRAM_BOT_TOKEN: "token",
    OPENAI_API_KEY: "test-openai-key", // Required for AI processing
    DB: { prepare } as unknown as D1Database,
    MEDIA_BUCKET: { get: vi.fn() } as unknown as R2Bucket,
    VECTORIZE: { upsert: vi.fn(), query: vi.fn(), deleteByIds: vi.fn() } as unknown as VectorizeIndex,
    RATE_LIMITER: {} as unknown as KVNamespace,
    INGEST_QUEUE: {} as Queue
  };
}

describe("M7 Categories & Tags Queue Extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extractForSourceEvent injects geographic context and maps AI categories", async () => {
    // M7 Mock OpenAI returning categorized response
    vi.mocked(openai.extractAmountCurrencyFromR2Image).mockResolvedValue({
      amountMinor: 25000,
      currency: "PHP",
      category: "Food",
      tags: ["andoks", "chicken"],
      confidence: 0.95,
      needsReview: false,
      metadata: {}
    });

    const env = createEnv(false);

    const sourceEvent = {
      message_type: "photo" as const,
      text_raw: null,
      r2_object_key: "test-receipt.jpg",
      user_currency: "PHP",
      user_timezone: "Asia/Manila",
      user_id: 7
    };

    const result = await extractForSourceEvent(env, sourceEvent, null);

    // M7 Verification 1: Geographic LLM variables properly injected
    expect(openai.extractAmountCurrencyFromR2Image).toHaveBeenCalledWith(
      env,
      "test-receipt.jpg",
      "PHP",
      "Asia/Manila",
      ""
    );

    // M7 Verification 2: Mapped values correctly retrieved
    expect(result.amountMinor).toBe(25000);
    expect(result.category).toBe("Food");
    expect(result.tags).toEqual(["andoks", "chicken"]);
  });

  it("handleParseQueueBatch maps M7 Category and Tags into the database", async () => {
    // M7 Mock OpenAI returning categorized response
    vi.mocked(openai.extractAmountCurrencyFromR2Image).mockResolvedValue({
      amountMinor: 1550,
      currency: "PHP",
      category: "Transport",
      tags: ["grab", "taxi"],
      confidence: 0.95,
      needsReview: false,
      metadata: {}
    });

    const ack = vi.fn();
    const retry = vi.fn();
    const capturedBinds: any[] = [];
    const env = createEnv(false, capturedBinds);

    // The message simulates triggering the queue processing
    await handleParseQueueBatch(
      {
        messages: [{ body: { type: "receipt", sourceEventId: 42, userId: 7, r2ObjectKey: null }, ack, retry }]
      } as unknown as MessageBatch<{ type: "receipt"; sourceEventId: number; userId: number; r2ObjectKey: string | null }>,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext
    );

    expect(ack).toHaveBeenCalled();

    // In our `queue.ts` we have two inserts: `parse_results` then `expenses`.
    // The `expenses` insertion should be at the very end.
    // Let's assert that "Transport" and "[\"grab\",\"taxi\"]" were bound!

    expect(capturedBinds).toContain("Transport");
    expect(capturedBinds).toContain(JSON.stringify(["grab", "taxi"]));
  });

  it("retries on failure", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const env = createEnv(true);

    await handleParseQueueBatch(
      {
        messages: [{ body: { type: "receipt", sourceEventId: 42, userId: 7, r2ObjectKey: null }, ack, retry }]
      } as unknown as MessageBatch<{ type: "receipt"; sourceEventId: number; userId: number; r2ObjectKey: string | null }>,
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext
    );

    expect(retry).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();
  });
});
