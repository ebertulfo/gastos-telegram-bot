import type { Env, TelegramUpdate } from "../types";

type TelegramGetFileResponse = {
  ok: boolean;
  result?: {
    file_path?: string;
  };
};

export function getPrimaryMediaFileId(update: TelegramUpdate): string | null {
  const message = update.message;
  if (!message) {
    return null;
  }

  if (message.voice?.file_id) {
    return message.voice.file_id;
  }

  if (message.photo?.length) {
    return message.photo[message.photo.length - 1]?.file_id ?? null;
  }

  return null;
}

export async function uploadTelegramMediaToR2(
  env: Env,
  update: TelegramUpdate,
  sourceEventId: number
): Promise<string | null> {
  const fileId = getPrimaryMediaFileId(update);
  if (!fileId) {
    return null;
  }

  const filePath = await resolveTelegramFilePath(env, fileId);
  if (!filePath) {
    throw new Error(`Telegram file path not found for file_id: ${fileId}`);
  }

  const downloadUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const fileResponse = await fetch(downloadUrl);
  if (!fileResponse.ok) {
    throw new Error(`Telegram media download failed with status ${fileResponse.status}`);
  }

  const contentType = fileResponse.headers.get("content-type") ?? undefined;
  const body = await fileResponse.arrayBuffer();
  const objectKey = `source-events/${sourceEventId}/${sanitizeFilePath(filePath)}`;

  await env.MEDIA_BUCKET.put(objectKey, body, {
    httpMetadata: contentType ? { contentType } : undefined
  });

  return objectKey;
}

async function resolveTelegramFilePath(env: Env, fileId: string): Promise<string | null> {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Telegram getFile failed with status ${response.status}`);
  }

  const json = (await response.json()) as TelegramGetFileResponse;
  if (!json.ok) {
    throw new Error("Telegram getFile returned ok=false");
  }

  return json.result?.file_path ?? null;
}

function sanitizeFilePath(filePath: string) {
  return filePath.replace(/[^a-zA-Z0-9._/-]/g, "_");
}
