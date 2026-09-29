import { Scope } from "@doodle/design-doc";

import { getDocument, isDocumentFileDeleted } from "../catalog/documents";
import { getReleaseContent } from "../catalog/releases";
import { getRequest } from "../catalog/requests";
import type { CatalogPort, Read } from "./catalog-port";

const found = <T>(value: T): Read<T> => ({ status: "found", value });
const absent = { status: "absent" } as const;
const unreadable = { status: "unreadable" } as const;

// A D1 error is an unreadable catalog; the session never sees D1 errors.
const guarded =
  <A extends unknown[], R>(read: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R | typeof unreadable> => {
    try {
      return await read(...args);
    } catch (error) {
      console.error(error);
      return unreadable;
    }
  };

const parseScope = (text: string): Scope | null => {
  try {
    const parsed = Scope.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** The catalog port backed by D1, through the catalog module. */
export const catalogFromEnv = (env: { DB: D1Database }): CatalogPort => ({
  isFileDeleted: guarded(async (documentId) => {
    const result = await isDocumentFileDeleted(env.DB, documentId);
    return result.ok ? found(result.deleted) : absent;
  }),
  registration: guarded(async (documentId) => {
    const result = await getDocument(env.DB, documentId);
    if (!result.ok) return absent;
    const { entry } = result;
    return found({
      kind: entry.kind,
      request: "request" in entry ? entry.request : null,
    });
  }),
  request: guarded(async (requestId) => {
    const request = await getRequest(env.DB, requestId);
    return request === null
      ? absent
      : found({ state: request.state, agent: request.agent });
  }),
  releaseContents: guarded(async (releaseId) => {
    const result = await getReleaseContent(env.DB, releaseId);
    if (!result.ok) return absent;
    const scope = parseScope(result.content);
    return scope === null ? ({ status: "not_a_scope" } as const) : found(scope);
  }),
});
