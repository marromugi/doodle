import type { Document } from "@doodle/design-doc";

import type {
  AddFileInput,
  AddPageInput,
  CatalogPage,
  CatalogRequest,
  DocumentEntry,
  Failure,
  ReleaseReference,
} from "../catalog/schema";
import type { InitializeResult } from "../session/document-session";

/** What the file procedures ask the catalog. */
export interface FileProcedureCatalog {
  addFile(
    input: AddFileInput,
  ): Promise<{ ok: true; fileId: string } | Failure<string>>;
  removeFile(fileId: string): Promise<void>;
  addPage(input: AddPageInput): Promise<{ ok: true } | Failure<string>>;
  registerDocument(
    entry: DocumentEntry,
  ): Promise<{ ok: true } | Failure<string>>;
  getRequest(requestId: string): Promise<CatalogRequest | null>;
  getPage(pageId: string): Promise<CatalogPage | null>;
  /** What the app references now. Null for an app with no design system. */
  getReference(fileId: string): Promise<ReleaseReference | null>;
}

/** What the file procedures ask the document sessions. */
export interface DocumentSessions {
  initialize(documentId: string, content: Document): Promise<InitializeResult>;
  erase(documentId: string): Promise<void>;
}

export type FileProcedurePorts = {
  catalog: FileProcedureCatalog;
  sessions: DocumentSessions;
};
