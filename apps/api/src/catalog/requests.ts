import type { Clock } from "./files";
import type {
  AddRequestInput,
  CatalogRequest,
  Failure,
  RequestState,
} from "./schema";

type RequestRow = {
  id: string;
  page_id: string;
  snapshot_document_id: string;
  feedback: string;
  previous_request_id: string | null;
  state: RequestState;
  agent_id: string | null;
  delivered: number;
  adopted_proposal_document_id: string | null;
};

const REQUEST_COLUMNS =
  "id, page_id, snapshot_document_id, feedback, previous_request_id, state, agent_id, delivered, adopted_proposal_document_id";

function toRequest(row: RequestRow, references: string[]): CatalogRequest {
  return {
    id: row.id,
    page: row.page_id,
    snapshot: row.snapshot_document_id,
    references,
    feedback: row.feedback,
    previous: row.previous_request_id,
    state: row.state,
    agent: row.agent_id,
    delivered: row.delivered === 1,
    adoptedProposal: row.adopted_proposal_document_id,
  };
}

export type AddRequestResult =
  | { ok: true; request: CatalogRequest }
  | Failure<"previous_not_awaiting_choice" | "write_failed">;

export async function addRequest(
  db: D1Database,
  input: AddRequestInput,
  clock: Clock = () => new Date(),
): Promise<AddRequestResult> {
  const id = `req_${crypto.randomUUID()}`;
  const createdAt = clock().toISOString();

  // The insert and the close of the previous round are statements of one batch,
  // so both are written or neither is. The insert only fires while the previous
  // round awaits a choice, and the close runs after it.
  const statements = [
    db
      .prepare(
        `INSERT INTO requests (${REQUEST_COLUMNS}, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, 'requested', NULL, 0, NULL, ?6
         WHERE ?5 IS NULL
            OR EXISTS (SELECT 1 FROM requests WHERE id = ?5 AND state = 'awaitingChoice')`,
      )
      .bind(
        id,
        input.page,
        input.snapshot,
        input.feedback,
        input.previous,
        createdAt,
      ),
    ...input.references.map((reference, position) =>
      db
        .prepare(
          `INSERT INTO request_references (request_id, proposal_document_id, position)
           SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM requests WHERE id = ?1)`,
        )
        .bind(id, reference, position),
    ),
    db
      .prepare(
        `UPDATE requests SET state = 'completed'
         WHERE id = ?1 AND state = 'awaitingChoice'`,
      )
      .bind(input.previous),
  ];

  let results: D1Result[];
  try {
    results = await db.batch(statements);
  } catch (error) {
    return {
      ok: false,
      code: "write_failed",
      message: `The request could not be written: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (results[0]!.meta.changes === 0) {
    return {
      ok: false,
      code: "previous_not_awaiting_choice",
      message: `Request ${input.previous} is not awaiting a choice.`,
    };
  }
  return {
    ok: true,
    request: {
      id,
      page: input.page,
      snapshot: input.snapshot,
      references: input.references,
      feedback: input.feedback,
      previous: input.previous,
      state: "requested",
      agent: null,
      delivered: false,
      adoptedProposal: null,
    },
  };
}

export async function getRequest(
  db: D1Database,
  id: string,
): Promise<CatalogRequest | null> {
  const row = await db
    .prepare(`SELECT ${REQUEST_COLUMNS} FROM requests WHERE id = ?`)
    .bind(id)
    .first<RequestRow>();
  if (row === null) return null;
  const references = await db
    .prepare(
      "SELECT proposal_document_id FROM request_references WHERE request_id = ? ORDER BY position",
    )
    .bind(id)
    .all<{ proposal_document_id: string }>();
  return toRequest(
    row,
    references.results.map((reference) => reference.proposal_document_id),
  );
}

export async function listRequests(
  db: D1Database,
  state?: RequestState,
): Promise<CatalogRequest[]> {
  const rows = await db
    .prepare(
      `SELECT ${REQUEST_COLUMNS} FROM requests
       WHERE ?1 IS NULL OR state = ?1 ORDER BY created_at, rowid`,
    )
    .bind(state ?? null)
    .all<RequestRow>();
  const references = await db
    .prepare(
      `SELECT r.request_id, r.proposal_document_id FROM request_references r
       JOIN requests q ON q.id = r.request_id
       WHERE ?1 IS NULL OR q.state = ?1 ORDER BY r.position`,
    )
    .bind(state ?? null)
    .all<{ request_id: string; proposal_document_id: string }>();

  const byRequest = new Map<string, string[]>();
  for (const reference of references.results) {
    const list = byRequest.get(reference.request_id) ?? [];
    list.push(reference.proposal_document_id);
    byRequest.set(reference.request_id, list);
  }
  return rows.results.map((row) => toRequest(row, byRequest.get(row.id) ?? []));
}
