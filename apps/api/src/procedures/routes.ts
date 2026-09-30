import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ReleaseReferenceSchema } from "../catalog/schema";
import { creationCatalogFromDb } from "./catalog-d1";
import { createCandidate } from "./create-candidate";
import { createFile } from "./create-file";
import { createPage } from "./create-page";
import { eraseRetryFromEnv } from "./erase-retry-port";
import { invalidName, NameSchema } from "./name";
import type { FileProcedurePorts } from "./ports";
import { documentSessionsFromEnv } from "./sessions-port";

// The status and the meaning of each failure code. Each route documents only the codes it can return.
const FAILURES = {
  invalid_name: {
    status: 400,
    description: "名前が決まりに合いません。何も作りません。",
  },
  not_an_app: {
    status: 400,
    description: "ページを置くファイルが DS のファイルです。何も作りません。",
  },
  file_not_found: {
    status: 404,
    description: "ファイルが無いか、依頼のページのファイルが無いです。",
  },
  reference_not_found: {
    status: 404,
    description: "アプリが参照するリリースが無いです。何も作りません。",
  },
  request_not_found: {
    status: 404,
    description: "依頼が無いです。何も作りません。",
  },
  request_aborted: {
    status: 409,
    description: "依頼が中断されています。何も作りません。",
  },
  taken_by_another_agent: {
    status: 409,
    description: "別のエージェントが依頼を取っています。何も作りません。",
  },
  request_finished: {
    status: 409,
    description: "依頼が終わっています。何も作りません。",
  },
  request_not_taken: {
    status: 409,
    description: "エージェントは依頼を取っていません。何も作りません。",
  },
  registration_failed: {
    status: 500,
    description:
      "登録の書き込みで ID が使われていました。作った文書は消します。",
  },
  initialization_failed: {
    status: 500,
    description:
      "文書の初期化が、既に中身がある、または消去された、を返しました。登録はしません。",
  },
  catalog_inconsistent: {
    status: 500,
    description: "依頼のページが目録にありません。何も作りません。",
  },
  catalog_unavailable: {
    status: 503,
    description:
      "目録に届きませんでした。書き込みが届かなかったときは、書き込みが通ったか分かりません。",
  },
  session_unavailable: {
    status: 503,
    description:
      "文書セッションに届きませんでした。文書の片付けは消去の送り直しに任せます。",
  },
} as const;

type FailureCode = keyof typeof FAILURES;

// What a request whose shape does not match returns, before the procedure runs.
const RequestShapeErrorSchema = z
  .object({
    success: z.literal(false),
    error: z.object({ name: z.string(), message: z.string() }),
  })
  .openapi("RequestShapeError");

// The failure responses of one route: one response per status, listing the codes the route returns there.
const failureResponses = (route: string, codes: FailureCode[]) => {
  const responses: Record<
    number,
    {
      description: string;
      content: { "application/json": { schema: z.ZodType } };
    }
  > = {};
  for (const status of [400, 404, 409, 500, 503]) {
    const here = codes.filter((code) => FAILURES[code].status === status);
    if (here.length === 0 && status !== 400) continue;
    const error =
      here.length === 0
        ? null
        : z
            .object({
              code: z.enum(here as [FailureCode, ...FailureCode[]]),
              message: z.string(),
            })
            .openapi(`${route}Error${status}`);
    const lines = here.map((code) => `${code}: ${FAILURES[code].description}`);
    if (status === 400) {
      lines.push("リクエストの形が合わないときは、検証の失敗を返します。");
    }
    responses[status] = {
      description: lines.join("\n"),
      content: {
        "application/json": {
          schema:
            status === 400
              ? error === null
                ? RequestShapeErrorSchema
                : z.union([error, RequestShapeErrorSchema])
              : error!,
        },
      },
    };
  }
  return responses;
};

// The routes declare their failure responses from a table, so the handler cannot type them one by one.
const fail = (
  c: Context,
  failure: { code: FailureCode; message: string },
): never =>
  c.json(
    { code: failure.code, message: failure.message },
    FAILURES[failure.code].status,
  ) as never;

// A name the schema refuses is answered as the procedure answers it.
const nameRefusal = (
  result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } },
  c: Context,
) => {
  if (result.success) return undefined;
  if (!result.error?.issues.some((issue) => issue.path[0] === "name")) {
    return undefined;
  }
  const refusal = invalidName();
  return c.json({ code: refusal.code, message: refusal.message }, 400) as never;
};

const CreateFileBodySchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("designSystem"), name: NameSchema }),
    z.object({
      kind: z.literal("app"),
      name: NameSchema,
      reference: ReleaseReferenceSchema.nullable(),
    }),
  ])
  .openapi("CreateFileBody");

