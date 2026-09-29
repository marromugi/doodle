import * as z from "zod";

import { ValidateFailure } from "../validate/failure";

export const Discrepancy = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("component-removed"),
    nodeId: z.string(),
    component: z.string(),
  }),
  z.strictObject({
    kind: z.literal("props-mismatch"),
    nodeId: z.string(),
    component: z.string(),
    reasons: z.array(ValidateFailure),
  }),
  z.strictObject({
    kind: z.literal("token-removed"),
    nodeId: z.string(),
    token: z.string(),
  }),
]);
export type Discrepancy = z.infer<typeof Discrepancy>;
