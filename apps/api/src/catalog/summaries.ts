import type { Summary } from "@doodle/design-doc";

import type { Failure } from "./schema";

type SummaryRow = { updated_at: string; revision: number };

// The write is one conditional upsert so that a concurrent older write cannot replace a newer one.
export async function putSummary(
  db: D1Database,
  documentId: string,
  summary: Summary,
): Promise<Summary> {
  const [, kept] = await db.batch<SummaryRow>([
    db
      .prepare(
        `INSERT INTO document_summaries (document_id, updated_at, revision)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(document_id) DO UPDATE
           SET updated_at = excluded.updated_at, revision = excluded.revision
           WHERE excluded.revision > document_summaries.revision`,
      )
      .bind(documentId, summary.updatedAt, summary.revision),
    db
      .prepare(
        "SELECT updated_at, revision FROM document_summaries WHERE document_id = ?",
      )
      .bind(documentId),
  ]);
  const row = kept!.results[0]!;
  return { updatedAt: row.updated_at, revision: row.revision };
}

export type GetSummaryResult =
  { ok: true; summary: Summary } | Failure<"summary_not_found">;

export async function getSummary(
  db: D1Database,
  documentId: string,
): Promise<GetSummaryResult> {
  const row = await db
    .prepare(
      "SELECT updated_at, revision FROM document_summaries WHERE document_id = ?",
    )
    .bind(documentId)
    .first<SummaryRow>();
  if (row === null) {
    return {
      ok: false,
      code: "summary_not_found",
      message: `Document ${documentId} has no summary.`,
    };
  }
  return {
    ok: true,
    summary: { updatedAt: row.updated_at, revision: row.revision },
  };
}
