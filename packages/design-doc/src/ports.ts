import type { Document } from "./model/document";
import type { Operation } from "./model/operation";
import type { RenderShape } from "./model/render";
import type { Result } from "./roles";

export type DecodeFailure =
  | { code: "unreadable"; message: string }
  | { code: "invalid-shape"; message: string; path: (string | number)[] };

export type RasterizeFailure = { code: "rasterize-failed"; message: string };

/** PNG at scale 1; width and height are the drawn root's size in px. */
export type RasterImage = {
  contentType: "image/png";
  bytes: Uint8Array;
  width: number;
  height: number;
};

export interface LlmRepresentation {
  encode(doc: Document): string;
  decodeOperations(text: string): Result<Operation[], DecodeFailure>;
}

export interface Rasterizer {
  rasterize(shape: RenderShape): Promise<Result<RasterImage, RasterizeFailure>>;
}
