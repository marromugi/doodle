import { describe, expect, test } from "vitest";

import type { DraftDocument, TreeDocument } from "../model/document";
import type { Node } from "../model/node";
import type { EditOperation } from "../model/operation";
import type { Scope } from "../model/scope";
import { apply } from "./apply";

const scope: Scope = {
  tokens: {
    color: { primary: "#1a73e8", surface: "#ffffff" },
    typography: {},
    space: { md: 16 },
    radius: { md: 8 },
  },
  components: {},
};

const emptyHistory = { nodes: {}, tokens: {}, components: {}, nodeIds: [] };

const empty: TreeDocument = {
  kind: "tree",
  revision: 0,
  release: null,
  history: emptyHistory,
  root: { type: "frame", id: "root", children: [] },
};

const d0: DraftDocument = {
  kind: "draft",
  revision: 0,
  tokens: {
    color: { primary: "#1a73e8", surface: "#ffffff" },
    typography: {},
    space: {},
    radius: {},
  },
  components: {
    Button: {
      name: "Button",
      props: { label: { type: "string", required: true } },
      root: {
        type: "frame",
        id: "btn",
        background: { token: "color.primary" },
        children: [{ type: "text", id: "btn-label", text: { prop: "label" } }],
      },
    },
    Badge: {
      name: "Badge",
      props: {},
      root: { type: "frame", id: "badge", children: [] },
    },
  },
  history: emptyHistory,
};

const treeOps: EditOperation[] = [
  {
    type: "add",
    base: 0,
    parent: "root",
    index: 0,
    node: { type: "text", id: "t1", text: "A" },
  },
  {
    type: "add",
    base: 1,
    parent: "root",
    index: 1,
    node: { type: "frame", id: "box", children: [] },
  },
  {
    type: "add",
    base: 2,
    parent: "box",
    index: 0,
    node: { type: "text", id: "t2", text: "B" },
  },
  { type: "set", base: 3, node: "t1", key: "text", value: "A2" },
];

const tree = (doc: TreeDocument, op: EditOperation) => apply(doc, op, scope);

const okTree = (doc: TreeDocument, op: EditOperation): TreeDocument => {
  const result = tree(doc, op);
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result.value;
};

const okDraft = (doc: DraftDocument, op: EditOperation): DraftDocument => {
  const result = apply(doc, op);
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result.value;
};

const d4 = treeOps.reduce(okTree, empty);

const find = (n: Node, id: string): Node | undefined => {
  if (n.id === id) return n;
  if (n.type !== "frame" && n.type !== "repeat") return undefined;
  for (const c of n.children) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return undefined;
};

const childIds = (doc: TreeDocument, id: string): string[] => {
  const node = find(doc.root, id);
  return node && (node.type === "frame" || node.type === "repeat")
    ? node.children.map((c) => c.id)
    : [];
};

const textOf = (doc: TreeDocument, id: string): unknown => {
  const node = find(doc.root, id);
  return node?.type === "text" ? node.text : undefined;
};

