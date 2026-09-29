import { describe, expect, test } from "vitest";

import { apply } from "../apply/apply";
import type { DraftDocument, TreeDocument } from "../model/document";
import type { Node } from "../model/node";
import type { Component, Scope } from "../model/scope";
import { validate } from "./validate";

const button: Component = {
  name: "Button",
  props: {
    label: { type: "string", required: true },
    tone: {
      type: "enum",
      values: ["primary", "neutral"],
      default: "primary",
    },
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
    children: [{ type: "text", id: "btn-label", text: { prop: "label" } }],
  },
};

const scope: Scope = {
  tokens: {
    color: { primary: "#1a73e8", surface: "#ffffff" },
    typography: {},
    space: { md: 16 },
    radius: { md: 8 },
  },
  components: { cmp_btn: button },
};

const history = { nodes: {}, tokens: {}, components: {}, nodeIds: [] };

const b1 = (over: Record<string, unknown> = {}): Node =>
  ({
    type: "instance",
    id: "b1",
    component: "cmp_btn",
    props: { label: "OK" },
    ...over,
  }) as Node;

const page = (
  over: Record<string, unknown> = {},
  children: Node[] = [b1()],
): TreeDocument => ({
  kind: "tree",
  revision: 0,
  release: null,
  history,
  root: {
    type: "frame",
    id: "root",
    background: { token: "color.primary" },
    layout: { direction: "column", gap: { token: "space.md" } },
    children,
    ...over,
  } as Node,
});

const draft = (
  components: Record<string, Component> = {},
  tokens = scope.tokens,
): DraftDocument => ({
  kind: "draft",
  revision: 0,
  tokens,
  components: { cmp_btn: button, ...components },
  history,
});

const badge = (
  props: Component["props"],
  background: unknown,
): Record<string, Component> => ({
  cmp_badge: {
    name: "Badge",
    props,
    root: {
      type: "frame",
      id: "badge",
      background,
      children: [],
    } as Node,
  },
});

const codes = (failures: { code: string }[]) => failures.map((f) => f.code);

