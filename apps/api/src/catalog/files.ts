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
  | Failure<"invalid_name" | "reference_not_found">;

function isValidName(name: string): boolean {
  const length = [...name].length;
  return length >= 1 && length <= FILE_NAME_MAX_LENGTH && name.trim() !== "";
}

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

  // The insert is conditional so that the reference check and the write are one statement.
  const inserted = await db
    .prepare(
      `INSERT INTO files (id, workspace_id, kind, name, created_at, reference_design_system_id, reference_release_id)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
       WHERE ?7 IS NULL OR EXISTS (SELECT 1 FROM releases WHERE id = ?7 AND design_system_id = ?6)`,
    )
    .bind(
      file.id,
      PERSONAL_WORKSPACE_ID,
      file.kind,
      file.name,
      file.createdAt,
      reference?.designSystem ?? null,
      reference?.release ?? null,
    )
    .run();

  if (inserted.meta.changes === 0) {
    return {
      ok: false,
      code: "reference_not_found",
      message: "The release does not exist for that design system.",
    };
  }
  return { ok: true, file };
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
};

function isNewer(a: ReleaseRow, b: ReleaseRow): boolean {
  const diff = Date.parse(a.created_at) - Date.parse(b.created_at);
  return diff !== 0 ? diff > 0 : a.id > b.id;
}

export async function listFiles(db: D1Database): Promise<FileItem[]> {
  const [files, releases] = await db.batch<FileRow | ReleaseRow>([
    db
      .prepare(
        "SELECT id, kind, name, created_at, reference_design_system_id, reference_release_id FROM files WHERE workspace_id = ?",
      )
      .bind(PERSONAL_WORKSPACE_ID),
    db.prepare(
      "SELECT id, design_system_id, created_at, message FROM releases",
    ),
  ]);
  const fileRows = files!.results as FileRow[];
  const releaseRows = releases!.results as ReleaseRow[];

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
      return {
        id: row.id,
        kind: "designSystem",
        name: row.name,
        updatedAt: row.created_at,
        latestRelease: latest
          ? {
              id: latest.id,
              createdAt: latest.created_at,
              message: latest.message,
            }
          : null,
        usedByApps,
        referenced: usedByApps > 0,
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
    return {
      id: row.id,
      kind: "app",
      name: row.name,
      updatedAt: row.created_at,
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
        isNewer(latest, referencedRelease),
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
