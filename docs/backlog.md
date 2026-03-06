# Project Backlog & Future Ideas

This document tracks technical debt, future optimizations, and feature ideas that are currently deprioritized but should be considered in later milestones.

## AI & Latency Optimizations
- **Migrate text ingestion to `gemini-1.5-flash`**: Currently, `gpt-4o-mini` handles everything in `src/ai/openai.ts`. While it is fast, Gemini 1.5 Flash is strictly faster (better Time-To-First-Token) for short JSON extraction tasks. To push logging latency to the absolute limit, we should consider swapping the OpenAI Text Completion endpoint for the Gemini API (`@google/genai` or Vertex AI) in the queue worker.

## Feature Ideas
*(Add future product ideas here)*
