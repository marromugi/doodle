import { Summary } from "@doodle/design-doc";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { getDocument } from "./documents";
import { listFiles, listRecentFiles } from "./files";
import { getPage, listPages } from "./pages";
import { getRequest, listRequests } from "./requests";
import {
  AbortedRequestsSchema,
  CatalogErrorSchema,
  DocumentEntrySchema,
  FileListSchema,
  PageListSchema,
  PageSchema,
  RequestListSchema,
  RequestSchema,
  RequestStateSchema,
  ThumbnailPutSchema,
  ThumbnailSchema,
  TransitionErrorSchema,
} from "./schema";
import { getSummary, putSummary } from "./summaries";
import { getThumbnail, putThumbnail } from "./thumbnails";
import {
  abortAgentRequests,
  adoptProposal,
  completeRequest,
  markDelivered,
  retryRequest,
  takeRequest,
  type TransitionResult,
} from "./transitions";

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

const RequestParamsSchema = z.object({ id: z.string() });

catalogRoutes.openapi(
  createRoute({
    method: "get",
    path: "/requests",
    operationId: "listRequests",
    tags: ["catalog"],
    request: { query: z.object({ state: RequestStateSchema.optional() }) },
    responses: {
      200: {
        description: "依頼の一覧です。state で絞れます。",
        content: { "application/json": { schema: RequestListSchema } },
      },
    },
  }),
  async (c) =>
    c.json(
      { requests: await listRequests(c.env.DB, c.req.valid("query").state) },
      200,
    ),
);

