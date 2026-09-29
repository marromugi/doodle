import * as z from "zod";

import { ValidateFailure } from "../validate/failure";

const at = { message: z.string(), nodeId: z.string().optional() };

export const ApplyFailure = z.union([
  ValidateFailure,
  z.strictObject({
    code: z.literal("conflict"),
    latestRevision: z.number(),
    ...at,
  }),
  z.strictObject({ code: z.literal("node-id-reused"), ...at }),
  z.strictObject({ code: z.literal("unknown-node"), ...at }),
  z.strictObject({
    code: z.literal("target-missing"),
    target: z.string(),
    ...at,
  }),
  z.strictObject({
    code: z.literal("target-exists"),
    target: z.string(),
    ...at,
  }),
  z.strictObject({
    code: z.literal("component-name-taken"),
    name: z.string(),
    ...at,
  }),
  z.strictObject({ code: z.literal("operation-not-applicable"), ...at }),
  z.strictObject({
    code: z.literal("index-out-of-range"),
    nodeId: z.string(),
    index: z.number(),
    count: z.number(),
    message: z.string(),
  }),
  z.strictObject({
    code: z.literal("not-a-container"),
    nodeId: z.string(),
    message: z.string(),
  }),
  z.strictObject({
    code: z.literal("root-fixed"),
    nodeId: z.string(),
    message: z.string(),
  }),
  z.strictObject({
    code: z.literal("move-into-own-subtree"),
    nodeId: z.string(),
    target: z.string(),
    message: z.string(),
  }),
  z.strictObject({
    code: z.literal("key-not-settable"),
    nodeId: z.string(),
    key: z.string(),
    message: z.string(),
  }),
  z.strictObject({
    code: z.literal("invalid-shape"),
    path: z.array(z.union([z.string(), z.number()])),
    nodeId: z.string().optional(),
    message: z.string(),
  }),
  z.strictObject({
    code: z.literal("invalid-token-name"),
    token: z.string(),
    message: z.string(),
  }),
]);
export type ApplyFailure = z.infer<typeof ApplyFailure>;
