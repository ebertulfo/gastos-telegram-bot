# Project Backlog & Future Ideas

This document tracks technical debt, future optimizations, and feature ideas that are currently deprioritized but should be considered in later milestones.

## AI & Latency Optimizations
- **Migrate text ingestion to `gemini-1.5-flash`**: Currently, `gpt-4o-mini` handles everything in `src/ai/openai.ts`. While it is fast, Gemini 1.5 Flash is strictly faster (better Time-To-First-Token) for short JSON extraction tasks. To push logging latency to the absolute limit, we should consider swapping the OpenAI Text Completion endpoint for the Gemini API (`@google/genai` or Vertex AI) in the queue worker.

## Feature Ideas
- /bug command to report bugs to us. Must allow screenshot, voice message, text
- /feedback command to give feedback to us. Must allow screenshot, voice message, text
- /suggestion command to give suggestions to us. Must allow screenshot, voice message, text
- A breakdown tool for the AI Agent so we can breakdown expenses like a 120 dollar dinner expense, I only spent half of that. or photo of a receipt, mine is only the fllowing line items. Something like that. Also be able to split the line items to other people by the means of making a profile for them within the user's context of course. For example, a photo of receipt. Mine is only the following line items. The rest are for another person, Jen. Or mine is only this line item, line items x and y are for Jen, line items a, b, and c is Jia Liang's


