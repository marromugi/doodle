import { registerProposal } from "../catalog/documents";
import { addFile, getApp } from "../catalog/files";
import { addPage } from "../catalog/pages";
import { getRequestApp } from "../catalog/requests";
import type { CreationCatalog } from "./ports";

const unreachable = { status: "unreachable" } as const;

// A D1 error is an unreachable catalog; the procedures never see D1 errors.
const guarded =
  <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R | typeof unreachable> => {
    try {
      return await call(...args);
    } catch (error) {
      console.error(error);
      return unreachable;
    }
  };

/** The catalog the create procedures use, backed by D1 through the catalog module. */
export const creationCatalogFromDb = (db: D1Database): CreationCatalog => ({
  readApp: guarded(async (appFileId) => {
    const app = await getApp(db, appFileId);
    if (!app.ok) return { status: "file_not_found" };
    if (app.kind !== "app") return { status: "not_an_app" };
    return { status: "found", reference: app.reference };
  }),
  readRequest: guarded(async (requestId) => {
    const request = await getRequestApp(db, requestId);
    if (!request.ok) return { status: request.code };
    return {
      status: "found",
      state: request.state,
      agent: request.agent,
      page: request.page,
      file: request.file,
      reference: request.reference,
    };
  }),
  writeAppFile: guarded(async ({ name, reference }) => {
    const result = await addFile(db, { kind: "app", name, reference });
    if (result.ok) return { status: "written", fileId: result.file.id };
    if (result.code === "reference_not_found") {
      return { status: "reference_not_found" };
    }
    // The procedure checks the name before it writes.
    throw new Error(result.message);
  }),
  writeDesignSystemFile: guarded(async ({ name, draftDocumentId }) => {
    const result = await addFile(db, {
      kind: "designSystem",
      name,
      draft: draftDocumentId,
    });
    if (result.ok) return { status: "written", fileId: result.file.id };
    if (result.code === "document_exists") return { status: "id_in_use" };
    throw new Error(result.message);
  }),
  writePageWithSkeleton: guarded(async (input) => {
    const result = await addPage(db, {
      id: input.pageId,
      file: input.appFileId,
      name: input.name,
      skeleton: input.skeletonDocumentId,
      release: input.release,
    });
    if (result.ok) return { status: "written" };
    switch (result.code) {
      case "file_not_found":
      case "not_an_app":
        return { status: result.code };
      case "page_exists":
      case "document_exists":
        return { status: "id_in_use" };
    }
  }),
  registerProposal: guarded(async (input) => {
    const result = await registerProposal(db, {
      id: input.documentId,
      file: input.fileId,
      request: input.requestId,
      agent: input.agentId,
      release: input.release,
    });
    if (result.ok) return { status: "written" };
    switch (result.code) {
      case "request_not_found":
      case "page_not_found":
      case "file_not_found":
        return { status: result.code };
      case "request_state_mismatch":
        return {
          status: "state_mismatch",
          state: result.state,
          agent: result.agent,
        };
      case "document_exists":
        return { status: "id_in_use" };
    }
  }),
});
