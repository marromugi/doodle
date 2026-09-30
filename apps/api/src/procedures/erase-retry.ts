import { DurableObject } from "cloudflare:workers";

import type { DocumentSessions } from "./ports";
import { documentSessionsFromEnv } from "./sessions-port";

/** Each handed document ID is stored under this prefix with the time of its next erase. */
const PENDING = "pending:";
/** How many erases run at once. */
const ERASE_BATCH = 10;

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
    const due = Date.now() + this.#intervalMs();
    await this.ctx.storage.put(`${PENDING}${documentId}`, due);
    await this.#alarmNoLaterThan(due);
  }

  async alarm(): Promise<void> {
    const pending = await this.ctx.storage.list<number>({ prefix: PENDING });
    const now = Date.now();
    const retryAt = now + this.#intervalMs();
    const held: number[] = [];
    const due: string[] = [];
    for (const [key, dueAt] of pending) {
      if (dueAt > now) held.push(dueAt);
      else due.push(key);
    }

    const erased: string[] = [];
    const failed: Record<string, number> = {};
    for (let i = 0; i < due.length; i += ERASE_BATCH) {
      await Promise.all(
        due.slice(i, i + ERASE_BATCH).map(async (key) => {
          const answer = await this.sessions.erase(key.slice(PENDING.length));
          if (answer.status === "ok") erased.push(key);
          else failed[key] = retryAt;
        }),
      );
    }
    if (erased.length > 0) await this.ctx.storage.delete(erased);
    if (Object.keys(failed).length > 0) await this.ctx.storage.put(failed);

    const next = [...held, ...Object.values(failed)];
    if (next.length > 0) await this.#alarmNoLaterThan(Math.min(...next));
  }

  /** Sets the alarm to `time` unless it is already set earlier, such as by a hand-over during the erases. */
  async #alarmNoLaterThan(time: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || time < current) {
      await this.ctx.storage.setAlarm(time);
    }
  }
}
