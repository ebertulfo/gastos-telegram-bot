export async function insertParseResult(
  db: D1Database,
  sourceEventId: number,
  parserVersion: string,
  parsedJson: Record<string, unknown>,
  confidence: number,
  needsReview: boolean
): Promise<void> {
  await db.prepare(
    `INSERT INTO parse_results (
       source_event_id, parser_version, parsed_json,
       confidence, needs_review, created_at_utc
     ) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sourceEventId,
      parserVersion,
      JSON.stringify(parsedJson),
      confidence,
      needsReview ? 1 : 0,
      new Date().toISOString()
    )
    .run();
}
