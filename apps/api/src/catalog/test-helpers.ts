/** Stores a release row for tests. */
export async function putRelease(
  db: D1Database,
  id: string,
  designSystem: string,
  content: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO releases (id, design_system_id, created_at, message, draft_revision, content)
       VALUES (?, ?, ?, NULL, 0, ?)`,
    )
    .bind(id, designSystem, "2026-01-01T00:00:00.000Z", content)
    .run();
}
