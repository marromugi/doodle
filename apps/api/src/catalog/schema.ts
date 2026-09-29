import { z } from "@hono/zod-openapi";

const ReleaseReferenceSchema = z
  .object({ designSystem: z.string(), release: z.string() })
  .openapi("ReleaseReference");

export type ReleaseReference = z.infer<typeof ReleaseReferenceSchema>;

export type AddFileInput =
  | { kind: "designSystem"; name: string }
  | { kind: "app"; name: string; reference: ReleaseReference | null };

export type AddedFile = {
  id: string;
  kind: "designSystem" | "app";
  name: string;
  createdAt: string;
};

const ReleaseSummarySchema = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    message: z.string().nullable(),
  })
  .openapi("ReleaseSummary");

const DesignSystemItemSchema = z
  .object({
    id: z.string(),
    kind: z.literal("designSystem"),
    name: z.string(),
    updatedAt: z.string(),
    latestRelease: ReleaseSummarySchema.nullable(),
    usedByApps: z.number().int(),
    referenced: z.boolean(),
  })
  .openapi("DesignSystemItem");

const AppItemSchema = z
  .object({
    id: z.string(),
    kind: z.literal("app"),
    name: z.string(),
    updatedAt: z.string(),
    reference: ReleaseReferenceSchema.nullable(),
    hasNewerRelease: z.boolean(),
  })
  .openapi("AppItem");

export const FileItemSchema = z
  .discriminatedUnion("kind", [DesignSystemItemSchema, AppItemSchema])
  .openapi("FileItem");

export type FileItem = z.infer<typeof FileItemSchema>;

export const FileListSchema = z
  .object({ files: z.array(FileItemSchema) })
  .openapi("FileList");

export const DocumentEntrySchema = z
  .discriminatedUnion("kind", [
    z.object({
      id: z.string(),
      file: z.string(),
      kind: z.literal("skeleton"),
      page: z.string(),
      release: z.string().nullable(),
    }),
    z.object({
      id: z.string(),
      file: z.string(),
      kind: z.literal("proposal"),
      page: z.string(),
      request: z.string(),
      release: z.string().nullable(),
    }),
    z.object({
      id: z.string(),
      file: z.string(),
      kind: z.literal("snapshot"),
      page: z.string(),
      request: z.string(),
      release: z.string().nullable(),
    }),
    z.object({
      id: z.string(),
      file: z.string(),
      kind: z.literal("dsDraft"),
      release: z.null(),
    }),
  ])
  .openapi("DocumentEntry");

export type DocumentEntry = z.infer<typeof DocumentEntrySchema>;

export const CatalogErrorSchema = z
  .object({ code: z.string(), message: z.string() })
  .openapi("CatalogError");

export type Failure<Code extends string> = {
  ok: false;
  code: Code;
  message: string;
};
