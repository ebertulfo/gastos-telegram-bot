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

export async function setSourceEventR2ObjectKey(env: Env, sourceEventId: number, r2ObjectKey: string) {
  await env.DB.prepare(
    `UPDATE source_events
     SET r2_object_key = ?
     WHERE id = ?`
  )
    .bind(r2ObjectKey, sourceEventId)
    .run();
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const msg = error.message.toLowerCase();
  return msg.includes("unique") || msg.includes("constraint");
}
