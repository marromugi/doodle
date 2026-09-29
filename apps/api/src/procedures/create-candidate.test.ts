import { describe, expect, test } from "vitest";

import type { RequestState } from "../catalog/schema";
import { createCandidate } from "./create-candidate";
import {
  addApp,
  addRequest,
  fakeCatalog,
  fakeSessions,
  type FakeCatalog,
} from "./test-ports";

const rel1 = { designSystem: "ds_1", release: "rel_1" };
const rel2 = { designSystem: "ds_1", release: "rel_2" };

const setup = (
  options: {
    state?: RequestState;
    agent?: string | null;
    reference?: typeof rel1 | null;
  } = {},
) => {
  const catalog = fakeCatalog();
  const sessions = fakeSessions();
  const file = addApp(catalog, options.reference ?? null);
  addRequest(catalog, {
    id: "req_1",
    page: "p1",
    file,
    state: options.state ?? "inProgress",
    agent: options.agent === undefined ? "agt_A" : options.agent,
  });
  return { catalog, sessions, file, ports: { catalog, sessions } };
};

const setReference = (
  catalog: FakeCatalog,
  file: string,
  reference: typeof rel1 | null,
) => {
  catalog.files.find((each) => each.id === file)!.reference = reference;
};

describe("createCandidate", () => {
  test("the agent holding the request gets a proposal document registered for the request and page", async () => {
    const { catalog, file, ports } = setup({ reference: rel1 });

    const result = await createCandidate(ports, {
      requestId: "req_1",
      agentId: "agt_A",
    });

    if (!result.ok) throw new Error(result.message);
    expect(catalog.documents).toEqual([
      {
        id: result.candidateDocumentId,
        file,
        kind: "proposal",
        page: "p1",
        request: "req_1",
        release: "rel_1",
      },
    ]);
  });

  test("another agent is refused because the request is held by another agent, and nothing is created", async () => {
    const { catalog, sessions, ports } = setup();

    const result = await createCandidate(ports, {
      requestId: "req_1",
      agentId: "agt_B",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "taken_by_another_agent",
    });
    expect(catalog.documents).toEqual([]);
    expect(sessions.contents.size).toBe(0);
  });

  test("an aborted request, one awaiting a choice and a requested one are each refused with their own reason", async () => {
    const refusals: [RequestState, string][] = [
      ["aborted", "request_aborted"],
      ["awaitingChoice", "request_finished"],
      ["requested", "request_not_taken"],
    ];

    for (const [state, code] of refusals) {
      const { ports } = setup({ state });
      const result = await createCandidate(ports, {
        requestId: "req_1",
        agentId: "agt_A",
      });
      expect(result).toMatchObject({ ok: false, code });
    }
  });

  test("when the registry refuses the proposal, the request fails and the document is erased", async () => {
    const { catalog, sessions, ports } = setup({ reference: rel1 });
    catalog.failRegistration = true;

    const result = await createCandidate(ports, {
      requestId: "req_1",
      agentId: "agt_A",
    });

    expect(result).toMatchObject({ ok: false, code: "registration_failed" });
    expect(sessions.erased).toEqual([...sessions.contents.keys()]);
    expect(sessions.erased).toHaveLength(1);
  });

  test("a proposal takes the release the app references now, not the one it referenced when the page was made", async () => {
    const { catalog, sessions, file, ports } = setup({ reference: rel1 });
    setReference(catalog, file, rel2);

    const result = await createCandidate(ports, {
      requestId: "req_1",
      agentId: "agt_A",
    });

    if (!result.ok) throw new Error(result.message);
    expect(catalog.documents).toMatchObject([{ release: "rel_2" }]);
    expect(sessions.contents.get(result.candidateDocumentId)).toMatchObject({
      release: rel2,
    });
  });

  test("a proposal in an app without a design system has no release in the registry or in its content", async () => {
    const { catalog, sessions, ports } = setup({ reference: null });

    const result = await createCandidate(ports, {
      requestId: "req_1",
      agentId: "agt_A",
    });

    if (!result.ok) throw new Error(result.message);
    expect(catalog.documents).toMatchObject([{ release: null }]);
    expect(sessions.contents.get(result.candidateDocumentId)).toMatchObject({
      release: null,
    });
  });
});
