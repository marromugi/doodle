import type {
  DraftDocument,
  EditOperation,
  Scope,
  TreeDocument,
} from "@doodle/design-doc";
import type { ClientMessage, ServerMessage } from "@doodle/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import type { RequestState } from "../catalog/schema";
import type {
  CatalogPort,
  Read,
  Registration,
  RequestStanding,
  ScopeRead,
} from "./catalog-port";
import type { DocumentSession } from "./document-session";

type Identity = { kind: "human" } | { kind: "agent"; agentId: string };

const human: Identity = { kind: "human" };
const agentA: Identity = { kind: "agent", agentId: "agt_A" };
const agentB: Identity = { kind: "agent", agentId: "agt_B" };

let counter = 0;
const newId = (prefix: string) =>
  `${prefix}_${++counter}_${crypto.randomUUID()}`;

const WAIT_MS = 5_000;

class Client {
  private inbox: ServerMessage[] = [];
  private waiting: ((message: ServerMessage) => void) | null = null;
  readonly closed: Promise<{ code: number }>;

  private constructor(private readonly socket: WebSocket) {
    this.closed = new Promise((resolve) => {
      socket.addEventListener("close", (event) =>
        resolve({ code: event.code }),
      );
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (this.waiting) {
        const deliver = this.waiting;
        this.waiting = null;
        deliver(message);
      } else {
        this.inbox.push(message);
      }
    });
  }

  static async connect(
    documentId: string,
    identity: Identity,
  ): Promise<Client> {
    const query =
      identity.kind === "human"
        ? "kind=human"
        : `kind=agent&agentId=${identity.agentId}`;
    const response = await exports.default.fetch(
      `http://localhost/api/documents/${documentId}/session?${query}`,
      { headers: { Upgrade: "websocket" } },
    );
    const socket = response.webSocket;
    if (!socket) throw new Error(`no WebSocket, status ${response.status}`);
    socket.accept();
    return new Client(socket);
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  next(): Promise<ServerMessage> {
    const queued = this.inbox.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("no message arrived")),
        WAIT_MS,
      );
      this.waiting = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
    });
  }

  async read(): Promise<ServerMessage> {
    this.send({ type: "read" });
    return this.next();
  }

  async operate(operation: EditOperation): Promise<ServerMessage> {
    this.send({ type: "operation", operation });
    return this.next();
  }
}

const found = <T>(value: T): Read<T> => ({ status: "found", value });
const absent: Read<never> = { status: "absent" };
const unreadable: Read<never> = { status: "unreadable" };

type Spec = {
  fileDeleted?: Read<boolean>;
  registration?: Read<Registration>;
  request?: Read<RequestStanding>;
  releases?: Record<string, ScopeRead>;
  releaseContents?: ScopeRead;
};

const fakeCatalog = (spec: Spec = {}): CatalogPort => ({
  isFileDeleted: async () => spec.fileDeleted ?? found(false),
  registration: async () => spec.registration ?? absent,
  request: async () => spec.request ?? absent,
  releaseContents: async (releaseId) =>
    spec.releaseContents ?? spec.releases?.[releaseId] ?? absent,
});

const treeDoc = (over: Partial<TreeDocument> = {}): TreeDocument => ({
  kind: "tree",
  revision: 3,
  release: null,
  root: {
    type: "frame",
    id: "n_root",
    children: [
      { type: "text", id: "n_title", text: "Original" },
      { type: "text", id: "n_body", text: "Body" },
    ],
  },
  history: {
    nodes: {},
    tokens: {},
    components: {},
    nodeIds: ["n_root", "n_title", "n_body"],
  },
  ...over,
});

const draftDoc = (): DraftDocument => ({
  kind: "draft",
  revision: 3,
  tokens: { color: {}, typography: {}, space: {}, radius: {} },
  components: {},
  history: { nodes: {}, tokens: {}, components: {}, nodeIds: [] },
});

const setText = (node: string, value: string, base: number): EditOperation => ({
  type: "set",
  base,
  node,
  key: "text",
  value,
});

type Started = { documentId: string; stub: DurableObjectStub<DocumentSession> };

