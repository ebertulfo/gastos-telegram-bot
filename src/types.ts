export type MessageType = "text" | "photo" | "voice";

export type SourceEventRecord = {
  id: number;
  duplicate: boolean;
  messageType: MessageType;
};

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    chat: {
      id: number;
    };
    from?: {
      id: number;
    };
    photo?: Array<{
      file_id: string;
      file_unique_id: string;
      file_size?: number;
      width: number;
      height: number;
    }>;
    voice?: {
      file_id: string;
      file_unique_id: string;
      duration: number;
      mime_type?: string;
      file_size?: number;
    };
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
    };
    message?: {
      message_id: number;
      chat: {
        id: number;
      };
    };
    data?: string;
  };
};

export type Env = {
  APP_ENV: string;
  TELEGRAM_BOT_TOKEN: string;
  OPENAI_API_KEY?: string;
  OPENAI_TRANSCRIBE_MODEL?: string;
  OPENAI_VISION_MODEL?: string;
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  INGEST_QUEUE: Queue<ParseQueueMessage>;
};

export type ParseQueueMessage = {
  sourceEventId: number;
  userId: number;
  r2ObjectKey: string | null;
};
