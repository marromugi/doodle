import type { RenderNode, RenderShape, Result } from "@doodle/design-doc";

import { check } from "./check";
import type { RenderFailure } from "./failure";
import { fontFaceRule, quoteCss, type Font } from "./font";

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

/** Size declarations for one node; `parent` is null for the root. */
function sizeStyles(node: RenderNode, parent: Direction | null): string[] {
  const styles: string[] = [];
  const axes = [
    ["width", node.width, "row"],
    ["height", node.height, "column"],
  ] as const;
  let grows = false;
  for (const [property, size, axis] of axes) {
    if (typeof size === "number") {
      styles.push(`${property}: ${size}px`);
    } else if (size === "hug") {
      styles.push(`${property}: fit-content`);
    } else if (parent === axis) {
      grows = true;
      styles.push("flex: 1 1 0", `min-${property}: 0`);
    } else {
      styles.push("align-self: stretch");
    }
  }
  if (parent !== null && node.position === undefined && !grows) {
    styles.push("flex-shrink: 0");
  }
  return styles;
}

function renderNode(
  node: RenderNode,
  parent: Direction | null,
  parentBorder: number,
  fonts: Font[],
): string {
  const styles = ["box-sizing: border-box", ...sizeStyles(node, parent)];
  if (node.position) {
    styles.push(
      "position: absolute",
      `left: ${node.position.x - parentBorder}px`,
      `top: ${node.position.y - parentBorder}px`,
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
      if (node.position === undefined) extra.push("position: relative");
      if (node.background) extra.push(`background: ${node.background}`);
      if (node.border) {
        extra.push(`border: ${node.border.width}px solid ${node.border.color}`);
      }
      if (node.radius !== undefined) {
        extra.push(`border-radius: ${node.radius}px`);
      }
      const children = node.children
        .map((child) =>
          renderNode(child, layout.direction, node.border?.width ?? 0, fonts),
        )
        .join("");
      return `${open(extra)}${children}</div>`;
    }
    case "text": {
      const { typography } = node;
      const family = typography?.family ?? fonts[0]!.family;
      const extra = ["white-space: pre", `font-family: ${quoteCss(family)}`];
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
      if (node.radius !== undefined) {
        extra.push(`border-radius: ${node.radius}px`);
      }
      return `${open(extra)}</div>`;
    }
  }
}

export function renderHtml(
  shape: RenderShape,
  fonts: Font[],
): Result<string, RenderFailure> {
  const reasons = check(shape.root, fonts);
  if (reasons.length > 0) return { ok: false, reasons };

  const body = shape.root ? renderNode(shape.root, null, 0, fonts) : "";
  const style = [
    ...fonts.map(fontFaceRule),
    "html, body { margin: 0; padding: 0 }",
  ].join("\n");
  return {
    ok: true,
    value: `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<style>\n${style}\n</style>\n</head>\n<body>${body}</body>\n</html>\n`,
  };
}
