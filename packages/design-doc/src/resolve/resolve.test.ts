import { describe, expect, test } from "vitest";

import type { Node } from "../model/node";
import type { Scope } from "../model/scope";
import { resolve } from "./resolve";

const scope: Scope = {
  tokens: {
    color: { primary: "#1a73e8", surface: "#ffffff" },
    typography: {},
    space: { md: 16 },
    radius: { md: 8 },
  },
  components: {
    cmp_btn: {
      name: "Button",
      props: {
        label: { type: "string", required: true },
        tone: {
          type: "enum",
          values: ["primary", "neutral"],
          default: "primary",
        },
        icon: { type: "node" },
        note: { type: "string" },
      },
      root: {
        type: "frame",
        id: "btn",
        background: {
          match: "tone",
          cases: {
            primary: { token: "color.primary" },
            neutral: { token: "color.surface" },
          },
        },
        radius: { token: "radius.md" },
        children: [
          { type: "slot", id: "btn-icon", prop: "icon" },
          { type: "text", id: "btn-label", text: { prop: "label" } },
          {
            type: "text",
            id: "btn-note",
            text: { prop: "note" },
            when: { present: "note" },
          },
        ],
      },
    },
    cmp_chip: {
      name: "Chip",
      props: {
        fill: { type: "string" },
        caption: { type: "string" },
        size: { type: "enum", values: ["s", "l"] },
        visible: { type: "boolean", default: true },
        kind: { type: "string" },
      },
      root: {
        type: "frame",
        id: "chip",
        background: { prop: "fill" },
        radius: { match: "size", cases: { s: 4, l: 12 }, default: 8 },
        border: {
          color: {
            match: "kind",
            cases: { alert: "#d93025" },
            default: "#dadce0",
          },
          width: 1,
        },
        children: [
          {
            type: "text",
            id: "chip-text",
            text: { prop: "caption" },
            when: { prop: "visible" },
          },
        ],
      },
    },
    cmp_list: {
      name: "List",
      props: {
        items: {
          type: "array",
          of: {
            type: "object",
            fields: { label: { type: "string", required: true } },
          },
        },
      },
      root: {
        type: "frame",
        id: "list",
        children: [
          {
            type: "repeat",
            id: "list-rows",
            each: { prop: "items" },
            as: "item",
            children: [
              { type: "text", id: "list-row", text: { var: "item.label" } },
            ],
          },
        ],
      },
    },
  },
};

const flagScope: Scope = {
  ...scope,
  components: {
    ...scope.components,
    cmp_flag: {
      name: "Flag",
      props: { on: { type: "boolean" }, n: { type: "number" } },
      root: {
        type: "frame",
        id: "flag",
        background: {
          match: "on",
          cases: { true: "#000000", false: "#ffffff" },
        },
        radius: { match: "n", cases: { "1": 4 }, default: 0 },
        children: [],
      },
    },
  },
};

const drawn = (tree: Node, inScope: Scope = scope) => {
  const result = resolve(tree, inScope);
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result.value.root;
};

const failed = (tree: Node, inScope: Scope = scope) => {
  const result = resolve(tree, inScope);
  if (result.ok) throw new Error(JSON.stringify(result.value));
  return result.reasons;
};

const instance = (
  id: string,
  component: string,
  props: Record<string, unknown>,
): Node => ({ type: "instance", id, component, props }) as Node;

const button = (props: Record<string, unknown> = {}): Node =>
  instance("b1", "cmp_btn", { label: "OK", ...props });

const chip = (props: Record<string, unknown>): Node =>
  instance("c1", "cmp_chip", props);

const list = (props: Record<string, unknown>): Node =>
  instance("l1", "cmp_list", props);

const flag = (props: Record<string, unknown>): Node =>
  instance("f1", "cmp_flag", props);

