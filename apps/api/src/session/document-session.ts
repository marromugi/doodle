import {
  apply,
  type Document,
  type EditOperation,
  type Scope,
  type TreeDocument,
} from "@doodle/design-doc";
import {
  ClientMessage,
  identityFromSearch,
  type Identity,
  type ServerMessage,
  type SessionFailure,
} from "@doodle/protocol";
import { DurableObject } from "cloudflare:workers";

import {
  unreadableCatalog,
  type CatalogPort,
  type Registration,
} from "./catalog-port";
import { DOCUMENT_ID_HEADER } from "./connection";

const CONTENT = "content";
const DELETED = "deleted";
const UPDATED_AT = "updatedAt";

const CLOSE_POLICY = 1008;
const CLOSE_UNSUPPORTED = 1003;
const CLOSE_ERROR = 1011;

type Attachment = { documentId: string; identity: Identity };

type Outcome<T> =
  { ok: true; value: T } | { ok: false; failure: SessionFailure };

export type InitializeResult =
  | { ok: true }
  | {
      ok: false;
      code: "already_initialized" | "document_deleted";
      message: string;
    };

type PlainCode = Exclude<
  SessionFailure["code"],
  "conflict" | "invalid_operation"
>;

const plain = (code: PlainCode, message: string): SessionFailure => ({
  code,
  message,
});

const unavailable = plain(
  "catalog_unavailable",
  "The catalog could not be read.",
);
const inconsistent = (what: string): SessionFailure =>
  plain("catalog_inconsistent", `The catalog has no ${what}.`);
const deleted = plain("document_deleted", "The document was deleted.");

const sendText = (socket: WebSocket, text: string): void => {
  try {
    socket.send(text);
  } catch {
    // The peer is gone; the close event follows.
  }
};

const send = (socket: WebSocket, message: ServerMessage): void =>
  sendText(socket, JSON.stringify(message));

export class DocumentSession extends DurableObject<Env> {
  /** Replaced in tests. */
  catalog: CatalogPort = unreadableCatalog;

  #queue: Promise<unknown> = Promise.resolve();
  #scopes = new Map<string, Scope>();
  #registrations = new Map<string, Registration>();

