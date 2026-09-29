import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";

import { addFile, addPage, addRequest, registerDocument } from "./index";

const db = env.DB;

type Item = Record<string, unknown> & { id: string };

async function call(method: string, path: string, body?: unknown) {
  const res = await exports.default.fetch(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text.startsWith("{") ? (JSON.parse(text) as any) : text,
  };
}

const get = (path: string) => call("GET", path);
const post = (path: string, body?: unknown) => call("POST", path, body);

let now = 0;
const clock = () => new Date((now += 1000));

let app = "";

async function record(input: Parameters<typeof addRequest>[1]) {
  const result = await addRequest(db, input, clock);
  if (!result.ok) throw new Error(result.message);
  return result.request;
}

async function makeRequest(page = "p_1"): Promise<string> {
  const request = await record({
    page,
    snapshot: "doc_snap_1",
    references: ["doc_prop_0"],
    feedback: "余白を広く",
    previous: null,
  });
  return request.id;
}

const take = (id: string, agent: string) =>
  post(`/api/requests/${id}/take`, { agent });
const complete = (id: string, agent: string) =>
  post(`/api/requests/${id}/complete`, { agent });
const adopt = (id: string, proposal: string) =>
  post(`/api/requests/${id}/adopt`, { proposal });
const getRequest = async (id: string) =>
  (await get(`/api/requests/${id}`)).body;

async function awaitingChoice(id: string) {
  await take(id, "agt_1");
  await complete(id, "agt_1");
}

async function registerProposal(id: string, request: string, page = "p_1") {
  const result = await registerDocument(db, {
    id,
    file: app,
    kind: "proposal",
    page,
    request,
    release: null,
  });
  if (!result.ok) throw new Error(result.message);
}

async function addApp(name: string): Promise<string> {
  const result = await addFile(db, { kind: "app", name, reference: null });
  if (!result.ok) throw new Error(result.message);
  return result.file.id;
}

async function recordPage(
  id: string,
  skeleton: string,
  name: string,
  file = app,
) {
  const result = await addPage(db, { id, file, skeleton, name }, clock);
  if (!result.ok) throw new Error(result.message);
}

async function itemOf(id: string): Promise<Item> {
  const { body } = await get("/api/files");
  const item = (body.files as Item[]).find((file) => file.id === id);
  if (item === undefined) throw new Error(`no item ${id}`);
  return item;
}

beforeEach(async () => {
  now = Date.parse("2026-01-01T00:00:00Z");
  await db.batch([
    db.prepare("DELETE FROM request_references"),
    db.prepare("DELETE FROM requests"),
    db.prepare("DELETE FROM pages"),
    db.prepare("DELETE FROM documents"),
    db.prepare("DELETE FROM releases"),
    db.prepare("DELETE FROM files"),
  ]);
  app = await addApp("Shop");
  await recordPage("p_1", "doc_skel_1", "ホーム");
  await recordPage("p_2", "doc_skel_2", "設定");
});

