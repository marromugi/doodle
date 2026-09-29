import type { Document } from "@doodle/design-doc";

import type { DocumentEntry, Failure } from "../catalog/schema";
import type { FileProcedurePorts } from "./ports";

export const newDocumentId = (): string => `doc_${crypto.randomUUID()}`;

/** Puts the first content into the document. A failure names why it could not. */
export async function initializeDocument(
  ports: FileProcedurePorts,
  documentId: string,
  content: Document,
): Promise<Failure<"initialization_failed"> | null> {
  const result = await ports.sessions.initialize(documentId, content);
  return result.ok
    ? null
    : { ok: false, code: "initialization_failed", message: result.message };
}

/** Registers the document. When the registry refuses, the document is erased. */
export async function registerOrErase(
  ports: FileProcedurePorts,
  entry: DocumentEntry,
): Promise<Failure<"registration_failed"> | null> {
  const result = await ports.catalog.registerDocument(entry);
  if (result.ok) return null;
  await ports.sessions.erase(entry.id);
  return { ok: false, code: "registration_failed", message: result.message };
}