const start = async (
  content: TreeDocument | DraftDocument | null,
  spec: Spec = {},
): Promise<Started> => {
  const documentId = newId("doc");
  const stub = env.DOCUMENT_SESSION.get(
    env.DOCUMENT_SESSION.idFromName(documentId),
  );
  await runInDurableObject(stub, (instance: DocumentSession) => {
    instance.catalog = fakeCatalog(spec);
  });
  if (content) await stub.initialize(content);
  return { documentId, stub };
};

const proposalOf = (request: string): Spec["registration"] =>
  found({ kind: "proposal", request });

const taken = (state: RequestState, agent: string | null): Spec => ({
  registration: proposalOf("req_1"),
  request: found({ state, agent }),
});

const titleOf = (message: ServerMessage): unknown => {
  if (message.type !== "document" && message.type !== "applied") {
    throw new Error(`expected a document, got ${message.type}`);
  }
  const doc = message.document as TreeDocument;
  const node = doc.root.type === "frame" ? doc.root.children[0] : undefined;
  return node?.type === "text" ? node.text : undefined;
};

const failureCode = (message: ServerMessage): unknown =>
  message.type === "failure" ? message.failure.code : message.type;

describe("reading", () => {
  test("a client reads the initial content the procedure stored", async () => {
    const doc = treeDoc({
      root: {
        type: "frame",
        id: "n_root",
        children: [{ type: "text", id: "n_title", text: "Start" }],
      },
    });
    const { documentId } = await start(doc);
    const a = await Client.connect(documentId, human);
    expect(titleOf(await a.read())).toBe("Start");
  });

  test("a client reads the document and its revision", async () => {
    const { documentId } = await start(treeDoc());
    const a = await Client.connect(documentId, human);
    expect(await a.read()).toEqual({
      type: "document",
      revision: 3,
      document: treeDoc(),
    });
  });
});

describe("applying operations", () => {
  test("an accepted operation reaches every connection and later readers", async () => {
    const { documentId } = await start(treeDoc());
    const a = await Client.connect(documentId, human);
    const b = await Client.connect(documentId, human);

    a.send({ type: "operation", operation: setText("n_title", "Hello", 3) });
    const forA = await a.next();
    const forB = await b.next();
    for (const message of [forA, forB]) {
      expect(message.type).toBe("applied");
      expect(titleOf(message)).toBe("Hello");
      expect(message).toMatchObject({ revision: 4 });
    }

    const c = await Client.connect(documentId, human);
    const read = await c.read();
    expect(read).toMatchObject({ type: "document", revision: 4 });
    expect(titleOf(read)).toBe("Hello");
  });

  test("operations are applied in the order they arrive", async () => {
    const { documentId } = await start(treeDoc());
    const a = await Client.connect(documentId, human);
    const b = await Client.connect(documentId, human);

    a.send({ type: "operation", operation: setText("n_title", "One", 3) });
    a.send({ type: "operation", operation: setText("n_title", "Two", 4) });

    const first = await b.next();
    const second = await b.next();
    expect(first).toMatchObject({ type: "applied", revision: 4 });
    expect(titleOf(first)).toBe("One");
    expect(second).toMatchObject({ type: "applied", revision: 5 });
    expect(titleOf(second)).toBe("Two");
  });

  test("a failed operation is reported to the sender only and changes nothing", async () => {
    const { documentId } = await start(treeDoc());
    const a = await Client.connect(documentId, human);
    const b = await Client.connect(documentId, human);

    const failure = await a.operate({
      type: "add",
      base: 3,
      parent: "n_root",
      index: 0,
      node: { type: "text", id: "n_title", text: "Again" },
    });
    expect(failure).toMatchObject({
      type: "failure",
      failure: {
        code: "invalid_operation",
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "duplicate-node-id" }),
        ]),
      },
    });

    expect(await b.read()).toMatchObject({ type: "document", revision: 3 });
    const c = await Client.connect(documentId, human);
    expect(await c.read()).toMatchObject({ type: "document", revision: 3 });
  });

  test("an operation on a node changed after the revision it read fails with the latest revision", async () => {
    const { documentId } = await start(treeDoc());
    const a = await Client.connect(documentId, human);
    const b = await Client.connect(documentId, human);

    b.send({ type: "operation", operation: setText("n_title", "B", 3) });
    await b.next();
    await a.next();

    const failure = await a.operate(setText("n_title", "A", 3));
    expect(failure).toMatchObject({
      type: "failure",
      failure: { code: "conflict", latestRevision: 4 },
    });
    expect(titleOf(await a.read())).toBe("B");
  });

  test("an operation on a node nobody changed applies although the document moved on", async () => {
    const { documentId } = await start(treeDoc());
    const a = await Client.connect(documentId, human);
    const b = await Client.connect(documentId, human);

    b.send({ type: "operation", operation: setText("n_title", "B", 3) });
    await b.next();
    await a.next();

    const applied = await a.operate(setText("n_body", "A", 3));
    expect(applied).toMatchObject({ type: "applied", revision: 5 });
    const doc = (applied as { document: TreeDocument }).document;
    expect(doc.root).toMatchObject({
      children: [
        { id: "n_title", text: "B" },
        { id: "n_body", text: "A" },
      ],
    });
  });
});

