import {
  apply,
  type ApplyFailure,
  type Document,
  type EditOperation,
  type Scope,
} from "@doodle/design-doc";
import {
  ClientIdentity,
  ClientMessage,
  type ServerMessage,
  type SessionFailure,
} from "@doodle/protocol";
import { DurableObject } from "cloudflare:workers";

import { agentRefusal } from "./agent-access";
import type { CatalogPort, DocumentRegistration } from "./catalog-port";

const EMPTY_SCOPE: Scope = {
  tokens: { color: {}, typography: {}, space: {}, radius: {} },
  components: {},
};

const UNSUPPORTED_DATA = 1003;
const POLICY_VIOLATION = 1008;
const INTERNAL_ERROR = 1011;

const documentDeleted: SessionFailure = {
  code: "document_deleted",
  message: "The document was deleted.",
};

/**
 * The one session of a document: it applies operations in the order they
 * arrive, saves those that pass, and delivers the result to every connection.
 */
export abstract class DocumentSessionBase extends DurableObject<Env> {
  #tail: Promise<void> = Promise.resolve();

  protected abstract catalog(): CatalogPort;

  /** Stores the initial content of a new document. */
  initialize(content: Document, releaseId: string | null): Promise<void> {
    return this.#inOrder(() =>
      this.ctx.storage.put({
        document: content,
        releaseId,
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  /** Marks the document deleted, then deletes its content. */
  erase(): Promise<void> {
    return this.#inOrder(async () => {
      await this.ctx.storage.put("deleted", true);
      await this.ctx.storage.delete(["document", "releaseId", "updatedAt"]);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }
    const identity = ClientIdentity.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!identity.success) {
      return new Response("Declare the client as human or agent.", {
        status: 400,
      });
    }

    const refused = await this.#isDeleted();
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(identity.data);
    if (refused) {
      send(server, { type: "failure", failure: documentDeleted });
      server.close(POLICY_VIOLATION, documentDeleted.code);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(
    socket: WebSocket,
    data: string | ArrayBuffer,
  ): Promise<void> {
    return this.#inOrder(() => this.#handle(socket, data));
  }

  #inOrder(task: () => Promise<unknown>): Promise<void> {
    const run = this.#tail.then(task).then(() => undefined);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  #documentId(): string {
    const name = this.ctx.id.name;
    if (name === undefined) throw new Error("The session has no name.");
    return name;
  }

  async #isDeleted(): Promise<boolean> {
    return (
      (await this.ctx.storage.get("deleted")) === true ||
      (await this.catalog().isFileDeleted(this.#documentId()))
    );
  }

  async #handle(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    try {
      const message = parseClientMessage(data);
      if (message === null) {
        socket.close(UNSUPPORTED_DATA, "Unreadable message.");
        return;
      }
      if ((await this.ctx.storage.get("deleted")) === true) {
        send(socket, { type: "failure", failure: documentDeleted });
      } else if (message.type === "read") {
        const document = await this.#load();
        send(socket, {
          type: "document",
          document,
          revision: document.revision,
        });
      } else {
        await this.#operate(socket, message.operation);
      }
    } catch (error) {
      console.error(error);
      socket.close(INTERNAL_ERROR, "Internal error.");
    }
  }

  async #load(): Promise<Document> {
    const document = await this.ctx.storage.get<Document>("document");
    if (document === undefined) throw new Error("The session has no content.");
    return document;
  }

  async #operate(socket: WebSocket, operation: EditOperation): Promise<void> {
    const identity = ClientIdentity.parse(socket.deserializeAttachment());
    const document = await this.#load();
    const registration = await this.catalog().registration(this.#documentId());
    if (registration === null)
      throw new Error("The document is not registered.");

    const refusal = await this.#refusal(identity, registration);
    if (refusal !== null) {
      send(socket, { type: "failure", failure: refusal });
      return;
    }

    const result =
      document.kind === "draft"
        ? apply(document, operation)
        : apply(document, operation, await this.#scopeOf(registration));
    if (!result.ok) {
      send(socket, { type: "failure", failure: failureOf(result.reasons) });
      return;
    }

    const saved = result.value;
    await this.ctx.storage.put({
      document: saved,
      updatedAt: new Date().toISOString(),
    });
    for (const each of this.ctx.getWebSockets()) {
      send(each, {
        type: "applied",
        document: saved,
        revision: saved.revision,
      });
    }
  }

  async #refusal(
    identity: ClientIdentity,
    registration: DocumentRegistration,
  ): Promise<SessionFailure | null> {
    if (identity.kind === "human") return null;
    if (registration.kind !== "proposal") {
      return {
        code: "not_candidate_document",
        message: "Agents edit only the proposal of a request they hold.",
      };
    }
    const standing = await this.catalog().request(registration.request);
    if (standing === null) throw new Error("The request does not exist.");
    return agentRefusal(standing, identity.agentId);
  }

  async #scopeOf(registration: DocumentRegistration): Promise<Scope> {
    const release = "release" in registration ? registration.release : null;
    if (release === null) return EMPTY_SCOPE;
    const scope = await this.catalog().releaseScope(release);
    if (scope === null) throw new Error("The release does not exist.");
    return scope;
  }
}

function parseClientMessage(data: string | ArrayBuffer): ClientMessage | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = ClientMessage.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function failureOf(reasons: ApplyFailure[]): SessionFailure {
  for (const reason of reasons) {
    if (reason.code === "conflict") {
      return {
        code: "conflict",
        latestRevision: reason.latestRevision,
        message: reason.message,
      };
    }
  }
  return {
    code: "invalid_operation",
    reasons,
    message: "The operation is not valid for the document.",
  };
}

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}
