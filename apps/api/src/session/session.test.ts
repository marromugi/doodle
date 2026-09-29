import type {
  Component,
  DraftDocument,
  EditOperation,
  Scope,
  TreeDocument,
} from "@doodle/design-doc";
import {
  ServerMessage,
  type ClientIdentity,
  type ClientMessage,
} from "@doodle/protocol";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, test } from "vitest";

import type { DocumentRegistration } from "./catalog-port";
import type { TestEnv } from "./test-worker";

const testEnv = env as TestEnv;
const catalog = testEnv.FAKE_CATALOG.getByName("catalog");

let documentCount = 0;
const newDocumentId = () => `doc_${++documentCount}`;

const human: ClientIdentity = { kind: "human" };
const agent = (agentId: string): ClientIdentity => ({ kind: "agent", agentId });

type Client = {
  send(message: ClientMessage): void;
  next(): Promise<ServerMessage>;
  closed: Promise<void>;
  close(): void;
};

const open: Client[] = [];

afterEach(() => {
  for (const client of open.splice(0)) client.close();
});

async function connect(
  documentId: string,
  identity: ClientIdentity,
): Promise<Client> {
  const url = new URL(`http://localhost/api/documents/${documentId}/session`);
  for (const [key, value] of Object.entries(identity)) {
    url.searchParams.set(key, value);
  }
  const response = await exports.default.fetch(url, {
    headers: { Upgrade: "websocket" },
  });
  const socket = response.webSocket!;
  socket.accept();

  const received: ServerMessage[] = [];
  const waiting: ((message: ServerMessage) => void)[] = [];
  socket.addEventListener("message", (event) => {
    const message = ServerMessage.parse(JSON.parse(event.data as string));
    const taker = waiting.shift();
    if (taker) taker(message);
    else received.push(message);
  });
  const closed = new Promise<void>((resolve) => {
    socket.addEventListener("close", () => resolve());
  });

  const client: Client = {
    send: (message) => socket.send(JSON.stringify(message)),
    next: () =>
      received.length > 0
        ? Promise.resolve(received.shift()!)
        : new Promise<ServerMessage>((resolve, reject) => {
            waiting.push(resolve);
            setTimeout(() => reject(new Error("no message arrived")), 5_000);
          }),
    closed,
    close: () => socket.close(),
  };
  open.push(client);
  return client;
}

function treeDocument(title = "Original"): TreeDocument {
  return {
    kind: "tree",
    revision: 3,
    release: null,
    root: {
      type: "frame",
      id: "root",
      children: [
        { type: "text", id: "n_title", text: title },
        { type: "text", id: "n_body", text: "Body" },
      ],
    },
    history: {
      nodes: { n_title: 1, n_body: 2 },
      tokens: {},
      components: {},
      nodeIds: ["n_title", "n_body"],
    },
  };
}

function draftDocument(): DraftDocument {
  return {
    kind: "draft",
    revision: 3,
    tokens: { color: {}, typography: {}, space: {}, radius: {} },
    components: {},
    history: { nodes: {}, tokens: {}, components: {}, nodeIds: [] },
  };
}

const button: Component = {
  name: "Button",
  props: { label: { type: "string", required: true } },
  root: {
    type: "frame",
    id: "btn",
    children: [{ type: "text", id: "btn-label", text: { prop: "label" } }],
  },
};

const releaseA: Scope = {
  tokens: { color: {}, typography: {}, space: {}, radius: {} },
  components: { cmp_btn: button },
};

function operation(op: EditOperation): ClientMessage {
  return { type: "operation", operation: op };
}

function setText(node: string, text: string, base: number): ClientMessage {
  return operation({ type: "set", base, node, key: "text", value: text });
}

const addButton = operation({
  type: "add",
  base: 3,
  parent: "root",
  index: 2,
  node: {
    type: "instance",
    id: "n_btn",
    component: "cmp_btn",
    props: { label: "OK" },
  },
});

function textOf(message: ServerMessage, node: string): unknown {
  if (message.type === "failure") throw new Error("expected a document");
  const doc = message.document;
  if (doc.kind !== "tree") throw new Error("expected a tree document");
  const found = doc.root.type === "frame" ? doc.root.children : [];
  const child = found.find((each) => each.id === node);
  return child?.type === "text" ? child.text : undefined;
}

async function seed(
  registration: DocumentRegistration,
  content: TreeDocument | DraftDocument = treeDocument(),
): Promise<string> {
  const id = newDocumentId();
  await catalog.put({ registrations: { [id]: registration } });
  await testEnv.DOCUMENT_SESSION.getByName(id).initialize(content, null);
  return id;
}

const skeleton: DocumentRegistration = { kind: "skeleton", release: null };
const proposalOf = (request: string): DocumentRegistration => ({
  kind: "proposal",
  request,
  release: null,
});

