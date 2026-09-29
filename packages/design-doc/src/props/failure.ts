import * as z from "zod";

const at = { message: z.string(), nodeId: z.string().optional() };

export const PropsFailure = z.discriminatedUnion("code", [
  z.strictObject({
    code: z.literal("missing-required-prop"),
    prop: z.string(),
    ...at,
  }),
  z.strictObject({ code: z.literal("unknown-prop"), prop: z.string(), ...at }),
  z.strictObject({
    code: z.literal("prop-type-mismatch"),
    prop: z.string(),
    ...at,
  }),
]);
export type PropsFailure = z.infer<typeof PropsFailure>;
