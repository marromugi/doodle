import type { Failure } from "../catalog/schema";
import { emptyDraft } from "./empty-documents";
import { invalidName, NameSchema } from "./name";
import type { FileProcedurePorts } from "./ports";
import {
  catalogUnavailable,
  eraseDocument,
  initializeDocument,
  newDocumentId,
  registrationFailed,
} from "./steps";

export type CreateFileInput =
  | { kind: "designSystem"; name: string }
  | {
      kind: "app";
      name: string;
      reference: { designSystem: string; release: string } | null;
    };

export type CreateFileResult =
  | { ok: true; fileId: string; draftDocumentId?: string }
  | Failure<
      | "invalid_name"
      | "reference_not_found"
      | "registration_failed"
      | "initialization_failed"
      | "catalog_unavailable"
      | "session_unavailable"
    >;

/** Creates a file. A design system file also gets an empty draft document. */
export async function createFile(
  ports: FileProcedurePorts,
  input: CreateFileInput,
): Promise<CreateFileResult> {
  if (!NameSchema.safeParse(input.name).success) return invalidName();

  if (input.kind === "app") {
    const written = await ports.catalog.writeAppFile({
      name: input.name,
      reference: input.reference,
    });
    switch (written.status) {
      case "written":
        return { ok: true, fileId: written.fileId };
      case "reference_not_found":
        return {
          ok: false,
          code: "reference_not_found",
          message: "The release does not exist for that design system.",
        };
      case "unreachable":
        return catalogUnavailable();
    }
  }

  const draftDocumentId = newDocumentId();
  const initialized = await initializeDocument(
    ports,
    draftDocumentId,
    emptyDraft(),
  );
  if (initialized !== null) return initialized;

  const written = await ports.catalog.writeDesignSystemFile({
    name: input.name,
    draftDocumentId,
  });
  switch (written.status) {
    case "written":
      return { ok: true, fileId: written.fileId, draftDocumentId };
    case "id_in_use":
      await eraseDocument(ports, draftDocumentId);
      return registrationFailed("The draft");
    case "unreachable":
      return catalogUnavailable();
  }
}