describe("validation scope", () => {
  const button: Scope = {
    tokens: { color: {}, typography: {}, space: {}, radius: {} },
    components: {
      cmp_button: {
        name: "Button",
        props: {},
        root: { type: "frame", id: "btn", children: [] },
      },
    },
  };
  const addButton: EditOperation = {
    type: "add",
    base: 3,
    parent: "n_root",
    index: 2,
    node: {
      type: "instance",
      id: "n_button",
      component: "cmp_button",
      props: {},
    },
  };

  test("an app document is validated against its release contents", async () => {
    const { documentId } = await start(
      treeDoc({ release: { designSystem: "ds_1", release: "rel_a" } }),
      { releases: { rel_a: found(button) } },
    );
    const a = await Client.connect(documentId, human);
    expect(await a.operate(addButton)).toMatchObject({
      type: "applied",
      revision: 4,
    });
  });

  test("an app document without a design system has an empty scope", async () => {
    const { documentId } = await start(treeDoc());
    const a = await Client.connect(documentId, human);
    expect(await a.operate(addButton)).toMatchObject({
      type: "failure",
      failure: {
        code: "invalid_operation",
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "component-out-of-scope" }),
        ]),
      },
    });
  });

  test("a design system draft is its own scope after the operation is applied", async () => {
    const { documentId } = await start(draftDoc());
    const a = await Client.connect(documentId, human);
    const card = (id: string, token: string): EditOperation => ({
      type: "add-component",
      base: 4,
      id,
      component: {
        name: id,
        props: {},
        root: {
          type: "frame",
          id: `${id}_root`,
          background: { token },
          children: [],
        },
      },
    });

    expect(
      await a.operate({
        type: "add-token",
        base: 3,
        token: "color.primary",
        value: "#1a73e8",
      }),
    ).toMatchObject({ type: "applied", revision: 4 });
    expect(await a.operate(card("cmp_ok", "color.primary"))).toMatchObject({
      type: "applied",
      revision: 5,
    });
    expect(await a.operate(card("cmp_bad", "color.accent"))).toMatchObject({
      type: "failure",
      failure: {
        code: "invalid_operation",
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "unknown-token" }),
        ]),
      },
    });
  });

  test("the release the document itself holds decides the scope", async () => {
    const box: TreeDocument["root"] = {
      type: "frame",
      id: "n_box",
      children: [],
    };
    const withPrimary: Scope = {
      tokens: {
        color: { primary: "#1a73e8" },
        typography: {},
        space: {},
        radius: {},
      },
      components: {},
    };
    const without: Scope = {
      ...withPrimary,
      tokens: { ...withPrimary.tokens, color: {} },
    };
    const spec: Spec = {
      releases: { rel_1: found(withPrimary), rel_2: found(without) },
    };
    const paint: EditOperation = {
      type: "set",
      base: 0,
      node: "n_box",
      key: "background",
      value: { token: "color.primary" },
    };
    const doc = (release: string) =>
      treeDoc({
        revision: 0,
        root: box,
        release: { designSystem: "ds_1", release },
        history: { nodes: {}, tokens: {}, components: {}, nodeIds: ["n_box"] },
      });

    const x = await start(doc("rel_1"), spec);
    const y = await start(doc("rel_2"), spec);
    const forX = await (
      await Client.connect(x.documentId, human)
    ).operate(paint);
    const forY = await (
      await Client.connect(y.documentId, human)
    ).operate(paint);

    expect(forX).toMatchObject({ type: "applied", revision: 1 });
    expect(forY).toMatchObject({
      type: "failure",
      failure: {
        code: "invalid_operation",
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "unknown-token" }),
        ]),
      },
    });
  });
});

