import type { EditOperation } from "@doodle/design-doc";
import {
  identityToSearch,
  type ClientMessage,
  type Identity,
  type ServerMessage,
} from "@doodle/protocol";
import { exports } from "cloudflare:workers";

export const human: Identity = { kind: "human" };
export const agentA: Identity = { kind: "agent", agentId: "agt_A" };
export const agentB: Identity = { kind: "agent", agentId: "agt_B" };

let counter = 0;
export const newId = (prefix: string) =>
  `${prefix}_${++counter}_${crypto.randomUUID()}`;

const WAIT_MS = 5_000;

export class Client {
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
    const query = identityToSearch(identity);
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

export const failureCode = (message: ServerMessage): unknown =>
  message.type === "failure" ? message.failure.code : message.type;
