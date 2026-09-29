import type { SessionFailure } from "@doodle/protocol";

import type { RequestStanding } from "./catalog-port";

/** Why an agent may not edit the proposal of a request, or null when it may. */
export function agentRefusal(
  standing: RequestStanding,
  agentId: string,
): SessionFailure | null {
  switch (standing.state) {
    case "inProgress":
      return standing.agent === agentId
        ? null
        : {
            code: "taken_by_another_agent",
            message: "The request is held by another agent.",
          };
    case "aborted":
      return { code: "request_aborted", message: "The request was aborted." };
    case "awaitingChoice":
    case "completed":
      return { code: "request_finished", message: "The request is finished." };
    case "requested":
      return {
        code: "request_not_taken",
        message: "The request has not been taken.",
      };
  }
}
