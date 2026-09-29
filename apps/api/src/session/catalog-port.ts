import type { Scope } from "@doodle/design-doc";

import type { DocumentEntry, RequestState } from "../catalog/schema";

/** A catalog read: a value, nothing there, or a read that did not work. */
export type Read<T> =
  | { status: "found"; value: T }
  | { status: "absent" }
  | { status: "unreadable" };

/** What a release's contents can also be: not readable as a parts scope. */
export type ScopeRead = Read<Scope> | { status: "not_a_scope" };

export type Registration = {
  kind: DocumentEntry["kind"];
  /** The request a proposal or snapshot belongs to. */
  request: string | null;
};

export type RequestStanding = {
  state: RequestState;
  /** The agent holding the request. */
  agent: string | null;
};

/** What the document session asks the catalog. */
export interface CatalogPort {
  /** Whether the file the document belongs to is deleted. Absent: the catalog does not know the document yet. */
  isFileDeleted(documentId: string): Promise<Read<boolean>>;
  /** The document's registration. It carries no release. */
  registration(documentId: string): Promise<Read<Registration>>;
  request(requestId: string): Promise<Read<RequestStanding>>;
  releaseContents(releaseId: string): Promise<ScopeRead>;
}
