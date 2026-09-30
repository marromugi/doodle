import type {
  AddedFile,
  AddFileInput,
  Failure,
  FileItem,
  ReleaseReference,
} from "./schema";
import {
  FILE_NAME_MAX_LENGTH,
  PERSONAL_WORKSPACE_ID,
  RECENT_FILES_LIMIT,
} from "./settings";

export type Clock = () => Date;

export type AddFileResult =
  | { ok: true; file: AddedFile }
  | Failure<"invalid_name" | "reference_not_found" | "document_exists">;

/** The rule for the name of a file or a page: 1 to 50 code points, not only whitespace. */
export function isValidName(name: string): boolean {
  const length = [...name].length;
  return length >= 1 && length <= FILE_NAME_MAX_LENGTH && name.trim() !== "";
}

// A design system file is written together with the registration of its draft document.
export async function addFile(
  db: D1Database,
  input: AddFileInput,
  clock: Clock = () => new Date(),
): Promise<AddFileResult> {
  if (!isValidName(input.name)) {
    return {
      ok: false,
      code: "invalid_name",
      message: `The name must be 1 to ${FILE_NAME_MAX_LENGTH} characters and not only whitespace.`,
    };
  }

  const file: AddedFile = {
    id: `file_${crypto.randomUUID()}`,
    kind: input.kind,
    name: input.name,
    createdAt: clock().toISOString(),
  };
  const reference: ReleaseReference | null =
    input.kind === "app" ? input.reference : null;
  const draft = input.kind === "designSystem" ? input.draft : null;

  // The draft registration runs after the file insert and only when that row exists,
  // so both are written or neither is. A batch does not fail on a statement that changes no rows.
  const statements = [
    db
      .prepare(
        `INSERT INTO files (id, workspace_id, kind, name, created_at, reference_design_system_id, reference_release_id)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
         WHERE (?7 IS NULL OR EXISTS (SELECT 1 FROM releases WHERE id = ?7 AND design_system_id = ?6))
           AND (?8 IS NULL OR NOT EXISTS (SELECT 1 FROM documents WHERE id = ?8))`,
      )
      .bind(
        file.id,
        PERSONAL_WORKSPACE_ID,
        file.kind,
        file.name,
        file.createdAt,
        reference?.designSystem ?? null,
        reference?.release ?? null,
        draft,
      ),
  ];
  if (draft !== null) {
    statements.push(
      db
        .prepare(
          `INSERT INTO documents (id, file_id, kind, page_id, request_id, release_id)
           SELECT ?1, ?2, 'dsDraft', NULL, NULL, NULL
           WHERE EXISTS (SELECT 1 FROM files WHERE id = ?2)`,
        )
        .bind(draft, file.id),
    );
  }
  const results = await db.batch(statements);

  if (results[0]!.meta.changes === 0) {
    // A design system file has no reference, so the draft ID is the only thing that can refuse it.
    if (draft !== null) {
      return {
        ok: false,
        code: "document_exists",
        message: `Document ${draft} is already registered.`,
      };
    }
    return {
      ok: false,
      code: "reference_not_found",
      message: "The release does not exist for that design system.",
    };
  }
  return { ok: true, file };
}

export type GetAppResult =
  | {
      ok: true;
      kind: "designSystem" | "app";
      reference: ReleaseReference | null;
    }
  | Failure<"file_not_found">;

/** The file's kind and the release it references now. */
export async function getApp(
  db: D1Database,
  id: string,
): Promise<GetAppResult> {
  const row = await db
    .prepare(
      "SELECT kind, reference_design_system_id, reference_release_id FROM files WHERE id = ?",
    )
    .bind(id)
    .first<{
      kind: "designSystem" | "app";
      reference_design_system_id: string | null;
      reference_release_id: string | null;
    }>();
  if (row === null) {
    return {
      ok: false,
      code: "file_not_found",
      message: `File ${id} does not exist.`,
    };
  }
  return {
    ok: true,
    kind: row.kind,
    reference:
      row.reference_design_system_id !== null &&
      row.reference_release_id !== null
        ? {
            designSystem: row.reference_design_system_id,
            release: row.reference_release_id,
          }
        : null,
  };
}

type FileRow = {
  id: string;
  kind: "designSystem" | "app";
  name: string;
  created_at: string;
  reference_design_system_id: string | null;
  reference_release_id: string | null;
};

type ReleaseRow = {
  id: string;
  design_system_id: string;
  created_at: string;
  message: string | null;
  draft_revision: number;
};

type DocumentSummaryRow = {
  file_id: string;
  kind: string;
  updated_at: string;
  revision: number;
};

type PageRow = {
  file_id: string;
  skeleton_document_id: string;
  adopted_proposal_document_id: string | null;
};

type InProgressRow = { file_id: string; count: number };

function isNewer(a: ReleaseRow, b: ReleaseRow): boolean {
  const diff = Date.parse(a.created_at) - Date.parse(b.created_at);
  return diff !== 0 ? diff > 0 : a.id > b.id;
}