  /** Runs one step after every earlier step has finished. */
  #enqueue<T>(step: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(step);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async initialize(content: Document): Promise<InitializeResult> {
    return this.#enqueue(async () => {
      if (await this.ctx.storage.get<boolean>(DELETED)) {
        return {
          ok: false,
          code: "document_deleted",
          message: deleted.message,
        };
      }
      if ((await this.ctx.storage.get(CONTENT)) !== undefined) {
        return {
          ok: false,
          code: "already_initialized",
          message: "The document already has content.",
        };
      }
      await this.#save(content);
      return { ok: true };
    });
  }

  async erase(): Promise<void> {
    await this.#enqueue(async () => {
      await this.ctx.storage.put(DELETED, true);
      await this.ctx.storage.delete([CONTENT, UPDATED_AT]);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const documentId = request.headers.get(DOCUMENT_ID_HEADER);
    const identity = identityFromSearch(new URL(request.url).searchParams);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }
    if (documentId === null || identity === null) {
      return new Response("Missing document or identity.", { status: 400 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = { documentId, identity };
    server.serializeAttachment(attachment);

    try {
      const refusal = await this.#connectionRefusal(documentId);
      if (refusal) {
        send(server, { type: "failure", failure: refusal });
        server.close(CLOSE_POLICY, refusal.code);
      }
    } catch (error) {
      console.error(error);
      server.close(CLOSE_ERROR, "unexpected error");
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    socket: WebSocket,
    data: string | ArrayBuffer,
  ): Promise<void> {
    const parsed = typeof data === "string" ? parseMessage(data) : null;
    if (parsed === null) {
      socket.close(CLOSE_UNSUPPORTED, "invalid message");
      return;
    }
    const { documentId, identity } =
      socket.deserializeAttachment() as Attachment;
    try {
      await this.#enqueue(async () => {
        if (parsed.type === "read") {
          this.#reply(socket, await this.#read());
        } else {
          await this.#operate(socket, documentId, identity, parsed.operation);
        }
      });
    } catch (error) {
      console.error(error);
      socket.close(CLOSE_ERROR, "unexpected error");
    }
  }

  async #connectionRefusal(documentId: string): Promise<SessionFailure | null> {
    const fileDeleted = await this.catalog.isFileDeleted(documentId);
    if (fileDeleted.status === "unreadable") return unavailable;
    return fileDeleted.status === "found" && fileDeleted.value ? deleted : null;
  }

  #reply(socket: WebSocket, outcome: Outcome<Document>): void {
    send(
      socket,
      outcome.ok
        ? {
            type: "document",
            document: outcome.value,
            revision: outcome.value.revision,
          }
        : { type: "failure", failure: outcome.failure },
    );
  }

  async #read(): Promise<Outcome<Document>> {
    if (await this.ctx.storage.get<boolean>(DELETED)) {
      return { ok: false, failure: deleted };
    }
    const content = await this.ctx.storage.get<Document>(CONTENT);
    return content === undefined
      ? {
          ok: false,
          failure: plain("document_not_found", "The document has no content."),
        }
      : { ok: true, value: content };
  }

  async #operate(
    socket: WebSocket,
    documentId: string,
    identity: Identity,
    operation: EditOperation,
  ): Promise<void> {
    const fail = (failure: SessionFailure) =>
      send(socket, { type: "failure", failure });

    const current = await this.#read();
    if (!current.ok) return fail(current.failure);
    const document = current.value;

    if (identity.kind === "agent") {
      const refusal = await this.#agentRefusal(documentId, identity.agentId);
      if (refusal) return fail(refusal);
    }

    let result;
    if (document.kind === "tree") {
      const scope = await this.#scopeOf(document);
      if (!scope.ok) return fail(scope.failure);
      result = apply(document, operation, scope.value);
    } else {
      result = apply(document, operation);
    }
    if (!result.ok) {
      const conflict = result.reasons.find((r) => r.code === "conflict");
      return fail(
        conflict
          ? {
              code: "conflict",
              latestRevision: conflict.latestRevision,
              message: conflict.message,
            }
          : {
              code: "invalid_operation",
              reasons: result.reasons,
              message: "The operation was rejected.",
            },
      );
    }

    await this.#save(result.value);
    const applied: ServerMessage = {
      type: "applied",
      document: result.value,
      revision: result.value.revision,
    };
    const text = JSON.stringify(applied);
    for (const each of this.ctx.getWebSockets()) sendText(each, text);
  }

  async #save(document: Document): Promise<void> {
    await this.ctx.storage.put({
      [CONTENT]: document,
      [UPDATED_AT]: new Date().toISOString(),
    });
  }

  async #agentRefusal(
    documentId: string,
    agentId: string,
  ): Promise<SessionFailure | null> {
    const cached = this.#registrations.get(documentId);
    const registration = cached
      ? ({ status: "found", value: cached } as const)
      : await this.catalog.registration(documentId);
    if (registration.status === "unreadable") return unavailable;
    if (registration.status === "found") {
      this.#registrations.set(documentId, registration.value);
    }
    if (registration.status === "absent") {
      return plain(
        "document_not_registered",
        "The catalog does not have the document yet.",
      );
    }
    if (registration.value.kind !== "proposal") {
      return plain(
        "not_candidate_document",
        "Agents can only edit a proposal document.",
      );
    }
    if (registration.value.request === null) return inconsistent("request");

    const request = await this.catalog.request(registration.value.request);
    if (request.status === "unreadable") return unavailable;
    if (request.status === "absent") return inconsistent("request");

    switch (request.value.state) {
      case "aborted":
        return plain("request_aborted", "The request was aborted.");
      case "awaitingChoice":
      case "completed":
        return plain("request_finished", "The request is finished.");
      case "requested":
        return plain(
          "request_not_taken",
          "The agent has not taken the request.",
        );
      case "inProgress":
        return request.value.agent === agentId
          ? null
          : plain(
              "taken_by_another_agent",
              "Another agent has taken the request.",
            );
    }
  }

  async #scopeOf(document: TreeDocument): Promise<Outcome<Scope>> {
    if (document.release === null) {
      return {
        ok: true,
        value: {
          tokens: { color: {}, typography: {}, space: {}, radius: {} },
          components: {},
        },
      };
    }

    const releaseId = document.release.release;
    const cached = this.#scopes.get(releaseId);
    if (cached) return { ok: true, value: cached };

    const contents = await this.catalog.releaseContents(releaseId);
    switch (contents.status) {
      case "unreadable":
        return { ok: false, failure: unavailable };
      case "absent":
        return { ok: false, failure: inconsistent("release") };
      case "not_a_scope":
        return {
          ok: false,
          failure: plain(
            "catalog_inconsistent",
            "The release contents are not a parts scope.",
          ),
        };
      case "found":
        this.#scopes.set(releaseId, contents.value);
        return { ok: true, value: contents.value };
    }
  }
}

const parseMessage = (text: string): ClientMessage | null => {
  try {
    const parsed = ClientMessage.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
