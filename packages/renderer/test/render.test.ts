import type { RenderNode } from "@doodle/design-doc";
import { beforeAll, describe, expect, test } from "vitest";

import { renderHtml, type Font } from "../src";
import {
  box,
  fontStatus,
  frame,
  image,
  loadFonts,
  open,
  shape,
  text,
  withoutMessages,
} from "./helpers";

let fonts: Font[];

beforeAll(async () => {
  fonts = await loadFonts();
});

async function draw(root: RenderNode | null, passed: Font[] = fonts) {
  const result = renderHtml(shape(root), passed);
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return open(result.value);
}

function failures(root: RenderNode | null, passed: Font[] = fonts) {
  const result = renderHtml(shape(root), passed);
  if (result.ok) throw new Error("expected a failure");
  return withoutMessages(result.reasons);
}

const typography = {
  family: "Doodle Alt",
  size: 20,
  weight: 700,
  lineHeight: 28,
  letterSpacing: 1,
};

describe("layout", () => {
  test("a row frame places children with gap and padding", async () => {
    const page = await draw(
      frame("root", {
        layout: { direction: "row", gap: 8, padding: 10 },
        children: [box("a", 40, 20), box("b", 40, 20)],
      }),
    );
    expect(page.rect("a")).toEqual({ x: 10, y: 10, w: 40, h: 20 });
    expect(page.rect("b")).toEqual({ x: 58, y: 10, w: 40, h: 20 });
    expect(page.rect("root")).toEqual({ x: 0, y: 0, w: 108, h: 40 });
  });

  test("a column frame places children with gap and padding", async () => {
    const page = await draw(
      frame("root", {
        layout: { direction: "column", gap: 8, padding: 10 },
        children: [box("a", 40, 20), box("b", 40, 20)],
      }),
    );
    expect(page.rect("a")).toEqual({ x: 10, y: 10, w: 40, h: 20 });
    expect(page.rect("b")).toEqual({ x: 10, y: 38, w: 40, h: 20 });
    expect(page.rect("root")).toEqual({ x: 0, y: 0, w: 60, h: 68 });
  });

  test("a positioned child leaves the flow and sits at its coordinates", async () => {
    const c = {
      ...box("c", 30, 30),
      position: { x: 120, y: 50 },
    };
    const page = await draw(
      frame("root", {
        width: 200,
        height: 100,
        children: [box("a", 40, 20), c, box("b", 40, 20)],
      }),
    );
    expect(page.rect("a")).toEqual({ x: 0, y: 0, w: 40, h: 20 });
    expect(page.rect("c")).toEqual({ x: 120, y: 50, w: 30, h: 30 });
    expect(page.rect("b")).toEqual({ x: 40, y: 0, w: 40, h: 20 });
  });

  test("a fill width child takes the free space of its parent", async () => {
    const page = await draw(
      frame("root", {
        width: 300,
        height: 100,
        children: [box("a", 40, 20), frame("f", { width: "fill", height: 20 })],
      }),
    );
    expect(page.rect("f")).toEqual({ x: 40, y: 0, w: 260, h: 20 });
  });
});