describe("reading", () => {
  test("a client reads the initial content the procedure stored", async () => {
    const id = await seed(skeleton, treeDocument("Start"));
    const a = await connect(id, human);

    a.send({ type: "read" });
    const message = await a.next();

    expect(message.type).toBe("document");
    expect(textOf(message, "n_title")).toBe("Start");
  });

  test("a connected client reads the current document with its revision", async () => {
    const id = await seed(skeleton);
    const a = await connect(id, human);

    a.send({ type: "read" });

    expect(await a.next()).toEqual({
      type: "document",
      document: treeDocument(),
      revision: 3,
    });
  });
});

describe("applying operations", () => {
  test("an applied operation reaches everyone connected and later readers", async () => {
    const id = await seed(skeleton);
    const a = await connect(id, human);
    const b = await connect(id, human);

    a.send(setText("n_title", "Hello", 3));
    const toA = await a.next();
    const toB = await b.next();

    for (const message of [toA, toB]) {
      expect(message.type).toBe("applied");
      expect(textOf(message, "n_title")).toBe("Hello");
      expect(message).toMatchObject({ revision: 4 });
    }

    const c = await connect(id, human);
    c.send({ type: "read" });
    const read = await c.next();
    expect(read).toMatchObject({ type: "document", revision: 4 });
    expect(textOf(read, "n_title")).toBe("Hello");
  });

  test("operations sent one after another are applied and delivered in order", async () => {
    const id = await seed(skeleton);
    const a = await connect(id, human);
    const b = await connect(id, human);

    a.send(setText("n_title", "One", 3));
    a.send(setText("n_title", "Two", 4));

    const first = await b.next();
    const second = await b.next();
    expect(first).toMatchObject({ type: "applied", revision: 4 });
    expect(textOf(first, "n_title")).toBe("One");
    expect(second).toMatchObject({ type: "applied", revision: 5 });
    expect(textOf(second, "n_title")).toBe("Two");
  });

  test("an operation that fails validation returns the reason to the sender only", async () => {
    const id = await seed(skeleton);
    const a = await connect(id, human);
    const b = await connect(id, human);

    a.send(
      operation({
        type: "add",
        base: 3,
        parent: "root",
        index: 2,
        node: { type: "text", id: "n_title", text: "Again" },
      }),
    );
    expect(await a.next()).toMatchObject({
      type: "failure",
      failure: {
        code: "invalid_operation",
        reasons: [{ code: "duplicate-node-id" }],
      },
    });

    b.send({ type: "read" });
    expect(await b.next()).toMatchObject({ type: "document", revision: 3 });

    const c = await connect(id, human);
    c.send({ type: "read" });
    expect(await c.next()).toMatchObject({ type: "document", revision: 3 });
  });

  test("an operation on a node that changed after its revision fails with the latest revision", async () => {
    const id = await seed(skeleton);
    const a = await connect(id, human);
    const b = await connect(id, human);
    b.send(setText("n_title", "B", 3));
    await a.next();
    await b.next();

    a.send(setText("n_title", "A", 3));
    expect(await a.next()).toMatchObject({
      type: "failure",
      failure: { code: "conflict", latestRevision: 4 },
    });

    a.send({ type: "read" });
    expect(textOf(await a.next(), "n_title")).toBe("B");
  });

  test("an operation on a node that did not change after its revision is applied", async () => {
    const id = await seed(skeleton);
    const a = await connect(id, human);
    const b = await connect(id, human);
    b.send(setText("n_title", "B", 3));
    await a.next();
    await b.next();

    a.send(setText("n_body", "A", 3));
    const applied = await a.next();

    expect(applied).toMatchObject({ type: "applied", revision: 5 });
    expect(textOf(applied, "n_title")).toBe("B");
    expect(textOf(applied, "n_body")).toBe("A");
  });
});

describe("the parts a document is validated against", () => {
  test("an instance of a component in the validated release is added", async () => {
    const id = await seed({ kind: "skeleton", release: "rel_a" });
    await catalog.put({ releases: { rel_a: releaseA } });
    const a = await connect(id, human);

    a.send(addButton);

    expect(await a.next()).toMatchObject({ type: "applied", revision: 4 });
  });

  test("an instance of a component is refused in an app document without a design system", async () => {
    const id = await seed(skeleton);
    const a = await connect(id, human);

    a.send(addButton);

    expect(await a.next()).toMatchObject({
      type: "failure",
      failure: {
        code: "invalid_operation",
        reasons: [{ code: "component-out-of-scope" }],
      },
    });
  });

  test("a design system draft is validated against itself after each operation", async () => {
    const id = await seed({ kind: "dsDraft" }, draftDocument());
    const a = await connect(id, human);
    const addComponent = (name: string, token: string, base: number) =>
      operation({
        type: "add-component",
        base,
        id: `cmp_${name}`,
        component: {
          name,
          props: {},
          root: {
            type: "frame",
            id: `${name}_root`,
            background: { token },
            children: [],
          },
        },
      });

    a.send(
      operation({
        type: "add-token",
        base: 3,
        token: "color.primary",
        value: "#1a73e8",
      }),
    );
    expect(await a.next()).toMatchObject({ type: "applied", revision: 4 });

    a.send(addComponent("Primary", "color.primary", 4));
    expect(await a.next()).toMatchObject({ type: "applied", revision: 5 });

    a.send(addComponent("Accent", "color.accent", 5));
    expect(await a.next()).toMatchObject({
      type: "failure",
      failure: {
        code: "invalid_operation",
        reasons: [{ code: "unknown-token" }],
      },
    });
  });
});

