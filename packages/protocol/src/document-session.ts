import { ApplyFailure, Document, EditOperation } from "@doodle/design-doc";
import * as z from "zod";

/** Declared when a client connects: a person, or an agent registered as `agentId`. */
export const ClientIdentity = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("human") }),
  z.strictObject({ kind: z.literal("agent"), agentId: z.string() }),
]);
export type ClientIdentity = z.infer<typeof ClientIdentity>;

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
