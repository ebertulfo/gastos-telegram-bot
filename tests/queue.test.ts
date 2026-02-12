import { describe, expect, it, vi } from "vitest";
import { extractForSourceEvent, handleParseQueueBatch } from "../src/queue";
import type { Env } from "../src/types";

function createEnv(shouldFail = false): Env {
  const run = vi.fn(async () => {
    if (shouldFail) {
      throw new Error("db failure");
    }
    return {};
  });
  const first = vi.fn(async () => ({
    id: 42,
    user_id: 7,
    message_type: "text",
    text_raw: "Lunch SGD 12.50",
    received_at_utc: "2026-02-12T10:00:00.000Z",
    user_currency: "SGD"
  }));
  const prepare = vi.fn((query: string) => {
    if (query.includes("FROM source_events")) {
      return { bind: vi.fn(() => ({ first })) };
    }
    return { bind: vi.fn(() => ({ run })) };
  });

  return {
    APP_ENV: "test",
    TELEGRAM_BOT_TOKEN: "token",
    OPENAI_API_KEY: undefined,
    DB: { prepare } as unknown as D1Database,
    MEDIA_BUCKET: {} as R2Bucket,
    INGEST_QUEUE: {} as Queue
  };
}

describe("handleParseQueueBatch", () => {
  it("acks on success", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const env = createEnv(false);

    await handleParseQueueBatch(
      {
        messages: [{ body: { sourceEventId: 42, userId: 7, r2ObjectKey: null }, ack, retry }]
      } as unknown as MessageBatch<{ sourceEventId: number; userId: number; r2ObjectKey: string | null }>,
      env
    );

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("retries on failure", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const env = createEnv(true);

    await handleParseQueueBatch(
      {
        messages: [{ body: { sourceEventId: 42, userId: 7, r2ObjectKey: null }, ack, retry }]
      } as unknown as MessageBatch<{ sourceEventId: number; userId: number; r2ObjectKey: string | null }>,
      env
    );

    expect(retry).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();
  });
});

describe("extractForSourceEvent", () => {
  const env = createEnv(false);

  it("extracts amount and explicit currency from text", async () => {
    const result = await extractForSourceEvent(
      env,
      { message_type: "text", text_raw: "Coffee SGD 5.20", r2_object_key: null, user_currency: "PHP" },
      null
    );
    expect(result.amountMinor).toBe(520);
    expect(result.currency).toBe("SGD");
    expect(result.needsReview).toBe(false);
  });

  it("uses user default currency and marks needs_review", async () => {
    const result = await extractForSourceEvent(
      env,
      { message_type: "text", text_raw: "Taxi 100", r2_object_key: null, user_currency: "PHP" },
      null
    );
    expect(result.amountMinor).toBe(10000);
    expect(result.currency).toBe("PHP");
    expect(result.needsReview).toBe(true);
  });

  it("marks photo as unprocessed when openai key/media is unavailable", async () => {
    const result = await extractForSourceEvent(
      env,
      { message_type: "photo", text_raw: null, r2_object_key: null, user_currency: "SGD" },
      null
    );
    expect(result.amountMinor).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.parsedJson.reason).toBe("missing_photo_media_or_openai_key");
  });
});
