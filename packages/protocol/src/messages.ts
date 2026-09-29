import { ApplyFailure, Document, EditOperation } from "@doodle/design-doc";
import * as z from "zod";

export const Identity = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("human") }),
  z.strictObject({ kind: z.literal("agent"), agentId: z.string().min(1) }),
]);
export type Identity = z.infer<typeof Identity>;

/** Who the client is, as the query of the connection URL. */
export const identityToSearch = (identity: Identity): URLSearchParams =>
  new URLSearchParams(
    identity.kind === "human"
      ? { kind: "human" }
      : { kind: "agent", agentId: identity.agentId },
  );

export const identityFromSearch = (
  search: URLSearchParams,
): Identity | null => {
  const parsed = Identity.safeParse({
    kind: search.get("kind"),
    ...(search.get("kind") === "agent"
      ? { agentId: search.get("agentId") }
      : {}),
  });
  return parsed.success ? parsed.data : null;
};

export const ClientMessage = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("read") }),
  z.strictObject({ type: z.literal("operation"), operation: EditOperation }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

const message = { message: z.string() };

export const SessionFailure = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("not_candidate_document"), ...message }),
  z.strictObject({ code: z.literal("request_aborted"), ...message }),
  z.strictObject({ code: z.literal("taken_by_another_agent"), ...message }),
  z.strictObject({ code: z.literal("request_finished"), ...message }),
  z.strictObject({ code: z.literal("request_not_taken"), ...message }),
  z.strictObject({ code: z.literal("document_deleted"), ...message }),
  z.strictObject({
    code: z.literal("conflict"),
    latestRevision: z.number().int().nonnegative(),
    ...message,
  }),
  z.strictObject({
    code: z.literal("invalid_operation"),
    reasons: z.array(ApplyFailure),
    ...message,
  }),
  z.strictObject({ code: z.literal("document_not_found"), ...message }),
  z.strictObject({ code: z.literal("document_not_registered"), ...message }),
  z.strictObject({ code: z.literal("catalog_unavailable"), ...message }),
  z.strictObject({ code: z.literal("catalog_inconsistent"), ...message }),
]);
export type SessionFailure = z.infer<typeof SessionFailure>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("document"),
    document: Document,
    revision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("applied"),
    document: Document,
    revision: z.number().int().nonnegative(),
  }),
  z.strictObject({ type: z.literal("failure"), failure: SessionFailure }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
