import type { AddFileInput, Failure } from "../catalog/schema";
import {
  initializeDocument,
  newDocumentId,
  registerOrErase,
} from "./document-steps";
import { emptyDraft } from "./empty-documents";
import { invalidName, NameSchema } from "./name";
import type { FileProcedurePorts } from "./ports";

export type CreateFileResult =
  | { ok: true; fileId: string; draftDocumentId?: string }
  | Failure<"invalid_name" | "registration_failed" | "initialization_failed">;

/** Creates a file. A design system file also gets an empty draft document. */
export async function createFile(
  ports: FileProcedurePorts,
  input: AddFileInput,
): Promise<CreateFileResult> {
  if (!NameSchema.safeParse(input.name).success) return invalidName();

  const file = await ports.catalog.addFile(input);
  if (!file.ok) {
    return { ok: false, code: "registration_failed", message: file.message };
  }
  if (input.kind === "app") return { ok: true, fileId: file.fileId };

  const draftDocumentId = newDocumentId();
  const failure =
    (await initializeDocument(ports, draftDocumentId, emptyDraft())) ??
    (await registerOrErase(ports, {
      id: draftDocumentId,
      file: file.fileId,
      kind: "dsDraft",
      release: null,
    }));
  if (failure !== null) {
    await ports.catalog.removeFile(file.fileId);
    return failure;
  }
  return { ok: true, fileId: file.fileId, draftDocumentId };
}
