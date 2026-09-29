import type { Failure } from "../catalog/schema";
import {
  initializeDocument,
  newDocumentId,
  registerOrErase,
} from "./document-steps";
import { emptyTree } from "./empty-documents";
import { invalidName, NameSchema } from "./name";
import type { FileProcedurePorts } from "./ports";

export type CreatePageResult =
  | { ok: true; pageId: string; skeletonDocumentId: string }
  | Failure<"invalid_name" | "registration_failed" | "initialization_failed">;

/** Creates a page in an app with an empty skeleton document. */
export async function createPage(
  ports: FileProcedurePorts,
  input: { appFileId: string; name: string },
): Promise<CreatePageResult> {
  if (!NameSchema.safeParse(input.name).success) return invalidName();

  const reference = await ports.catalog.getReference(input.appFileId);
  const pageId = `page_${crypto.randomUUID()}`;
  const skeletonDocumentId = newDocumentId();

  const failure =
    (await initializeDocument(
      ports,
      skeletonDocumentId,
      emptyTree(reference),
    )) ??
    (await registerOrErase(ports, {
      id: skeletonDocumentId,
      file: input.appFileId,
      kind: "skeleton",
      page: pageId,
      release: reference?.release ?? null,
    }));
  if (failure !== null) return failure;

  const page = await ports.catalog.addPage({
    id: pageId,
    file: input.appFileId,
    skeleton: skeletonDocumentId,
    name: input.name,
  });
  if (!page.ok) {
    await ports.sessions.erase(skeletonDocumentId);
    return { ok: false, code: "registration_failed", message: page.message };
  }
  return { ok: true, pageId, skeletonDocumentId };
}