describe("apply on a tree document", () => {
  test("applies add, add, add and set in order, advancing the revision by one each time", () => {
    let doc = empty;
    const revisions: number[] = [];
    for (const op of treeOps) {
      doc = okTree(doc, op);
      revisions.push(doc.revision);
    }
    expect(revisions).toEqual([1, 2, 3, 4]);
    expect(childIds(doc, "root")).toEqual(["t1", "box"]);
    expect(textOf(doc, "t1")).toBe("A2");
    expect(childIds(doc, "box")).toEqual(["t2"]);
  });

  test("fails a set on a node changed after the base revision with the latest revision", () => {
    const result = tree(d4, {
      type: "set",
      base: 3,
      node: "t1",
      key: "text",
      value: "X",
    });
    expect(result).toMatchObject({
      ok: false,
      reasons: [{ code: "conflict", latestRevision: 4 }],
    });
  });

  test("applies a set on a node unchanged since an older base revision", () => {
    const doc = okTree(d4, {
      type: "set",
      base: 3,
      node: "t2",
      key: "text",
      value: "B2",
    });
    expect(doc.revision).toBe(5);
    expect(textOf(doc, "t2")).toBe("B2");
  });

  test("fails a set on the parent of a removed node with a conflict", () => {
    const removed = okTree(d4, { type: "remove", base: 4, node: "t2" });
    const result = tree(removed, {
      type: "set",
      base: 4,
      node: "box",
      key: "background",
      value: "#ffffff",
    });
    expect(result).toMatchObject({
      ok: false,
      reasons: [{ code: "conflict", latestRevision: 5 }],
    });
  });

  test("fails a set on a node removed after the base revision with a conflict", () => {
    const removed = okTree(d4, { type: "remove", base: 4, node: "t2" });
    const result = tree(removed, {
      type: "set",
      base: 4,
      node: "t2",
      key: "text",
      value: "C",
    });
    expect(result).toMatchObject({
      ok: false,
      reasons: [{ code: "conflict", latestRevision: 5 }],
    });
  });

  test("applies an add into a parent unchanged since the base revision", () => {
    const doc = okTree(d4, {
      type: "add",
      base: 2,
      parent: "root",
      index: 2,
      node: { type: "text", id: "t3", text: "C" },
    });
    expect(doc.revision).toBe(5);
    expect(childIds(doc, "root")).toEqual(["t1", "box", "t3"]);
  });

  test("fails an add into a parent whose children changed after the base revision", () => {
    const result = tree(d4, {
      type: "add",
      base: 2,
      parent: "box",
      index: 0,
      node: { type: "text", id: "t3", text: "C" },
    });
    expect(result).toMatchObject({
      ok: false,
      reasons: [{ code: "conflict", latestRevision: 4 }],
    });
  });

  test("applies a move when the moved node and both parents are unchanged since the base revision", () => {
    const doc = okTree(d4, {
      type: "move",
      base: 3,
      node: "t2",
      parent: "root",
      index: 0,
    });
    expect(childIds(doc, "root")).toEqual(["t2", "t1", "box"]);
    expect(childIds(doc, "box")).toEqual([]);
  });

  test("fails a move of a node changed after the base revision", () => {
    const result = tree(d4, {
      type: "move",
      base: 3,
      node: "t1",
      parent: "box",
      index: 0,
    });
    expect(result).toMatchObject({
      ok: false,
      reasons: [{ code: "conflict", latestRevision: 4 }],
    });
  });

  test("fails a move out of a source parent whose children changed after the base revision", () => {
    const added = okTree(d4, {
      type: "add",
      base: 4,
      parent: "box",
      index: 1,
      node: { type: "text", id: "t3", text: "C" },
    });
    const result = tree(added, {
      type: "move",
      base: 4,
      node: "t2",
      parent: "root",
      index: 0,
    });
    expect(result).toMatchObject({
      ok: false,
      reasons: [{ code: "conflict", latestRevision: 5 }],
    });
  });

  test("fails an add with the id of a removed node", () => {
    const removed = okTree(d4, { type: "remove", base: 4, node: "t2" });
    const result = tree(removed, {
      type: "add",
      base: 5,
      parent: "root",
      index: 0,
      node: { type: "text", id: "t2", text: "D" },
    });
    expect(result).toMatchObject({
      ok: false,
      reasons: [{ code: "node-id-reused" }],
    });
  });

  test("returns the validation reasons and no document when the result fails validation", () => {
    const result = tree(d4, {
      type: "set",
      base: 4,
      node: "box",
      key: "background",
      value: { token: "space.md" },
    });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      reasons: [{ code: "token-kind-mismatch" }],
    });
    expect(result).not.toHaveProperty("value");
  });

  test("applies a different set to the same document after a validation failure", () => {
    const doc = okTree(d4, {
      type: "set",
      base: 4,
      node: "box",
      key: "background",
      value: "#ffffff",
    });
    expect(doc.revision).toBe(5);
  });

  test("returns a duplicate node id for an add with the id of a live node", () => {
    const result = tree(d4, {
      type: "add",
      base: 4,
      parent: "root",
      index: 0,
      node: { type: "text", id: "t1", text: "E" },
    });
    expect(result).toMatchObject({
      ok: false,
      reasons: [{ code: "duplicate-node-id" }],
    });
  });
});

