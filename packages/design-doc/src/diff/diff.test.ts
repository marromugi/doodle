import { describe, expect, test } from "vitest";

import type { TreeDocument } from "../model/document";
import type { Component, Scope } from "../model/scope";
import { diff } from "./diff";

const button: Component = {
  name: "Button",
  props: { label: { type: "string", required: true } },
  root: {
    type: "frame",
    id: "btn",
    children: [{ type: "text", id: "btn-label", text: { prop: "label" } }],
  },
};

const oldScope: Scope = {
  tokens: {
    color: { primary: "#1a73e8" },
    typography: {},
    space: {},
    radius: {},
  },
  components: { cmp_btn: button },
};

const withoutButton: Scope = { ...oldScope, components: {} };

const withoutPrimary: Scope = {
  ...oldScope,
  tokens: { ...oldScope.tokens, color: {} },
};

const doc: TreeDocument = {
  kind: "tree",
  revision: 3,
  release: { designSystem: "ds_1", release: "rel_old" },
  history: { nodes: {}, tokens: {}, components: {}, nodeIds: [] },
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
};

describe("diff", () => {
  test("returns an empty list when the new scope equals the old scope", () => {
    expect(diff(doc, oldScope, oldScope)).toEqual([]);
  });

  test("returns an empty list when only a component name changed", () => {
    const renamed: Scope = {
      ...oldScope,
      components: { cmp_btn: { ...button, name: "ButtonV2" } },
    };
    expect(diff(doc, oldScope, renamed)).toEqual([]);
  });

  test("returns one discrepancy when a used token is gone", () => {
    expect(diff(doc, oldScope, withoutPrimary)).toHaveLength(1);
  });

  test("reports an instance whose component is gone from the new scope", () => {
    expect(diff(doc, oldScope, withoutButton)).toEqual([
      { kind: "component-removed", nodeId: "b1", component: "cmp_btn" },
    ]);
  });

  test("reports an instance that lacks a prop the new definition requires", () => {
    const newScope: Scope = {
      ...oldScope,
      components: {
        cmp_btn: {
          ...button,
          props: {
            ...button.props,
            size: { type: "enum", values: ["s", "m"], required: true },
          },
        },
      },
    };
    expect(diff(doc, oldScope, newScope)).toEqual([
      {
        kind: "props-mismatch",
        nodeId: "b1",
        component: "cmp_btn",
        reasons: [
          {
            code: "missing-required-prop",
            prop: "size",
            nodeId: "b1",
            message: 'required prop "size" is missing',
          },
        ],
      },
    ]);
  });

  test("reports a node that uses a token missing from the new scope", () => {
    expect(diff(doc, oldScope, withoutPrimary)).toEqual([
      { kind: "token-removed", nodeId: "root", token: "color.primary" },
    ]);
  });
});