export async function listFiles(db: D1Database): Promise<FileItem[]> {
  const [files, releases, summaries, pages, inProgress] = await db.batch<
    FileRow | ReleaseRow | DocumentSummaryRow | PageRow | InProgressRow
  >([
    db
      .prepare(
        "SELECT id, kind, name, created_at, reference_design_system_id, reference_release_id FROM files WHERE workspace_id = ?",
      )
      .bind(PERSONAL_WORKSPACE_ID),
    db.prepare(
      "SELECT id, design_system_id, created_at, message, draft_revision FROM releases",
    ),
    db.prepare(
      `SELECT d.file_id, d.kind, s.updated_at, s.revision
       FROM documents d JOIN document_summaries s ON s.document_id = d.id`,
    ),
    db.prepare(
      `SELECT file_id, skeleton_document_id, adopted_proposal_document_id
       FROM pages ORDER BY created_at, rowid`,
    ),
    db.prepare(
      `SELECT p.file_id, COUNT(*) AS count
       FROM requests r JOIN pages p ON p.id = r.page_id
       WHERE r.state = 'inProgress' GROUP BY p.file_id`,
    ),
  ]);
  const fileRows = files!.results as FileRow[];
  const releaseRows = releases!.results as ReleaseRow[];
  const summaryRows = summaries!.results as DocumentSummaryRow[];
  const pageRows = pages!.results as PageRow[];
  const inProgressRows = inProgress!.results as InProgressRow[];

  const pageCounts = new Map<string, number>();
  const firstPages = new Map<string, PageRow>();
  for (const page of pageRows) {
    pageCounts.set(page.file_id, (pageCounts.get(page.file_id) ?? 0) + 1);
    if (!firstPages.has(page.file_id)) firstPages.set(page.file_id, page);
  }
  const inProgressCounts = new Map(
    inProgressRows.map((row) => [row.file_id, row.count]),
  );

  const summaryUpdatedAt = new Map<string, string>();
  const draftRevisions = new Map<string, number>();
  for (const summary of summaryRows) {
    const latest = summaryUpdatedAt.get(summary.file_id);
    if (
      latest === undefined ||
      Date.parse(summary.updated_at) > Date.parse(latest)
    ) {
      summaryUpdatedAt.set(summary.file_id, summary.updated_at);
    }
    if (summary.kind === "dsDraft") {
      draftRevisions.set(summary.file_id, summary.revision);
    }
  }

  const releaseById = new Map(releaseRows.map((row) => [row.id, row]));
  const latestByDesignSystem = new Map<string, ReleaseRow>();
  for (const release of releaseRows) {
    const latest = latestByDesignSystem.get(release.design_system_id);
    if (latest === undefined || isNewer(release, latest)) {
      latestByDesignSystem.set(release.design_system_id, release);
    }
  }
  const appsByDesignSystem = new Map<string, number>();
  for (const row of fileRows) {
    if (row.kind === "app" && row.reference_design_system_id !== null) {
      const count = appsByDesignSystem.get(row.reference_design_system_id) ?? 0;
      appsByDesignSystem.set(row.reference_design_system_id, count + 1);
    }
  }

  return fileRows.map((row): FileItem => {
    if (row.kind === "designSystem") {
      const latest = latestByDesignSystem.get(row.id);
      const usedByApps = appsByDesignSystem.get(row.id) ?? 0;
      const draftRevision = draftRevisions.get(row.id) ?? 0;
      return {
        id: row.id,
        kind: "designSystem",
        name: row.name,
        updatedAt: summaryUpdatedAt.get(row.id) ?? row.created_at,
        latestRelease: latest
          ? {
              id: latest.id,
              createdAt: latest.created_at,
              message: latest.message,
            }
          : null,
        usedByApps,
        referenced: usedByApps > 0,
        hasUnreleasedChanges:
          latest === undefined
            ? draftRevision >= 1
            : draftRevision > latest.draft_revision,
      };
    }
    const referencedRelease =
      row.reference_release_id === null
        ? undefined
        : releaseById.get(row.reference_release_id);
    const latest =
      row.reference_design_system_id === null
        ? undefined
        : latestByDesignSystem.get(row.reference_design_system_id);
    const firstPage = firstPages.get(row.id);
    return {
      id: row.id,
      kind: "app",
      name: row.name,
      updatedAt: summaryUpdatedAt.get(row.id) ?? row.created_at,
      reference:
        row.reference_design_system_id !== null &&
        row.reference_release_id !== null
          ? {
              designSystem: row.reference_design_system_id,
              release: row.reference_release_id,
            }
          : null,
      hasNewerRelease:
        referencedRelease !== undefined &&
        latest !== undefined &&
        Date.parse(latest.created_at) >
          Date.parse(referencedRelease.created_at),
      inProgressRequests: inProgressCounts.get(row.id) ?? 0,
      pageCount: pageCounts.get(row.id) ?? 0,
      thumbnailDocument:
        firstPage === undefined
          ? null
          : (firstPage.adopted_proposal_document_id ??
            firstPage.skeleton_document_id),
    };
  });
}

export async function listRecentFiles(db: D1Database): Promise<FileItem[]> {
  const items = await listFiles(db);
  return items
    .sort((a, b) => {
      const diff = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      return diff !== 0 ? diff : a.id < b.id ? -1 : 1;
    })
    .slice(0, RECENT_FILES_LIMIT);
}
