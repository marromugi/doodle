import type { Failure, RequestState } from "../catalog/schema";
import { emptyTree } from "./empty-documents";
import type { FileProcedurePorts } from "./ports";
import {
  catalogUnavailable,
  eraseDocument,
  initializeDocument,
  newDocumentId,
  registrationFailed,
} from "./steps";

type Refusal = Failure<
  | "request_aborted"
  | "taken_by_another_agent"
  | "request_finished"
  | "request_not_taken"
>;

export type CreateCandidateResult =
  | { ok: true; candidateDocumentId: string }
  | Refusal
  | Failure<
      | "file_not_found"
      | "request_not_found"
      | "registration_failed"
      | "initialization_failed"
      | "catalog_inconsistent"
      | "catalog_unavailable"
      | "session_unavailable"
    >;

const refuse = (code: Refusal["code"], message: string): Refusal => ({
  ok: false,
  code,
  message,
});

// The refusal for a request that is not in progress with this agent, or null when it is.
function refusalFor(
  state: RequestState,
  holder: string | null,
  agentId: string,
): Refusal | null {
  switch (state) {
    case "aborted":
      return refuse("request_aborted", "The request was aborted.");
    case "awaitingChoice":
    case "completed":
      return refuse("request_finished", "The request is finished.");
    case "requested":
      return refuse("request_not_taken", "The request has not been taken.");
    case "inProgress":
      return holder === agentId
        ? null
        : refuse(
            "taken_by_another_agent",
            "Another agent has taken the request.",
          );
  }
}

const requestNotFound = (requestId: string): Failure<"request_not_found"> => ({
  ok: false,
  code: "request_not_found",
  message: `Request ${requestId} does not exist.`,
});

const pageNotFound = (requestId: string): Failure<"catalog_inconsistent"> => ({
  ok: false,
  code: "catalog_inconsistent",
  message: `The page of request ${requestId} is not in the catalog.`,
});

const fileNotFound = (): Failure<"file_not_found"> => ({
  ok: false,
  code: "file_not_found",
  message: "The file of the request's page does not exist.",
});

/** Creates an empty proposal document for a request, for the agent that holds the request. */
export async function createCandidate(
  ports: FileProcedurePorts,
  input: { requestId: string; agentId: string },
): Promise<CreateCandidateResult> {
  const request = await ports.catalog.readRequest(input.requestId);
  switch (request.status) {
    case "request_not_found":
      return requestNotFound(input.requestId);
    case "page_not_found":
      return pageNotFound(input.requestId);
    case "file_not_found":
      return fileNotFound();
    case "unreachable":
      return catalogUnavailable();
    case "found":
      break;
  }
  const refusal = refusalFor(request.state, request.agent, input.agentId);
  if (refusal !== null) return refusal;

  const candidateDocumentId = newDocumentId();
  const initialized = await initializeDocument(
    ports,
    candidateDocumentId,
    emptyTree(request.reference),
  );
  if (initialized !== null) return initialized;

  const written = await ports.catalog.registerProposal({
    documentId: candidateDocumentId,
    fileId: request.file,
    requestId: input.requestId,
    agentId: input.agentId,
    release: request.reference?.release ?? null,
  });
  switch (written.status) {
    case "written":
      return { ok: true, candidateDocumentId };
    case "unreachable":
      return catalogUnavailable();
    case "request_not_found":
      await eraseDocument(ports, candidateDocumentId);
      return requestNotFound(input.requestId);
    case "page_not_found":
      await eraseDocument(ports, candidateDocumentId);
      return pageNotFound(input.requestId);
    case "file_not_found":
      await eraseDocument(ports, candidateDocumentId);
      return fileNotFound();
    case "state_mismatch":
      await eraseDocument(ports, candidateDocumentId);
      return (
        refusalFor(written.state, written.agent, input.agentId) ??
        registrationFailed("The proposal")
      );
    case "id_in_use":
      await eraseDocument(ports, candidateDocumentId);
      return registrationFailed("The proposal");
  }
}