describe("validate", () => {
  test("returns an empty list for the base page", () => {
    expect(validate(page(), scope)).toEqual([]);
  });

  test("returns a duplicate node id and a token kind mismatch together", () => {
    const failures = validate(
      page({ background: { token: "space.md" } }, [
        b1(),
        { type: "text", id: "b1", text: "A" },
      ]),
      scope,
    );
    expect(failures).toHaveLength(2);
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-node-id", nodeId: "b1" }),
        expect.objectContaining({
          code: "token-kind-mismatch",
          nodeId: "root",
        }),
      ]),
    );
  });

  test("returns one token kind mismatch for a space token used as a background", () => {
    const failures = validate(
      page({ background: { token: "space.md" } }),
      scope,
    );
    expect(codes(failures)).toEqual(["token-kind-mismatch"]);
  });

  test("returns an unknown token for a token missing from the scope", () => {
    const failures = validate(
      page({ background: { token: "color.missing" } }),
      scope,
    );
    expect(codes(failures)).toEqual(["unknown-token"]);
  });

  test("returns an unknown prop reference for a prop the page does not define", () => {
    const failures = validate(
      page({}, [b1(), { type: "text", id: "t1", text: { prop: "label" } }]),
      scope,
    );
    expect(codes(failures)).toEqual(["unknown-prop-reference"]);
  });

  test("returns a component out of scope for the id Card", () => {
    const failures = validate(page({}, [b1({ component: "Card" })]), scope);
    expect(failures).toEqual([
      expect.objectContaining({
        code: "component-out-of-scope",
        nodeId: "b1",
      }),
    ]);
  });

  test("returns a component out of scope for the name Button", () => {
    const failures = validate(page({}, [b1({ component: "Button" })]), scope);
    expect(failures).toEqual([
      expect.objectContaining({
        code: "component-out-of-scope",
        nodeId: "b1",
      }),
    ]);
  });

  test("returns a missing required prop for label", () => {
    const failures = validate(page({}, [b1({ props: {} })]), scope);
    expect(failures).toEqual([
      expect.objectContaining({ code: "missing-required-prop", prop: "label" }),
    ]);
  });

  test("returns an unknown prop for size", () => {
    const failures = validate(
      page({}, [b1({ props: { label: "OK", size: "lg" } })]),
      scope,
    );
    expect(failures).toEqual([
      expect.objectContaining({ code: "unknown-prop", prop: "size" }),
    ]);
  });

  test("returns a prop type mismatch for a number given to a string prop", () => {
    const failures = validate(page({}, [b1({ props: { label: 1 } })]), scope);
    expect(failures).toEqual([
      expect.objectContaining({ code: "prop-type-mismatch", prop: "label" }),
    ]);
  });

  test("returns a prop type mismatch for an enum value outside its values", () => {
    const failures = validate(
      page({}, [b1({ props: { label: "OK", tone: "danger" } })]),
      scope,
    );
    expect(failures).toEqual([
      expect.objectContaining({ code: "prop-type-mismatch", prop: "tone" }),
    ]);
  });

  test("returns a prop type mismatch for a wrapped array given to a string prop", () => {
    const failures = validate(
      page({}, [b1({ props: { label: { array: ["OK"] } } })]),
      scope,
    );
    expect(codes(failures)).toEqual(["prop-type-mismatch"]);
  });

  test("returns a match not exhaustive for an enum case left uncovered", () => {
    const props: Component["props"] = {
      tone: { type: "enum", values: ["info", "warn"], required: true },
    };
    const failures = validate(
      draft(badge(props, { match: "tone", cases: { info: "#1a73e8" } })),
    );
    expect(codes(failures)).toEqual(["match-not-exhaustive"]);
  });

  test("returns an empty list once the enum cases cover every value", () => {
    const props: Component["props"] = {
      tone: { type: "enum", values: ["info", "warn"], required: true },
    };
    const failures = validate(
      draft(
        badge(props, {
          match: "tone",
          cases: { info: "#1a73e8", warn: "#ffffff" },
        }),
      ),
    );
    expect(failures).toEqual([]);
  });

  test("returns a match not exhaustive for a boolean with only true, with or without a default", () => {
    const props: Component["props"] = {
      on: { type: "boolean", required: true },
    };
    const cases = { true: "#1a73e8" };
    expect(
      codes(validate(draft(badge(props, { match: "on", cases })))),
    ).toEqual(["match-not-exhaustive"]);
    expect(
      codes(
        validate(
          draft(badge(props, { match: "on", cases, default: "#ffffff" })),
        ),
      ),
    ).toEqual(["match-not-exhaustive"]);
  });

  test("returns an empty list once the boolean cases cover true and false", () => {
    const props: Component["props"] = {
      on: { type: "boolean", required: true },
    };
    const cases = { true: "#1a73e8", false: "#000000" };
    expect(validate(draft(badge(props, { match: "on", cases })))).toEqual([]);
  });

  test("returns a match default required for an optional enum without a default", () => {
    const props: Component["props"] = {
      tone: { type: "enum", values: ["info", "warn"] },
    };
    const cases = { info: "#1a73e8", warn: "#ffffff" };
    expect(
      codes(validate(draft(badge(props, { match: "tone", cases })))),
    ).toEqual(["match-default-required"]);
    expect(
      validate(
        draft(badge(props, { match: "tone", cases, default: "#ffffff" })),
      ),
    ).toEqual([]);
  });

  test("returns a match default required for a string match without a default", () => {
    const props: Component["props"] = {
      kind: { type: "string", required: true },
    };
    const cases = { a: "#1a73e8", b: "#ffffff" };
    expect(
      codes(validate(draft(badge(props, { match: "kind", cases })))),
    ).toEqual(["match-default-required"]);
    expect(
      validate(
        draft(badge(props, { match: "kind", cases, default: "#000000" })),
      ),
    ).toEqual([]);
  });

  test("returns a match unsupported type for a match on a node prop", () => {
    const props: Component["props"] = { icon: { type: "node" } };
    const failures = validate(
      draft(badge(props, { match: "icon", cases: {}, default: "#ffffff" })),
    );
    expect(codes(failures)).toEqual(["match-unsupported-type"]);
  });

  const rowsProp: Component["props"] = {
    rows: {
      type: "array",
      of: { type: "object", fields: { label: { type: "string" } } },
      required: true,
    },
  };

  const nestedRepeats = (inner: string): Record<string, Component> => ({
    cmp_list: {
      name: "List",
      props: rowsProp,
      root: {
        type: "frame",
        id: "list",
        children: [
          {
            type: "repeat",
            id: "outer",
            each: { prop: "rows" },
            as: "item",
            children: [
              {
                type: "repeat",
                id: "inner",
                each: { var: "item.cells" },
                as: inner,
                children: [],
              },
            ],
          },
        ],
      } as Node,
    },
  });

  test("returns a repeat name shadowed for an inner repeat reusing item", () => {
    expect(codes(validate(draft(nestedRepeats("item"))))).toEqual([
      "repeat-name-shadowed",
    ]);
  });

  test("returns an empty list when the inner repeat is named cell", () => {
    expect(validate(draft(nestedRepeats("cell")))).toEqual([]);
  });

  const listWith = (children: Node[]): Record<string, Component> => ({
    cmp_list: {
      name: "List",
      props: rowsProp,
      root: { type: "frame", id: "list", children } as Node,
    },
  });

  test("returns a var outside repeat for a var used outside any repeat", () => {
    const failures = validate(
      draft(
        listWith([{ type: "text", id: "t1", text: { var: "item.label" } }]),
      ),
    );
    expect(codes(failures)).toEqual(["var-outside-repeat"]);
  });

  test("returns a var outside repeat for a var not starting with the repeat name", () => {
    const failures = validate(
      draft(
        listWith([
          {
            type: "repeat",
            id: "r1",
            each: { prop: "rows" },
            as: "row",
            children: [{ type: "text", id: "t1", text: { var: "item.label" } }],
          },
        ]),
      ),
    );
    expect(codes(failures)).toEqual(["var-outside-repeat"]);
  });

  test("returns a component cycle for two components nesting each other", () => {
    const nest = (id: string, target: string): Component => ({
      name: id,
      props: {},
      root: {
        type: "frame",
        id: `${id}-root`,
        children: [
          { type: "instance", id: `${id}-i`, component: target, props: {} },
        ],
      } as Node,
    });
    const failures = validate(
      draft({ cmp_a: nest("A", "cmp_b"), cmp_b: nest("B", "cmp_a") }),
    );
    expect(codes(failures)).toContain("component-cycle");
  });

  test("returns an empty list for a draft holding the scope's tokens and components", () => {
    expect(validate(draft())).toEqual([]);
  });

  test("returns an unknown token at btn when the draft lacks color.primary", () => {
    const { primary: _removed, ...color } = scope.tokens.color;
    const failures = validate(draft({}, { ...scope.tokens, color }));
    expect(failures).toEqual([
      expect.objectContaining({ code: "unknown-token", nodeId: "btn" }),
    ]);
  });

  test("returns an invalid colour for a url() background and none for a hex colour", () => {
    expect(
      validate(
        page({ background: "url(https://example.com/a.png)" }, []),
        scope,
      ),
    ).toEqual([
      expect.objectContaining({
        code: "invalid-color",
        nodeId: "root",
        key: "background",
        value: "url(https://example.com/a.png)",
      }),
    ]);
    expect(validate(page({ background: "#1a73e8" }, []), scope)).toEqual([]);
  });

  test("returns an invalid colour keyed color for a text and keyed border.color for a frame", () => {
    expect(
      validate(
        page({}, [
          { type: "text", id: "t1", text: "A", color: "currentcolor" },
        ]),
        scope,
      ),
    ).toEqual([
      expect.objectContaining({
        code: "invalid-color",
        nodeId: "t1",
        key: "color",
      }),
    ]);
    expect(
      validate(page({ border: { color: "red; x: 1", width: 1 } }, []), scope),
    ).toEqual([
      expect.objectContaining({
        code: "invalid-color",
        nodeId: "root",
        key: "border.color",
      }),
    ]);
  });

  test("returns an invalid colour for a match case and for a match default that are not colours", () => {
    const tone: Component["props"] = {
      tone: { type: "enum", values: ["a", "b"], required: true },
    };
    const withColor = (color: unknown): Record<string, Component> => ({
      cmp_badge: {
        name: "Badge",
        props: tone,
        root: {
          type: "frame",
          id: "badge",
          children: [{ type: "text", id: "badge-t", text: "A", color }],
        } as Node,
      },
    });
    const invalid = (failures: { code: string }[]) =>
      failures.filter((f) => f.code === "invalid-color");
    expect(
      invalid(
        validate(
          draft(
            withColor({
              match: "tone",
              cases: { a: "#000000", b: "not-a-colour" },
            }),
          ),
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        code: "invalid-color",
        nodeId: "badge-t",
        key: "color",
        value: "not-a-colour",
      }),
    ]);
    expect(
      invalid(
        validate(
          draft(
            withColor({
              match: "tone",
              cases: { a: "#000000", b: "#ffffff" },
              default: "also-not",
            }),
          ),
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        code: "invalid-color",
        nodeId: "badge-t",
        key: "color",
        value: "also-not",
      }),
    ]);
  });

  test("returns one invalid colour for the text colour when a prop reference and a text body look like colours", () => {
    const failures = validate(
      draft({
        cmp_fill: {
          name: "Fill",
          props: { fill: { type: "string", default: "url(x)" } },
          root: {
            type: "frame",
            id: "fill",
            background: { prop: "fill" },
            children: [
              { type: "text", id: "fill-t", text: "url(x)", color: "nope" },
            ],
          } as Node,
        },
      }),
    );
    expect(failures).toEqual([
      expect.objectContaining({
        code: "invalid-color",
        key: "color",
        value: "nope",
      }),
    ]);
  });

  test("fails an apply with an invalid colour when the document already holds a non-colour background", () => {
    const doc = page({ background: "nope" }, [
      { type: "text", id: "t1", text: "A" },
    ]);
    const result = apply(
      doc,
      { type: "set", base: 0, node: "t1", key: "text", value: "B" },
      scope,
    );
    expect(result).toEqual({
      ok: false,
      reasons: [
        expect.objectContaining({
          code: "invalid-color",
          nodeId: "root",
          key: "background",
          value: "nope",
        }),
      ],
    });
  });
});
