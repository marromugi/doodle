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
