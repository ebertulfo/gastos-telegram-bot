import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { Env } from "../src/types";

type MockDbOptions = {
  duplicate?: boolean;
  user?: {
    id: number;
    telegram_user_id: number;
    telegram_chat_id: number;
    timezone: string | null;
    currency: string | null;
    onboarding_step: string | null;
  } | null;
};

function createMockDb(options: MockDbOptions = {}) {
  const updateRun = vi.fn(async () => ({}));
  let currentUser = options.user ?? null;
  const userUpdateRun = vi.fn(async () => ({}));
  const insertFirst = vi.fn(async () => {
    if (options.duplicate) {
      throw new Error("UNIQUE constraint failed: source_events.telegram_chat_id, source_events.telegram_message_id");
    }
    return { id: 123 };
  });
  const selectFirst = vi.fn(async () => ({ id: 123 }));
  const selectUserFirst = vi.fn(async () => currentUser);
  const upsertUserRun = vi.fn(async () => {
    currentUser ??= {
      id: 7,
      telegram_user_id: 88,
      telegram_chat_id: 77,
      timezone: null,
      currency: null,
      onboarding_step: null
    };
    return {};
  });

  const prepare = vi.fn((query: string) => {
    if (query.includes("INSERT INTO source_events")) {
      return { bind: vi.fn(() => ({ first: insertFirst })) };
    }
    if (query.includes("SELECT id FROM source_events")) {
      return { bind: vi.fn(() => ({ first: selectFirst })) };
    }
    if (query.includes("UPDATE source_events")) {
      return { bind: vi.fn(() => ({ run: updateRun })) };
    }
    if (query.includes("FROM users")) {
      return { bind: vi.fn(() => ({ first: selectUserFirst })) };
    }
    if (query.includes("INSERT INTO users")) {
      return { bind: vi.fn(() => ({ run: upsertUserRun })) };
    }
    if (query.includes("UPDATE users")) {
      return { bind: vi.fn(() => ({ run: userUpdateRun })) };
    }
    return { bind: vi.fn(() => ({ run: vi.fn(async () => ({})) })) };
  });

  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    updateRun
  };
}

function createEnv(options: MockDbOptions = {}) {
  const dbState = createMockDb(options);
  const send = vi.fn(async () => undefined);
  const put = vi.fn(async () => undefined);

  const env: Env = {
    APP_ENV: "test",
    TELEGRAM_BOT_TOKEN: "token",
    DB: dbState.db,
    MEDIA_BUCKET: { put } as unknown as R2Bucket,
    INGEST_QUEUE: { send } as unknown as Queue
  };

  return { env, send, put, updateRun: dbState.updateRun };
}

function buildTextUpdateBody() {
  return JSON.stringify({
    update_id: 1,
    message: {
      message_id: 2,
      date: 1730000000,
      text: "Lunch 10.00",
      chat: { id: 77 },
      from: { id: 88 }
    }
  });
}

function buildPhotoUpdateBody() {
  return JSON.stringify({
    update_id: 1,
    message: {
      message_id: 2,
      date: 1730000000,
      chat: { id: 77 },
      from: { id: 88 },
      photo: [{ file_id: "file-1", file_unique_id: "uniq-1", width: 100, height: 100 }]
    }
  });
}

type WebhookResponse = {
  status: string;
  message: string;
};

describe("telegram webhook", () => {
  it("enqueues once for first-time event", async () => {
    const app = createApp();
    const { env, send } = createEnv({ duplicate: false });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await app.fetch(
      new Request("http://localhost/webhook/telegram", {
        method: "POST",
        body: buildTextUpdateBody(),
        headers: { "content-type": "application/json" }
      }),
      env
    );

    const json = (await response.json()) as WebhookResponse;
    expect(json.status).toBe("saved");
    expect(send).toHaveBeenCalledTimes(1); // Webhook no longer sends "Saved" message
    expect(fetchMock).toHaveBeenCalledTimes(0); // Webhook no longer calls Telegram API

    fetchMock.mockRestore();
  });

  it("does not enqueue duplicates", async () => {
    const app = createApp();
    const { env, send } = createEnv({ duplicate: true });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await app.fetch(
      new Request("http://localhost/webhook/telegram", {
        method: "POST",
        body: buildTextUpdateBody(),
        headers: { "content-type": "application/json" }
      }),
      env
    );

    const json = (await response.json()) as WebhookResponse;
    expect(json.status).toBe("duplicate");
    expect(send).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(0); // Webhook no longer calls Telegram API

    fetchMock.mockRestore();
  });

  it("uploads photo media to r2 and stores object key", async () => {
    const app = createApp();
    const { env, send, put, updateRun } = createEnv({ duplicate: false });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: { file_path: "photos/file-1.jpg" } }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await app.fetch(
      new Request("http://localhost/webhook/telegram", {
        method: "POST",
        body: buildPhotoUpdateBody(),
        headers: { "content-type": "application/json" }
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(put).toHaveBeenCalledTimes(1);
    expect(updateRun).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1); // Webhook no longer sends "Saved" message
    expect(fetchMock).toHaveBeenCalledTimes(2); // Only getFile and downloadFile, no send message

    fetchMock.mockRestore();
  });
});
