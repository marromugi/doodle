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
    hasUnreleasedChanges: z.boolean(),
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
    inProgressRequests: z.number().int(),
    pageCount: z.number().int(),
    thumbnailDocument: z.string().nullable(),
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

export const ThumbnailPutSchema = z
  .discriminatedUnion("state", [
    z.object({
      state: z.literal("ready"),
      revision: z.number().int(),
      contentType: z.string(),
      image: z.base64(),
    }),
    z.object({
      state: z.literal("failed"),
      revision: z.number().int(),
      reason: z.string(),
    }),
  ])
  .openapi("ThumbnailPut");

export type ThumbnailPut = z.infer<typeof ThumbnailPutSchema>;

export const ThumbnailSchema = z
  .discriminatedUnion("state", [
    z.object({
      state: z.literal("ready"),
      revision: z.number().int(),
      contentType: z.string(),
      image: z.string(),
    }),
    z.object({
      state: z.literal("failed"),
      revision: z.number().int(),
      reason: z.string(),
    }),
    z.object({ state: z.literal("none") }),
  ])
  .openapi("Thumbnail");

export type Thumbnail = z.infer<typeof ThumbnailSchema>;

export const CatalogErrorSchema = z
  .object({ code: z.string(), message: z.string() })
  .openapi("CatalogError");

export type Failure<Code extends string> = {
  ok: false;
  code: Code;
  message: string;
};

export const RequestStateSchema = z
  .enum(["requested", "inProgress", "awaitingChoice", "completed", "aborted"])
  .openapi("RequestState");

export type RequestState = z.infer<typeof RequestStateSchema>;

export const RequestSchema = z
  .object({
    id: z.string(),
    page: z.string(),
    snapshot: z.string(),
    references: z.array(z.string()),
    feedback: z.string(),
    previous: z.string().nullable(),
    state: RequestStateSchema,
    agent: z.string().nullable(),
    delivered: z.boolean(),
    adoptedProposal: z.string().nullable(),
  })
  .openapi("Request");

export type CatalogRequest = z.infer<typeof RequestSchema>;

export const RequestListSchema = z
  .object({ requests: z.array(RequestSchema) })
  .openapi("RequestList");

export const PageSchema = z
  .object({
    id: z.string(),
    file: z.string(),
    name: z.string(),
    skeleton: z.string(),
    adoptedProposal: z.string().nullable(),
  })
  .openapi("Page");

export type CatalogPage = z.infer<typeof PageSchema>;

export const PageListSchema = z
  .object({ pages: z.array(PageSchema) })
  .openapi("PageList");

export const TransitionErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    state: RequestStateSchema.optional(),
  })
  .openapi("TransitionError");

export const AbortedRequestsSchema = z
  .object({ aborted: z.array(z.string()) })
  .openapi("AbortedRequests");

export type AddRequestInput = {
  page: string;
  snapshot: string;
  references: string[];
  feedback: string;
  previous: string | null;
};

export type AddPageInput = {
  id: string;
  file: string;
  skeleton: string;
  name: string;
};

export const AuthorKindSchema = z
  .enum(["human", "agent"])
  .openapi("AuthorKind");

export type AuthorKind = z.infer<typeof AuthorKindSchema>;

export const CommentSchema = z
  .object({
    id: z.string(),
    authorKind: AuthorKindSchema,
    body: z.string(),
    createdAt: z.string(),
  })
  .openapi("Comment");

export type Comment = z.infer<typeof CommentSchema>;

export const ThreadSchema = z
  .object({
    id: z.string(),
    document: z.string(),
    node: z.string(),
    awaitingReply: z.boolean(),
    comments: z.array(CommentSchema),
  })
  .openapi("Thread");

export type Thread = z.infer<typeof ThreadSchema>;

export const ThreadListSchema = z
  .object({ threads: z.array(ThreadSchema) })
  .openapi("ThreadList");

export const AddThreadSchema = z
  .object({
    document: z.string(),
    node: z.string(),
    authorKind: AuthorKindSchema,
    body: z.string(),
  })
  .openapi("AddThread");

export type AddThreadInput = z.infer<typeof AddThreadSchema>;

export const AddCommentSchema = z
  .object({ authorKind: AuthorKindSchema, body: z.string() })
  .openapi("AddComment");

export type AddCommentInput = z.infer<typeof AddCommentSchema>;

export type ThreadFilter = { document?: string; awaitingReply?: true };
