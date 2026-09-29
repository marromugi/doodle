import type { Clock } from "./files";
import type { AddPageInput, CatalogPage, Failure } from "./schema";

export type AddPageResult =
  { ok: true } | Failure<"file_not_found" | "page_exists">;

export async function addPage(
  db: D1Database,
  input: AddPageInput,
  clock: Clock = () => new Date(),
): Promise<AddPageResult> {
  // The insert is conditional so that the app check and the write are one statement.
  const inserted = await db
    .prepare(
      `INSERT INTO pages (id, file_id, name, skeleton_document_id, adopted_proposal_document_id, created_at)
       SELECT ?1, ?2, ?3, ?4, NULL, ?5
       WHERE EXISTS (SELECT 1 FROM files WHERE id = ?2 AND kind = 'app')
         AND NOT EXISTS (SELECT 1 FROM pages WHERE id = ?1)`,
    )
    .bind(
      input.id,
      input.file,
      input.name,
      input.skeleton,
      clock().toISOString(),
    )
    .run();
  if (inserted.meta.changes === 0) {
    const existing = await db
      .prepare("SELECT 1 AS found FROM pages WHERE id = ?")
      .bind(input.id)
      .first();
    if (existing !== null) {
      return {
        ok: false,
        code: "page_exists",
        message: `Page ${input.id} already exists.`,
      };
    }
    return {
      ok: false,
      code: "file_not_found",
      message: `App ${input.file} does not exist.`,
    };
  }
  return { ok: true };
}

type PageRow = {
  id: string;
  file_id: string;
  name: string;
  skeleton_document_id: string;
  adopted_proposal_document_id: string | null;
};

const PAGE_COLUMNS =
  "id, file_id, name, skeleton_document_id, adopted_proposal_document_id";

function toPage(row: PageRow): CatalogPage {
  return {
    id: row.id,
    file: row.file_id,
    name: row.name,
    skeleton: row.skeleton_document_id,
    adoptedProposal: row.adopted_proposal_document_id,
  };
}

export async function getPage(
  db: D1Database,
  id: string,
): Promise<CatalogPage | null> {
  const row = await db
    .prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE id = ?`)
    .bind(id)
    .first<PageRow>();
  return row === null ? null : toPage(row);
}

export async function listPages(
  db: D1Database,
  file: string,
): Promise<CatalogPage[] | null> {
  const found = await db
    .prepare("SELECT 1 AS found FROM files WHERE id = ?")
    .bind(file)
    .first();
  if (found === null) return null;
  const rows = await db
    .prepare(
      `SELECT ${PAGE_COLUMNS} FROM pages WHERE file_id = ? ORDER BY created_at, rowid`,
    )
    .bind(file)
    .all<PageRow>();
  return rows.results.map(toPage);
}