describe("who may operate", () => {
  test("a human's operations pass on any document", async () => {
    const aborted = await start(treeDoc(), taken("aborted", "agt_A"));
    const skeleton = await start(treeDoc(), {
      registration: found({ kind: "skeleton", request: null }),
    });
    const onProposal = await Client.connect(aborted.documentId, human);
    const onSkeleton = await Client.connect(skeleton.documentId, human);
    expect(await onProposal.operate(setText("n_title", "H", 3))).toMatchObject({
      type: "applied",
    });
    expect(await onSkeleton.operate(setText("n_title", "H", 3))).toMatchObject({
      type: "applied",
    });
  });

  test("the agent holding the request passes on the proposal document", async () => {
    const { documentId } = await start(treeDoc(), taken("inProgress", "agt_A"));
    const a = await Client.connect(documentId, agentA);
    expect(await a.operate(setText("n_title", "Agent", 3))).toMatchObject({
      type: "applied",
      revision: 4,
    });
  });

  test("an agent's operation on a skeleton, a snapshot or a draft fails as not a proposal", async () => {
    const codes: unknown[] = [];
    for (const kind of ["skeleton", "snapshot", "dsDraft"] as const) {
      const { documentId } = await start(treeDoc(), {
        registration: found({ kind, request: null }),
        request: found({ state: "inProgress", agent: "agt_A" }),
      });
      const a = await Client.connect(documentId, agentA);
      codes.push(failureCode(await a.operate(setText("n_title", "X", 3))));
    }
    expect(codes).toEqual([
      "not_candidate_document",
      "not_candidate_document",
      "not_candidate_document",
    ]);
  });

  test("another agent's operation fails as taken by another agent", async () => {
    const { documentId } = await start(treeDoc(), taken("inProgress", "agt_A"));
    const b = await Client.connect(documentId, agentB);
    expect(failureCode(await b.operate(setText("n_title", "B", 3)))).toBe(
      "taken_by_another_agent",
    );
  });

  test("an agent's operation on an aborted request fails as aborted", async () => {
    const { documentId } = await start(treeDoc(), taken("aborted", "agt_A"));
    const a = await Client.connect(documentId, agentA);
    expect(failureCode(await a.operate(setText("n_title", "X", 3)))).toBe(
      "request_aborted",
    );
  });

  test("an agent's operation fails as finished when the request awaits a choice or is completed", async () => {
    const codes: unknown[] = [];
    for (const state of ["awaitingChoice", "completed"] as const) {
      const { documentId } = await start(treeDoc(), taken(state, "agt_A"));
      const a = await Client.connect(documentId, agentA);
      codes.push(failureCode(await a.operate(setText("n_title", "X", 3))));
    }
    expect(codes).toEqual(["request_finished", "request_finished"]);
  });

  test("an agent's operation on a requested request fails as not taken", async () => {
    const { documentId } = await start(treeDoc(), taken("requested", null));
    const a = await Client.connect(documentId, agentA);
    expect(failureCode(await a.operate(setText("n_title", "X", 3)))).toBe(
      "request_not_taken",
    );
  });
});

describe("erasing", () => {
  test("after the erase instruction operations fail and new clients read nothing", async () => {
    const { documentId, stub } = await start(treeDoc());
    const a = await Client.connect(documentId, human);
    await stub.erase();

    expect(failureCode(await a.operate(setText("n_title", "X", 3)))).toBe(
      "document_deleted",
    );
    const fresh = await Client.connect(documentId, human);
    expect(failureCode(await fresh.read())).toBe("document_deleted");
  });

  test("a connection is refused when the catalog says the file is deleted", async () => {
    const { documentId } = await start(treeDoc(), {
      fileDeleted: found(true),
    });
    const a = await Client.connect(documentId, human);
    expect(failureCode(await a.next())).toBe("document_deleted");
    await a.closed;
  });

  test("a connection reads the document when the catalog says the file is not deleted", async () => {
    const { documentId } = await start(treeDoc(), {
      fileDeleted: found(false),
    });
    const a = await Client.connect(documentId, human);
    expect(await a.read()).toMatchObject({ type: "document", revision: 3 });
  });
});

