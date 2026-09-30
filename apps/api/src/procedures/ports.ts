import type { Document } from "@doodle/design-doc";

import type { ReleaseReference, RequestState } from "../catalog/schema";

// The ports never throw. What could not be reached is an answer: `unreachable`.

export type AppRead =
  | { status: "found"; reference: ReleaseReference | null }
  | { status: "file_not_found" }
  | { status: "not_an_app" }
  | { status: "unreachable" };

export type RequestRead =
  | {
      status: "found";
      state: RequestState;
      agent: string | null;
      page: string;
      /** The app the page belongs to. */
      file: string;
      /** What the app references now. */
      reference: ReleaseReference | null;
    }
  | { status: "request_not_found" }
  | { status: "page_not_found" }
  | { status: "file_not_found" }
  | { status: "unreachable" };

export type AppFileWrite =
  | { status: "written"; fileId: string }
  | { status: "reference_not_found" }
  | { status: "unreachable" };

export type DesignSystemFileWrite =
  | { status: "written"; fileId: string }
  | { status: "id_in_use" }
  | { status: "unreachable" };

export type PageWrite =
  | { status: "written" }
  | { status: "file_not_found" }
  | { status: "not_an_app" }
  | { status: "id_in_use" }
  | { status: "unreachable" };

export type ProposalWrite =
  | { status: "written" }
  | { status: "request_not_found" }
  | { status: "page_not_found" }
  | { status: "file_not_found" }
  | { status: "state_mismatch"; state: RequestState; agent: string | null }
  | { status: "id_in_use" }
  | { status: "unreachable" };

/** What the create procedures ask the catalog. */
export interface CreationCatalog {
  /** The app a page is placed in. */
  readApp(appFileId: string): Promise<AppRead>;
  /** A request, its page, and the app of the page. */
  readRequest(requestId: string): Promise<RequestRead>;
  writeAppFile(input: {
    name: string;
    reference: ReleaseReference | null;
  }): Promise<AppFileWrite>;
  /** The file record and the registration of its draft document, in one write. */
  writeDesignSystemFile(input: {
    name: string;
    draftDocumentId: string;
  }): Promise<DesignSystemFileWrite>;
  /** The page and the registration of its skeleton document, in one write. */
  writePageWithSkeleton(input: {
    pageId: string;
    appFileId: string;
    name: string;
    skeletonDocumentId: string;
    release: string | null;
  }): Promise<PageWrite>;
  /** Registers a proposal only while the request is in progress and held by the agent. */
  registerProposal(input: {
    documentId: string;
    fileId: string;
    requestId: string;
    agentId: string;
    release: string | null;
  }): Promise<ProposalWrite>;
}

export type InitializeAnswer =
  | { status: "ok" }
  | { status: "already_initialized" }
  | { status: "document_deleted" }
  | { status: "unreachable" };

export type EraseAnswer = { status: "ok" } | { status: "unreachable" };

/** What the create procedures ask the document sessions. */
export interface DocumentSessions {
  initialize(documentId: string, content: Document): Promise<InitializeAnswer>;
  erase(documentId: string): Promise<EraseAnswer>;
}

export type HandAnswer =
  /** Written where it survives a restart. */
  { status: "accepted" } | { status: "unreachable" };

/** Where documents that could not be erased are handed over. */
export interface EraseRetryPort {
  hand(documentId: string): Promise<HandAnswer>;
}

export type FileProcedurePorts = {
  catalog: CreationCatalog;
  sessions: DocumentSessions;
  eraseRetry: EraseRetryPort;
};
