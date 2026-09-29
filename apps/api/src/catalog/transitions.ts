import { getRequest } from "./requests";
import type { CatalogRequest, RequestState } from "./schema";

export type TransitionFailure = {
  ok: false;
  code:
    | "not_found"
    | "already_taken"
    | "taken_by_another_agent"
    | "request_aborted"
    | "request_finished"
    | "not_taken"
    | "invalid_state"
    | "proposal_not_in_request";
  message: string;
  state?: RequestState;
};

export type TransitionResult =
  { ok: true; request: CatalogRequest } | TransitionFailure;

function notFound(id: string): TransitionFailure {
  return {
    ok: false,
    code: "not_found",
    message: `Request ${id} does not exist.`,
  };
}

function invalidState(
  request: CatalogRequest,
  attempted: string,
): TransitionFailure {
  return {
    ok: false,
    code: "invalid_state",
    state: request.state,
    message: `Cannot ${attempted} a request that is ${request.state}.`,
  };
}

// Each transition is one conditional UPDATE; when it changes no row, the
// request is read again to say why.
async function transition(
  db: D1Database,
  id: string,
  update: D1PreparedStatement,
  whenRefused: (request: CatalogRequest) => TransitionResult,
): Promise<TransitionResult> {
  const updated = await update.run();
  const request = await getRequest(db, id);
  if (request === null) return notFound(id);
  return updated.meta.changes > 0
    ? { ok: true, request }
    : whenRefused(request);
}

export function takeRequest(
  db: D1Database,
  id: string,
  agent: string,
): Promise<TransitionResult> {
  return transition(
    db,
    id,
    db
      .prepare(
        `UPDATE requests SET state = 'inProgress', agent_id = ?2
         WHERE id = ?1 AND state = 'requested'`,
      )
      .bind(id, agent),
    (request) => {
      if (request.state !== "inProgress") return invalidState(request, "take");
      if (request.agent === agent) return { ok: true, request };
      return {
        ok: false,
        code: "already_taken",
        message: `Request ${id} is already taken by another agent.`,
      };
    },
  );
}

export function markDelivered(
  db: D1Database,
  id: string,
): Promise<TransitionResult> {
  return transition(
    db,
    id,
    db
      .prepare(
        "UPDATE requests SET delivered = 1 WHERE id = ?1 AND state = 'requested'",
      )
      .bind(id),
    (request) => invalidState(request, "mark as delivered"),
  );
}

export function completeRequest(
  db: D1Database,
  id: string,
  agent: string,
): Promise<TransitionResult> {
  return transition(
    db,
    id,
    db
      .prepare(
        `UPDATE requests SET state = 'awaitingChoice'
         WHERE id = ?1 AND state = 'inProgress' AND agent_id = ?2`,
      )
      .bind(id, agent),
    (request): TransitionFailure => {
      switch (request.state) {
        case "inProgress":
          return {
            ok: false,
            code: "taken_by_another_agent",
            message: `Request ${id} is held by another agent.`,
          };
        case "aborted":
          return {
            ok: false,
            code: "request_aborted",
            message: `Request ${id} was aborted.`,
          };
        case "awaitingChoice":
        case "completed":
          return {
            ok: false,
            code: "request_finished",
            message: `Request ${id} is already finished.`,
          };
        case "requested":
          return {
            ok: false,
            code: "not_taken",
            message: `Request ${id} has not been taken.`,
          };
      }
    },
  );
}

export function retryRequest(
  db: D1Database,
  id: string,
): Promise<TransitionResult> {
  return transition(
    db,
    id,
    db
      .prepare(
        `UPDATE requests SET state = 'requested', agent_id = NULL, delivered = 0
         WHERE id = ?1 AND state = 'aborted'`,
      )
      .bind(id),
    (request) => invalidState(request, "request again"),
  );
}

export async function adoptProposal(
  db: D1Database,
  id: string,
  proposal: string,
): Promise<TransitionResult> {
  // Both statements test the same condition against rows neither of them
  // changes, so they apply together or not at all.
  const condition = `EXISTS (SELECT 1 FROM requests WHERE id = ?1 AND state = 'awaitingChoice')
      AND EXISTS (SELECT 1 FROM documents WHERE id = ?2 AND kind = 'proposal' AND request_id = ?1)`;
  const [, updated] = await db.batch([
    db
      .prepare(
        `UPDATE pages SET adopted_proposal_document_id = ?2
         WHERE id = (SELECT page_id FROM requests WHERE id = ?1) AND ${condition}`,
      )
      .bind(id, proposal),
    db
      .prepare(
        `UPDATE requests SET state = 'completed', adopted_proposal_document_id = ?2
         WHERE id = ?1 AND ${condition}`,
      )
      .bind(id, proposal),
  ]);
  const request = await getRequest(db, id);
  if (request === null) return notFound(id);
  if (updated!.meta.changes > 0) return { ok: true, request };
  if (request.state !== "awaitingChoice") return invalidState(request, "adopt");
  return {
    ok: false,
    code: "proposal_not_in_request",
    message: `Document ${proposal} is not a proposal of request ${id}.`,
  };
}

export async function abortAgentRequests(
  db: D1Database,
  agent: string,
): Promise<string[]> {
  const aborted = await db
    .prepare(
      `UPDATE requests SET state = 'aborted'
       WHERE agent_id = ?1 AND state = 'inProgress'
       RETURNING id, created_at, rowid AS position`,
    )
    .bind(agent)
    .all<{ id: string; created_at: string; position: number }>();
  return aborted.results
    .sort((a, b) =>
      a.created_at === b.created_at
        ? a.position - b.position
        : a.created_at < b.created_at
          ? -1
          : 1,
    )
    .map((row) => row.id);
}
