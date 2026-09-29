import type { RenderNode, RenderShape } from "@doodle/design-doc";
import type { Font } from "@doodle/renderer";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import { createBrowserRasterizer } from "./browser-rasterizer";
import interData from "./fixtures/inter-latin-400-normal.woff2?inline";
import notoSerifData from "./fixtures/noto-serif-latin-400-normal.woff2?inline";
import { colorAt, decodePng, nonWhite } from "./png";

function fontFrom(dataUri: string): Font {
  const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
  const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return { family: "Doodle Test", data, format: "woff2" };
}

const fontA = fontFrom(interData);
const fontB = fontFrom(notoSerifData);

const LAYOUT = {
  direction: "row",
  gap: 0,
  padding: 0,
  align: "start",
  justify: "start",
} as const;

function frame(
  source: string,
  width: number,
  height: number,
  background: string,
  extra: Partial<Extract<RenderNode, { type: "frame" }>> = {},
): RenderNode {
  return {
    type: "frame",
    source,
    width,
    height,
    layout: LAYOUT,
    background,
    children: [],
    ...extra,
  };
}

const redFrame: RenderShape = { root: frame("root", 200, 100, "#FF0000") };

async function rasterizeToPixels(shape: RenderShape, font: Font) {
  const rasterizer = createBrowserRasterizer({
    browser: env.BROWSER,
    fonts: [font],
  });
  const result = await rasterizer.rasterize(shape);
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return { image: result.value, pixels: decodePng(result.value.bytes) };
}

const wordShape: RenderShape = {
  root: frame("root", 300, 100, "#FFFFFF", {
    children: [
      {
        type: "text",
        source: "word",
        width: "hug",
        height: "hug",
        text: "WWWW",
        color: "#000000",
        typography: {
          family: "Doodle Test",
          size: 48,
          weight: 400,
          lineHeight: 56,
          letterSpacing: 0,
        },
      },
    ],
  }),
};

describe("rasterize with the local browser", () => {
  test("draws a 200 x 100 red frame as a PNG of that size", async () => {
    const { image, pixels } = await rasterizeToPixels(redFrame, fontA);

    expect(colorAt(pixels, 10, 10)).toBe("#FF0000");
    expect(image.contentType).toBe("image/png");
    expect(`${image.width} x ${image.height}`).toBe("200 x 100");
    expect(`${pixels.width} x ${pixels.height}`).toBe("200 x 100");
  });

  test("draws a child frame over its parent", async () => {
    const shape: RenderShape = {
      root: frame("root", 200, 100, "#FF0000", {
        children: [
          frame("child", 20, 20, "#0000FF", { position: { x: 50, y: 20 } }),
        ],
      }),
    };

    const { pixels } = await rasterizeToPixels(shape, fontA);

    expect(colorAt(pixels, 60, 30)).toBe("#0000FF");
    expect(colorAt(pixels, 10, 10)).toBe("#FF0000");
  });

  test("draws the same text differently with two different fonts", async () => {
    const a = await rasterizeToPixels(wordShape, fontA);
    const b = await rasterizeToPixels(wordShape, fontB);

    expect(a.pixels.data).not.toEqual(b.pixels.data);
  });

  test("draws text in the passed font and nowhere else", async () => {
    const a = await rasterizeToPixels(wordShape, fontA);
    const b = await rasterizeToPixels(wordShape, fontB);
    const again = await rasterizeToPixels(wordShape, fontA);

    expect(nonWhite(a.pixels).length).toBeGreaterThanOrEqual(100);
    expect(nonWhite(b.pixels).length).toBeGreaterThanOrEqual(100);
    expect(nonWhite(a.pixels)).not.toEqual(nonWhite(b.pixels));
    expect(again.pixels.data).toEqual(a.pixels.data);
  });
});

describe("rasterize when the browser cannot start", () => {
  test("returns a failure whose reason holds the launch error", async () => {
    const rasterizer = createBrowserRasterizer({
      browser: {
        fetch: () => Promise.reject(new Error("launch failed")),
      },
      fonts: [fontA],
    });

    const result = await rasterizer.rasterize(redFrame);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons[0]?.code).toBe("rasterize-failed");
    expect(result.reasons[0]?.message).toContain("launch failed");
  });
});
