import type { Document } from "@doodle/design-doc";

import type { Failure } from "../catalog/schema";
import type { FileProcedurePorts } from "./ports";

export const newDocumentId = (): string => `doc_${crypto.randomUUID()}`;

export const catalogUnavailable = (): Failure<"catalog_unavailable"> => ({
  ok: false,
  code: "catalog_unavailable",
  message: "The catalog could not be reached.",
});

export const registrationFailed = (
  what: string,
): Failure<"registration_failed"> => ({
  ok: false,
  code: "registration_failed",
  message: `${what} could not be registered: the ID is already in use.`,
});

/** Hands a document whose content may remain to the erase retry. */
async function handOver(
  ports: FileProcedurePorts,
  documentId: string,
): Promise<void> {
  const answer = await ports.eraseRetry.hand(documentId);
  if (answer.status === "unreachable") {
    console.error(
      `Document ${documentId} could not be handed to the erase retry and its content remains.`,
    );
  }
}

/** Puts the first content into the document. A document that may have been left behind is handed over. */
export async function initializeDocument(
  ports: FileProcedurePorts,
  documentId: string,
  content: Document,
): Promise<Failure<"initialization_failed" | "session_unavailable"> | null> {
  const answer = await ports.sessions.initialize(documentId, content);
  switch (answer.status) {
    case "ok":
      return null;
    case "already_initialized":
    case "document_deleted":
      return {
        ok: false,
        code: "initialization_failed",
        message: `Document ${documentId} could not be initialised: ${answer.status}.`,
      };
    case "unreachable":
      await handOver(ports, documentId);
      return {
        ok: false,
        code: "session_unavailable",
        message: "The document session could not be reached.",
      };
  }
}

/** Erases a document made for a creation that failed. What cannot be erased is handed over. */
export async function eraseDocument(
  ports: FileProcedurePorts,
  documentId: string,
): Promise<void> {
  const answer = await ports.sessions.erase(documentId);
  if (answer.status === "unreachable") await handOver(ports, documentId);
}
