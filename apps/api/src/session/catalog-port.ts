import type { Scope } from "@doodle/design-doc";

/** What the catalog records about a document: its kind and the release that validated it. */
export type DocumentRegistration =
  | { kind: "proposal"; request: string; release: string | null }
  | { kind: "skeleton" | "snapshot"; release: string | null }
  | { kind: "dsDraft" };

/** Where a request stands, and which agent holds it while it is being drafted. */
export type RequestStanding = {
  state:
    "requested" | "inProgress" | "awaitingChoice" | "completed" | "aborted";
  agent: string | null;
};

/** The only way a document session reaches the catalog. */
export type CatalogPort = {
  registration(documentId: string): Promise<DocumentRegistration | null>;
  isFileDeleted(documentId: string): Promise<boolean>;
  request(requestId: string): Promise<RequestStanding | null>;
  releaseScope(releaseId: string): Promise<Scope | null>;
};