describe("creating requests", () => {
  test("a created request is requested, undelivered and has no adopted proposal, and is served by id", async () => {
    const result = await addRequest(
      db,
      {
        page: "p_1",
        snapshot: "doc_snap_1",
        references: ["doc_prop_0"],
        feedback: "余白を広く",
        previous: null,
      },
      clock,
    );

    expect(result).toEqual({
      ok: true,
      request: {
        id: expect.any(String),
        page: "p_1",
        snapshot: "doc_snap_1",
        references: ["doc_prop_0"],
        feedback: "余白を広く",
        previous: null,
        state: "requested",
        agent: null,
        delivered: false,
        adoptedProposal: null,
      },
    });
    if (!result.ok) return;
    expect(await get(`/api/requests/${result.request.id}`)).toEqual({
      status: 200,
      body: result.request,
    });
  });

  test("a request that follows an awaiting-choice request names it as the previous round, with no references and empty feedback", async () => {
    const first = await makeRequest();
    await awaitingChoice(first);

    const next = await record({
      page: "p_1",
      snapshot: "doc_snap_2",
      references: [],
      feedback: "",
      previous: first,
    });

    expect(next.previous).toBe(first);
    expect(next.references).toEqual([]);
    expect(next.feedback).toBe("");
  });

  test("a request whose previous round is in progress fails with previous_not_awaiting_choice and nothing changes", async () => {
    const first = await makeRequest();
    await take(first, "agt_1");

    const result = await addRequest(
      db,
      {
        page: "p_1",
        snapshot: "doc_snap_2",
        references: [],
        feedback: "",
        previous: first,
      },
      clock,
    );

    expect(result).toEqual({
      ok: false,
      code: "previous_not_awaiting_choice",
      message: expect.any(String),
    });
    expect((await getRequest(first)).state).toBe("inProgress");
    expect((await get("/api/requests")).body.requests).toHaveLength(1);
  });

  test("filtering by state returns only the requests in that state", async () => {
    const requested = await makeRequest();
    const taken = await makeRequest();
    await take(taken, "agt_1");

    const { status, body } = await get("/api/requests?state=requested");

    expect(status).toBe(200);
    expect(body).toEqual({
      requests: [
        expect.objectContaining({ id: requested, state: "requested" }),
      ],
    });
  });
});

describe("taking a request", () => {
  test("an agent that takes a requested request makes it in progress under that agent", async () => {
    const id = await makeRequest();

    const { status, body } = await take(id, "agt_1");

    expect(status).toBe(200);
    expect(body).toMatchObject({ id, state: "inProgress", agent: "agt_1" });
  });

  test("another agent taking an in-progress request gets 409 already_taken and the request is unchanged", async () => {
    const id = await makeRequest();
    await take(id, "agt_1");

    const { status, body } = await take(id, "agt_2");

    expect(status).toBe(409);
    expect(body).toEqual({
      code: "already_taken",
      message: expect.any(String),
    });
    expect(await getRequest(id)).toMatchObject({
      state: "inProgress",
      agent: "agt_1",
    });
  });

  test("the agent that already holds a request takes it again and gets the same request", async () => {
    const id = await makeRequest();
    const first = await take(id, "agt_1");

    const again = await take(id, "agt_1");

    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(again.body).toMatchObject({ state: "inProgress", agent: "agt_1" });
  });
});

describe("delivering a request", () => {
  test("a delivered record leaves the request requested and marks it delivered", async () => {
    const id = await makeRequest();

    const { status, body } = await post(`/api/requests/${id}/delivered`);

    expect(status).toBe(200);
    expect(body).toMatchObject({ id, state: "requested", delivered: true });
  });
});

describe("completing a request", () => {
  test("the agent that holds a request completes it and it awaits a choice", async () => {
    const id = await makeRequest();
    await take(id, "agt_1");

    const { status, body } = await complete(id, "agt_1");

    expect(status).toBe(200);
    expect(body).toMatchObject({
      id,
      state: "awaitingChoice",
      agent: "agt_1",
    });
  });

  type Setup = (id: string) => Promise<void>;
  const cases: { label: string; setup: Setup; code: string }[] = [
    {
      label: "in progress under another agent",
      setup: async (id) => void (await take(id, "agt_1")),
      code: "taken_by_another_agent",
    },
    {
      label: "aborted",
      setup: async (id) => {
        await take(id, "agt_1");
        await post("/api/agents/agt_1/abort-requests");
      },
      code: "request_aborted",
    },
    {
      label: "awaiting a choice",
      setup: awaitingChoice,
      code: "request_finished",
    },
    {
      label: "completed",
      setup: async (id) => {
        await awaitingChoice(id);
        await record({
          page: "p_1",
          snapshot: "doc_snap_2",
          references: [],
          feedback: "",
          previous: id,
        });
      },
      code: "request_finished",
    },
    {
      label: "requested and untaken",
      setup: async () => {},
      code: "not_taken",
    },
  ];

  test.each(cases)(
    "another agent completing a request that is $label gets 409 $code and the request is unchanged",
    async ({ setup, code }) => {
      const id = await makeRequest();
      await setup(id);
      const before = await getRequest(id);

      const { status, body } = await complete(id, "agt_2");

      expect(status).toBe(409);
      expect(body).toEqual({ code, message: expect.any(String) });
      expect(await getRequest(id)).toEqual(before);
    },
  );
});

