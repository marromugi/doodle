import { describe, expect, test } from "vitest";

import { Node } from "../model/node";
import type { RenderNode } from "../model/render";
import { Scope } from "../model/scope";
import { resolve } from "./resolve";

const baseScope = {
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
        radius: {
          match: "size",
          cases: { s: 4, l: 12 },
          default: 8,
        },
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

const flag = {
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
};

const rows = {
  name: "Rows",
  props: { items: { type: "array", of: { type: "string" } } },
  root: {
    type: "repeat",
    id: "rows",
    each: { prop: "items" },
    as: "it",
    children: [{ type: "text", id: "row", text: { var: "it" } }],
  },
};

const slotpos = {
  name: "SlotPos",
  props: { icon: { type: "node" } },
  root: {
    type: "frame",
    id: "sp",
    children: [
      { type: "slot", id: "sp-slot", prop: "icon", position: { x: 2, y: 2 } },
    ],
  },
};

const run = (tree: unknown, extra: Record<string, unknown> = {}) =>
  resolve(
    Node.parse(tree),
    Scope.parse({
      ...baseScope,
      components: { ...baseScope.components, ...extra },
    }),
  );

type Result = ReturnType<typeof run>;

const rootOf = (result: Result): RenderNode | null => {
  if (!result.ok) {
    throw new Error(`expected success: ${JSON.stringify(result.reasons)}`);
  }
  return result.value.root;
};

const reasonsOf = (result: Result) => {
  if (result.ok) throw new Error("expected failure");
  return result.reasons;
};

const button = (props: Record<string, unknown> = {}) => ({
  type: "instance",
  id: "b1",
  component: "cmp_btn",
  props: { label: "OK", ...props },
});

const chip = (props: Record<string, unknown>) => ({
  type: "instance",
  id: "c1",
  component: "cmp_chip",
  props,
});

const list = (props: Record<string, unknown>) => ({
  type: "instance",
  id: "l1",
  component: "cmp_list",
  props,
});

const flagOf = (props: Record<string, unknown>) => ({
  type: "instance",
  id: "f1",
  component: "cmp_flag",
  props,
});

const rowsOf = (items: unknown, position?: unknown) => ({
  type: "instance",
  id: "r1",
  component: "cmp_rows",
  ...(position === undefined ? {} : { position }),
  props: { items },
});

const inFrame = (...children: unknown[]) => ({
  type: "frame",
  id: "root",
  children,
});

describe("resolve", () => {
  test("expands an instance with its passed props and the scope's tokens", () => {
    expect(rootOf(run(button()))).toMatchObject({
      type: "frame",
      background: "#1a73e8",
      radius: 8,
      children: [{ type: "text", text: "OK" }],
    });
  });

  test("uses the case that matches the passed enum value", () => {
    expect(rootOf(run(button({ tone: "neutral" })))).toMatchObject({
      background: "#ffffff",
    });
  });

  test("draws a node whose present condition names a passed prop", () => {
    expect(rootOf(run(button({ note: "New" })))).toMatchObject({
      children: [
        { type: "text", text: "OK" },
        { type: "text", text: "New" },
      ],
    });
  });

  test("draws the nodes passed to a slot in order", () => {
    const icon = {
      nodes: [{ type: "image", id: "i1", width: 16, height: 16 }],
    };
    expect(rootOf(run(button({ icon })))).toMatchObject({
      children: [
        { type: "image", width: 16, height: 16 },
        { type: "text", text: "OK" },
      ],
    });
  });

  test("drops the key and empties the text when an unspecified prop is read", () => {
    const root = rootOf(run(chip({})));
    expect(root).not.toHaveProperty("background");
    expect(root).toMatchObject({
      radius: 8,
      children: [{ type: "text", text: "" }],
    });
  });

  test("uses the case for a passed enum value in a number position", () => {
    expect(rootOf(run(chip({ size: "l" })))).toMatchObject({ radius: 12 });
  });

  test("skips a node whose condition prop is false", () => {
    expect(rootOf(run(chip({ visible: false })))).toMatchObject({
      children: [],
    });
  });

  test("draws the children of a repeat once per array element", () => {
    const items = {
      array: [{ object: { label: "A" } }, { object: { label: "B" } }],
    };
    expect(rootOf(run(list({ items })))).toMatchObject({
      children: [
        { type: "text", text: "A" },
        { type: "text", text: "B" },
      ],
    });
  });

  test("draws nothing for a repeat over an unspecified array prop", () => {
    expect(rootOf(run(list({})))).toMatchObject({ children: [] });
  });

  test("fails with the token reference when a token is not in the scope", () => {
    const tree = {
      type: "frame",
      id: "root",
      background: { token: "color.missing" },
      children: [],
    };
    expect(reasonsOf(run(tree))).toMatchObject([
      { code: "unresolved-reference", reference: "color.missing" },
    ]);
  });

  test("fails with the written id when the component is not in the scope", () => {
    const missing = (component: string) => ({
      type: "instance",
      id: "x1",
      component,
      props: {},
    });
    expect(reasonsOf(run(missing("cmp_card")))).toMatchObject([
      { code: "unresolved-reference", reference: "cmp_card" },
    ]);
    expect(reasonsOf(run(missing("Button")))).toMatchObject([
      { code: "unresolved-reference", reference: "Button" },
    ]);
  });

  test("returns an empty shape when the root's condition is false", () => {
    const tree = { type: "text", id: "t1", text: "A", when: false };
    expect(run(tree)).toEqual({ ok: true, value: { root: null } });
  });

  test("uses the default when no case matches an unmatched string", () => {
    expect(rootOf(run(chip({ kind: "info" })))).toMatchObject({
      border: { color: "#dadce0", width: 1 },
    });
    expect(rootOf(run(chip({ kind: "alert" })))).toMatchObject({
      border: { color: "#d93025", width: 1 },
    });
  });

  test("fills unwritten sizes and layout with the document model's values", () => {
    const tree = inFrame({ type: "text", id: "t1", text: "A" });
    expect(rootOf(run(tree))).toMatchObject({
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
    const wide = inFrame({ type: "text", id: "t1", text: "A", width: "fill" });
    expect(rootOf(run(wide))).toMatchObject({
      children: [{ width: "fill", height: "hug" }],
    });
  });

  test("fills only the unwritten fields of a written layout", () => {
    const tree = {
      type: "frame",
      id: "root",
      width: 120,
      layout: { direction: "column", gap: 8, align: "center" },
      children: [],
    };
    expect(rootOf(run(tree))).toMatchObject({
      width: 120,
      height: "hug",
      layout: {
        direction: "column",
        gap: 8,
        padding: 0,
        align: "center",
        justify: "start",
      },
    });
  });

  test("fails for an image without a width or a height", () => {
    expect(
      reasonsOf(run({ type: "image", id: "i1", width: 16 })),
    ).toMatchObject([{ code: "size-required", nodeId: "i1", key: "height" }]);
    expect(
      reasonsOf(run({ type: "image", id: "i1", height: 16 })),
    ).toMatchObject([{ code: "size-required", nodeId: "i1", key: "width" }]);
  });

  test("fails when a slot or a repeat reads a value of another kind", () => {
    expect(reasonsOf(run(button({ icon: "x" })))).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "btn-icon",
        key: "prop",
        expected: ["nodes"],
      },
    ]);
    expect(
      reasonsOf(run(list({ items: { object: { label: "A" } } }))),
    ).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "list-rows",
        key: "each",
        expected: ["array"],
      },
    ]);
  });

  test("fails when a colour or a typography position reads another kind", () => {
    const background = {
      type: "frame",
      id: "root",
      background: 5,
      children: [],
    };
    expect(reasonsOf(run(background))).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "root",
        key: "background",
        expected: ["string"],
      },
    ]);
    const typography = {
      type: "text",
      id: "t1",
      text: "A",
      typography: { token: "space.md" },
    };
    expect(reasonsOf(run(typography))).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "t1",
        key: "typography",
        expected: ["typography"],
      },
    ]);
  });

  test("fails when a var steps through a value that is not an object", () => {
    expect(reasonsOf(run(list({ items: { array: ["A"] } })))).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "list-row",
        key: "text",
        expected: ["object"],
      },
    ]);
  });

  test("fails with the written path when a var names a missing key or repeat", () => {
    const items = { array: [{ object: { name: "A" } }] };
    expect(reasonsOf(run(list({ items })))).toMatchObject([
      { code: "unresolved-reference", reference: "item.label" },
    ]);
    const outside = { type: "text", id: "t1", text: { var: "item.label" } };
    expect(reasonsOf(run(outside))).toMatchObject([
      { code: "unresolved-reference", reference: "item.label" },
    ]);
  });

  test("compares a number or a boolean with the case keys by its JSON text", () => {
    const extra = { cmp_flag: flag };
    expect(rootOf(run(flagOf({ on: true, n: 1 }), extra))).toMatchObject({
      background: "#000000",
      radius: 4,
    });
    expect(rootOf(run(flagOf({ on: false, n: 2 }), extra))).toMatchObject({
      background: "#ffffff",
      radius: 0,
    });
  });

  test("fails for an unmatched value without a default and drops the key when unspecified", () => {
    const extra = { cmp_flag: flag };
    expect(reasonsOf(run(flagOf({ on: "yes" }), extra))).toMatchObject([
      {
        code: "no-matching-case",
        nodeId: "flag",
        key: "background",
        prop: "on",
      },
    ]);
    expect(rootOf(run(flagOf({}), extra))).not.toHaveProperty("background");
    expect(reasonsOf(run(flagOf({ on: { array: [] } }), extra))).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "flag",
        key: "background",
        expected: ["string", "number", "boolean"],
      },
    ]);
  });

  test("fails for a condition that is not a boolean and draws for true", () => {
    const withWhen = (when: unknown) => ({
      type: "text",
      id: "t1",
      text: "A",
      when,
    });
    expect(reasonsOf(run(withWhen("yes")))).toMatchObject([
      {
        code: "value-kind-mismatch",
        nodeId: "t1",
        key: "when",
        expected: ["boolean"],
      },
    ]);
    expect(rootOf(run(withWhen(true)))).toMatchObject({
      type: "text",
      text: "A",
    });
  });

  test("fails when the root expands to several nodes and returns an empty root for none", () => {
    const extra = { cmp_rows: rows };
    expect(reasonsOf(run(rowsOf({ array: ["A", "B"] }), extra))).toMatchObject([
      { code: "several-roots", nodeId: "r1", count: 2, instances: [] },
    ]);
    expect(run(rowsOf({ array: [] }), extra)).toEqual({
      ok: true,
      value: { root: null },
    });
    expect(rootOf(run(rowsOf({ array: ["A"] }), extra))).toMatchObject({
      type: "text",
      text: "A",
    });
  });

  test("gives an instance's position to its node and drops the component root's", () => {
    const pos = {
      name: "Pos",
      props: {},
      root: {
        type: "frame",
        id: "pos",
        position: { x: 1, y: 1 },
        children: [],
      },
    };
    const tree = inFrame(
      { type: "instance", id: "p1", component: "cmp_pos", props: {} },
      {
        type: "instance",
        id: "p2",
        component: "cmp_pos",
        props: {},
        position: { x: 5, y: 6 },
      },
    );
    const root = rootOf(run(tree, { cmp_pos: pos }));
    expect(root).toMatchObject({
      children: [{}, { position: { x: 5, y: 6 } }],
    });
    if (root === null || root.type !== "frame") throw new Error("frame");
    expect(root.children[0]).not.toHaveProperty("position");
  });

  test("fails for a positioned instance that expands to several nodes", () => {
    const extra = { cmp_rows: rows };
    const at = { x: 5, y: 6 };
    expect(
      reasonsOf(run(inFrame(rowsOf({ array: ["A", "B"] }, at)), extra)),
    ).toMatchObject([{ code: "several-at-position", nodeId: "r1", count: 2 }]);
    expect(
      rootOf(run(inFrame(rowsOf({ array: [] }, at)), extra)),
    ).toMatchObject({ children: [] });
    expect(
      rootOf(run(inFrame(rowsOf({ array: ["A"] }, at)), extra)),
    ).toMatchObject({ children: [{ type: "text", position: at }] });
  });

  test("fails when a slot and its node both have a position and uses the one written otherwise", () => {
    const extra = { cmp_slotpos: slotpos };
    const spot = (image: unknown) => ({
      type: "instance",
      id: "s1",
      component: "cmp_slotpos",
      props: { icon: { nodes: [image] } },
    });
    const image = { type: "image", id: "i1", width: 4, height: 4 };
    expect(
      reasonsOf(run(spot({ ...image, position: { x: 9, y: 9 } }), extra)),
    ).toMatchObject([
      { code: "position-conflict", nodeId: "sp-slot", instances: ["s1"] },
    ]);
    expect(rootOf(run(spot(image), extra))).toMatchObject({
      children: [{ type: "image", position: { x: 2, y: 2 } }],
    });
  });

  test("keeps a passed node's own position when the slot has none", () => {
    const icon = {
      nodes: [
        {
          type: "image",
          id: "i1",
          width: 16,
          height: 16,
          position: { x: 3, y: 4 },
        },
      ],
    };
    expect(rootOf(run(button({ icon })))).toMatchObject({
      children: [{ type: "image", position: { x: 3, y: 4 } }, { type: "text" }],
    });
  });

  test("fails where a component definition's instances return to the same component", () => {
    const a = {
      name: "A",
      props: {},
      root: {
        type: "frame",
        id: "a",
        children: [
          { type: "instance", id: "a-b", component: "cmp_b", props: {} },
        ],
      },
    };
    const b = {
      name: "B",
      props: {},
      root: {
        type: "frame",
        id: "b",
        children: [
          { type: "instance", id: "b-a", component: "cmp_a", props: {} },
        ],
      },
    };
    const tree = {
      type: "instance",
      id: "x1",
      component: "cmp_a",
      props: {},
    };
    expect(reasonsOf(run(tree, { cmp_a: a, cmp_b: b }))).toMatchObject([
      {
        code: "component-cycle",
        nodeId: "b-a",
        component: "cmp_a",
        instances: ["x1", "a-b"],
      },
    ]);
  });

  test("does not count instances written in the page tree as a cycle", () => {
    const box = {
      name: "Box",
      props: { content: { type: "node" } },
      root: {
        type: "frame",
        id: "box",
        children: [{ type: "slot", id: "box-slot", prop: "content" }],
      },
    };
    const tree = {
      type: "instance",
      id: "o1",
      component: "cmp_box",
      props: {
        content: {
          nodes: [
            { type: "instance", id: "o2", component: "cmp_box", props: {} },
          ],
        },
      },
    };
    expect(rootOf(run(tree, { cmp_box: box }))).toMatchObject({
      type: "frame",
      children: [{ type: "frame", children: [] }],
    });
  });

  test("fails for a cycle closed through a prop default", () => {
    const d = {
      name: "D",
      props: {
        content: {
          type: "node",
          default: {
            nodes: [
              { type: "instance", id: "d-in", component: "cmp_d", props: {} },
            ],
          },
        },
      },
      root: {
        type: "frame",
        id: "d",
        children: [{ type: "slot", id: "d-slot", prop: "content" }],
      },
    };
    const tree = {
      type: "instance",
      id: "y1",
      component: "cmp_d",
      props: {},
    };
    expect(reasonsOf(run(tree, { cmp_d: d }))).toMatchObject([
      {
        code: "component-cycle",
        nodeId: "d-in",
        component: "cmp_d",
        instances: ["y1"],
      },
    ]);
  });

  test("drops the whole border when its colour is an unspecified prop", () => {
    const edge = {
      name: "Edge",
      props: { line: { type: "string" } },
      root: {
        type: "frame",
        id: "edge",
        border: { color: { prop: "line" }, width: 1 },
        children: [],
      },
    };
    const tree = (props: Record<string, unknown>) => ({
      type: "instance",
      id: "e1",
      component: "cmp_edge",
      props,
    });
    expect(rootOf(run(tree({}), { cmp_edge: edge }))).not.toHaveProperty(
      "border",
    );
    expect(
      rootOf(run(tree({ line: "#000000" }), { cmp_edge: edge })),
    ).toMatchObject({ border: { color: "#000000", width: 1 } });
  });

  test("answers present false for a required prop that was not passed", () => {
    const req = {
      name: "Req",
      props: { label: { type: "string", required: true } },
      root: {
        type: "frame",
        id: "req",
        children: [
          {
            type: "text",
            id: "req-t",
            text: "x",
            when: { present: "label" },
          },
        ],
      },
    };
    const tree = {
      type: "instance",
      id: "q1",
      component: "cmp_req",
      props: {},
    };
    expect(rootOf(run(tree, { cmp_req: req }))).toMatchObject({
      children: [],
    });
  });

  test("fails for a present condition naming an undeclared prop or written in the page tree", () => {
    const page = {
      type: "text",
      id: "t1",
      text: "A",
      when: { present: "note" },
    };
    expect(reasonsOf(run(page))).toMatchObject([
      { code: "unresolved-reference", reference: "note", instances: [] },
    ]);
    const und = {
      name: "Und",
      props: {},
      root: {
        type: "frame",
        id: "und",
        children: [
          {
            type: "text",
            id: "und-t",
            text: "x",
            when: { present: "nope" },
          },
        ],
      },
    };
    const tree = {
      type: "instance",
      id: "u1",
      component: "cmp_und",
      props: {},
    };
    expect(reasonsOf(run(tree, { cmp_und: und }))).toMatchObject([
      {
        code: "unresolved-reference",
        reference: "nope",
        nodeId: "und-t",
        instances: ["u1"],
      },
    ]);
  });

  test("returns every failure in document order with the instances leading to each", () => {
    const bad = {
      name: "Bad",
      props: {},
      root: {
        type: "frame",
        id: "bad",
        background: { token: "color.none" },
        children: [],
      },
    };
    const use = (id: string) => ({
      type: "instance",
      id,
      component: "cmp_bad",
      props: {},
    });
    const tree = {
      type: "frame",
      id: "root",
      background: { token: "color.missing" },
      children: [
        { type: "text", id: "t1", text: { var: "it" } },
        use("x1"),
        use("x2"),
      ],
    };
    expect(reasonsOf(run(tree, { cmp_bad: bad }))).toMatchObject([
      {
        code: "unresolved-reference",
        reference: "color.missing",
        nodeId: "root",
        instances: [],
      },
      {
        code: "unresolved-reference",
        reference: "it",
        nodeId: "t1",
        instances: [],
      },
      {
        code: "unresolved-reference",
        reference: "color.none",
        nodeId: "bad",
        instances: ["x1"],
      },
      {
        code: "unresolved-reference",
        reference: "color.none",
        nodeId: "bad",
        instances: ["x2"],
      },
    ]);
  });

  test("does not expand an instance whose passed prop value fails to resolve", () => {
    const badp = {
      name: "BadP",
      props: { fill: { type: "string" } },
      root: {
        type: "frame",
        id: "badp",
        background: { token: "color.none" },
        children: [],
      },
    };
    const tree = (props: Record<string, unknown>) => ({
      type: "instance",
      id: "k1",
      component: "cmp_badp",
      props,
    });
    expect(
      reasonsOf(
        run(tree({ fill: { token: "color.nope" } }), { cmp_badp: badp }),
      ),
    ).toMatchObject([
      {
        code: "unresolved-reference",
        reference: "color.nope",
        nodeId: "k1",
        instances: [],
      },
    ]);
    expect(reasonsOf(run(tree({}), { cmp_badp: badp }))).toMatchObject([
      {
        code: "unresolved-reference",
        reference: "color.none",
        nodeId: "badp",
        instances: ["k1"],
      },
    ]);
  });

  test("reports a failure in a node written in the page tree with no instances when drawn through a slot", () => {
    const tree = {
      type: "instance",
      id: "s1",
      component: "cmp_slotpos",
      props: {
        icon: {
          nodes: [
            {
              type: "text",
              id: "n1",
              text: "A",
              color: { token: "color.none" },
            },
          ],
        },
      },
    };
    expect(reasonsOf(run(tree, { cmp_slotpos: slotpos }))).toMatchObject([
      {
        code: "unresolved-reference",
        reference: "color.none",
        nodeId: "n1",
        instances: [],
      },
    ]);
  });
});