describe("apply on a draft document", () => {
  test("changes a token and advances the revision", () => {
    const doc = okDraft(d0, {
      type: "change-token",
      base: 0,
      token: "color.primary",
      value: "#0b57d0",
    });
    expect(doc.revision).toBe(1);
    expect(doc.tokens.color.primary).toBe("#0b57d0");
  });

  test("fails a token removal changed after the base revision, while a change of another token applies", () => {
    const changed = okDraft(d0, {
      type: "change-token",
      base: 0,
      token: "color.primary",
      value: "#0b57d0",
    });
    const other = okDraft(changed, {
      type: "change-token",
      base: 0,
      token: "color.surface",
      value: "#f8f9fa",
    });
    expect(other.revision).toBe(2);
    const result = apply(other, {
      type: "remove-token",
      base: 0,
      token: "color.primary",
    });
    expect(result).toMatchObject({
      ok: false,
      reasons: [{ code: "conflict", latestRevision: 2 }],
    });
  });

  test("adds a prop to a component", () => {
    const doc = okDraft(d0, {
      type: "add-prop",
      base: 0,
      component: "Button",
      name: "note",
      def: { type: "string" },
    });
    expect(doc.revision).toBe(1);
    expect(doc.components.Button!.props.note).toEqual({ type: "string" });
  });

  test("fails a prop removal on a component changed after the base revision", () => {
    const added = okDraft(d0, {
      type: "add-prop",
      base: 0,
      component: "Button",
      name: "note",
      def: { type: "string" },
    });
    const other = okDraft(added, {
      type: "add-prop",
      base: 0,
      component: "Badge",
      name: "tone",
      def: { type: "string" },
    });
    expect(other.revision).toBe(2);
    const result = apply(other, {
      type: "remove-prop",
      base: 0,
      component: "Button",
      name: "note",
    });
    expect(result).toMatchObject({
      ok: false,
      reasons: [{ code: "conflict", latestRevision: 2 }],
    });
  });

  test("renames a component keeping its id, and a later prop change to it conflicts", () => {
    const doc = okDraft(d0, {
      type: "rename-component",
      base: 0,
      id: "Badge",
      to: "Tag",
    });
    expect(doc.revision).toBe(1);
    expect(doc.components.Badge!.name).toBe("Tag");
    expect(Object.keys(doc.components)).toEqual(["Button", "Badge"]);
    const result = apply(doc, {
      type: "add-prop",
      base: 0,
      component: "Badge",
      name: "size",
      def: { type: "string" },
    });
    expect(result).toMatchObject({
      ok: false,
      reasons: [{ code: "conflict", latestRevision: 1 }],
    });
  });

  test("adds a component and then removes it", () => {
    const added = okDraft(d0, {
      type: "add-component",
      base: 0,
      id: "Card",
      component: {
        name: "Card",
        props: {},
        root: { type: "frame", id: "card", children: [] },
      },
    });
    expect(added.revision).toBe(1);
    const removed = okDraft(added, {
      type: "remove-component",
      base: 1,
      id: "Card",
    });
    expect(removed.revision).toBe(2);
    expect(removed.components).not.toHaveProperty("Card");
  });

  test("fails removing a token a component uses, and removes an unused token", () => {
    const result = apply(d0, {
      type: "remove-token",
      base: 0,
      token: "color.primary",
    });
    expect(result).toMatchObject({
      ok: false,
      reasons: [{ code: "unknown-token", nodeId: "btn" }],
    });
    const doc = okDraft(d0, {
      type: "remove-token",
      base: 0,
      token: "color.surface",
    });
    expect(doc.tokens.color).toEqual({ primary: "#1a73e8" });
  });

  test("keeps an instance pointing at a renamed component", () => {
    const withCard = okDraft(d0, {
      type: "add-component",
      base: 0,
      id: "Card",
      component: {
        name: "Card",
        props: {},
        root: {
          type: "frame",
          id: "card",
          children: [
            {
              type: "instance",
              id: "card-badge",
              component: "Badge",
              props: {},
            },
          ],
        },
      },
    });
    expect(withCard.revision).toBe(1);
    const renamed = okDraft(withCard, {
      type: "rename-component",
      base: 1,
      id: "Badge",
      to: "Tag",
    });
    expect(renamed.revision).toBe(2);
    const root = renamed.components.Card!.root;
    expect(root.type === "frame" && root.children[0]).toMatchObject({
      id: "card-badge",
      component: "Badge",
    });
  });

  test("fails a name taken by another component and leaves the draft unchanged", () => {
    const rename = apply(d0, {
      type: "rename-component",
      base: 0,
      id: "Badge",
      to: "Button",
    });
    expect(rename).toMatchObject({
      ok: false,
      reasons: [{ code: "component-name-taken", name: "Button" }],
    });
    const add = apply(d0, {
      type: "add-component",
      base: 0,
      id: "Card",
      component: {
        name: "Badge",
        props: {},
        root: { type: "frame", id: "card", children: [] },
      },
    });
    expect(add).toMatchObject({
      ok: false,
      reasons: [{ code: "component-name-taken", name: "Badge" }],
    });
    expect(d0.revision).toBe(0);
    const same = okDraft(d0, {
      type: "rename-component",
      base: 0,
      id: "Badge",
      to: "Badge",
    });
    expect(same.revision).toBe(1);
  });

  test("fails adding a token, prop or component id that already exists", () => {
    expect(
      apply(d0, {
        type: "add-token",
        base: 0,
        token: "color.primary",
        value: "#000000",
      }),
    ).toMatchObject({
      ok: false,
      reasons: [{ code: "target-exists", target: "color.primary" }],
    });
    expect(
      apply(d0, {
        type: "add-prop",
        base: 0,
        component: "Button",
        name: "label",
        def: { type: "string" },
      }),
    ).toMatchObject({ ok: false, reasons: [{ code: "target-exists" }] });
    expect(
      apply(d0, {
        type: "add-component",
        base: 0,
        id: "Badge",
        component: {
          name: "Pill",
          props: {},
          root: { type: "frame", id: "pill", children: [] },
        },
      }),
    ).toMatchObject({ ok: false, reasons: [{ code: "target-exists" }] });
  });

  test("fails changing, removing or renaming a token, prop or component that does not exist", () => {
    expect(
      apply(d0, {
        type: "change-token",
        base: 0,
        token: "color.accent",
        value: "#000000",
      }),
    ).toMatchObject({
      ok: false,
      reasons: [{ code: "target-missing", target: "color.accent" }],
    });
    expect(
      apply(d0, {
        type: "remove-prop",
        base: 0,
        component: "Button",
        name: "size",
      }),
    ).toMatchObject({ ok: false, reasons: [{ code: "target-missing" }] });
    expect(
      apply(d0, {
        type: "rename-component",
        base: 0,
        id: "Card",
        to: "Tile",
      }),
    ).toMatchObject({ ok: false, reasons: [{ code: "target-missing" }] });
  });
});

describe("apply on a document of the other kind", () => {
  test("fails a node operation on a draft", () => {
    expect(
      apply(d0, {
        type: "set",
        base: 0,
        node: "btn",
        key: "background",
        value: "#000000",
      }),
    ).toMatchObject({
      ok: false,
      reasons: [{ code: "operation-not-applicable" }],
    });
  });

  test("fails token, component and prop operations on a tree document", () => {
    const ops: EditOperation[] = [
      { type: "add-token", base: 4, token: "color.x", value: "#000000" },
      { type: "remove-component", base: 4, id: "Button" },
      {
        type: "add-prop",
        base: 4,
        component: "Button",
        name: "x",
        def: { type: "string" },
      },
    ];
    for (const op of ops) {
      expect(tree(d4, op)).toMatchObject({
        ok: false,
        reasons: [{ code: "operation-not-applicable" }],
      });
    }
    expect(d4.revision).toBe(4);
  });
});