describe("aborting and retrying", () => {
  test("aborting one agent's requests aborts them all and leaves another agent's request in progress", async () => {
    const r1 = await makeRequest();
    const r2 = await makeRequest();
    const r3 = await makeRequest();
    await take(r1, "agt_1");
    await take(r2, "agt_1");
    await take(r3, "agt_2");

    const { status, body } = await post("/api/agents/agt_1/abort-requests");

    expect(status).toBe(200);
    expect(body).toEqual({ aborted: [r1, r2] });
    expect((await getRequest(r1)).state).toBe("aborted");
    expect((await getRequest(r2)).state).toBe("aborted");
    expect((await getRequest(r3)).state).toBe("inProgress");
  });

  test("retrying an aborted request that was delivered returns it requested with no agent and undelivered", async () => {
    const r1 = await makeRequest();
    await post(`/api/requests/${r1}/delivered`);
    await take(r1, "agt_1");
    await post("/api/agents/agt_1/abort-requests");

    const { status, body } = await post(`/api/requests/${r1}/retry`);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: r1,
      state: "requested",
      agent: null,
      delivered: false,
    });
  });

  test("adopting on a requested request gets 409 invalid_state with state requested", async () => {
    const id = await makeRequest();
    await registerProposal("doc_prop_1", id);

    const { status, body } = await adopt(id, "doc_prop_1");

    expect(status).toBe(409);
    expect(body).toEqual({
      code: "invalid_state",
      state: "requested",
      message: expect.any(String),
    });
  });

  test("retrying an in-progress request gets 409 invalid_state with state inProgress", async () => {
    const id = await makeRequest();
    await take(id, "agt_1");

    const { status, body } = await post(`/api/requests/${id}/retry`);

    expect(status).toBe(409);
    expect(body).toEqual({
      code: "invalid_state",
      state: "inProgress",
      message: expect.any(String),
    });
  });
});

describe("adopting a proposal", () => {
  test("adopting a proposal of the request completes it and sets the page's adopted proposal", async () => {
    const id = await makeRequest();
    await registerProposal("doc_prop_1", id);
    await awaitingChoice(id);

    const adopted = await adopt(id, "doc_prop_1");

    expect(adopted.status).toBe(200);
    expect(adopted.body).toMatchObject({
      id,
      state: "completed",
      adoptedProposal: "doc_prop_1",
    });
    expect(await get("/api/pages/p_1")).toEqual({
      status: 200,
      body: {
        id: "p_1",
        file: app,
        name: "ホーム",
        skeleton: "doc_skel_1",
        adoptedProposal: "doc_prop_1",
      },
    });
  });

  test.each(["doc_prop_q", "doc_skel_1"])(
    "adopting %s, which is not a proposal of the request, gets 409 proposal_not_in_request and changes nothing",
    async (proposal) => {
      const id = await makeRequest();
      const other = await makeRequest();
      await registerProposal("doc_prop_q", other);
      await registerDocument(db, {
        id: "doc_skel_1",
        file: app,
        kind: "skeleton",
        page: "p_1",
        release: null,
      });
      await awaitingChoice(id);

      const { status, body } = await adopt(id, proposal);

      expect(status).toBe(409);
      expect(body).toEqual({
        code: "proposal_not_in_request",
        message: expect.any(String),
      });
      expect((await getRequest(id)).state).toBe("awaitingChoice");
      expect((await get("/api/pages/p_1")).body.adoptedProposal).toBeNull();
    },
  );

  test("creating the next request closes the previous round without adopting and keeps the page's adopted proposal", async () => {
    const r = await makeRequest();
    await registerProposal("doc_prop_1", r);
    await awaitingChoice(r);
    await adopt(r, "doc_prop_1");
    const r2 = await makeRequest();
    await awaitingChoice(r2);

    const next = await addRequest(
      db,
      {
        page: "p_1",
        snapshot: "doc_snap_3",
        references: [],
        feedback: "",
        previous: r2,
      },
      clock,
    );

    expect(next.ok).toBe(true);
    expect(await get(`/api/requests/${r2}`)).toEqual({
      status: 200,
      body: expect.objectContaining({
        id: r2,
        state: "completed",
        adoptedProposal: null,
      }),
    });
    expect((await get("/api/pages/p_1")).body.adoptedProposal).toBe(
      "doc_prop_1",
    );
    expect((await post(`/api/requests/${r2}/close`)).status).toBe(404);
  });
});

