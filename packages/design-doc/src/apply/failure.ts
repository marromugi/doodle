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
]);
export type ApplyFailure = z.infer<typeof ApplyFailure>;
