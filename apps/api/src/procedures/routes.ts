import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ReleaseReferenceSchema } from "../catalog/schema";
import { catalogFromDb, sessionsFromEnv } from "./adapters";
import { createCandidate } from "./create-candidate";
import { createFile } from "./create-file";
import { createPage } from "./create-page";
import { invalidName, NameSchema } from "./name";
import type { FileProcedurePorts } from "./ports";

export const fileProcedureRoutes = new OpenAPIHono<{ Bindings: Env }>();

const portsOf = (env: Env): FileProcedurePorts => ({
  catalog: catalogFromDb(env.DB),
  sessions: sessionsFromEnv(env),
});

const errorSchema = <Code extends [string, ...string[]]>(
  name: string,
  codes: Code,
) => z.object({ code: z.enum(codes), message: z.string() }).openapi(name);

const NameFailureSchema = errorSchema("CreateNameError", ["invalid_name"]);
const CreationFailureSchema = errorSchema("CreationError", [
  "registration_failed",
  "initialization_failed",
]);
const CandidateRefusalSchema = errorSchema("CandidateRefusal", [
  "request_aborted",
  "taken_by_another_agent",
  "request_finished",
  "request_not_taken",
]);

// A name the schema refuses is answered like the procedure's own refusal.
const nameRefusal = (
  result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } },
  c: Context,
) => {
  if (result.success) return undefined;
  const failure = invalidName();
  return result.error?.issues.some((issue) => issue.path[0] === "name")
    ? c.json({ code: failure.code, message: failure.message }, 400)
    : undefined;
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

fileProcedureRoutes.openapi(
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
      400: {
        description: "名前が決まりに合いません。何も作りません。",
        content: { "application/json": { schema: NameFailureSchema } },
      },
      500: {
        description: "文書の初期化か登録に失敗しました。何も残りません。",
        content: { "application/json": { schema: CreationFailureSchema } },
      },
    },
  }),
  async (c) => {
    const result = await createFile(portsOf(c.env), c.req.valid("json"));
    if (result.ok) {
      const { ok: _ok, ...created } = result;
      return c.json(created, 201);
    }
    const body = { code: result.code, message: result.message };
    return result.code === "invalid_name"
      ? c.json({ ...body, code: result.code }, 400)
      : c.json({ ...body, code: result.code }, 500);
  },
  nameRefusal,
);

const CreatePageBodySchema = z
  .object({ name: NameSchema })
  .openapi("CreatePageBody");

const CreatedPageSchema = z
  .object({ pageId: z.string(), skeletonDocumentId: z.string() })
  .openapi("CreatedPage");

fileProcedureRoutes.openapi(
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
      400: {
        description: "名前が決まりに合いません。何も作りません。",
        content: { "application/json": { schema: NameFailureSchema } },
      },
      500: {
        description: "文書の初期化か登録に失敗しました。作った文書は消します。",
        content: { "application/json": { schema: CreationFailureSchema } },
      },
    },
  }),
  async (c) => {
    const result = await createPage(portsOf(c.env), {
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
    return result.code === "invalid_name"
      ? c.json({ code: result.code, message: result.message }, 400)
      : c.json({ code: result.code, message: result.message }, 500);
  },
  nameRefusal,
);

const CreateCandidateBodySchema = z
  .object({ agentId: z.string() })
  .openapi("CreateCandidateBody");

const CreatedCandidateSchema = z
  .object({ candidateDocumentId: z.string() })
  .openapi("CreatedCandidate");

fileProcedureRoutes.openapi(
  createRoute({
    method: "post",
    path: "/requests/{requestId}/candidate",
    operationId: "createCandidate",
    tags: ["files"],
    request: {
      params: z.object({ requestId: z.string() }),
      body: {
        content: { "application/json": { schema: CreateCandidateBodySchema } },
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
          "依頼を清書中として取っていないため作れません。理由はコードで返します。",
        content: { "application/json": { schema: CandidateRefusalSchema } },
      },
      500: {
        description: "文書の初期化か登録に失敗しました。作った文書は消します。",
        content: { "application/json": { schema: CreationFailureSchema } },
      },
    },
  }),
  async (c) => {
    const result = await createCandidate(portsOf(c.env), {
      requestId: c.req.valid("param").requestId,
      agentId: c.req.valid("json").agentId,
    });
    if (result.ok) {
      return c.json({ candidateDocumentId: result.candidateDocumentId }, 201);
    }
    switch (result.code) {
      case "registration_failed":
      case "initialization_failed":
        return c.json({ code: result.code, message: result.message }, 500);
      default:
        return c.json({ code: result.code, message: result.message }, 409);
    }
  },
);
