import * as z from "zod";

export const Summary = z.strictObject({
  revision: z.number(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Summary = z.infer<typeof Summary>;
