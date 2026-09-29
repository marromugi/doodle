import { describe, expect, test } from "vitest";

import type { TreeDocument } from "../model/document";
import type { EditOperation } from "../model/operation";
import type { Scope } from "../model/scope";
import { rebase } from "./rebase";

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

const R = doc.revision;

const withoutButton: Scope = { ...oldScope, components: {} };

const withSize: Scope = {
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

const withoutButtonAndPrimary: Scope = {
  ...withoutButton,
  tokens: { ...oldScope.tokens, color: {} },
};

const setSize: EditOperation = {
  type: "set",
  base: R,
  node: "b1",
  key: "props.size",
  value: "m",
};

const removeB1: EditOperation = { type: "remove", base: R, node: "b1" };

describe("rebase", () => {
  test("returns the new document when a fix leaves no discrepancy", () => {
    const result = rebase(doc, oldScope, withSize, [setSize]);
    if (!result.ok) throw new Error(JSON.stringify(result.reason));
    const b1 = (result.value.root as { children: unknown[] }).children[0];
    expect(b1).toMatchObject({ props: { label: "OK", size: "m" } });
  });

  test("returns the new document when removing the instance clears the discrepancy", () => {
    const result = rebase(doc, oldScope, withoutButton, [removeB1]);
    if (!result.ok) throw new Error(JSON.stringify(result.reason));
    expect(result.value.root).toMatchObject({ id: "root", children: [] });
  });

  test("fails with the remaining discrepancy when one is left after the fixes", () => {
    const result = rebase(doc, oldScope, withoutButtonAndPrimary, [
      {
        type: "set",
        base: R,
        node: "root",
        key: "background",
        value: "#1a73e8",
      },
    ]);
    expect(result).toMatchObject({
      ok: false,
      reason: {
        code: "remaining",
        remaining: [{ kind: "component-removed", nodeId: "b1" }],
      },
    });
  });

  test("fails with the remaining discrepancy when there are no fixes", () => {
    const result = rebase(doc, oldScope, withoutButton, []);
    expect(result).toMatchObject({
      ok: false,
      reason: {
        code: "remaining",
        remaining: [{ kind: "component-removed", nodeId: "b1" }],
      },
    });
  });

  test("fails with the index and reason of a fix that cannot be applied", () => {
    const result = rebase(doc, oldScope, withSize, [
      setSize,
      { type: "remove", base: R, node: "zz" },
    ]);
    expect(result).toMatchObject({
      ok: false,
      reason: {
        code: "fix-failed",
        index: 1,
        reasons: [{ code: "unknown-node" }],
      },
    });
  });

  test("fails as invalid when no discrepancy remains but validation fails", () => {
    const result = rebase(doc, oldScope, oldScope, [
      {
        type: "add",
        base: R,
        parent: "root",
        index: 0,
        node: { type: "text", id: "b1", text: "X" },
      },
    ]);
    expect(result).toMatchObject({
      ok: false,
      reason: {
        code: "invalid",
        reasons: [{ code: "duplicate-node-id", nodeId: "b1" }],
      },
    });
  });
});
