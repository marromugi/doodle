import { registerDocument } from "../catalog/documents";
import { addFile, getFileReference, removeFile } from "../catalog/files";
import { addPage, getPage } from "../catalog/pages";
import { getRequest } from "../catalog/requests";
import type { Failure } from "../catalog/schema";
import type { DocumentSession } from "../session/document-session";
import type { DocumentSessions, FileProcedureCatalog } from "./ports";

// A D1 error while writing is a failed write; the procedures do not see D1 errors.
const guardedWrite =
  <A extends unknown[], R>(write: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R | Failure<"catalog_unavailable">> => {
    try {
      return await write(...args);
    } catch (error) {
      console.error(error);
      return {
        ok: false,
        code: "catalog_unavailable",
        message: "The catalog could not be written.",
      };
    }
  };

/** The catalog the file procedures use, backed by D1 through the catalog module. */
export const catalogFromDb = (db: D1Database): FileProcedureCatalog => ({
  addFile: guardedWrite(async (input) => {
    const result = await addFile(db, input);
    return result.ok ? { ok: true as const, fileId: result.file.id } : result;
  }),
  removeFile: (fileId) => removeFile(db, fileId),
  addPage: guardedWrite((input) => addPage(db, input)),
  registerDocument: guardedWrite((entry) => registerDocument(db, entry)),
  getRequest: (requestId) => getRequest(db, requestId),
  getPage: (pageId) => getPage(db, pageId),
  getReference: (fileId) => getFileReference(db, fileId),
});

/** The document sessions the file procedures use, one Durable Object per document. */
export const sessionsFromEnv = (env: {
  DOCUMENT_SESSION: DurableObjectNamespace<DocumentSession>;
}): DocumentSessions => {
  const stub = (documentId: string) =>
    env.DOCUMENT_SESSION.get(env.DOCUMENT_SESSION.idFromName(documentId));
  return {
    initialize: (documentId, content) => stub(documentId).initialize(content),
    erase: (documentId) => stub(documentId).erase(),
  };
};
