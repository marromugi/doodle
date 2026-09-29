import { Scope } from "@doodle/design-doc";

import { getDocument } from "./catalog/documents";
import { getRequest } from "./catalog/requests";
import type { CatalogPort } from "./session";

/** The catalog port backed by the D1 catalog. */
export function d1SessionCatalog(db: D1Database): CatalogPort {
  return {
    async registration(documentId) {
      const found = await getDocument(db, documentId);
      if (!found.ok) return null;
      const entry = found.entry;
      switch (entry.kind) {
        case "proposal":
          return {
            kind: "proposal",
            request: entry.request,
            release: entry.release,
          };
        case "skeleton":
        case "snapshot":
          return { kind: entry.kind, release: entry.release };
        case "dsDraft":
          return { kind: "dsDraft" };
      }
    },

    // The catalog records no file deletion yet.
    async isFileDeleted() {
      return false;
    },

    async request(requestId) {
      const found = await getRequest(db, requestId);
      return found === null ? null : { state: found.state, agent: found.agent };
    },

    async releaseScope(releaseId) {
      const row = await db
        .prepare("SELECT content FROM releases WHERE id = ?")
        .bind(releaseId)
        .first<{ content: string }>();
      return row === null ? null : Scope.parse(JSON.parse(row.content));
    },
  };
}
