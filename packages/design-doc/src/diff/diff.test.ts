import { describe, expect, test } from "vitest";

import type { TreeDocument } from "../model/document";
import type { Scope } from "../model/scope";
import { diff } from "./diff";

const oldScope: Scope = {
  tokens: {
    color: { primary: "#1a73e8" },
    typography: {},
    space: {},
    radius: {},
  },
  components: {
    cmp_btn: {
      name: "Button",
      props: { label: { type: "string", required: true } },
      root: {
        type: "frame",
        id: "btn",
        children: [{ type: "text", id: "btn-label", text: { prop: "label" } }],
      },
    },
  },
};

const doc: TreeDocument = {
  kind: "tree",
  revision: 3,
  release: null,
  root: {
    type: "frame",
    id: "root",
    background: { token: "color.primary" },
    children: [
      {
        type: "instance",
        id: "b1",
        component: "cmp_btn",
        props: { label: "OK" },
      },
    ],
  },
  history: {
    nodes: { root: 1, b1: 2 },
    tokens: {},
    components: {},
    nodeIds: ["root", "b1"],
  },
};

const withoutPrimary: Scope = {
  ...oldScope,
  tokens: { ...oldScope.tokens, color: {} },
};

describe("diff", () => {
  test("returns an empty list when the new scope equals the old one", () => {
    expect(diff(doc, oldScope, oldScope)).toEqual([]);
  });

  test("returns an empty list when only a component name changed", () => {
    const renamed: Scope = {
      ...oldScope,
      components: {
        cmp_btn: { ...oldScope.components["cmp_btn"]!, name: "ButtonV2" },
      },
    };
    expect(diff(doc, oldScope, renamed)).toEqual([]);
  });

  test("returns one discrepancy when only color.primary is gone", () => {
    expect(diff(doc, oldScope, withoutPrimary)).toHaveLength(1);
  });

  test("reports a used component missing from the new scope", () => {
    const newScope: Scope = { ...oldScope, components: {} };
    expect(diff(doc, oldScope, newScope)).toEqual([
      { kind: "component-removed", nodeId: "b1", component: "cmp_btn" },
    ]);
  });

  test("reports an instance whose props no longer fit the new definition", () => {
    const newScope: Scope = {
      ...oldScope,
      components: {
        cmp_btn: {
          ...oldScope.components["cmp_btn"]!,
          props: {
            label: { type: "string", required: true },
            size: { type: "enum", values: ["s", "m"], required: true },
          },
        },
      },
    };
    const found = diff(doc, oldScope, newScope);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "props-mismatch", nodeId: "b1" });
    expect(found[0]).toMatchObject({
      reasons: [{ code: "missing-required-prop", prop: "size" }],
    });
  });

  test("reports a used token missing from the new scope", () => {
    expect(diff(doc, oldScope, withoutPrimary)).toEqual([
      { kind: "token-removed", nodeId: "root", token: "color.primary" },
    ]);
  });
});
