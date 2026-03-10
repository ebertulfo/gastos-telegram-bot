import type { Env, MessageType, SourceEventRecord, TelegramUpdate } from "../types";

export function classifyMessageType(update: TelegramUpdate): MessageType {
  const message = update.message;
  if (message?.voice) {
    return "voice";
  }
  if (message?.photo?.length) {
    return "photo";
  }
  return "text";
}

function getFileUniqueId(update: TelegramUpdate): string | null {
  const message = update.message;
  if (!message) {
    return null;
  }
  if (message.voice) {
    return message.voice.file_unique_id;
  }
  if (message.photo?.length) {
    return message.photo[message.photo.length - 1]?.file_unique_id ?? null;
  }
  return null;
}

export async function persistSourceEvent(
  env: Env,
  userId: number,
  update: TelegramUpdate,
  r2ObjectKey: string | null = null
): Promise<SourceEventRecord> {
  const message = update.message;
  if (!message) {
    throw new Error("Unsupported update payload: message is required");
  }

  const messageType = classifyMessageType(update);
  const receivedAtUtc = new Date(message.date * 1000).toISOString();
  const createdAtUtc = new Date().toISOString();
  const fileUniqueId = getFileUniqueId(update);
  const textRaw = message.text ?? null;

  const stmt = env.DB.prepare(
    `INSERT INTO source_events (
      user_id,
      telegram_chat_id,
      telegram_message_id,
      file_unique_id,
      message_type,
      text_raw,
      r2_object_key,
      received_at_utc,
      created_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id`
  );

  try {
    const result = await stmt
      .bind(
        userId,
        message.chat.id,
        message.message_id,
        fileUniqueId,
        messageType,
        textRaw,
        r2ObjectKey,
        receivedAtUtc,
        createdAtUtc
      )
      .first<{ id: number }>();

    if (!result?.id) {
      throw new Error("Failed to persist source event");
    }

    return { id: result.id, duplicate: false, messageType };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const existing = await env.DB.prepare(
      `SELECT id FROM source_events
       WHERE telegram_chat_id = ? AND telegram_message_id = ?`
    )
      .bind(message.chat.id, message.message_id)
      .first<{ id: number }>();

    if (!existing?.id) {
      throw new Error("Duplicate detected but existing source event not found");
    }

    return { id: existing.id, duplicate: true, messageType };
  }
}

/**
 * Create a minimal source event for agent-created expenses (e.g. log_expense tool).
 * Uses negative telegram_message_id to avoid collision with real Telegram messages.
 */
export async function createAgentSourceEvent(
  db: D1Database,
  userId: number,
  telegramChatId: number,
  description: string,
): Promise<number> {
  const now = new Date();
  const result = await db.prepare(
    `INSERT INTO source_events (
      user_id, telegram_chat_id, telegram_message_id, file_unique_id,
      message_type, text_raw, r2_object_key, received_at_utc, created_at_utc
    ) VALUES (?, ?, ?, NULL, 'text', ?, NULL, ?, ?)
    RETURNING id`
  )
    .bind(
      userId,
      telegramChatId,
      -Date.now(), // negative to avoid collision with real Telegram message IDs
      description,
      now.toISOString(),
      now.toISOString(),
    )
    .first<{ id: number }>();

  if (!result?.id) {
    throw new Error("Failed to create agent source event");
  }
  return result.id;
}

export async function setSourceEventR2ObjectKey(env: Env, sourceEventId: number, r2ObjectKey: string) {
  await env.DB.prepare(
    `UPDATE source_events
     SET r2_object_key = ?
     WHERE id = ?`
  )
    .bind(r2ObjectKey, sourceEventId)
    .run();
}

export type SourceEventForQueue = {
  id: number;
  user_id: number;
  message_type: "text" | "photo" | "voice";
  text_raw: string | null;
  r2_object_key: string | null;
  received_at_utc: string;
  user_currency: string | null;
  user_timezone: string | null;
  telegram_id: number | null;
};

export async function getSourceEventForQueue(
  db: D1Database,
  sourceEventId: number
): Promise<SourceEventForQueue | null> {
  return db.prepare(
    `SELECT se.id, se.user_id, se.message_type, se.text_raw, se.r2_object_key, se.received_at_utc,
            u.currency AS user_currency, u.timezone AS user_timezone, u.telegram_user_id AS telegram_id
     FROM source_events se
     LEFT JOIN users u ON u.id = se.user_id
     WHERE se.id = ?`
  )
    .bind(sourceEventId)
    .first<SourceEventForQueue>();
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const msg = error.message.toLowerCase();
  return msg.includes("unique") || msg.includes("constraint");
}