describe("appearance", () => {
  test("a frame draws its background, border and radius", async () => {
    const page = await draw(
      frame("root", {
        width: 100,
        height: 100,
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

  test("a text draws its string", async () => {
    const page = await draw(frame("root", { children: [text("t", "Hello")] }));
    expect(page.el("t").textContent).toBe("Hello");
  });

  test("an image draws a placeholder of its size and loads no external file", async () => {
    const page = await draw(frame("root", { children: [image("i", 120, 80)] }));
    expect(page.rect("i")).toMatchObject({ w: 120, h: 80 });
    expect(page.win.performance.getEntriesByType("resource")).toHaveLength(0);
  });
});

describe("fonts", () => {
  test("a text without typography is drawn with the first font passed", async () => {
    const page = await draw(frame("root", { children: [text("t", "Hello")] }));
    expect(fontStatus(page.doc, "Doodle Test")).toBe("loaded");
    const family = page.win.getComputedStyle(page.el("t")).fontFamily;
    expect(family).toBe('"Doodle Test"');
    for (const generic of ["serif", "sans-serif", "system-ui", "monospace"]) {
      expect(family).not.toContain(generic);
    }
  });

  test("typography sets family, size, weight, line height and letter spacing", async () => {
    const page = await draw(
      frame("root", { children: [text("t", "Hello", { typography })] }),
    );
    const style = page.win.getComputedStyle(page.el("t"));
    expect(style.fontFamily).toBe('"Doodle Alt"');
    expect(style.fontSize).toBe("20px");
    expect(style.fontWeight).toBe("700");
    expect(style.lineHeight).toBe("28px");
    expect(style.letterSpacing).toBe("1px");
  });

  test("a family with quotes and a closing style tag is written as that name", async () => {
    const name = 'Doodle"</style><script>window.x=1</script>';
    const page = await draw(
      frame("root", {
        children: [
          text("t", "Hello", { typography: { ...typography, family: name } }),
        ],
      }),
      [{ ...fonts[0]!, family: name }],
    );
    expect(page.doc.querySelectorAll("script")).toHaveLength(0);
    expect((page.win as unknown as { x?: number }).x).toBeUndefined();
    expect(fontStatus(page.doc, name)).toBe("loaded");
  });
});

describe("failures", () => {
  const hello = () => frame("root", { children: [text("t", "Hello")] });

  test("a typography family that was not passed fails with unknown-font", () => {
    const root = frame("root", {
      children: [
        text("t", "Hello", {
          typography: { ...typography, family: "Missing" },
        }),
      ],
    });
    expect(failures(root)).toEqual([
      { code: "unknown-font", family: "Missing" },
    ]);
  });

  test("a text without any font passed fails with no-font, while a shape without text renders", () => {
    expect(failures(hello(), [])).toEqual([{ code: "no-font" }]);
    const result = renderHtml(
      shape(
        frame("root", {
          layout: { direction: "row", gap: 8, padding: 10 },
          children: [box("a", 40, 20), box("b", 40, 20)],
        }),
      ),
      [],
    );
    expect(result.ok).toBe(true);
  });

  test("a shape without a root renders an empty page", async () => {
    const page = await draw(null);
    expect(page.doc.body.children).toHaveLength(0);
  });

  test("a colour that is not a colour fails with invalid-color", () => {
    const url = "url(https://example.com/a.png)";
    expect(failures(frame("root", { background: url }))).toEqual([
      { code: "invalid-color", source: "root", key: "background", value: url },
    ]);
    expect(
      renderHtml(shape(frame("root", { background: "#1a73e8" })), fonts).ok,
    ).toBe(true);
    expect(
      failures(frame("root", { border: { color: "nope", width: 1 } })),
    ).toEqual([
      {
        code: "invalid-color",
        source: "root",
        key: "border.color",
        value: "nope",
      },
    ]);
    expect(
      failures(
        frame("root", { children: [text("t", "Hello", { color: "nope" })] }),
      ),
    ).toEqual([
      { code: "invalid-color", source: "t", key: "color", value: "nope" },
    ]);
  });

  test("a node without a place fails with invalid-placement", () => {
    expect(failures(frame("root", { width: "fill" }))).toEqual([
      { code: "invalid-placement", source: "root", key: "width" },
    ]);
    expect(failures(frame("root", { position: { x: 0, y: 0 } }))).toEqual([
      { code: "invalid-placement", source: "root", key: "position" },
    ]);
    const c = { ...box("c", 30, 30), position: { x: 120, y: 50 } };
    expect(
      failures(
        frame("root", {
          width: 200,
          height: 100,
          children: [{ ...c, width: "fill" }],
        }),
      ),
    ).toEqual([{ code: "invalid-placement", source: "c", key: "width" }]);
    expect(
      failures(
        frame("root", {
          layout: { direction: "row", gap: 8, padding: 10 },
          children: [{ ...box("a", 40, 20), width: "fill" }, box("b", 40, 20)],
        }),
      ),
    ).toEqual([{ code: "invalid-placement", source: "a", key: "width" }]);
  });

  test("a number CSS cannot take fails with invalid-value", () => {
    expect(failures(frame("root", { children: [box("a", -10, 20)] }))).toEqual([
      { code: "invalid-value", source: "a", key: "width", value: -10 },
    ]);
    expect(
      failures(
        frame("root", {
          children: [
            text("t", "Hello", { typography: { ...typography, weight: 1200 } }),
          ],
        }),
      ),
    ).toEqual([
      {
        code: "invalid-value",
        source: "t",
        key: "typography.weight",
        value: 1200,
      },
    ]);
    const [reason] = failures(
      frame("root", { layout: { gap: Number.NaN } }),
    ) as { key: string; value: number }[];
    expect(reason?.key).toBe("layout.gap");
    expect(reason?.value).toBeNaN();
  });

  test("a font weight outside 1 to 1000 fails with invalid-font", () => {
    expect(failures(hello(), [{ ...fonts[0]!, weight: 0 }, fonts[1]!])).toEqual(
      [
        {
          code: "invalid-font",
          family: "Doodle Test",
          key: "weight",
          value: 0,
        },
      ],
    );
  });

  test("every failure is returned in the fixed order", () => {
    expect(
      failures(
        frame("root", { background: "nope", children: [text("t", "Hello")] }),
        [],
      ),
    ).toEqual([
      { code: "no-font" },
      {
        code: "invalid-color",
        source: "root",
        key: "background",
        value: "nope",
      },
    ]);

    expect(failures(frame("root", { width: -1, background: "nope" }))).toEqual([
      { code: "invalid-value", source: "root", key: "width", value: -1 },
      {
        code: "invalid-color",
        source: "root",
        key: "background",
        value: "nope",
      },
    ]);

    expect(
      failures(
        frame("root", {
          background: "nope",
          children: [
            text("t", "Hello", { typography }),
            { ...box("a", 40, 20), background: "nope" },
          ],
        }),
        [{ ...fonts[0]!, weight: 0 }],
      ),
    ).toEqual([
      { code: "invalid-font", family: "Doodle Test", key: "weight", value: 0 },
      { code: "unknown-font", family: "Doodle Alt" },
      {
        code: "invalid-color",
        source: "root",
        key: "background",
        value: "nope",
      },
      { code: "invalid-color", source: "a", key: "background", value: "nope" },
    ]);
  });
});
