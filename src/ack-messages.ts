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
        "Let me check...",
        "Working on it...",
        "Processing...",
        "One moment...",
        "Noted!",
        "Looking into it...",
        "Give me a sec...",
    ],
};

/**
 * Returns a random acknowledgment message appropriate for the input type.
 */
export function getAckMessage(type: MessageType): string {
    const pool = ACK_MESSAGES[type] ?? ACK_MESSAGES.text;
    return pool[Math.floor(Math.random() * pool.length)];
}
