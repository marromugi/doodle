import * as z from "zod";

import { PropsFailure } from "../props/failure";

const at = { message: z.string(), nodeId: z.string().optional() };

export const ValidateFailure = z.union([
  PropsFailure,
  z.discriminatedUnion("code", [
    z.strictObject({ code: z.literal("duplicate-node-id"), ...at }),
    z.strictObject({ code: z.literal("token-kind-mismatch"), ...at }),
    z.strictObject({ code: z.literal("unknown-token"), ...at }),
    z.strictObject({ code: z.literal("unknown-prop-reference"), ...at }),
    z.strictObject({ code: z.literal("component-out-of-scope"), ...at }),
    z.strictObject({ code: z.literal("match-not-exhaustive"), ...at }),
    z.strictObject({ code: z.literal("match-default-required"), ...at }),
    z.strictObject({ code: z.literal("match-unsupported-type"), ...at }),
    z.strictObject({ code: z.literal("repeat-name-shadowed"), ...at }),
    z.strictObject({ code: z.literal("var-outside-repeat"), ...at }),
    z.strictObject({ code: z.literal("component-cycle"), ...at }),
  ]),
]);
export type ValidateFailure = z.infer<typeof ValidateFailure>;
