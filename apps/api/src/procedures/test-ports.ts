import type { Document } from "@doodle/design-doc";

import type { ReleaseReference, RequestState } from "../catalog/schema";
import type {
  AppFileWrite,
  AppRead,
  CreationCatalog,
  DesignSystemFileWrite,
  DocumentSessions,
  EraseRetryPort,
  FileProcedurePorts,
  HandAnswer,
  PageWrite,
  ProposalWrite,
  RequestRead,
} from "./ports";

export type FakeFile = {
  id: string;
  kind: "designSystem" | "app";
  name: string;
  reference: ReleaseReference | null;
};

export type FakePage = {
  id: string;
  file: string;
  name: string;
  skeleton: string;
};

export type FakeRegistration = {
  id: string;
  file: string;
  kind: "dsDraft" | "skeleton" | "proposal";
  page: string | null;
  request: string | null;
  release: string | null;
};

export type FakeRequest = {
  id: string;
  page: string;
  state: RequestState;
  agent: string | null;
};

export type FakeCatalog = CreationCatalog & {
  files: FakeFile[];
  pages: FakePage[];
  registrations: FakeRegistration[];
  requests: FakeRequest[];
  /** The releases the catalog knows. */
  releases: ReleaseReference[];
  /** A set answer is returned as it is, and the call writes nothing. */
  answer: {
    readApp?: AppRead;
    readRequest?: RequestRead;
    writeAppFile?: AppFileWrite;
    writeDesignSystemFile?: DesignSystemFileWrite;
    writePageWithSkeleton?: PageWrite;
    registerProposal?: ProposalWrite;
  };
};

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${++counter}`;

/** An in-memory catalog that follows the rules the real catalog keeps. */
export const fakeCatalog = (): FakeCatalog => {
  const catalog: FakeCatalog = {
    files: [],
    pages: [],
    registrations: [],
    requests: [],
    releases: [],
    answer: {},
    async readApp(appFileId) {
      if (catalog.answer.readApp) return catalog.answer.readApp;
      const file = catalog.files.find((item) => item.id === appFileId);
      if (file === undefined) return { status: "file_not_found" };
      if (file.kind !== "app") return { status: "not_an_app" };
      return { status: "found", reference: file.reference };
    },
    async readRequest(requestId) {
      if (catalog.answer.readRequest) return catalog.answer.readRequest;
      const request = catalog.requests.find((item) => item.id === requestId);
      if (request === undefined) return { status: "request_not_found" };
      const page = catalog.pages.find((item) => item.id === request.page);
      if (page === undefined) return { status: "page_not_found" };
      const file = catalog.files.find((item) => item.id === page.file);
      if (file === undefined) return { status: "file_not_found" };
      return {
        status: "found",
        state: request.state,
        agent: request.agent,
        page: page.id,
        file: file.id,
        reference: file.reference,
      };
    },
    async writeAppFile(input) {
      if (catalog.answer.writeAppFile) return catalog.answer.writeAppFile;
      const { reference } = input;
      if (
        reference !== null &&
        !catalog.releases.some(
          (release) =>
            release.designSystem === reference.designSystem &&
            release.release === reference.release,
        )
      ) {
        return { status: "reference_not_found" };
      }
      const id = nextId("file");
      catalog.files.push({ id, kind: "app", name: input.name, reference });
      return { status: "written", fileId: id };
    },
    async writeDesignSystemFile(input) {
      if (catalog.answer.writeDesignSystemFile) {
        return catalog.answer.writeDesignSystemFile;
      }
      const id = nextId("file");
      catalog.files.push({
        id,
        kind: "designSystem",
        name: input.name,
        reference: null,
      });
      catalog.registrations.push({
        id: input.draftDocumentId,
        file: id,
        kind: "dsDraft",
        page: null,
        request: null,
        release: null,
      });
      return { status: "written", fileId: id };
    },
    async writePageWithSkeleton(input) {
      if (catalog.answer.writePageWithSkeleton) {
        return catalog.answer.writePageWithSkeleton;
      }
      const file = catalog.files.find((item) => item.id === input.appFileId);
      if (file === undefined) return { status: "file_not_found" };
      if (file.kind !== "app") return { status: "not_an_app" };
      catalog.pages.push({
        id: input.pageId,
        file: input.appFileId,
        name: input.name,
        skeleton: input.skeletonDocumentId,
      });
      catalog.registrations.push({
        id: input.skeletonDocumentId,
        file: input.appFileId,
        kind: "skeleton",
        page: input.pageId,
        request: null,
        release: input.release,
      });
      return { status: "written" };
    },
    async registerProposal(input) {
      if (catalog.answer.registerProposal) {
        return catalog.answer.registerProposal;
      }
      const request = catalog.requests.find(
        (item) => item.id === input.requestId,
      );
      if (request === undefined) return { status: "request_not_found" };
      if (request.state !== "inProgress" || request.agent !== input.agentId) {
        return {
          status: "state_mismatch",
          state: request.state,
          agent: request.agent,
        };
      }
      catalog.registrations.push({
        id: input.documentId,
        file: input.fileId,
        kind: "proposal",
        page: request.page,
        request: request.id,
        release: input.release,
      });
      return { status: "written" };
    },
  };
  return catalog;
};

export type FakeSessions = DocumentSessions & {
  /** What each initialised document was given. */
  contents: Map<string, Document>;
  /** The IDs `initialize` was called with. */
  initializeCalls: string[];
  /** The IDs `erase` was called with. */
  erased: string[];
  initializeStatus:
    "ok" | "already_initialized" | "document_deleted" | "unreachable";
  eraseStatus: "ok" | "unreachable";
  /** Runs while a document is being initialised. */
  duringInitialize: () => Promise<void>;
};

/** Document sessions that keep what they are given. */
export const fakeSessions = (): FakeSessions => {
  const sessions: FakeSessions = {
    contents: new Map(),
    initializeCalls: [],
    erased: [],
    initializeStatus: "ok",
    eraseStatus: "ok",
    duringInitialize: async () => {},
    async initialize(documentId, content) {
      sessions.initializeCalls.push(documentId);
      await sessions.duringInitialize();
      if (sessions.initializeStatus === "ok") {
        sessions.contents.set(documentId, content);
      }
      return { status: sessions.initializeStatus };
    },
    async erase(documentId) {
      sessions.erased.push(documentId);
      return { status: sessions.eraseStatus };
    },
  };
  return sessions;
};

export type FakeEraseRetry = EraseRetryPort & {
  /** The IDs `hand` was called with. */
  handed: string[];
  answer: HandAnswer;
};

export const fakeEraseRetry = (): FakeEraseRetry => {
  const retry: FakeEraseRetry = {
    handed: [],
    answer: { status: "accepted" },
    async hand(documentId) {
      retry.handed.push(documentId);
      return retry.answer;
    },
  };
  return retry;
};

export type Fakes = {
  catalog: FakeCatalog;
  sessions: FakeSessions;
  eraseRetry: FakeEraseRetry;
  ports: FileProcedurePorts;
};

export const fakes = (): Fakes => {
  const catalog = fakeCatalog();
  const sessions = fakeSessions();
  const eraseRetry = fakeEraseRetry();
  return {
    catalog,
    sessions,
    eraseRetry,
    ports: { catalog, sessions, eraseRetry },
  };
};

/** Adds a file to the fake catalog and returns its ID. */
export const addFile = (
  catalog: FakeCatalog,
  input: {
    id?: string;
    kind: FakeFile["kind"];
    reference?: ReleaseReference | null;
  },
): string => {
  const id = input.id ?? nextId("file");
  catalog.files.push({
    id,
    kind: input.kind,
    name: "Existing",
    reference: input.reference ?? null,
  });
  return id;
};

/** Adds a page of `file` with a request in the given state. */
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
    skeleton: nextId("doc_skeleton"),
  });
  catalog.requests.push({
    id: input.id,
    page: input.page,
    state: input.state,
    agent: input.agent,
  });
};