describe("documents without content", () => {
  test("a read and an operation fail as not found and the socket stays open", async () => {
    const { documentId } = await start(null);
    const a = await Client.connect(documentId, human);
    expect(failureCode(await a.read())).toBe("document_not_found");
    expect(failureCode(await a.operate(setText("n_title", "X", 3)))).toBe(
      "document_not_found",
    );
    expect(failureCode(await a.read())).toBe("document_not_found");
  });
});

describe("catalog answers", () => {
  test("an agent's operation on a document missing from the registry fails as not registered while a human's passes", async () => {
    const { documentId } = await start(treeDoc(), {
      registration: absent,
    });
    const agent = await Client.connect(documentId, agentA);
    const person = await Client.connect(documentId, human);
    expect(failureCode(await agent.operate(setText("n_title", "A", 3)))).toBe(
      "document_not_registered",
    );
    expect(await person.operate(setText("n_title", "H", 3))).toMatchObject({
      type: "applied",
    });
  });

  test("a connection is closed with unavailable when the deletion check cannot be read", async () => {
    const { documentId } = await start(treeDoc(), { fileDeleted: unreadable });
    const a = await Client.connect(documentId, human);
    expect(failureCode(await a.next())).toBe("catalog_unavailable");
    await a.closed;
  });

  test("an agent's operation fails as unavailable when the registry cannot be read and the socket stays open", async () => {
    const { documentId } = await start(treeDoc(), { registration: unreadable });
    const a = await Client.connect(documentId, agentA);
    expect(failureCode(await a.operate(setText("n_title", "A", 3)))).toBe(
      "catalog_unavailable",
    );
    expect(await a.read()).toMatchObject({ type: "document", revision: 3 });
  });

  test("an operation fails as unavailable when the release contents cannot be read and the socket stays open", async () => {
    const { documentId } = await start(
      treeDoc({ release: { designSystem: "ds_1", release: "rel_1" } }),
      { releaseContents: unreadable },
    );
    const a = await Client.connect(documentId, human);
    expect(failureCode(await a.operate(setText("n_title", "H", 3)))).toBe(
      "catalog_unavailable",
    );
    expect(await a.read()).toMatchObject({ type: "document", revision: 3 });
  });

  test("an agent's operation fails as inconsistent when the registered request is missing", async () => {
    const { documentId } = await start(treeDoc(), {
      registration: proposalOf("req_x"),
      request: absent,
    });
    const a = await Client.connect(documentId, agentA);
    expect(failureCode(await a.operate(setText("n_title", "A", 3)))).toBe(
      "catalog_inconsistent",
    );
  });

  test("an operation fails as inconsistent when the release contents are not a scope", async () => {
    const { documentId } = await start(
      treeDoc({ release: { designSystem: "ds_1", release: "rel_1" } }),
      { releaseContents: { status: "not_a_scope" } },
    );
    const a = await Client.connect(documentId, human);
    expect(failureCode(await a.operate(setText("n_title", "H", 3)))).toBe(
      "catalog_inconsistent",
    );
  });

  test("an operation fails as inconsistent when the document's release is not in the catalog", async () => {
    const { documentId } = await start(
      treeDoc({ release: { designSystem: "ds_1", release: "rel_z" } }),
      { releaseContents: absent },
    );
    const a = await Client.connect(documentId, human);
    expect(failureCode(await a.operate(setText("n_title", "H", 3)))).toBe(
      "catalog_inconsistent",
    );
  });
});

describe("initializing", () => {
  test("a second initialization fails and leaves the first content", async () => {
    const { documentId, stub } = await start(treeDoc());
    const second = await stub.initialize(
      treeDoc({ revision: 9, release: null }),
    );
    expect(second).toMatchObject({ ok: false, code: "already_initialized" });
    const a = await Client.connect(documentId, human);
    expect(await a.read()).toMatchObject({ type: "document", revision: 3 });
  });

  test("initializing an erased document fails and leaves no content", async () => {
    const { documentId, stub } = await start(treeDoc());
    await stub.erase();
    const again = await stub.initialize(treeDoc());
    expect(again).toMatchObject({ ok: false, code: "document_deleted" });
    const a = await Client.connect(documentId, human);
    expect(failureCode(await a.read())).toBe("document_deleted");
  });
});
