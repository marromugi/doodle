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

const errorSchema = <Codes extends [string, ...string[]]>(
  name: string,
  codes: Codes,
) => z.object({ code: z.enum(codes), message: z.string() }).openapi(name);

const InvalidInputSchema = errorSchema("InvalidInputError", [
  "invalid_name",
  "not_an_app",
]);
const NotFoundSchema = errorSchema("NotFoundError", [
  "file_not_found",
  "reference_not_found",
  "request_not_found",
]);
const RequestStateSchema = errorSchema("RequestStateError", [
  "request_aborted",
  "taken_by_another_agent",
  "request_finished",
  "request_not_taken",
]);
const InternalSchema = errorSchema("InternalError", [
  "registration_failed",
  "initialization_failed",
  "catalog_inconsistent",
]);
const UnavailableSchema = errorSchema("UnavailableError", [
  "catalog_unavailable",
  "session_unavailable",
]);

const failureResponses = {
  400: {
    description: "入力が決まりに合いません。何も作りません。",
    content: { "application/json": { schema: InvalidInputSchema } },
  },
  404: {
    description: "入力が指すものがありません。何も作りません。",
    content: { "application/json": { schema: NotFoundSchema } },
  },
  500: {
    description:
      "登録か初期化に失敗したか、目録の中に食い違いがあります。作った文書は消します。",
    content: { "application/json": { schema: InternalSchema } },
  },
  503: {
    description: "目録か文書セッションに届きませんでした。",
    content: { "application/json": { schema: UnavailableSchema } },
  },
};

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
  return c.json({ code: refusal.code, message: refusal.message }, 400);
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
        ...failureResponses,
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
      switch (result.code) {
        case "invalid_name":
          return c.json({ code: result.code, message: result.message }, 400);
        case "reference_not_found":
          return c.json({ code: result.code, message: result.message }, 404);
        case "registration_failed":
        case "initialization_failed":
          return c.json({ code: result.code, message: result.message }, 500);
        case "catalog_unavailable":
        case "session_unavailable":
          return c.json({ code: result.code, message: result.message }, 503);
      }
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
        ...failureResponses,
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
      switch (result.code) {
        case "invalid_name":
        case "not_an_app":
          return c.json({ code: result.code, message: result.message }, 400);
        case "file_not_found":
          return c.json({ code: result.code, message: result.message }, 404);
        case "registration_failed":
        case "initialization_failed":
          return c.json({ code: result.code, message: result.message }, 500);
        case "catalog_unavailable":
        case "session_unavailable":
          return c.json({ code: result.code, message: result.message }, 503);
      }
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
        409: {
          description:
            "依頼の状態が合いません。理由はコードで返します。何も作りません。",
          content: { "application/json": { schema: RequestStateSchema } },
        },
        ...failureResponses,
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
      switch (result.code) {
        case "file_not_found":
        case "request_not_found":
          return c.json({ code: result.code, message: result.message }, 404);
        case "request_aborted":
        case "taken_by_another_agent":
        case "request_finished":
        case "request_not_taken":
          return c.json({ code: result.code, message: result.message }, 409);
        case "registration_failed":
        case "initialization_failed":
        case "catalog_inconsistent":
          return c.json({ code: result.code, message: result.message }, 500);
        case "catalog_unavailable":
        case "session_unavailable":
          return c.json({ code: result.code, message: result.message }, 503);
      }
    },
  );

  return routes;
};

export const fileProcedureRoutes = createFileProcedureRoutes((env) => ({
  catalog: creationCatalogFromDb(env.DB),
  sessions: documentSessionsFromEnv(env),
  eraseRetry: eraseRetryFromEnv(env),
}));
