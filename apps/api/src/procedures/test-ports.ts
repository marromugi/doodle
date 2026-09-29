import type { Document } from "@doodle/design-doc";

import type {
  CatalogPage,
  CatalogRequest,
  DocumentEntry,
  ReleaseReference,
  RequestState,
} from "../catalog/schema";
import type { InitializeResult } from "../session/document-session";
import type { DocumentSessions, FileProcedureCatalog } from "./ports";

export type FakeFile = {
  id: string;
  kind: "designSystem" | "app";
  name: string;
  reference: ReleaseReference | null;
};

export type FakeCatalog = FileProcedureCatalog & {
  files: FakeFile[];
  pages: CatalogPage[];
  documents: DocumentEntry[];
  requests: Map<string, CatalogRequest>;
  failRegistration: boolean;
};

let counter = 0;

/** An in-memory catalog. Tests set `requests`, and `failRegistration` makes document registration fail. */
export const fakeCatalog = (): FakeCatalog => {
  const catalog: FakeCatalog = {
    files: [],
    pages: [],
    documents: [],
    requests: new Map(),
    failRegistration: false,
    async addFile(input) {
      const file: FakeFile = {
        id: `file_${++counter}`,
        kind: input.kind,
        name: input.name,
        reference: input.kind === "app" ? input.reference : null,
      };
      catalog.files.push(file);
      return { ok: true, fileId: file.id };
    },
    async removeFile(fileId) {
      catalog.files = catalog.files.filter((file) => file.id !== fileId);
    },
    async addPage(input) {
      catalog.pages.push({
        id: input.id,
        file: input.file,
        name: input.name,
        skeleton: input.skeleton,
        adoptedProposal: null,
      });
      return { ok: true };
    },
    async registerDocument(entry) {
      if (catalog.failRegistration) {
        return {
          ok: false,
          code: "write_failed",
          message: "The registry could not be written.",
        };
      }
      catalog.documents.push(entry);
      return { ok: true };
    },
    async getRequest(requestId) {
      return catalog.requests.get(requestId) ?? null;
    },
    async getPage(pageId) {
      return catalog.pages.find((page) => page.id === pageId) ?? null;
    },
    async getReference(fileId) {
      return (
        catalog.files.find((file) => file.id === fileId)?.reference ?? null
      );
    },
  };
  return catalog;
};

export type FakeSessions = DocumentSessions & {
  /** What each initialised document was given. */
  contents: Map<string, Document>;
  /** The IDs of the documents that were told to erase themselves. */
  erased: string[];
  /** What `initialize` answers. */
  result: InitializeResult;
};

/** Document sessions that keep what they are given. */
export const fakeSessions = (): FakeSessions => {
  const sessions: FakeSessions = {
    contents: new Map(),
    erased: [],
    result: { ok: true },
    async initialize(documentId, content) {
      if (sessions.result.ok) sessions.contents.set(documentId, content);
      return sessions.result;
    },
    async erase(documentId) {
      sessions.erased.push(documentId);
    },
  };
  return sessions;
};

/** Adds an app to the fake catalog and returns its ID. */
export const addApp = (
  catalog: FakeCatalog,
  reference: ReleaseReference | null,
): string => {
  const id = `file_${++counter}`;
  catalog.files.push({ id, kind: "app", name: "Shop", reference });
  return id;
};

/** Adds a page with a request in the given state to the fake catalog. */
export const addRequest = (
  catalog: FakeCatalog,
  input: {
    id: string;
    page: string;
    file: string;
    state: RequestState;
    agent: string | null;
  },
): void => {
  catalog.pages.push({
    id: input.page,
    file: input.file,
    name: "Home",
    skeleton: "doc_skeleton",
    adoptedProposal: null,
  });
  catalog.requests.set(input.id, {
    id: input.id,
    page: input.page,
    snapshot: "doc_snapshot",
    references: [],
    feedback: "",
    previous: null,
    state: input.state,
    agent: input.agent,
    delivered: false,
    adoptedProposal: null,
  });
};
