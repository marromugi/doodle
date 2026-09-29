import * as z from "zod";

export const Summary = z.strictObject({
  revision: z.number(),
  updatedAt: z.iso.datetime(),
});
export type Summary = z.infer<typeof Summary>;
