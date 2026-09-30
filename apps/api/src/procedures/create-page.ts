import type { Failure } from "../catalog/schema";
import { emptyTree } from "./empty-documents";
import { invalidName, NameSchema } from "./name";
import type { FileProcedurePorts } from "./ports";
import {
  catalogUnavailable,
  eraseDocument,
  initializeDocument,
  newDocumentId,
  registrationFailed,
} from "./steps";

export type CreatePageResult =
  | { ok: true; pageId: string; skeletonDocumentId: string }
  | Failure<
      | "invalid_name"
      | "file_not_found"
      | "not_an_app"
      | "registration_failed"
      | "initialization_failed"
      | "catalog_unavailable"
      | "session_unavailable"
    >;

const fileNotFound = (appFileId: string): Failure<"file_not_found"> => ({
  ok: false,
  code: "file_not_found",
  message: `File ${appFileId} does not exist.`,
});

const notAnApp = (appFileId: string): Failure<"not_an_app"> => ({
  ok: false,
  code: "not_an_app",
  message: `File ${appFileId} is not an app.`,
});

/** Creates a page in an app with an empty skeleton document. */
export async function createPage(
  ports: FileProcedurePorts,
  input: { appFileId: string; name: string },
): Promise<CreatePageResult> {
  if (!NameSchema.safeParse(input.name).success) return invalidName();

  const app = await ports.catalog.readApp(input.appFileId);
  switch (app.status) {
    case "file_not_found":
      return fileNotFound(input.appFileId);
    case "not_an_app":
      return notAnApp(input.appFileId);
    case "unreachable":
      return catalogUnavailable();
    case "found":
      break;
  }

  const pageId = `page_${crypto.randomUUID()}`;
  const skeletonDocumentId = newDocumentId();
  const initialized = await initializeDocument(
    ports,
    skeletonDocumentId,
    emptyTree(app.reference),
  );
  if (initialized !== null) return initialized;

  const written = await ports.catalog.writePageWithSkeleton({
    pageId,
    appFileId: input.appFileId,
    name: input.name,
    skeletonDocumentId,
    release: app.reference?.release ?? null,
  });
  switch (written.status) {
    case "written":
      return { ok: true, pageId, skeletonDocumentId };
    case "unreachable":
      return catalogUnavailable();
    case "file_not_found":
      await eraseDocument(ports, skeletonDocumentId);
      return fileNotFound(input.appFileId);
    case "not_an_app":
      await eraseDocument(ports, skeletonDocumentId);
      return notAnApp(input.appFileId);
    case "id_in_use":
      await eraseDocument(ports, skeletonDocumentId);
      return registrationFailed("The page");
  }
}