describe("who may send operations", () => {
  test("a human's operation passes on any document", async () => {
    await catalog.put({
      requests: { req_1: { state: "aborted", agent: null } },
    });
    const proposal = await seed(proposalOf("req_1"));
    const outline = await seed(skeleton);

    for (const id of [proposal, outline]) {
      const a = await connect(id, human);
      a.send(setText("n_title", "Human", 3));
      expect(await a.next()).toMatchObject({ type: "applied", revision: 4 });
    }
  });

  test("an agent's operation passes on the proposal of the request it holds", async () => {
    await catalog.put({
      requests: { req_1: { state: "inProgress", agent: "agt_A" } },
    });
    const id = await seed(proposalOf("req_1"));
    const a = await connect(id, agent("agt_A"));

    a.send(setText("n_title", "Agent", 3));

    expect(await a.next()).toMatchObject({ type: "applied", revision: 4 });
  });

  test("an agent's operation on a skeleton, a snapshot and a design system draft fails as not a proposal document", async () => {
    await catalog.put({
      requests: { req_1: { state: "inProgress", agent: "agt_A" } },
    });
    const documents = [
      await seed(skeleton),
      await seed({ kind: "snapshot", release: null }),
      await seed({ kind: "dsDraft" }, draftDocument()),
    ];
    const attempts = [
      setText("n_title", "Agent", 3),
      setText("n_title", "Agent", 3),
      operation({
        type: "add-token",
        base: 3,
        token: "color.primary",
        value: "#1a73e8",
      }),
    ];

    for (const [index, id] of documents.entries()) {
      const a = await connect(id, agent("agt_A"));
      a.send(attempts[index]!);
      expect(await a.next()).toMatchObject({
        type: "failure",
        failure: { code: "not_candidate_document" },
      });
    }
  });

  test("an agent that does not hold the request fails as taken by another agent", async () => {
    await catalog.put({
      requests: { req_1: { state: "inProgress", agent: "agt_A" } },
    });
    const id = await seed(proposalOf("req_1"));
    const b = await connect(id, agent("agt_B"));

    b.send(setText("n_title", "Agent", 3));

    expect(await b.next()).toMatchObject({
      type: "failure",
      failure: { code: "taken_by_another_agent" },
    });
  });

  test("an agent's operation fails when the request was aborted", async () => {
    await catalog.put({
      requests: { req_1: { state: "aborted", agent: "agt_A" } },
    });
    const id = await seed(proposalOf("req_1"));
    const a = await connect(id, agent("agt_A"));

    a.send(setText("n_title", "Agent", 3));

    expect(await a.next()).toMatchObject({
      type: "failure",
      failure: { code: "request_aborted" },
    });
  });

  test("an agent's operation fails when the request is awaiting a choice or completed", async () => {
    const id = await seed(proposalOf("req_1"));
    const a = await connect(id, agent("agt_A"));

    for (const state of ["awaitingChoice", "completed"] as const) {
      await catalog.put({ requests: { req_1: { state, agent: "agt_A" } } });
      a.send(setText("n_title", "Agent", 3));
      expect(await a.next()).toMatchObject({
        type: "failure",
        failure: { code: "request_finished" },
      });
    }
  });

  test("an agent's operation fails when the request has not been taken", async () => {
    await catalog.put({
      requests: { req_1: { state: "requested", agent: null } },
    });
    const id = await seed(proposalOf("req_1"));
    const a = await connect(id, agent("agt_A"));

    a.send(setText("n_title", "Agent", 3));

    expect(await a.next()).toMatchObject({
      type: "failure",
      failure: { code: "request_not_taken" },
    });
  });
});

describe("deleted documents", () => {
  test("after erase, operations fail as deleted and new connections read nothing", async () => {
    const id = await seed(skeleton);
    const a = await connect(id, human);

    await testEnv.DOCUMENT_SESSION.getByName(id).erase();

    a.send(setText("n_title", "Late", 3));
    expect(await a.next()).toMatchObject({
      type: "failure",
      failure: { code: "document_deleted" },
    });

    const b = await connect(id, human);
    expect(await b.next()).toMatchObject({
      type: "failure",
      failure: { code: "document_deleted" },
    });
    await b.closed;
  });

  test("a connection is refused when the catalog says the file is deleted", async () => {
    const id = await seed(skeleton);
    await catalog.put({ deletedDocuments: [id] });

    const refused = await connect(id, human);
    expect(await refused.next()).toMatchObject({
      type: "failure",
      failure: { code: "document_deleted" },
    });
    await refused.closed;

    await catalog.put({ deletedDocuments: [] });
    const a = await connect(id, human);
    a.send({ type: "read" });
    expect(await a.next()).toMatchObject({ type: "document", revision: 3 });
  });
});
