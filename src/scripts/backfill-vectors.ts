/**
 * One-shot backfill script: embed all existing expenses into Vectorize.
 * Run with: npx wrangler dev --test-scheduled
 * Or deploy and hit: POST /api/admin/backfill-vectors
 */
import type { Env } from "../types";
import { generateEmbedding } from "../ai/openai";

export async function backfillVectorize(env: Env): Promise<{ total: number; embedded: number; errors: number }> {
    // Fetch all expenses with text_raw
    const { results } = await env.DB.prepare(
        `SELECT e.source_event_id, e.user_id, e.description, e.tags, e.currency, se.text_raw
         FROM expenses e
         JOIN source_events se ON e.source_event_id = se.id
         WHERE se.text_raw IS NOT NULL AND se.text_raw != ''
         ORDER BY e.id DESC
         LIMIT 200`
    ).all<{ source_event_id: number; user_id: number; description: string | null; tags: string; currency: string; text_raw: string }>();

    const expenses = results ?? [];
    let embedded = 0;
    let errors = 0;

    // Process in batches of 10 to avoid rate limits
    for (let i = 0; i < expenses.length; i += 10) {
        const batch = expenses.slice(i, i + 10);

        const vectors: { id: string; values: number[]; metadata: Record<string, any> }[] = [];

        for (const exp of batch) {
            try {
                const embedding = await generateEmbedding(env, exp.text_raw);
                if (embedding.length > 0) {
                    vectors.push({
                        id: `expense_${exp.source_event_id}`,
                        values: embedding,
                        metadata: {
                            user_id: exp.user_id,
                            expense_id: exp.source_event_id,
                            tags: exp.tags ?? "[]",
                            currency: exp.currency ?? "",
                            raw_text: exp.text_raw
                        }
                    });
                    embedded++;
                }
            } catch (err) {
                console.error(`Failed to embed expense ${exp.source_event_id}:`, err);
                errors++;
            }
        }

        if (vectors.length > 0) {
            await env.VECTORIZE.upsert(vectors);
        }
    }

    return { total: expenses.length, embedded, errors };
}
