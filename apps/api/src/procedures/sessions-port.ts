import type { DocumentSession } from "../session/document-session";
import type { DocumentSessions } from "./ports";

/** The document sessions the create procedures use, one per document. A failed call is an unreachable session. */
export const documentSessionsFromEnv = (env: {
  DOCUMENT_SESSION: DurableObjectNamespace<DocumentSession>;
}): DocumentSessions => {
  const session = (documentId: string) =>
    env.DOCUMENT_SESSION.get(env.DOCUMENT_SESSION.idFromName(documentId));
  return {
    async initialize(documentId, content) {
      try {
        const result = await session(documentId).initialize(content);
        return result.ok ? { status: "ok" } : { status: result.code };
      } catch (error) {
        console.error(error);
        return { status: "unreachable" };
      }
    },
    async erase(documentId) {
      try {
        await session(documentId).erase();
        return { status: "ok" };
      } catch (error) {
        console.error(error);
        return { status: "unreachable" };
      }
    },
  };
};
