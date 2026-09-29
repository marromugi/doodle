import type { Failure } from "./schema";

export type GetReleaseContentResult =
  { ok: true; content: string } | Failure<"release_not_found">;

export async function getReleaseContent(
  db: D1Database,
  releaseId: string,
): Promise<GetReleaseContentResult> {
  const row = await db
    .prepare("SELECT content FROM releases WHERE id = ?")
    .bind(releaseId)
    .first<{ content: string }>();
  if (row === null) {
    return {
      ok: false,
      code: "release_not_found",
      message: `Release ${releaseId} does not exist.`,
    };
  }
  return { ok: true, content: row.content };
}
