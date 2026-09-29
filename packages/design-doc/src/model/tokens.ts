import * as z from "zod";

export const TokenKind = z.enum(["color", "typography", "space", "radius"]);
export type TokenKind = z.infer<typeof TokenKind>;

export const Typography = z.strictObject({
  family: z.string(),
  size: z.number(),
  weight: z.number(),
  lineHeight: z.number(),
  letterSpacing: z.number(),
});
export type Typography = z.infer<typeof Typography>;

export const Tokens = z.strictObject({
  color: z.record(z.string(), z.string()),
  typography: z.record(z.string(), Typography),
  space: z.record(z.string(), z.number()),
  radius: z.record(z.string(), z.number()),
});
export type Tokens = z.infer<typeof Tokens>;
