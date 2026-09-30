import type {
  AddProposalInput,
  DocumentEntry,
  Failure,
  RequestState,
} from "./schema";

export type RegisterProposalResult =
  | { ok: true }
  | Failure<
      | "request_not_found"
      | "page_not_found"
      | "file_not_found"
      | "document_exists"
    >
  | {
      ok: false;
      code: "request_state_mismatch";
      message: string;
      state: RequestState;
      agent: string | null;
    };

// A proposal is registered only while its request is in progress and held by the agent.
export async function registerProposal(
  db: D1Database,
  input: AddProposalInput,
): Promise<RegisterProposalResult> {
  const inserted = await db
    .prepare(
      `INSERT INTO documents (id, file_id, kind, page_id, request_id, release_id)
       SELECT ?1, ?2, 'proposal', r.page_id, r.id, ?5
       FROM requests r
       WHERE r.id = ?3 AND r.state = 'inProgress' AND r.agent_id = ?4
         AND EXISTS (SELECT 1 FROM pages WHERE id = r.page_id)
         AND EXISTS (SELECT 1 FROM files WHERE id = ?2)
         AND NOT EXISTS (SELECT 1 FROM documents WHERE id = ?1)`,
    )
    .bind(input.id, input.file, input.request, input.agent, input.release)
    .run();
  if (inserted.meta.changes > 0) return { ok: true };

  const [requestRows, fileRows] = await db.batch<{
    state?: RequestState;
    agent_id?: string | null;
    page_found?: number | null;
    found?: number;
  }>([
    db
      .prepare(
        `SELECT state, agent_id, (SELECT 1 FROM pages WHERE id = r.page_id) AS page_found
         FROM requests r WHERE id = ?`,
      )
      .bind(input.request),
    db.prepare("SELECT 1 AS found FROM files WHERE id = ?").bind(input.file),
  ]);
  const request = requestRows!.results[0];
  if (request === undefined) {
    return {
      ok: false,
      code: "request_not_found",
      message: `Request ${input.request} does not exist.`,
    };
  }
  if (request.page_found === null) {
    return {
      ok: false,
      code: "page_not_found",
      message: `The page of request ${input.request} does not exist.`,
    };
  }
  if (fileRows!.results[0] === undefined) {
    return {
      ok: false,
      code: "file_not_found",
      message: `File ${input.file} does not exist.`,
    };
  }
  if (request.state !== "inProgress" || request.agent_id !== input.agent) {
    return {
      ok: false,
      code: "request_state_mismatch",
      message: `Request ${input.request} is ${request.state}.`,
      state: request.state!,
      agent: request.agent_id ?? null,
    };
  }
  return {
    ok: false,
    code: "document_exists",
    message: `Document ${input.id} is already registered.`,
  };
}

export type RegisterDocumentResult =
  { ok: true } | Failure<"document_exists" | "file_not_found">;

export async function registerDocument(
  db: D1Database,
  entry: DocumentEntry,
): Promise<RegisterDocumentResult> {
  const page = "page" in entry ? entry.page : null;
  const request = "request" in entry ? entry.request : null;

  // The insert is conditional so that the checks and the write are one statement.
  const inserted = await db
    .prepare(
      `INSERT INTO documents (id, file_id, kind, page_id, request_id, release_id)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE EXISTS (SELECT 1 FROM files WHERE id = ?2)
         AND NOT EXISTS (SELECT 1 FROM documents WHERE id = ?1)`,
    )
    .bind(entry.id, entry.file, entry.kind, page, request, entry.release)
    .run();
  if (inserted.meta.changes > 0) return { ok: true };

  const existing = await db
    .prepare("SELECT 1 AS found FROM documents WHERE id = ?")
    .bind(entry.id)
    .first();
  if (existing !== null) {
    return {
      ok: false,
      code: "document_exists",
      message: `Document ${entry.id} is already registered.`,
    };
  }
  return {
    ok: false,
    code: "file_not_found",
    message: `File ${entry.file} does not exist.`,
  };
}

type DocumentRow = {
  id: string;
  file_id: string;
  kind: DocumentEntry["kind"];
  page_id: string | null;
  request_id: string | null;
  release_id: string | null;
};

export type GetDocumentResult =
  { ok: true; entry: DocumentEntry } | Failure<"document_not_found">;

export async function getDocument(
  db: D1Database,
  id: string,
): Promise<GetDocumentResult> {
  const row = await db
    .prepare(
      "SELECT id, file_id, kind, page_id, request_id, release_id FROM documents WHERE id = ?",
    )
    .bind(id)
    .first<DocumentRow>();
  if (row === null) {
    return {
      ok: false,
      code: "document_not_found",
      message: `Document ${id} is not registered.`,
    };
  }

  const base = { id: row.id, file: row.file_id };
  switch (row.kind) {
    case "skeleton":
      return {
        ok: true,
        entry: {
          ...base,
          kind: "skeleton",
          page: row.page_id!,
          release: row.release_id,
        },
      };
    case "proposal":
    case "snapshot":
      return {
        ok: true,
        entry: {
          ...base,
          kind: row.kind,
          page: row.page_id!,
          request: row.request_id!,
          release: row.release_id,
        },
      };
    case "dsDraft":
      return { ok: true, entry: { ...base, kind: "dsDraft", release: null } };
  }
}

export type IsDocumentFileDeletedResult =
  { ok: true; deleted: boolean } | Failure<"document_not_found">;

// A registered document's file is not deleted (#1, 「文書セッションが使う目録の口の実物」).
export async function isDocumentFileDeleted(
  db: D1Database,
  id: string,
): Promise<IsDocumentFileDeletedResult> {
  const document = await getDocument(db, id);
  if (!document.ok) return document;
  return { ok: true, deleted: false };
}
