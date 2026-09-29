import * as z from "zod";

export const ResolveFailure = z.discriminatedUnion("code", [
  z.strictObject({
    code: z.literal("unresolved-reference"),
    reference: z.string(),
    message: z.string(),
    nodeId: z.string().optional(),
  }),
  z.strictObject({
    code: z.literal("value-kind-mismatch"),
    nodeId: z.string(),
    key: z.string(),
    expected: z.array(
      z.enum([
        "string",
        "number",
        "boolean",
        "object",
        "array",
        "nodes",
        "typography",
      ]),
    ),
    message: z.string(),
  }),
  z.strictObject({
    code: z.literal("no-matching-case"),
    nodeId: z.string(),
    key: z.string(),
    prop: z.string(),
    message: z.string(),
  }),
  z.strictObject({
    code: z.literal("size-required"),
    nodeId: z.string(),
    key: z.enum(["width", "height"]),
    message: z.string(),
  }),
]);
export type ResolveFailure = z.infer<typeof ResolveFailure>;
