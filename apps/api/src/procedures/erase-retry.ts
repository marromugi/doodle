import { DurableObject } from "cloudflare:workers";

import type { DocumentSessions } from "./ports";
import { documentSessionsFromEnv } from "./sessions-port";

/** Each handed document ID is stored under this prefix with the time of its next erase. */
const PENDING = "pending:";

/**
 * Keeps document IDs whose content may remain and sends `erase` for each one
 * until it succeeds. A handed ID waits one interval before its first erase.
 */
export class EraseRetry extends DurableObject<Env> {
  /** Built from the environment on every construction; tests replace it. */
  sessions: DocumentSessions;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessions = documentSessionsFromEnv(env);
  }

  #intervalMs(): number {
    return Number(this.env.ERASE_RETRY_SECONDS) * 1000;
  }

  async hand(documentId: string): Promise<void> {
    await this.ctx.storage.put(
      `${PENDING}${documentId}`,
      Date.now() + this.#intervalMs(),
    );
    await this.#scheduleNext();
  }

  async alarm(): Promise<void> {
    const pending = await this.ctx.storage.list<number>({ prefix: PENDING });
    const now = Date.now();
    for (const [key, due] of pending) {
      if (due > now) continue;
      const answer = await this.sessions.erase(key.slice(PENDING.length));
      if (answer.status === "ok") {
        await this.ctx.storage.delete(key);
      } else {
        await this.ctx.storage.put(key, now + this.#intervalMs());
      }
    }
    await this.#scheduleNext();
  }

  /** The alarm is set to the earliest due time of the documents still held. */
  async #scheduleNext(): Promise<void> {
    const pending = await this.ctx.storage.list<number>({ prefix: PENDING });
    if (pending.size === 0) return;
    await this.ctx.storage.setAlarm(Math.min(...pending.values()));
  }
}
