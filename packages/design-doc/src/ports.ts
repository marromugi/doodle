import * as z from "zod";

import type { Document } from "./model/document";
import type { Operation } from "./model/operation";
import type { RenderShape } from "./model/render";
import type { Result } from "./roles";

export const DecodeFailure = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("unreadable"), message: z.string() }),
  z.strictObject({
    code: z.literal("invalid-shape"),
    message: z.string(),
    path: z.array(z.union([z.string(), z.number()])),
  }),
]);
export type DecodeFailure = z.infer<typeof DecodeFailure>;

export const RasterizeFailure = z.strictObject({
  code: z.literal("rasterize-failed"),
  message: z.string(),
});
export type RasterizeFailure = z.infer<typeof RasterizeFailure>;

/** PNG at scale 1; width and height are the drawn root's size in px. */
export const RasterImage = z.strictObject({
  contentType: z.literal("image/png"),
  bytes: z.instanceof(Uint8Array),
  width: z.number(),
  height: z.number(),
});
export type RasterImage = z.infer<typeof RasterImage>;

export interface LlmRepresentation {
  encode(doc: Document): string;
  decodeOperations(text: string): Result<Operation[], DecodeFailure>;
}

export interface Rasterizer {
  rasterize(shape: RenderShape): Promise<Result<RasterImage, RasterizeFailure>>;
}
