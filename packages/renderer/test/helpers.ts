import type { RenderNode, RenderShape } from "@doodle/design-doc";

import type { Font } from "../src";

export const DEFAULT_LAYOUT = {
  direction: "row",
  gap: 0,
  padding: 0,
  align: "start",
  justify: "start",
} as const;

type FrameNode = Extract<RenderNode, { type: "frame" }>;

export function frame(
  source: string,
  props: Partial<Omit<FrameNode, "type" | "source" | "layout">> & {
    layout?: Partial<FrameNode["layout"]>;
  } = {},
): FrameNode {
  const { layout, ...rest } = props;
  return {
    type: "frame",
    source,
    width: "hug",
    height: "hug",
    children: [],
    ...rest,
    layout: { ...DEFAULT_LAYOUT, ...layout },
  };
}

export function box(source: string, width: number, height: number): FrameNode {
  return frame(source, { width, height });
}

export function shape(root: RenderNode | null): RenderShape {
  return { root };
}

export async function loadFonts(): Promise<Font[]> {
  const response = await fetch(
    new URL("./fixtures/inter-latin-400-normal.woff2", import.meta.url),
  );
  const data = new Uint8Array(await response.arrayBuffer());
  return [
    { family: "Doodle Test", data, format: "woff2" },
    { family: "Doodle Alt", data, format: "woff2" },
  ];
}

export type Page = {
  doc: Document;
  win: Window;
  el: (source: string) => HTMLElement;
  rect: (source: string) => { x: number; y: number; w: number; h: number };
};

export async function open(html: string): Promise<Page> {
  const iframe = document.createElement("iframe");
  iframe.style.width = "800px";
  iframe.style.height = "600px";
  iframe.style.border = "0";
  document.body.append(iframe);
  const loaded = new Promise((resolve) => {
    iframe.addEventListener("load", resolve, { once: true });
  });
  iframe.srcdoc = html;
  await loaded;
  const doc = iframe.contentDocument!;
  const win = iframe.contentWindow!;
  await doc.fonts.ready;
  const root = doc.body.firstElementChild as HTMLElement;
  const el = (source: string) =>
    doc.querySelector<HTMLElement>(`[data-source="${source}"]`)!;
  const rect = (source: string) => {
    const origin = root.getBoundingClientRect();
    const r = el(source).getBoundingClientRect();
    return {
      x: r.left - origin.left,
      y: r.top - origin.top,
      w: r.width,
      h: r.height,
    };
  };
  return { doc, win, el, rect };
}
