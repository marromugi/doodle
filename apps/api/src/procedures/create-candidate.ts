import type { Failure } from "../catalog/schema";
import {
  initializeDocument,
  newDocumentId,
  registerOrErase,
} from "./document-steps";
import { emptyTree } from "./empty-documents";
import type { FileProcedurePorts } from "./ports";

export type CreateCandidateResult =
  | { ok: true; candidateDocumentId: string }
  | Failure<
      | "request_aborted"
      | "taken_by_another_agent"
      | "request_finished"
      | "request_not_taken"
      | "registration_failed"
      | "initialization_failed"
    >;

const notTaken: Failure<"request_not_taken"> = {
  ok: false,
  code: "request_not_taken",
  message: "The agent has not taken the request.",
};

/** Creates an empty proposal document for a request, for the agent that holds the request. */
export async function createCandidate(
  ports: FileProcedurePorts,
  input: { requestId: string; agentId: string },
): Promise<CreateCandidateResult> {
  const request = await ports.catalog.getRequest(input.requestId);
  if (request === null) return notTaken;
  switch (request.state) {
    case "aborted":
      return {
        ok: false,
        code: "request_aborted",
        message: "The request was aborted.",
      };
    case "awaitingChoice":
    case "completed":
      return {
        ok: false,
        code: "request_finished",
        message: "The request is finished.",
      };
    case "requested":
      return notTaken;
    case "inProgress":
      if (request.agent !== input.agentId) {
        return {
          ok: false,
          code: "taken_by_another_agent",
          message: "Another agent has taken the request.",
        };
      }
  }

  const page = await ports.catalog.getPage(request.page);
  if (page === null) {
    return {
      ok: false,
      code: "registration_failed",
      message: `Page ${request.page} does not exist.`,
    };
  }
  const reference = await ports.catalog.getReference(page.file);
  const candidateDocumentId = newDocumentId();

  const failure =
    (await initializeDocument(
      ports,
      candidateDocumentId,
      emptyTree(reference),
    )) ??
    (await registerOrErase(ports, {
      id: candidateDocumentId,
      file: page.file,
      kind: "proposal",
      page: page.id,
      request: request.id,
      release: reference?.release ?? null,
    }));
  if (failure !== null) return failure;
  return { ok: true, candidateDocumentId };
}
