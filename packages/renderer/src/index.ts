import type { RenderShape, Result } from "@doodle/design-doc";

export type Font = {
  family: string;
  weight?: number;
  style?: "normal" | "italic";
  data: Uint8Array;
  format: "woff2" | "woff" | "truetype";
};

export type RenderFailure =
  | { code: "unknown-font"; family: string; message: string }
  | { code: "no-font"; message: string };

export function renderHtml(
  _shape: RenderShape,
  _fonts: Font[],
): Result<string, RenderFailure> {
  throw new Error("not implemented");
}
