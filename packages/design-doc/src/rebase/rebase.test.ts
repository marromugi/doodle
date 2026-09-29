import { describe, expect, test } from "vitest";

import type { TreeDocument } from "../model/document";
import type { Component, Scope } from "../model/scope";
import { rebase } from "./rebase";

const R = 3;

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

const withSize: Scope = {
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

const withoutButton: Scope = { ...oldScope, components: {} };

const withoutButtonAndPrimary: Scope = {
  tokens: { ...oldScope.tokens, color: {} },
  components: {},
};

const doc: TreeDocument = {
  kind: "tree",
  revision: R,
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

const b1Of = (d: TreeDocument) => {
  const root = d.root;
  if (root.type !== "frame") throw new Error("root is not a frame");
  return root.children[0];
};

const onlyButtonRemoved = {
  ok: false,
  reason: {
    code: "remaining",
    remaining: [
      { kind: "component-removed", nodeId: "b1", component: "cmp_btn" },
    ],
  },
};

describe("rebase", () => {
  test("returns the new document with the fix applied and the revision advanced", () => {
    const result = rebase(doc, oldScope, withSize, [
      { type: "set", base: R, node: "b1", key: "props.size", value: "m" },
    ]);
    if (!result.ok) throw new Error("expected ok");
    expect(b1Of(result.value)).toMatchObject({
      props: { label: "OK", size: "m" },
    });
    expect(result.value.revision).toBe(R + 1);
    expect(result.value.release).toEqual(doc.release);
  });

  test("leaves the passed document unchanged", () => {
    rebase(doc, oldScope, withSize, [
      { type: "set", base: R, node: "b1", key: "props.size", value: "m" },
    ]);
    expect(b1Of(doc)).toMatchObject({ props: { label: "OK" } });
    expect(doc.revision).toBe(R);
  });

  test("returns the new document when a fix removes the node of a removed component", () => {
    const result = rebase(doc, oldScope, withoutButton, [
      { type: "remove", base: R, node: "b1" },
    ]);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.root).toMatchObject({ children: [] });
  });

  test("fails with the discrepancies left when a fix does not cover all of them", () => {
    const result = rebase(doc, oldScope, withoutButtonAndPrimary, [
      {
        type: "set",
        base: R,
        node: "root",
        key: "background",
        value: "#1a73e8",
      },
    ]);
    expect(result).toEqual(onlyButtonRemoved);
  });

  test("fails with the discrepancies left when there are no fixes", () => {
    expect(rebase(doc, oldScope, withoutButton, [])).toEqual(onlyButtonRemoved);
  });

  test("fails with the index and reason of a fix that cannot be applied", () => {
    const result = rebase(doc, oldScope, withSize, [
      { type: "set", base: R, node: "b1", key: "props.size", value: "m" },
      { type: "remove", base: R, node: "zz" },
    ]);
    if (result.ok || result.reason.code !== "fix-failed") {
      throw new Error("expected fix-failed");
    }
    expect(result.reason.index).toBe(1);
    expect(result.reason.reasons.map((r) => r.code)).toEqual(["unknown-node"]);
  });

  test("fails with the validation reasons when no discrepancy remains but the document is invalid", () => {
    const result = rebase(doc, oldScope, oldScope, [
      {
        type: "add",
        base: R,
        parent: "root",
        index: 0,
        node: { type: "text", id: "b1", text: "X" },
      },
    ]);
    if (result.ok || result.reason.code !== "invalid") {
      throw new Error("expected invalid");
    }
    expect(result.reason.reasons).toMatchObject([
      { code: "duplicate-node-id", nodeId: "b1" },
    ]);
  });

  test("applies fixes that touch the same node when they share the document revision as base", () => {
    const result = rebase(doc, oldScope, withSize, [
      { type: "set", base: R, node: "b1", key: "props.size", value: "s" },
      { type: "set", base: R, node: "b1", key: "props.size", value: "m" },
    ]);
    if (!result.ok) throw new Error("expected ok");
    expect(b1Of(result.value)).toMatchObject({
      props: { label: "OK", size: "m" },
    });
    expect(result.value.revision).toBe(R + 2);
  });

  test("fails with a conflict when a fix was read at another revision than the document's", () => {
    const result = rebase(doc, oldScope, withSize, [
      { type: "set", base: R + 1, node: "b1", key: "props.size", value: "m" },
    ]);
    if (result.ok || result.reason.code !== "fix-failed") {
      throw new Error("expected fix-failed");
    }
    expect(result.reason.index).toBe(0);
    expect(result.reason.reasons).toMatchObject([
      { code: "conflict", latestRevision: R },
    ]);
  });
});
