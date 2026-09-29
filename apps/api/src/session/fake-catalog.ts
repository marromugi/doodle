import type { Scope } from "@doodle/design-doc";
import { DurableObject } from "cloudflare:workers";

import type {
  CatalogPort,
  DocumentRegistration,
  RequestStanding,
} from "./catalog-port";

export type FakeCatalogState = {
  registrations: Record<string, DocumentRegistration>;
  deletedDocuments: string[];
  requests: Record<string, RequestStanding>;
  releases: Record<string, Scope>;
};

const EMPTY: FakeCatalogState = {
  registrations: {},
  deletedDocuments: [],
  requests: {},
  releases: {},
};

/** An in-memory catalog that a test fills in and the session under test reads through the port. */
export class FakeCatalog extends DurableObject {
  async put(patch: Partial<FakeCatalogState>): Promise<void> {
    const current = await this.state();
    await this.ctx.storage.put("state", {
      registrations: { ...current.registrations, ...patch.registrations },
      deletedDocuments: patch.deletedDocuments ?? current.deletedDocuments,
      requests: { ...current.requests, ...patch.requests },
      releases: { ...current.releases, ...patch.releases },
    });
  }

  async state(): Promise<FakeCatalogState> {
    return (await this.ctx.storage.get<FakeCatalogState>("state")) ?? EMPTY;
  }
}

export function fakeCatalogPort(
  catalog: DurableObjectStub<FakeCatalog>,
): CatalogPort {
  return {
    async registration(documentId) {
      return (await catalog.state()).registrations[documentId] ?? null;
    },
    async isFileDeleted(documentId) {
      return (await catalog.state()).deletedDocuments.includes(documentId);
    },
    async request(requestId) {
      return (await catalog.state()).requests[requestId] ?? null;
    },
    async releaseScope(releaseId) {
      return (await catalog.state()).releases[releaseId] ?? null;
    },
  };
}
