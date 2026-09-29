import * as z from "zod";

import { Node } from "./node";

export const Value = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.strictObject({
    get object() {
      return z.record(z.string(), Value);
    },
  }),
  z.strictObject({
    get array() {
      return z.array(Value);
    },
  }),
  z.strictObject({
    get nodes() {
      return z.array(Node);
    },
  }),
  z.strictObject({ token: z.string() }),
  z.strictObject({ prop: z.string() }),
  z.strictObject({ var: z.string() }),
  z.strictObject({
    match: z.string(),
    get cases() {
      return z.record(z.string(), Value);
    },
    get default() {
      return Value.optional();
    },
  }),
]);
export type Value = z.infer<typeof Value>;
