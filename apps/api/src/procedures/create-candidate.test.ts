import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import { addFile as addCatalogFile, addPage, addRequest } from "../catalog";
import { abortAgentRequests, takeRequest } from "../catalog/transitions";
import { creationCatalogFromDb } from "./catalog-d1";
import { createCandidate } from "./create-candidate";
import { createPage } from "./create-page";
import { addRequest as addFakeRequest, addFile, fakes } from "./test-ports";

const reference = { designSystem: "ds_1", release: "rel_1" };

const heldBy = (
  state:
    "requested" | "inProgress" | "awaitingChoice" | "completed" | "aborted",
  agent: string | null = "agt_A",
) => {
  const setup = fakes();
  const file = addFile(setup.catalog, { kind: "app" });
  addFakeRequest(setup.catalog, {
    id: "req_1",
    page: "p1",
    file,
    state,
    agent,
  });
  return { ...setup, file };
};

describe("createCandidate", () => {
  test("the agent holding req_1 gets a new proposal document registered for req_1 and page p1, and its ID is returned", async () => {
    const { catalog, ports } = heldBy("inProgress");

    const result = await createCandidate(ports, {
      requestId: "req_1",
      agentId: "agt_A",
    });

    if (!result.ok) throw new Error(result.message);
    expect(catalog.registrations).toMatchObject([
      {
        id: result.candidateDocumentId,
        kind: "proposal",
        request: "req_1",
        page: "p1",
      },
    ]);
  });

  test("an agent that does not hold req_1 is refused as taken_by_another_agent and nothing is registered or initialised", async () => {
    const { catalog, sessions, ports } = heldBy("inProgress");

    const result = await createCandidate(ports, {
      requestId: "req_1",
      agentId: "agt_B",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "taken_by_another_agent",
    });
    expect(catalog.registrations).toEqual([]);
    expect(sessions.contents.size).toBe(0);
  });

  test.each([
    ["aborted", "request_aborted"],
    ["awaitingChoice", "request_finished"],
    ["requested", "request_not_taken"],
  ] as const)(
    "a request in state %s refuses the agent as %s",
    async (state, code) => {
      const { ports } = heldBy(state);

      const result = await createCandidate(ports, {
        requestId: "req_1",
        agentId: "agt_A",
      });

      expect(result).toMatchObject({ ok: false, code });
    },
  );

  test("when the registry refuses the proposal with an ID in use, the candidate fails as registration_failed and the proposal document is erased", async () => {
    const { catalog, sessions, ports } = heldBy("inProgress");
    catalog.answer.registerProposal = { status: "id_in_use" };

    const result = await createCandidate(ports, {
      requestId: "req_1",
      agentId: "agt_A",
    });

    expect(result).toMatchObject({ ok: false, code: "registration_failed" });
    expect(sessions.erased).toEqual([...sessions.contents.keys()]);
    expect(sessions.erased).toHaveLength(1);
  });

  test("a proposal is registered and initialised with the release the app references now, not the one the page was made with", async () => {
    const { catalog, sessions, ports } = fakes();
    const file = addFile(catalog, { kind: "app", reference });
    const page = await createPage(ports, { appFileId: file, name: "Home" });
    if (!page.ok) throw new Error(page.message);
    catalog.requests.push({
      id: "req_1",
      page: page.pageId,
      state: "inProgress",
      agent: "agt_A",
    });
    catalog.files[0]!.reference = { designSystem: "ds_1", release: "rel_2" };

    const result = await createCandidate(ports, {
      requestId: "req_1",
      agentId: "agt_A",
    });

    if (!result.ok) throw new Error(result.message);
    expect(
      catalog.registrations.find(
        (row) => row.id === result.candidateDocumentId,
      ),
    ).toMatchObject({ release: "rel_2" });
    expect(sessions.contents.get(result.candidateDocumentId)).toMatchObject({
      release: { designSystem: "ds_1", release: "rel_2" },
    });
  });

  test("a proposal for an app without a design system has no release in the registry or in the initial content", async () => {
    const { catalog, sessions, ports } = heldBy("inProgress");

    const result = await createCandidate(ports, {
      requestId: "req_1",
      agentId: "agt_A",
    });

    if (!result.ok) throw new Error(result.message);
    expect(catalog.registrations[0]).toMatchObject({ release: null });
    expect(sessions.contents.get(result.candidateDocumentId)).toMatchObject({
      release: null,
    });
  });

  test("when req_1 is aborted between the check and the write, the candidate fails as request_aborted, no proposal is registered for req_1 and the initialised proposal is erased", async () => {
    const { sessions, eraseRetry } = fakes();
    const catalog = creationCatalogFromDb(env.DB);
    const app = await addCatalogFile(env.DB, {
      kind: "app",
      name: "Shop",
      reference: null,
    });
    if (!app.ok) throw new Error(app.message);
    const pageId = `p_${crypto.randomUUID()}`;
    const added = await addPage(env.DB, {
      id: pageId,
      file: app.file.id,
      skeleton: `doc_skel_${crypto.randomUUID()}`,
      name: "Home",
      release: null,
    });
    if (!added.ok) throw new Error(added.message);
    const request = await addRequest(env.DB, {
      page: pageId,
      snapshot: `doc_snap_${crypto.randomUUID()}`,
      references: [],
      feedback: "",
      previous: null,
    });
    if (!request.ok) throw new Error(request.message);
    const taken = await takeRequest(env.DB, request.request.id, "agt_A");
    if (!taken.ok) throw new Error(taken.message);
    sessions.duringInitialize = async () => {
      await abortAgentRequests(env.DB, "agt_A");
    };

    const result = await createCandidate(
      { catalog, sessions, eraseRetry },
      { requestId: request.request.id, agentId: "agt_A" },
    );

    expect(result).toMatchObject({ ok: false, code: "request_aborted" });
    const registered = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM documents WHERE request_id = ?",
    )
      .bind(request.request.id)
      .first<{ count: number }>();
    expect(registered?.count).toBe(0);
    expect(sessions.erased).toEqual([...sessions.contents.keys()]);
    expect(sessions.erased).toHaveLength(1);
  });
});