describe("resolve", () => {
  test("expands an instance with its props, the token value and the default", () => {
    const root = drawn(button());
    expect(root).toMatchObject({
      type: "frame",
      background: "#1a73e8",
      radius: 8,
      children: [{ type: "text", text: "OK" }],
    });
  });

  test("uses the case that matches a passed prop", () => {
    expect(drawn(button({ tone: "neutral" }))).toMatchObject({
      background: "#ffffff",
    });
  });

  test("draws a node whose present condition names a passed prop", () => {
    expect(drawn(button({ note: "New" }))).toMatchObject({
      children: [
        { type: "text", text: "OK" },
        { type: "text", text: "New" },
      ],
    });
  });

  test("draws the nodes passed to a slot in place of the slot", () => {
    const root = drawn(
      button({
        icon: {
          nodes: [{ type: "image", id: "i1", width: 16, height: 16 }],
        },
      }),
    );
    expect(root).toMatchObject({
      children: [
        { type: "image", width: 16, height: 16 },
        { type: "text", text: "OK" },
      ],
    });
  });

  test("drops the key of an unspecified prop and gives empty text", () => {
    const root = drawn(chip({}));
    expect(root).not.toHaveProperty("background");
    expect(root).toMatchObject({
      radius: 8,
      children: [{ type: "text", text: "" }],
    });
  });

  test("uses the matching case of a passed enum prop", () => {
    expect(drawn(chip({ size: "l" }))).toMatchObject({ radius: 12 });
  });

  test("skips a node whose condition reads false", () => {
    expect(drawn(chip({ visible: false }))).toMatchObject({ children: [] });
  });

  test("draws the children once for each element of an array prop", () => {
    const root = drawn(
      list({
        items: {
          array: [{ object: { label: "A" } }, { object: { label: "B" } }],
        },
      }),
    );
    expect(root).toMatchObject({
      children: [
        { type: "text", text: "A" },
        { type: "text", text: "B" },
      ],
    });
  });

  test("draws nothing for a repeat over an unspecified array prop", () => {
    expect(drawn(list({}))).toMatchObject({ children: [] });
  });

  test("fails on a token that is not in the scope", () => {
    const reasons = failed({
      type: "frame",
      id: "root",
      background: { token: "color.missing" },
      children: [],
    });
    expect(reasons).toMatchObject([
      { code: "unresolved-reference", reference: "color.missing" },
    ]);
  });

  test("looks a component up by its ID and fails on a name or an unknown ID", () => {
    expect(failed(instance("x1", "cmp_card", {}))).toMatchObject([
      { code: "unresolved-reference", reference: "cmp_card" },
    ]);
    expect(failed(instance("x1", "Button", {}))).toMatchObject([
      { code: "unresolved-reference", reference: "Button" },
    ]);
  });

  test("returns an empty shape when the root condition is false", () => {
    expect(
      resolve({ type: "text", id: "t1", text: "A", when: false }, scope),
    ).toEqual({ ok: true, value: { root: null } });
  });

  test("uses the default case for a value with no matching case", () => {
    expect(drawn(chip({ kind: "info" }))).toMatchObject({
      border: { color: "#dadce0" },
    });
    expect(drawn(chip({ kind: "alert" }))).toMatchObject({
      border: { color: "#d93025" },
    });
  });

  test("fills the unwritten size and layout of a frame and a text", () => {
    const tree = (text: object): Node =>
      ({
        type: "frame",
        id: "root",
        children: [{ type: "text", id: "t1", text: "A", ...text }],
      }) as Node;
    expect(drawn(tree({}))).toMatchObject({
      width: "hug",
      height: "hug",
      layout: {
        direction: "row",
        gap: 0,
        padding: 0,
        align: "start",
        justify: "start",
      },
      children: [{ width: "hug", height: "hug" }],
    });
    expect(drawn(tree({ width: "fill" }))).toMatchObject({
      children: [{ width: "fill", height: "hug" }],
    });
  });

  test("fills only the unwritten fields of a written layout", () => {
    const root = drawn({
      type: "frame",
      id: "root",
      width: 120,
      layout: { direction: "column", gap: 8, align: "center" },
      children: [],
    });
    expect(root).toMatchObject({
      layout: {
        direction: "column",
        gap: 8,
        padding: 0,
        align: "center",
        justify: "start",
      },
      width: 120,
      height: "hug",
    });
  });

  test("fails for an image that has no width or no height", () => {
    expect(failed({ type: "image", id: "i1", width: 16 })).toMatchObject([
      { code: "size-required", nodeId: "i1", key: "height" },
    ]);
    expect(failed({ type: "image", id: "i1", height: 16 })).toMatchObject([
      { code: "size-required", nodeId: "i1", key: "width" },
    ]);
  });

  test("fails when a slot or a repeat reads a value of the wrong kind", () => {
    expect(failed(button({ icon: "x" }))).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "btn-icon",
        key: "prop",
        expected: ["nodes"],
      },
    ]);
    expect(failed(list({ items: { object: { label: "A" } } }))).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "list-rows",
        key: "each",
        expected: ["array"],
      },
    ]);
  });

  test("fails when a style position holds a value of the wrong kind", () => {
    expect(
      failed({ type: "frame", id: "root", background: 5, children: [] }),
    ).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "root",
        key: "background",
        expected: ["string"],
      },
    ]);
    expect(
      failed({
        type: "text",
        id: "t1",
        text: "A",
        typography: { token: "space.md" },
      }),
    ).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "t1",
        key: "typography",
        expected: ["typography"],
      },
    ]);
  });

  test("fails on a var that steps through a non-object or a missing key", () => {
    expect(failed(list({ items: { array: ["A"] } }))).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "list-row",
        key: "text",
        expected: ["object"],
      },
    ]);
    expect(
      failed(list({ items: { array: [{ object: { name: "A" } }] } })),
    ).toMatchObject([
      { code: "unresolved-reference", reference: "item.label" },
    ]);
    expect(
      failed({ type: "text", id: "t1", text: { var: "item.label" } }),
    ).toMatchObject([
      { code: "unresolved-reference", reference: "item.label" },
    ]);
  });

  test("compares the JSON text of the matched value with the case keys", () => {
    expect(drawn(flag({ on: true, n: 1 }), flagScope)).toMatchObject({
      background: "#000000",
      radius: 4,
    });
    expect(drawn(flag({ on: false, n: 2 }), flagScope)).toMatchObject({
      background: "#ffffff",
      radius: 0,
    });
  });

  test("fails for a match with a value but no case, and for a value of the wrong kind", () => {
    expect(failed(flag({ on: "yes" }), flagScope)).toMatchObject([
      {
        code: "no-matching-case",
        nodeId: "flag",
        key: "background",
        prop: "on",
      },
    ]);
    expect(drawn(flag({}), flagScope)).not.toHaveProperty("background");
    expect(failed(flag({ on: { array: [] } }), flagScope)).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "flag",
        key: "background",
        expected: ["string", "number", "boolean"],
      },
    ]);
  });

  test("fails on a condition that is not a boolean and draws on true", () => {
    expect(
      failed({ type: "text", id: "t1", text: "A", when: "yes" }),
    ).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "t1",
        key: "when",
        expected: ["boolean"],
      },
    ]);
    expect(
      drawn({ type: "text", id: "t1", text: "A", when: true }),
    ).toMatchObject({ type: "text", text: "A" });
  });
});
