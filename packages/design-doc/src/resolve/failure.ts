import * as z from "zod";

export const ResolveFailure = z.discriminatedUnion("code", [
  z.strictObject({
    code: z.literal("unresolved-reference"),
    reference: z.string(),
    message: z.string(),
    nodeId: z.string().optional(),
  }),
]);
export type ResolveFailure = z.infer<typeof ResolveFailure>;
