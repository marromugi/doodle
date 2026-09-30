import type { Clock } from "./files";
import type { AddPageInput, CatalogPage, Failure } from "./schema";

export type AddPageResult =
  | { ok: true }
  | Failure<
      "file_not_found" | "not_an_app" | "page_exists" | "document_exists"
    >;

// The page and its skeleton registration are written together. The registration runs
// after the page insert and only when that row exists, so both are written or neither is.
// A batch does not fail on a statement that changes no rows.
export async function addPage(
  db: D1Database,
  input: AddPageInput,
  clock: Clock = () => new Date(),
): Promise<AddPageResult> {
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO pages (id, file_id, name, skeleton_document_id, adopted_proposal_document_id, created_at)
         SELECT ?1, ?2, ?3, ?4, NULL, ?5
         WHERE EXISTS (SELECT 1 FROM files WHERE id = ?2 AND kind = 'app')
           AND NOT EXISTS (SELECT 1 FROM pages WHERE id = ?1)
           AND NOT EXISTS (SELECT 1 FROM documents WHERE id = ?4)`,
      )
      .bind(
        input.id,
        input.file,
        input.name,
        input.skeleton,
        clock().toISOString(),
      ),
    db
      .prepare(
        `INSERT INTO documents (id, file_id, kind, page_id, request_id, release_id)
         SELECT ?1, ?2, 'skeleton', ?3, NULL, ?4
         WHERE EXISTS (SELECT 1 FROM pages WHERE id = ?3 AND skeleton_document_id = ?1)`,
      )
      .bind(input.skeleton, input.file, input.id, input.release),
  ]);
  if (inserted!.meta.changes > 0) return { ok: true };

  const page = await db
    .prepare("SELECT 1 AS found FROM pages WHERE id = ?")
    .bind(input.id)
    .first();
  if (page !== null) {
    return {
      ok: false,
      code: "page_exists",
      message: `Page ${input.id} already exists.`,
    };
  }
  const file = await db
    .prepare("SELECT kind FROM files WHERE id = ?")
    .bind(input.file)
    .first<{ kind: "designSystem" | "app" }>();
  if (file === null) {
    return {
      ok: false,
      code: "file_not_found",
      message: `File ${input.file} does not exist.`,
    };
  }
  if (file.kind !== "app") {
    return {
      ok: false,
      code: "not_an_app",
      message: `File ${input.file} is not an app.`,
    };
  }
  return {
    ok: false,
    code: "document_exists",
    message: `Document ${input.skeleton} is already registered.`,
  };
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