const CreatedFileSchema = z
  .object({ fileId: z.string(), draftDocumentId: z.string().optional() })
  .openapi("CreatedFile");

const CreatePageBodySchema = z
  .object({ name: NameSchema })
  .openapi("CreatePageBody");

const CreatedPageSchema = z
  .object({ pageId: z.string(), skeletonDocumentId: z.string() })
  .openapi("CreatedPage");

const CreateCandidateBodySchema = z
  .object({ agentId: z.string() })
  .openapi("CreateCandidateBody");

const CreatedCandidateSchema = z
  .object({ candidateDocumentId: z.string() })
  .openapi("CreatedCandidate");

/** The routes of the create procedures. `makePorts` builds the ports from the environment of each request. */
export const createFileProcedureRoutes = (
  makePorts: (env: Env) => FileProcedurePorts,
) => {
  const routes = new OpenAPIHono<{ Bindings: Env }>();

  routes.openapi(
    createRoute({
      method: "post",
      path: "/files",
      operationId: "createFile",
      tags: ["files"],
      request: {
        body: {
          content: { "application/json": { schema: CreateFileBodySchema } },
        },
      },
      responses: {
        201: {
          description:
            "作ったファイルです。DS のファイルには空の下書きの文書も作ります。",
          content: { "application/json": { schema: CreatedFileSchema } },
        },
        ...failureResponses("CreateFile", [
          "invalid_name",
          "reference_not_found",
          "registration_failed",
          "initialization_failed",
          "catalog_unavailable",
          "session_unavailable",
        ]),
      },
    }),
    async (c) => {
      const result = await createFile(makePorts(c.env), c.req.valid("json"));
      if (result.ok) {
        return c.json(
          {
            fileId: result.fileId,
            ...(result.draftDocumentId === undefined
              ? {}
              : { draftDocumentId: result.draftDocumentId }),
          },
          201,
        );
      }
      return fail(c, result);
    },
    nameRefusal,
  );

  routes.openapi(
    createRoute({
      method: "post",
      path: "/files/{fileId}/pages",
      operationId: "createPage",
      tags: ["files"],
      request: {
        params: z.object({ fileId: z.string() }),
        body: {
          content: { "application/json": { schema: CreatePageBodySchema } },
        },
      },
      responses: {
        201: {
          description: "作ったページです。空の骨子の文書も作ります。",
          content: { "application/json": { schema: CreatedPageSchema } },
        },
        ...failureResponses("CreatePage", [
          "invalid_name",
          "not_an_app",
          "file_not_found",
          "registration_failed",
          "initialization_failed",
          "catalog_unavailable",
          "session_unavailable",
        ]),
      },
    }),
    async (c) => {
      const result = await createPage(makePorts(c.env), {
        appFileId: c.req.valid("param").fileId,
        name: c.req.valid("json").name,
      });
      if (result.ok) {
        return c.json(
          {
            pageId: result.pageId,
            skeletonDocumentId: result.skeletonDocumentId,
          },
          201,
        );
      }
      return fail(c, result);
    },
    nameRefusal,
  );

  routes.openapi(
    createRoute({
      method: "post",
      path: "/requests/{requestId}/candidate",
      operationId: "createCandidate",
      tags: ["files"],
      request: {
        params: z.object({ requestId: z.string() }),
        body: {
          content: {
            "application/json": { schema: CreateCandidateBodySchema },
          },
        },
      },
      responses: {
        201: {
          description:
            "作った清書案の文書です。依頼を清書中として取っているエージェントだけが作れます。",
          content: { "application/json": { schema: CreatedCandidateSchema } },
        },
        ...failureResponses("CreateCandidate", [
          "file_not_found",
          "request_not_found",
          "request_aborted",
          "taken_by_another_agent",
          "request_finished",
          "request_not_taken",
          "registration_failed",
          "initialization_failed",
          "catalog_inconsistent",
          "catalog_unavailable",
          "session_unavailable",
        ]),
      },
    }),
    async (c) => {
      const result = await createCandidate(makePorts(c.env), {
        requestId: c.req.valid("param").requestId,
        agentId: c.req.valid("json").agentId,
      });
      if (result.ok) {
        return c.json({ candidateDocumentId: result.candidateDocumentId }, 201);
      }
      return fail(c, result);
    },
  );

  return routes;
};

export const fileProcedureRoutes = createFileProcedureRoutes((env) => ({
  catalog: creationCatalogFromDb(env.DB),
  sessions: documentSessionsFromEnv(env),
  eraseRetry: eraseRetryFromEnv(env),
}));
