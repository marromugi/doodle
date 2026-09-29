import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";

const db = env.DB;

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

type AuthorKind = "human" | "agent";

const createThread = (
  document: string,
  node: string,
  authorKind: AuthorKind,
  body: string,
) => post("/api/threads", { document, node, authorKind, body });

const reply = (thread: string, authorKind: AuthorKind, body: string) =>
  post(`/api/threads/${thread}/comments`, { authorKind, body });

const listByDocument = async (document: string) =>
  (await get(`/api/threads?document=${document}`)).body.threads as any[];

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM comments"),
    db.prepare("DELETE FROM threads"),
  ]);
});

describe("creating threads", () => {
  test("a human creates a thread on a node and gets it back with the first comment", async () => {
    const res = await createThread(
      "doc_1",
      "n_title",
      "human",
      "見出しを大きく",
    );

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      document: "doc_1",
      node: "n_title",
      awaitingReply: false,
      comments: [
        {
          id: expect.any(String),
          authorKind: "human",
          body: "見出しを大きく",
          createdAt: expect.any(String),
        },
      ],
    });
  });

  test("a thread on a node the document does not have is created and carries no field about the node existing", async () => {
    const res = await createThread(
      "doc_1",
      "n_missing",
      "agent",
      "ここは仮に 16px としました",
    );

    expect(res.status).toBe(201);
    expect(res.body.node).toBe("n_missing");
    expect(res.body.awaitingReply).toBe(true);
    expect(Object.keys(res.body).sort()).toEqual([
      "awaitingReply",
      "comments",
      "document",
      "id",
      "node",
    ]);
  });
});

describe("replying to threads", () => {
  test("replies are listed in the order written, each with its author kind", async () => {
    const created = await createThread(
      "doc_1",
      "n_title",
      "human",
      "見出しを大きく",
    );
    const thread = created.body.id as string;

    const agentReply = await reply(thread, "agent", "48px にしました");
    expect(agentReply.status).toBe(201);
    expect(agentReply.body).toEqual({
      id: expect.any(String),
      authorKind: "agent",
      body: "48px にしました",
      createdAt: expect.any(String),
    });
    await reply(thread, "human", "ありがとう");

    const listed = (await listByDocument("doc_1")).find((t) => t.id === thread);
    expect(listed.comments.map((c: any) => [c.body, c.authorKind])).toEqual([
      ["見出しを大きく", "human"],
      ["48px にしました", "agent"],
      ["ありがとう", "human"],
    ]);
  });
});

describe("listing threads", () => {
  test("listing by document returns only that document's threads", async () => {
    await createThread("doc_1", "n_a", "human", "a");
    await createThread("doc_1", "n_b", "human", "b");
    await createThread("doc_2", "n_c", "human", "c");

    const res = await get("/api/threads?document=doc_1");

    expect(res.status).toBe(200);
    expect(res.body.threads).toHaveLength(2);
    expect(res.body.threads.map((t: any) => t.document)).toEqual([
      "doc_1",
      "doc_1",
    ]);
  });

  test("a thread awaits a reply while its last comment is the agent's", async () => {
    const created = await createThread(
      "doc_1",
      "n_title",
      "human",
      "見出しを大きく",
    );
    const thread = created.body.id as string;
    const awaiting = async () =>
      (await listByDocument("doc_1")).find((t) => t.id === thread)
        .awaitingReply;

    await reply(thread, "agent", "48px にしました");
    expect(await awaiting()).toBe(true);

    await reply(thread, "human", "ありがとう");
    expect(await awaiting()).toBe(false);
  });

  test("filtering by awaiting a reply lists the agent's threads across documents", async () => {
    await createThread("doc_1", "n_a", "human", "人のスレッド");
    const agent1 = await createThread("doc_1", "n_b", "agent", "エージェント1");
    const agent2 = await createThread("doc_2", "n_c", "agent", "エージェント2");

    const res = await get("/api/threads?awaitingReply=true");

    expect(res.status).toBe(200);
    expect(res.body.threads.map((t: any) => t.id)).toEqual([
      agent1.body.id,
      agent2.body.id,
    ]);
  });
});
