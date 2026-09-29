import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { getDocument } from "./documents";
import { listFiles, listRecentFiles } from "./files";
import {
  CatalogErrorSchema,
  DocumentEntrySchema,
  FileListSchema,
} from "./schema";

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