catalogRoutes.openapi(
  createRoute({
    method: "get",
    path: "/requests/{id}",
    operationId: "getRequest",
    tags: ["catalog"],
    request: { params: RequestParamsSchema },
    responses: {
      200: {
        description: "依頼です。",
        content: { "application/json": { schema: RequestSchema } },
      },
      404: {
        description: "存在しない依頼 ID です。",
        content: { "application/json": { schema: CatalogErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const request = await getRequest(c.env.DB, id);
    if (request === null) {
      return c.json(
        { code: "not_found", message: `Request ${id} does not exist.` },
        404,
      );
    }
    return c.json(request, 200);
  },
);

const transitionResponses = {
  200: {
    description: "移したあとの依頼です。",
    content: { "application/json": { schema: RequestSchema } },
  },
  404: {
    description: "存在しない依頼 ID です。",
    content: { "application/json": { schema: TransitionErrorSchema } },
  },
  409: {
    description: "今の状態からは移れません。理由はコードで返します。",
    content: { "application/json": { schema: TransitionErrorSchema } },
  },
} as const;

function transitionBody(result: Extract<TransitionResult, { ok: false }>) {
  return {
    code: result.code,
    message: result.message,
    ...(result.state === undefined ? {} : { state: result.state }),
  };
}

const AgentBodySchema = z.object({ agent: z.string() });

catalogRoutes.openapi(
  createRoute({
    method: "post",
    path: "/requests/{id}/take",
    operationId: "takeRequest",
    tags: ["catalog"],
    request: {
      params: RequestParamsSchema,
      body: { content: { "application/json": { schema: AgentBodySchema } } },
    },
    responses: transitionResponses,
  }),
  async (c) => {
    const result = await takeRequest(
      c.env.DB,
      c.req.valid("param").id,
      c.req.valid("json").agent,
    );
    if (result.ok) return c.json(result.request, 200);
    return c.json(
      transitionBody(result),
      result.code === "not_found" ? 404 : 409,
    );
  },
);

catalogRoutes.openapi(
  createRoute({
    method: "post",
    path: "/requests/{id}/delivered",
    operationId: "markRequestDelivered",
    tags: ["catalog"],
    request: { params: RequestParamsSchema },
    responses: transitionResponses,
  }),
  async (c) => {
    const result = await markDelivered(c.env.DB, c.req.valid("param").id);
    if (result.ok) return c.json(result.request, 200);
    return c.json(
      transitionBody(result),
      result.code === "not_found" ? 404 : 409,
    );
  },
);

catalogRoutes.openapi(
  createRoute({
    method: "post",
    path: "/requests/{id}/complete",
    operationId: "completeRequest",
    tags: ["catalog"],
    request: {
      params: RequestParamsSchema,
      body: { content: { "application/json": { schema: AgentBodySchema } } },
    },
    responses: transitionResponses,
  }),
  async (c) => {
    const result = await completeRequest(
      c.env.DB,
      c.req.valid("param").id,
      c.req.valid("json").agent,
    );
    if (result.ok) return c.json(result.request, 200);
    return c.json(
      transitionBody(result),
      result.code === "not_found" ? 404 : 409,
    );
  },
);

catalogRoutes.openapi(
  createRoute({
    method: "post",
    path: "/requests/{id}/retry",
    operationId: "retryRequest",
    tags: ["catalog"],
    request: { params: RequestParamsSchema },
    responses: transitionResponses,
  }),
  async (c) => {
    const result = await retryRequest(c.env.DB, c.req.valid("param").id);
    if (result.ok) return c.json(result.request, 200);
    return c.json(
      transitionBody(result),
      result.code === "not_found" ? 404 : 409,
    );
  },
);

catalogRoutes.openapi(
  createRoute({
    method: "post",
    path: "/requests/{id}/adopt",
    operationId: "adoptProposal",
    tags: ["catalog"],
    request: {
      params: RequestParamsSchema,
      body: {
        content: {
          "application/json": { schema: z.object({ proposal: z.string() }) },
        },
      },
    },
    responses: transitionResponses,
  }),
  async (c) => {
    const result = await adoptProposal(
      c.env.DB,
      c.req.valid("param").id,
      c.req.valid("json").proposal,
    );
    if (result.ok) return c.json(result.request, 200);
    return c.json(
      transitionBody(result),
      result.code === "not_found" ? 404 : 409,
    );
  },
);

catalogRoutes.openapi(
  createRoute({
    method: "post",
    path: "/agents/{agentId}/abort-requests",
    operationId: "abortAgentRequests",
    tags: ["catalog"],
    request: { params: z.object({ agentId: z.string() }) },
    responses: {
      200: {
        description: "中断にした依頼の ID です。",
        content: { "application/json": { schema: AbortedRequestsSchema } },
      },
    },
  }),
  async (c) =>
    c.json(
      {
        aborted: await abortAgentRequests(
          c.env.DB,
          c.req.valid("param").agentId,
        ),
      },
      200,
    ),
);

catalogRoutes.openapi(
  createRoute({
    method: "get",
    path: "/pages/{id}",
    operationId: "getPage",
    tags: ["catalog"],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "ページです。",
        content: { "application/json": { schema: PageSchema } },
      },
      404: {
        description: "存在しないページ ID です。",
        content: { "application/json": { schema: CatalogErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const page = await getPage(c.env.DB, id);
    if (page === null) {
      return c.json(
        { code: "not_found", message: `Page ${id} does not exist.` },
        404,
      );
    }
    return c.json(page, 200);
  },
);

catalogRoutes.openapi(
  createRoute({
    method: "get",
    path: "/files/{fileId}/pages",
    operationId: "listPages",
    tags: ["catalog"],
    request: { params: z.object({ fileId: z.string() }) },
    responses: {
      200: {
        description: "アプリのページの一覧です。記録した順に並びます。",
        content: { "application/json": { schema: PageListSchema } },
      },
      404: {
        description: "存在しないファイル ID です。",
        content: { "application/json": { schema: CatalogErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { fileId } = c.req.valid("param");
    const pages = await listPages(c.env.DB, fileId);
    if (pages === null) {
      return c.json(
        { code: "file_not_found", message: `File ${fileId} does not exist.` },
        404,
      );
    }
    return c.json({ pages }, 200);
  },
);
