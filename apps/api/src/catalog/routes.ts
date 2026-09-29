import { Summary } from "@doodle/design-doc";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { getDocument } from "./documents";
import { listFiles, listRecentFiles } from "./files";
import {
  CatalogErrorSchema,
  DocumentEntrySchema,
  FileListSchema,
  ThumbnailPutSchema,
  ThumbnailSchema,
} from "./schema";
import { getSummary, putSummary } from "./summaries";
import { getThumbnail, putThumbnail } from "./thumbnails";

export const catalogRoutes = new OpenAPIHono<{ Bindings: Env }>();

catalogRoutes.openapi(
  createRoute({
    method: "get",
    path: "/files",
    operationId: "listFiles",
    tags: ["catalog"],
    responses: {
      200: {
        description: "ファイルの一覧です。",
        content: { "application/json": { schema: FileListSchema } },
      },
    },
  }),
  async (c) => c.json({ files: await listFiles(c.env.DB) }, 200),
);

catalogRoutes.openapi(
  createRoute({
    method: "get",
    path: "/files/recent",
    operationId: "listRecentFiles",
    tags: ["catalog"],
    responses: {
      200: {
        description: "更新日時の新しい順の最近のファイルです。",
        content: { "application/json": { schema: FileListSchema } },
      },
    },
  }),
  async (c) => c.json({ files: await listRecentFiles(c.env.DB) }, 200),
);

catalogRoutes.openapi(
  createRoute({
    method: "get",
    path: "/documents/{id}",
    operationId: "getDocument",
    tags: ["catalog"],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "登録簿の文書です。",
        content: { "application/json": { schema: DocumentEntrySchema } },
      },
      404: {
        description: "登録されていない文書 ID です。",
        content: { "application/json": { schema: CatalogErrorSchema } },
      },
    },
  }),
  async (c) => {
    const result = await getDocument(c.env.DB, c.req.valid("param").id);
    if (!result.ok) {
      return c.json({ code: result.code, message: result.message }, 404);
    }
    return c.json(result.entry, 200);
  },
);

const DocumentParamsSchema = z.object({ documentId: z.string() });

catalogRoutes.openapi(
  createRoute({
    method: "put",
    path: "/documents/{documentId}/summary",
    operationId: "putDocumentSummary",
    tags: ["catalog"],
    request: {
      params: DocumentParamsSchema,
      body: { content: { "application/json": { schema: Summary } } },
    },
    responses: {
      200: {
        description: "書き込みのあとに残っている概要です。",
        content: { "application/json": { schema: Summary } },
      },
    },
  }),
  async (c) =>
    c.json(
      await putSummary(
        c.env.DB,
        c.req.valid("param").documentId,
        c.req.valid("json"),
      ),
      200,
    ),
);

catalogRoutes.openapi(
  createRoute({
    method: "get",
    path: "/documents/{documentId}/summary",
    operationId: "getDocumentSummary",
    tags: ["catalog"],
    request: { params: DocumentParamsSchema },
    responses: {
      200: {
        description: "文書の概要です。",
        content: { "application/json": { schema: Summary } },
      },
      404: {
        description: "概要がまだ届いていない文書です。",
        content: { "application/json": { schema: CatalogErrorSchema } },
      },
    },
  }),
  async (c) => {
    const result = await getSummary(c.env.DB, c.req.valid("param").documentId);
    if (!result.ok) {
      return c.json({ code: result.code, message: result.message }, 404);
    }
    return c.json(result.summary, 200);
  },
);

catalogRoutes.openapi(
  createRoute({
    method: "put",
    path: "/documents/{documentId}/thumbnail",
    operationId: "putDocumentThumbnail",
    tags: ["catalog"],
    request: {
      params: DocumentParamsSchema,
      body: { content: { "application/json": { schema: ThumbnailPutSchema } } },
    },
    responses: {
      204: { description: "受け取りました。古いリビジョンは捨てます。" },
    },
  }),
  async (c) => {
    await putThumbnail(
      c.env.DB,
      c.req.valid("param").documentId,
      c.req.valid("json"),
    );
    return c.body(null, 204);
  },
);

catalogRoutes.openapi(
  createRoute({
    method: "get",
    path: "/documents/{documentId}/thumbnail",
    operationId: "getDocumentThumbnail",
    tags: ["catalog"],
    request: { params: DocumentParamsSchema },
    responses: {
      200: {
        description:
          "サムネイルの画像か、作れなかった理由です。まだ無ければ none です。",
        content: { "application/json": { schema: ThumbnailSchema } },
      },
    },
  }),
  async (c) =>
    c.json(await getThumbnail(c.env.DB, c.req.valid("param").documentId), 200),
);
