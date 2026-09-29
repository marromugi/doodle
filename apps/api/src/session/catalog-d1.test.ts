import type { EditOperation, Scope, TreeDocument } from "@doodle/design-doc";
import {
  identityToSearch,
  type ClientMessage,
  type Identity,
  type ServerMessage,
} from "@doodle/protocol";
import { env, exports } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import { addFile, addPage, addRequest, registerDocument } from "../catalog";
import { isDocumentFileDeleted } from "../catalog/documents";
import { putRelease as insertRelease } from "../catalog/test-helpers";
import { takeRequest } from "../catalog/transitions";
import { catalogFromEnv } from "./catalog-d1";
import type { DocumentSession } from "./document-session";

const db = env.DB;

const human: Identity = { kind: "human" };
const agentA: Identity = { kind: "agent", agentId: "agt_A" };
const agentB: Identity = { kind: "agent", agentId: "agt_B" };

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

const exchange = async (
  documentId: string,
  identity: Identity,
  message: ClientMessage,
): Promise<ServerMessage> => {
  const response = await exports.default.fetch(
    `http://localhost/api/documents/${documentId}/session?${identityToSearch(identity)}`,
    { headers: { Upgrade: "websocket" } },
  );
  const socket = response.webSocket;
  if (!socket) throw new Error(`no WebSocket, status ${response.status}`);
  socket.accept();
  const reply = new Promise<ServerMessage>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no message")), 5_000);
    socket.addEventListener("message", (event) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(event.data)) as ServerMessage);
    });
  });
  socket.send(JSON.stringify(message));
  const result = await reply;
  socket.close();
  return result;
};

const operate = (
  documentId: string,
  identity: Identity,
  operation: EditOperation,
) => exchange(documentId, identity, { type: "operation", operation });

const failureCode = (message: ServerMessage): unknown =>
  message.type === "failure" ? message.failure.code : message.type;

const stubOf = (documentId: string) =>
  env.DOCUMENT_SESSION.get(
    env.DOCUMENT_SESSION.idFromName(documentId),
  ) as DurableObjectStub<DocumentSession>;

const withPrimary: Scope = {
  tokens: {
    color: { primary: "#1a73e8" },
    typography: {},
    space: {},
    radius: {},
  },
  components: {},
};

const paint: EditOperation = {
  type: "set",
  base: 0,
  node: "n_box",
  key: "background",
  value: { token: "color.primary" },
};

const boxDocument = (
  release: TreeDocument["release"],
  revision = 0,
): TreeDocument => ({
  kind: "tree",
  revision,
  release,
  root: { type: "frame", id: "n_box", children: [] },
  history: { nodes: {}, tokens: {}, components: {}, nodeIds: ["n_box"] },
});

const addDesignSystem = async (): Promise<string> => {
  const result = await addFile(db, { kind: "designSystem", name: "Kit" });
  if (!result.ok) throw new Error(result.message);
  return result.file.id;
};

const addApp = async (): Promise<string> => {
  const result = await addFile(db, {
    kind: "app",
    name: "Shop",
    reference: null,
  });
  if (!result.ok) throw new Error(result.message);
  return result.file.id;
};

type Registered = {
  app: string;
  designSystem: string;
  release: string;
  request: string;
  proposal: string;
};

const register = async (): Promise<Registered> => {
  const designSystem = await addDesignSystem();
  const release = newId("rel");
  await insertRelease(db, release, designSystem, JSON.stringify(withPrimary));
  const app = await addApp();
  const page = newId("p");
  const added = await addPage(db, {
    id: page,
    file: app,
    skeleton: newId("doc_skel"),
    name: "Home",
  });
  if (!added.ok) throw new Error(added.message);

  const request = await addRequest(db, {
    page,
    snapshot: newId("doc_snap"),
    references: [],
    feedback: "wider",
    previous: null,
  });
  if (!request.ok) throw new Error(request.message);
  const taken = await takeRequest(db, request.request.id, "agt_A");
  if (!taken.ok) throw new Error(taken.message);

  const proposal = newId("d_x");
  const registered = await registerDocument(db, {
    id: proposal,
    file: app,
    kind: "proposal",
    page,
    request: request.request.id,
    release: null,
  });
  if (!registered.ok) throw new Error(registered.message);
  return {
    app,
    designSystem,
    release,
    request: request.request.id,
    proposal,
  };
};

describe("the session on the real catalog", () => {
  test("a registered proposal takes the operation of the agent holding the request only", async () => {
    const setup = await register();
    const content = boxDocument({
      designSystem: setup.designSystem,
      release: setup.release,
    });
    await stubOf(setup.proposal).initialize(content);

    expect(failureCode(await operate(setup.proposal, agentB, paint))).toBe(
      "taken_by_another_agent",
    );
    expect(await operate(setup.proposal, agentA, paint)).toMatchObject({
      type: "applied",
      revision: 1,
    });
  });

  test("a document missing from the catalog is readable by a human and refuses an agent as not registered", async () => {
    const unregistered = newId("d_y");
    await stubOf(unregistered).initialize(boxDocument(null));

    expect(await exchange(unregistered, human, { type: "read" })).toMatchObject(
      { type: "document", revision: 0 },
    );
    expect(failureCode(await operate(unregistered, agentA, paint))).toBe(
      "document_not_registered",
    );
  });

  test("a release whose contents are not JSON or not a scope makes an operation fail as inconsistent", async () => {
    const designSystem = await addDesignSystem();
    const bad = newId("rel_bad");
    const shape = newId("rel_shape");
    await insertRelease(db, bad, designSystem, "{");
    await insertRelease(db, shape, designSystem, '{"tokens":{}}');

    const codes: unknown[] = [];
    for (const release of [bad, shape]) {
      const documentId = newId("d_z");
      await stubOf(documentId).initialize(
        boxDocument({ designSystem, release }),
      );
      codes.push(failureCode(await operate(documentId, human, paint)));
    }
    expect(codes).toEqual(["catalog_inconsistent", "catalog_inconsistent"]);
  });
});

describe("the catalog reads", () => {
  test("a registered document is not deleted and a missing one is not found, in the catalog and through the port", async () => {
    const setup = await register();
    const missing = newId("d_y");

    expect(await isDocumentFileDeleted(db, setup.proposal)).toEqual({
      ok: true,
      deleted: false,
    });
    expect(await isDocumentFileDeleted(db, missing)).toMatchObject({
      ok: false,
      code: "document_not_found",
    });

    const port = catalogFromEnv(env);
    expect(await port.isFileDeleted(setup.proposal)).toEqual({
      status: "found",
      value: false,
    });
    expect(await port.isFileDeleted(missing)).toEqual({ status: "absent" });
  });

  test("every read is unreadable when D1 throws", async () => {
    const broken = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("D1 is down");
        },
      },
    ) as D1Database;
    const port = catalogFromEnv({ DB: broken });

    expect(await port.isFileDeleted("d_1")).toEqual({ status: "unreadable" });
    expect(await port.registration("d_1")).toEqual({ status: "unreadable" });
    expect(await port.request("req_1")).toEqual({ status: "unreadable" });
    expect(await port.releaseContents("rel_1")).toEqual({
      status: "unreadable",
    });
  });
});
