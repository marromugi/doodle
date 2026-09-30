import type { TreeDocument } from "@doodle/design-doc";
import { abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import type { EraseRetry } from "./erase-retry";
import { eraseRetryFromEnv, eraseRetryStub } from "./erase-retry-port";
import type { DocumentSessions } from "./ports";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const emptyDocument: TreeDocument = {
  kind: "tree",
  revision: 0,
  release: null,
  root: { type: "frame", id: "n_root", children: [] },
  history: { nodes: {}, tokens: {}, components: {}, nodeIds: ["n_root"] },
};

describe("the erase retry", () => {
  test("with an interval of 1 second, a handed document d_z gets no erase at 0.5 seconds, a first erase that does not arrive by 1.5 seconds, a second that succeeds by 2.5 seconds, and no more until 4 seconds", async () => {
    const calls: { documentId: string; at: number }[] = [];
    let started = 0;
    const sessions: DocumentSessions = {
      initialize: async () => ({ status: "ok" }),
      erase: async (documentId) => {
        calls.push({ documentId, at: Date.now() - started });
        return { status: calls.length === 1 ? "unreachable" : "ok" };
      },
    };
    await runInDurableObject(eraseRetryStub(env), (instance: EraseRetry) => {
      instance.sessions = sessions;
    });

    started = Date.now();
    const handed = await eraseRetryFromEnv(env).hand("d_z");
    expect(handed).toEqual({ status: "accepted" });

    await sleep(500 - (Date.now() - started));
    expect(calls).toEqual([]);

    await sleep(1500 - (Date.now() - started));
    expect(calls.map((call) => call.documentId)).toEqual(["d_z"]);

    await sleep(2500 - (Date.now() - started));
    expect(calls.map((call) => call.documentId)).toEqual(["d_z", "d_z"]);

    await sleep(4000 - (Date.now() - started));
    expect(calls).toHaveLength(2);
  });

  test("a handed document d_w is erased within 1.5 seconds even when the retry's memory is discarded right after it was accepted", async () => {
    const session = env.DOCUMENT_SESSION.get(
      env.DOCUMENT_SESSION.idFromName("d_w"),
    );
    await session.initialize(emptyDocument);

    const started = Date.now();
    const handed = await eraseRetryFromEnv(env).hand("d_w");
    expect(handed).toEqual({ status: "accepted" });
    await abortAllDurableObjects();

    await sleep(1500 - (Date.now() - started));
    const again = await env.DOCUMENT_SESSION.get(
      env.DOCUMENT_SESSION.idFromName("d_w"),
    ).initialize(emptyDocument);
    expect(again).toMatchObject({ ok: false, code: "document_deleted" });
  });
});
