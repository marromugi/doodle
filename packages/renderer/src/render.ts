import type { RenderNode, RenderShape, Result } from "@doodle/design-doc";

import { fontFaceRule, quoteCss, type Font } from "./font";

export type RenderFailure =
  | { code: "unknown-font"; family: string; message: string }
  | { code: "no-font"; message: string };

type Direction = "row" | "column";

const JUSTIFY = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  "space-between": "space-between",
} as const;

const ALIGN = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collectTypographyFamilies(node: RenderNode, into: Set<string>): void {
  if (node.type === "text" && node.typography) {
    into.add(node.typography.family);
  }
  if (node.type === "frame") {
    for (const child of node.children) collectTypographyFamilies(child, into);
  }
}

function hasText(node: RenderNode): boolean {
  if (node.type === "text") return true;
  return node.type === "frame" && node.children.some(hasText);
}

function checkFonts(root: RenderNode, fonts: Font[]): RenderFailure[] {
  if (!hasText(root)) return [];
  if (fonts.length === 0) {
    return [
      {
        code: "no-font",
        message: "a text is drawn but no font was passed",
      },
    ];
  }
  const requested = new Set<string>();
  collectTypographyFamilies(root, requested);
  const known = new Set(fonts.map((font) => font.family));
  return [...requested]
    .filter((family) => !known.has(family))
    .map((family) => ({
      code: "unknown-font" as const,
      family,
      message: `typography points at font "${family}", which was not passed`,
    }));
}

function sizeStyles(
  node: RenderNode,
  parent: Direction | null,
  absolute: boolean,
): string[] {
  const styles: string[] = [];
  const axes = [
    ["width", node.width, "row"],
    ["height", node.height, "column"],
  ] as const;
  for (const [property, size, axis] of axes) {
    if (typeof size === "number") {
      styles.push(`${property}: ${size}px`);
    } else if (size === "hug") {
      styles.push(`${property}: fit-content`);
    } else if (parent === null || absolute) {
      styles.push(`${property}: 100%`);
    } else if (parent === axis) {
      styles.push("flex: 1 1 0", "min-width: 0", "min-height: 0");
    } else {
      styles.push("align-self: stretch");
    }
  }
  if (parent !== null && !absolute) {
    const grows =
      (node.width === "fill" && parent === "row") ||
      (node.height === "fill" && parent === "column");
    if (!grows) styles.push("flex-shrink: 0");
  }
  return styles;
}

function renderNode(
  node: RenderNode,
  parent: Direction | null,
  fonts: Font[],
): string {
  const absolute = node.position !== undefined;
  const styles = [
    "box-sizing: border-box",
    ...sizeStyles(node, parent, absolute),
  ];
  if (node.position) {
    styles.push(
      "position: absolute",
      `left: ${node.position.x}px`,
      `top: ${node.position.y}px`,
    );
  }
  const open = (extra: string[]) =>
    `<div data-source="${escapeHtml(node.source)}" style="${escapeHtml(
      [...styles, ...extra].join("; "),
    )}">`;

  switch (node.type) {
    case "frame": {
      const { layout } = node;
      const extra = [
        "display: flex",
        `flex-direction: ${layout.direction}`,
        `gap: ${layout.gap}px`,
        `padding: ${layout.padding}px`,
        `align-items: ${ALIGN[layout.align]}`,
        `justify-content: ${JUSTIFY[layout.justify]}`,
      ];
      if (!absolute) extra.push("position: relative");
      if (node.background) extra.push(`background: ${node.background}`);
      if (node.border) {
        extra.push(`border: ${node.border.width}px solid ${node.border.color}`);
      }
      if (node.radius !== undefined)
        extra.push(`border-radius: ${node.radius}px`);
      const children = node.children
        .map((child) => renderNode(child, layout.direction, fonts))
        .join("");
      return `${open(extra)}${children}</div>`;
    }
    case "text": {
      const extra: string[] = [];
      const typography = node.typography;
      const family = typography?.family ?? fonts[0]?.family ?? "";
      extra.push(`font-family: ${quoteCss(family)}`);
      if (typography) {
        extra.push(
          `font-size: ${typography.size}px`,
          `font-weight: ${typography.weight}`,
          `line-height: ${typography.lineHeight}px`,
          `letter-spacing: ${typography.letterSpacing}px`,
        );
      }
      if (node.color) extra.push(`color: ${node.color}`);
      return `${open(extra)}${escapeHtml(node.text)}</div>`;
    }
    case "image": {
      const extra = ["background: #d9d9d9"];
      if (node.radius !== undefined)
        extra.push(`border-radius: ${node.radius}px`);
      return `${open(extra)}</div>`;
    }
  }
}

export function renderHtml(
  shape: RenderShape,
  fonts: Font[],
): Result<string, RenderFailure> {
  const reasons = shape.root ? checkFonts(shape.root, fonts) : [];
  if (reasons.length > 0) return { ok: false, reasons };

  const body = shape.root ? renderNode(shape.root, null, fonts) : "";
  const style = [
    ...fonts.map(fontFaceRule),
    "html, body { margin: 0; padding: 0 }",
  ].join("\n");
  return {
    ok: true,
    value: `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<style>\n${style}\n</style>\n</head>\n<body>${body}</body>\n</html>\n`,
  };
}
