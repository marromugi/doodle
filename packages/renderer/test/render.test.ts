import type { RenderNode } from "@doodle/design-doc";
import { describe, expect, it } from "vitest";

import { renderHtml } from "../src";
import { box, frame, loadFonts, open, shape } from "./helpers";

async function render(root: RenderNode | null) {
  const result = renderHtml(shape(root), await loadFonts());
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return open(result.value);
}

function text(
  source: string,
  extra: Partial<Extract<RenderNode, { type: "text" }>> = {},
) {
  return {
    type: "text",
    source,
    width: "hug",
    height: "hug",
    text: "Hello",
    ...extra,
  } satisfies RenderNode;
}

const families = (value: string) =>
  value.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));

describe("renderHtml", () => {
  it("places a and b in a row with gap 8 and padding 10 and hugs the root to 108 x 40", async () => {
    const page = await render(
      frame("root", {
        layout: { direction: "row", gap: 8, padding: 10 },
        children: [box("a", 40, 20), box("b", 40, 20)],
      }),
    );
    expect(page.rect("a")).toMatchObject({ x: 10, y: 10 });
    expect(page.rect("b")).toMatchObject({ x: 58, y: 10 });
    expect(page.rect("root")).toMatchObject({ w: 108, h: 40 });
  });

  it("places a and b in a column with gap 8 and padding 10 and hugs the root to 60 x 68", async () => {
    const page = await render(
      frame("root", {
        layout: { direction: "column", gap: 8, padding: 10 },
        children: [box("a", 40, 20), box("b", 40, 20)],
      }),
    );
    expect(page.rect("a")).toMatchObject({ x: 10, y: 10 });
    expect(page.rect("b")).toMatchObject({ x: 10, y: 38 });
    expect(page.rect("root")).toMatchObject({ w: 60, h: 68 });
  });

  it("takes a child with a position out of the row and puts it at (120, 50)", async () => {
    const page = await render(
      frame("root", {
        width: 200,
        height: 100,
        children: [
          box("a", 40, 20),
          { ...box("c", 30, 30), position: { x: 120, y: 50 } },
          box("b", 40, 20),
        ],
      }),
    );
    expect(page.rect("a")).toMatchObject({ x: 0, y: 0 });
    expect(page.rect("c")).toMatchObject({ x: 120, y: 50 });
    expect(page.rect("b")).toMatchObject({ x: 40, y: 0 });
  });

  it("stretches a fill child to 260 wide beside a 40 wide child", async () => {
    const page = await render(
      frame("root", {
        width: 300,
        height: 100,
        children: [box("a", 40, 20), frame("f", { width: "fill", height: 20 })],
      }),
    );
    expect(page.rect("f")).toMatchObject({ x: 40, y: 0, w: 260 });
  });

  it("draws the background, border and radius of a frame", async () => {
    const page = await render(
      frame("root", {
        width: 50,
        height: 50,
        background: "#1a73e8",
        border: { color: "#202124", width: 2 },
        radius: 8,
      }),
    );
    const style = page.win.getComputedStyle(page.el("root"));
    expect(style.backgroundColor).toBe("rgb(26, 115, 232)");
    expect(style.borderTopWidth).toBe("2px");
    expect(style.borderTopColor).toBe("rgb(32, 33, 36)");
    expect(style.borderTopLeftRadius).toBe("8px");
  });

  it("draws the string Hello for a text", async () => {
    const page = await render(frame("root", { children: [text("t")] }));
    expect(page.el("t").textContent).toBe("Hello");
  });

  it("draws a 120 x 80 image placeholder without loading any outside file", async () => {
    const page = await render(
      frame("root", {
        children: [{ type: "image", source: "i", width: 120, height: 80 }],
      }),
    );
    expect(page.rect("i")).toMatchObject({ w: 120, h: 80 });
    expect(page.win.performance.getEntriesByType("resource")).toHaveLength(0);
  });

  it("draws a text without typography in the first font, loaded, with no generic family", async () => {
    const page = await render(frame("root", { children: [text("t")] }));
    const faces = [...page.doc.fonts].filter(
      (f) => f.family.replace(/["']/g, "") === "Doodle Test",
    );
    expect(faces.map((f) => f.status)).toEqual(["loaded"]);
    const family = page.win.getComputedStyle(page.el("t")).fontFamily;
    expect(families(family)).toEqual(["Doodle Test"]);
  });

  it("applies family, size, weight, line height and letter spacing of a typography", async () => {
    const page = await render(
      frame("root", {
        children: [
          text("t", {
            typography: {
              family: "Doodle Alt",
              size: 20,
              weight: 700,
              lineHeight: 28,
              letterSpacing: 1,
            },
          }),
        ],
      }),
    );
    const style = page.win.getComputedStyle(page.el("t"));
    expect(families(style.fontFamily)).toEqual(["Doodle Alt"]);
    expect(style.fontSize).toBe("20px");
    expect(style.fontWeight).toBe("700");
    expect(style.lineHeight).toBe("28px");
    expect(style.letterSpacing).toBe("1px");
  });

  it("fails with unknown-font naming Missing when a typography points at a font that was not passed", async () => {
    const result = renderHtml(
      shape(
        frame("root", {
          children: [
            text("t", {
              typography: {
                family: "Missing",
                size: 16,
                weight: 400,
                lineHeight: 20,
                letterSpacing: 0,
              },
            }),
          ],
        }),
      ),
      await loadFonts(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toMatchObject([
      { code: "unknown-font", family: "Missing" },
    ]);
  });

  it("fails with no-font for a text without fonts, and still renders a shape without text", () => {
    const withText = renderHtml(
      shape(frame("root", { children: [text("t")] })),
      [],
    );
    expect(withText.ok).toBe(false);
    if (withText.ok) return;
    expect(withText.reasons).toMatchObject([{ code: "no-font" }]);

    const withoutText = renderHtml(
      shape(
        frame("root", {
          layout: { gap: 8, padding: 10 },
          children: [box("a", 40, 20), box("b", 40, 20)],
        }),
      ),
      [],
    );
    expect(withoutText.ok).toBe(true);
  });
});
