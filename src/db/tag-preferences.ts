/**
 * User tag preferences — seeded during onboarding, used for tag suggestions.
 * Tags stored here represent user's preferred/expected tags.
 */

export async function insertTagPreferences(
  db: D1Database,
  userId: number,
  tags: string[],
  source: "onboarding" | "manual" = "onboarding"
): Promise<void> {
  if (tags.length === 0) return;

  const stmt = db.prepare(
    `INSERT INTO user_tag_preferences (user_id, tag, source)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, tag) DO NOTHING`
  );

  await db.batch(
    tags.map(tag => stmt.bind(userId, tag.toLowerCase(), source))
  );
}

export async function getTagPreferences(
  db: D1Database,
  userId: number
): Promise<string[]> {
  const { results } = await db.prepare(
    `SELECT tag FROM user_tag_preferences WHERE user_id = ? ORDER BY created_at_utc`
  )
    .bind(userId)
    .all<{ tag: string }>();

  return (results ?? []).map(r => r.tag);
}

export async function deleteTagPreference(
  db: D1Database,
  userId: number,
  tag: string
): Promise<void> {
  await db.prepare(
    `DELETE FROM user_tag_preferences WHERE user_id = ? AND tag = ?`
  )
    .bind(userId, tag.toLowerCase())
    .run();
}
