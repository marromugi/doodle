import { isColor, type RenderNode, type Size } from "@doodle/design-doc";

import type { RenderFailure } from "./failure";
import type { Font } from "./font";

type Direction = "row" | "column";

const isWeight = (value: number): boolean =>
  Number.isFinite(value) && value >= 1 && value <= 1000;

function hasText(node: RenderNode): boolean {
  return (
    node.type === "text" ||
    (node.type === "frame" && node.children.some(hasText))
  );
}

function typographyFamilies(node: RenderNode, into: Set<string>): void {
  if (node.type === "text" && node.typography) {
    into.add(node.typography.family);
  }
  if (node.type === "frame") {
    for (const child of node.children) typographyFamilies(child, into);
  }
}

function checkFonts(root: RenderNode | null, fonts: Font[]): RenderFailure[] {
  const failures: RenderFailure[] = [];
  if (root !== null && fonts.length === 0 && hasText(root)) {
    failures.push({
      code: "no-font",
      message: "a text is drawn but no font was passed",
    });
  }
  for (const font of fonts) {
    if (font.weight !== undefined && !isWeight(font.weight)) {
      failures.push({
        code: "invalid-font",
        family: font.family,
        key: "weight",
        value: font.weight,
        message: `font "${font.family}" has weight ${font.weight}, outside 1 to 1000`,
      });
    }
  }
  const requested = new Set<string>();
  if (root !== null) typographyFamilies(root, requested);
  const known = new Set(fonts.map((font) => font.family));
  for (const family of requested) {
    if (!known.has(family)) {
      failures.push({
        code: "unknown-font",
        family,
        message: `typography points at font "${family}", which was not passed`,
      });
    }
  }
  return failures;
}

type Place = {
  parent: { direction: Direction; width: Size; height: Size } | null;
};

function checkNode(
  node: RenderNode,
  place: Place,
  into: RenderFailure[],
): void {
  const source = node.source;

  const value = (key: string, number: number, nonNegative: boolean) => {
    if (!Number.isFinite(number)) {
      into.push({
        code: "invalid-value",
        source,
        key,
        value: number,
        message: `${key} is not a finite number`,
      });
    } else if (nonNegative && number < 0) {
      into.push({
        code: "invalid-value",
        source,
        key,
        value: number,
        message: `${key} must not be negative`,
      });
    }
  };
  const placement = (key: "width" | "height" | "position", why: string) => {
    into.push({
      code: "invalid-placement",
      source,
      key,
      message: `${key} ${why}`,
    });
  };
  const color = (key: string, text: string | undefined) => {
    if (text !== undefined && !isColor(text)) {
      into.push({
        code: "invalid-color",
        source,
        key,
        value: text,
        message: `${key} is not a colour`,
      });
    }
  };

  const positioned = node.position !== undefined;
  const parent = place.parent;
  for (const key of ["width", "height"] as const) {
    const size = node[key];
    if (size === "fill") {
      if (parent === null) {
        placement(key, "cannot fill: the root has no parent");
      } else if (positioned) {
        placement(key, "cannot fill: a positioned child has no free space");
      } else if (
        parent[key] === "hug" &&
        (parent.direction === "row") === (key === "width")
      ) {
        placement(key, "cannot fill a parent that hugs its content");
      }
    } else if (typeof size === "number") {
      value(key, size, true);
    }
  }
  if (node.position !== undefined) {
    if (parent === null) placement("position", "cannot be set on the root");
    value("position.x", node.position.x, false);
    value("position.y", node.position.y, false);
  }

  if (node.type === "frame") {
    value("layout.gap", node.layout.gap, true);
    value("layout.padding", node.layout.padding, true);
    color("background", node.background);
    if (node.border) {
      color("border.color", node.border.color);
      value("border.width", node.border.width, true);
    }
  }
  if (node.type !== "text" && node.radius !== undefined) {
    value("radius", node.radius, true);
  }
  if (node.type === "text") {
    color("color", node.color);
    if (node.typography) {
      const { size, weight, lineHeight, letterSpacing } = node.typography;
      value("typography.size", size, true);
      if (!isWeight(weight)) {
        into.push({
          code: "invalid-value",
          source,
          key: "typography.weight",
          value: weight,
          message: "typography.weight must be from 1 to 1000",
        });
      }
      value("typography.lineHeight", lineHeight, true);
      value("typography.letterSpacing", letterSpacing, false);
    }
  }

  if (node.type === "frame") {
    for (const child of node.children) {
      checkNode(
        child,
        {
          parent: {
            direction: node.layout.direction,
            width: node.width,
            height: node.height,
          },
        },
        into,
      );
    }
  }
}

export function check(root: RenderNode | null, fonts: Font[]): RenderFailure[] {
  const failures = checkFonts(root, fonts);
  if (root !== null) checkNode(root, { parent: null }, failures);
  return failures;
}
