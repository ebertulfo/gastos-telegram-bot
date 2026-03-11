/**
 * Contextual acknowledgment messages sent immediately when the bot receives a message,
 * before the heavy AI processing begins in the queue. Reduces perceived latency.
 */

import type { MessageType } from "./types";

const ACK_MESSAGES: Record<MessageType, string[]> = {
    photo: [
        "Got your receipt. Processing...",
        "Receipt received! Looking at it now.",
        "Got it. Let me check this receipt.",
        "Photo received. Reading it now...",
        "Checking your receipt...",
        "One sec, reading this...",
        "On it! Scanning your receipt.",
        "Got your photo. Give me a moment.",
        "Let me take a look at this.",
        "Receipt spotted! Processing now.",
    ],
    voice: [
        "Got your voice message. Transcribing...",
        "Listening now...",
        "Voice received! One moment.",
        "Got it. Let me hear what you said.",
        "Processing your voice message...",
        "One sec, listening...",
        "Voice message received. On it!",
        "Heard you! Processing now.",
        "Let me listen to this...",
        "Got your audio. Transcribing now.",
    ],
    text: [
        "On it!",
        "Got it.",
        "One sec...",
        "Working on it...",
        "One moment...",
        "Noted!",
        "Give me a sec...",
    ],
};

const QUESTION_ACK_MESSAGES = [
    "Let me check...",
    "Looking into it...",
    "One sec, let me pull that up...",
    "Checking now...",
    "Let me look that up...",
    "Give me a moment...",
    "On it, one sec...",
    "Let me see...",
    "Pulling up your data...",
    "Hmm, let me check...",
];

const QUESTION_PATTERN = /^(how|what|when|where|which|who|why|did|is|are|was|were|do|does|can|will|show|list|tell|give|compare|any)\b/i;

/**
 * Detects whether a text message is likely a question/query rather than an expense log.
 */
export function looksLikeQuestion(text: string): boolean {
    return text.includes("?") || QUESTION_PATTERN.test(text.trim());
}

function pickRandom(pool: string[]): string {
    return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Returns a random acknowledgment message appropriate for the input type.
 * For text messages, uses question-specific acks if the text looks like a query.
 */
export function getAckMessage(type: MessageType, text?: string): string {
    if (type === "text" && text && looksLikeQuestion(text)) {
        return pickRandom(QUESTION_ACK_MESSAGES);
    }

    const pool = ACK_MESSAGES[type] ?? ACK_MESSAGES.text;
    return pickRandom(pool);
}
