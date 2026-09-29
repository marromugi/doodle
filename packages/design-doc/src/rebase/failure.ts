import * as z from "zod";

import { ApplyFailure } from "../apply/failure";
import { Discrepancy } from "../model/discrepancy";
import { ValidateFailure } from "../validate/failure";

export const RebaseFailure = z.discriminatedUnion("code", [
  z.strictObject({
    code: z.literal("remaining"),
    remaining: z.array(Discrepancy),
  }),
  z.strictObject({
    code: z.literal("fix-failed"),
    index: z.number(),
    reasons: z.array(ApplyFailure),
  }),
  z.strictObject({
    code: z.literal("invalid"),
    reasons: z.array(ValidateFailure),
  }),
]);
export type RebaseFailure = z.infer<typeof RebaseFailure>;
