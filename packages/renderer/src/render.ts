import type { RenderShape, Result } from "@doodle/design-doc";

export type Font = {
  family: string;
  weight?: number;
  style?: "normal" | "italic";
  data: Uint8Array;
  format: "woff2" | "woff" | "truetype";
};

export type RenderFailure =
  | { code: "no-font"; message: string }
  | {
      code: "invalid-font";
      family: string;
      key: "weight";
      value: number;
      message: string;
    }
  | { code: "unknown-font"; family: string; message: string }
  | {
      code: "invalid-color";
      source: string;
      key: string;
      value: string;
      message: string;
    }
  | {
      code: "invalid-placement";
      source: string;
      key: "width" | "height" | "position";
      message: string;
    }
  | {
      code: "invalid-value";
      source: string;
      key: string;
      value: number;
      message: string;
    };

export function renderHtml(
  _shape: RenderShape,
  _fonts: Font[],
): Result<string, RenderFailure> {
  throw new Error("not implemented");
}
