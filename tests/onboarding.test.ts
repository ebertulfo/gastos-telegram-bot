import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { Env } from "../src/types";

type UserRow = {
  id: number;
  telegram_user_id: number;
  telegram_chat_id: number;
  timezone: string | null;
  currency: string | null;
  onboarding_step: string | null;
};

function createOnboardingEnv(initialUser: UserRow | null) {
  const upsertRun = vi.fn(async () => ({}));
  const userUpdateRun = vi.fn(async () => ({}));
  const send = vi.fn(async () => undefined);
  const put = vi.fn(async () => undefined);

  let currentUser = initialUser;

  const prepare = vi.fn((query: string) => {
    if (query.includes("INSERT INTO users")) {
      return {
        bind: vi.fn(() => ({
          run: vi.fn(async () => {
            currentUser = {
              id: 1,
              telegram_user_id: 88,
              telegram_chat_id: 77,
              timezone: null,
              currency: null,
              onboarding_step: "awaiting_currency"
            };
            return upsertRun();
          })
        }))
      };
    }

    if (query.includes("FROM users")) {
      return { bind: vi.fn(() => ({ first: vi.fn(async () => currentUser) })) };
    }

    if (query.includes("FROM expenses")) {
      return {
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({
            total_minor: 123456,
            count: 18,
            needs_review_count: 3
          }))
        }))
      };
    }

    if (query.includes("UPDATE users")) {
      return {
        bind: vi.fn((timezone: string | null, currency: string | null, onboardingStep: string) => ({
          run: vi.fn(async () => {
            if (currentUser) {
              currentUser = {
                ...currentUser,
                timezone: timezone ?? currentUser.timezone,
                currency: currency ?? currentUser.currency,
                onboarding_step: onboardingStep
              };
            }
            return userUpdateRun();
          })
        }))
      };
    }

    return { bind: vi.fn(() => ({ run: vi.fn(async () => ({})), first: vi.fn(async () => null) })) };
  });

  const env: Env = {
    APP_ENV: "test",
    TELEGRAM_BOT_TOKEN: "token",
    DB: { prepare } as unknown as D1Database,
    MEDIA_BUCKET: { put } as unknown as R2Bucket,
    VECTORIZE: {} as unknown as VectorizeIndex,
    RATE_LIMITER: {} as unknown as KVNamespace,
    INGEST_QUEUE: { send } as unknown as Queue<any>
  };

  return { env, send };
}

function requestForText(text: string) {
  return new Request("http://localhost/webhook/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 2,
        date: 1730000000,
        text,
        chat: { id: 77 },
        from: { id: 88 }
      }
    })
  });
}

describe("onboarding and command handling", () => {
  it("handles /start and does not enqueue", async () => {
    const app = createApp();
    const { env, send } = createOnboardingEnv(null);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await app.fetch(requestForText("/start"), env);
    const json = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(json.status).toBe("handled");
    expect(send).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockRestore();
  });

  it("accepts currency and sets inferred timezone", async () => {
    const app = createApp();
    const { env, send } = createOnboardingEnv({
      id: 1,
      telegram_user_id: 88,
      telegram_chat_id: 77,
      timezone: null,
      currency: null,
      onboarding_step: "awaiting_currency"
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await app.fetch(requestForText("PHP"), env);
    const json = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(json.status).toBe("handled");
    expect(send).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockRestore();
  });

  it("gates totals command when onboarding is incomplete", async () => {
    const app = createApp();
    const { env, send } = createOnboardingEnv({
      id: 1,
      telegram_user_id: 88,
      telegram_chat_id: 77,
      timezone: null,
      currency: null,
      onboarding_step: "awaiting_currency"
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await app.fetch(requestForText("/today"), env);
    const json = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(json.status).toBe("handled");
    expect(send).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockRestore();
  });

  it("returns totals when onboarding is completed", async () => {
    const app = createApp();
    const { env, send } = createOnboardingEnv({
      id: 1,
      telegram_user_id: 88,
      telegram_chat_id: 77,
      timezone: "Asia/Manila",
      currency: "SGD",
      onboarding_step: "completed"
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await app.fetch(requestForText("/today"), env);
    const json = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(json.status).toBe("handled");
    expect(send).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(requestInit?.body ?? "{}")) as { text?: string };
    expect(body.text).toContain("SGD 1,234\\.56");
    expect(body.text).toContain("18 expenses");
    expect(body.text).toContain("3 need review");

    fetchMock.mockRestore();
  });
});