describe("pages", () => {
  test("a recorded page is served with no adopted proposal", async () => {
    expect(
      await addPage(
        db,
        { id: "p_3", file: app, skeleton: "doc_skel_3", name: "一覧" },
        clock,
      ),
    ).toEqual({ ok: true });

    expect(await get("/api/pages/p_3")).toEqual({
      status: 200,
      body: {
        id: "p_3",
        file: app,
        name: "一覧",
        skeleton: "doc_skel_3",
        adoptedProposal: null,
      },
    });
  });

  test("a page added last is listed last", async () => {
    await recordPage("p_0", "doc_skel_0", "ゼロ");

    const { status, body } = await get(`/api/files/${app}/pages`);

    expect(status).toBe(200);
    expect(body.pages.map((page: Item) => page.id)).toEqual([
      "p_1",
      "p_2",
      "p_0",
    ]);
  });
});

describe("app items", () => {
  test("the in-progress count is the number of taken requests on the app's pages", async () => {
    const a = await makeRequest("p_1");
    const b = await makeRequest("p_1");
    const c = await makeRequest("p_2");
    await take(a, "agt_1");
    await take(b, "agt_1");
    await take(c, "agt_1");
    await complete(c, "agt_1");

    expect(await itemOf(app)).toMatchObject({
      id: app,
      inProgressRequests: 2,
    });
  });

  test("the page count is 2, then 3 after another page, and 0 for an app without pages", async () => {
    const empty = await addApp("Blog");

    expect(await itemOf(app)).toMatchObject({ pageCount: 2 });
    await recordPage("p_3", "doc_skel_3", "一覧");
    expect(await itemOf(app)).toMatchObject({ pageCount: 3 });
    expect(await itemOf(empty)).toMatchObject({ pageCount: 0 });
  });

  test("the thumbnail document is the first page's skeleton, then its adopted proposal, and null without pages", async () => {
    const empty = await addApp("Blog");
    expect(await itemOf(app)).toMatchObject({
      thumbnailDocument: "doc_skel_1",
    });

    const r1 = await makeRequest("p_1");
    await registerProposal("doc_prop_1", r1);
    await awaitingChoice(r1);
    await adopt(r1, "doc_prop_1");
    expect(await itemOf(app)).toMatchObject({
      thumbnailDocument: "doc_prop_1",
    });

    const r2 = await makeRequest("p_2");
    await registerProposal("doc_prop_2", r2, "p_2");
    await awaitingChoice(r2);
    await adopt(r2, "doc_prop_2");
    await recordPage("p_0", "doc_skel_0", "ゼロ");
    expect(await itemOf(app)).toMatchObject({
      thumbnailDocument: "doc_prop_1",
    });
    expect(await itemOf(empty)).toMatchObject({ thumbnailDocument: null });
  });
});
