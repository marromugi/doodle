import { describe, expect, test } from "vitest";

import type { DraftDocument, TreeDocument } from "../model/document";
import type { Node } from "../model/node";
import type { EditOperation } from "../model/operation";
import type { Component, Scope } from "../model/scope";
import type { Result } from "../roles";
import { apply, applyUnvalidated } from "./apply";
import type { ApplyFailure } from "./failure";

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

const card: Component = {
  name: "Card",
  props: { content: { type: "node" } },
  root: {
    type: "frame",
    id: "card",
    children: [{ type: "slot", id: "card-slot", prop: "content" }],
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

const cardScope: Scope = {
  ...scope,
  components: { ...scope.components, cmp_card: card },
};

const emptyTree: TreeDocument = {
  kind: "tree",
  revision: 0,
  release: null,
  root: { type: "frame", id: "root", children: [] },
  history: { nodes: {}, tokens: {}, components: {}, nodeIds: [] },
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
  history: { nodes: {}, tokens: {}, components: {}, nodeIds: [] },
};

const onTree = (
  doc: TreeDocument,
  op: EditOperation,
  s: Scope = scope,
): Result<TreeDocument, ApplyFailure> => apply(doc, op, s);

const onDraft = (
  doc: DraftDocument,
  op: EditOperation,
): Result<DraftDocument, ApplyFailure> => apply(doc, op);

const passes = <T>(result: Result<T, ApplyFailure>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
  return result.value;
};

const failures = <T>(result: Result<T, ApplyFailure>): ApplyFailure[] => {
  if (result.ok) throw new Error("expected a failure");
  return result.reasons;
};

const treeAfter = (
  start: TreeDocument,
  ops: EditOperation[],
  s: Scope = scope,
): TreeDocument => ops.reduce((doc, op) => passes(onTree(doc, op, s)), start);

const d4Ops: EditOperation[] = [
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

const memo = <T>(make: () => T): (() => T) => {
  let value: T | undefined;
  return () => (value ??= make());
};

const D4 = memo(() => treeAfter(emptyTree, d4Ops));

const removeT2: EditOperation = { type: "remove", base: 4, node: "t2" };
const D4WithoutT2 = memo(() => treeAfter(D4(), [removeT2]));

const addC1: EditOperation = {
  type: "add",
  base: 4,
  parent: "root",
  index: 2,
  node: {
    type: "instance",
    id: "c1",
    component: "cmp_card",
    position: { x: 0, y: 0 },
    props: { content: { nodes: [{ type: "text", id: "n1", text: "X" }] } },
  },
};
const D5 = memo(() => treeAfter(D4(), [addC1], cardScope));

const onD5 = (op: EditOperation) => onTree(D5(), op, cardScope);

const nodeIn = (node: unknown, id: string): Record<string, unknown> | null => {
  if (typeof node !== "object" || node === null) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = nodeIn(item, id);
      if (found) return found;
    }
    return null;
  }
  const record = node as Record<string, unknown>;
  if (record["id"] === id && typeof record["type"] === "string") return record;
  for (const value of Object.values(record)) {
    const found = nodeIn(value, id);
    if (found) return found;
  }
  return null;
};

const nodeOf = (doc: TreeDocument, id: string): Record<string, unknown> => {
  const found = nodeIn(doc.root, id);
  if (!found) throw new Error(`no node ${id}`);
  return found;
};

const childIds = (doc: TreeDocument, id: string): string[] =>
  (nodeOf(doc, id)["children"] as Node[]).map((child) => child.id);

const text = (id: string, value: string): Node => ({
  type: "text",
  id,
  text: value,
});

const addText = (
  base: number,
  parent: string,
  index: number,
  id: string,
): EditOperation => ({
  type: "add",
  base,
  parent,
  index,
  node: text(id, "C"),
});

describe("apply on a tree document", () => {
  test("adds, sets and moves nodes and raises the revision by one each time", () => {
    const revisions: number[] = [];
    let doc = emptyTree;
    for (const op of d4Ops) {
      doc = passes(onTree(doc, op));
      revisions.push(doc.revision);
    }
    expect(revisions).toEqual([1, 2, 3, 4]);
    expect(childIds(doc, "root")).toEqual(["t1", "box"]);
    expect(nodeOf(doc, "t1")["text"]).toBe("A2");
    expect(childIds(doc, "box")).toEqual(["t2"]);
  });

  test("fails with conflict and the latest revision when the node changed after the base", () => {
    const reasons = failures(
      onTree(D4(), {
        type: "set",
        base: 3,
        node: "t1",
        key: "text",
        value: "X",
      }),
    );
    expect(reasons).toMatchObject([{ code: "conflict", latestRevision: 4 }]);
  });

  test("applies an old-base set when the node did not change since", () => {
    const doc = passes(
      onTree(D4(), {
        type: "set",
        base: 3,
        node: "t2",
        key: "text",
        value: "B2",
      }),
    );
    expect(doc.revision).toBe(5);
    expect(nodeOf(doc, "t2")["text"]).toBe("B2");
  });

  test("a removed node makes its parent count as changed", () => {
    expect(D4WithoutT2().revision).toBe(5);
    const reasons = failures(
      onTree(D4WithoutT2(), {
        type: "set",
        base: 4,
        node: "box",
        key: "background",
        value: "#ffffff",
      }),
    );
    expect(reasons).toMatchObject([{ code: "conflict", latestRevision: 5 }]);
  });

  test("a set on a node removed after the base fails with conflict", () => {
    const reasons = failures(
      onTree(D4WithoutT2(), {
        type: "set",
        base: 4,
        node: "t2",
        key: "text",
        value: "C",
      }),
    );
    expect(reasons).toMatchObject([{ code: "conflict", latestRevision: 5 }]);
  });

  test("applies an old-base add when the parent did not change since", () => {
    const doc = passes(onTree(D4(), addText(2, "root", 2, "t3")));
    expect(doc.revision).toBe(5);
    expect(childIds(doc, "root")).toEqual(["t1", "box", "t3"]);
  });

  test("an add into a parent whose children changed after the base fails with conflict", () => {
    const reasons = failures(onTree(D4(), addText(2, "box", 0, "t3")));
    expect(reasons).toMatchObject([{ code: "conflict", latestRevision: 4 }]);
  });

  test("applies an old-base move when node and both parents are unchanged", () => {
    const doc = passes(
      onTree(D4(), {
        type: "move",
        base: 3,
        node: "t2",
        parent: "root",
        index: 0,
      }),
    );
    expect(childIds(doc, "root")).toEqual(["t2", "t1", "box"]);
    expect(childIds(doc, "box")).toEqual([]);
  });

  test("a move of a node that changed after the base fails with conflict", () => {
    const reasons = failures(
      onTree(D4(), {
        type: "move",
        base: 3,
        node: "t1",
        parent: "box",
        index: 0,
      }),
    );
    expect(reasons).toMatchObject([{ code: "conflict", latestRevision: 4 }]);
  });

  test("a move out of a parent whose children changed after the base fails with conflict", () => {
    const added = passes(onTree(D4(), addText(4, "box", 1, "t3")));
    expect(added.revision).toBe(5);
    const reasons = failures(
      onTree(added, {
        type: "move",
        base: 4,
        node: "t2",
        parent: "root",
        index: 0,
      }),
    );
    expect(reasons).toMatchObject([{ code: "conflict", latestRevision: 5 }]);
  });

  test("adding a node with the id of a removed node fails with node-id-reused", () => {
    const reasons = failures(
      onTree(D4WithoutT2(), addText(5, "root", 0, "t2")),
    );
    expect(reasons).toMatchObject([{ code: "node-id-reused" }]);
  });

  test("a set that breaks a token kind fails with the validation reason and returns no document", () => {
    const bad = onTree(D4(), {
      type: "set",
      base: 4,
      node: "box",
      key: "background",
      value: { token: "space.md" },
    });
    expect(bad.ok).toBe(false);
    expect(failures(bad)).toMatchObject([{ code: "token-kind-mismatch" }]);
    const good = passes(
      onTree(D4(), {
        type: "set",
        base: 4,
        node: "t1",
        key: "text",
        value: "Z",
      }),
    );
    expect(good.revision).toBe(5);
  });

  test("adding a live node id fails with duplicate-node-id", () => {
    const reasons = failures(onTree(D4(), addText(4, "root", 0, "t1")));
    expect(reasons).toMatchObject([{ code: "duplicate-node-id" }]);
  });

  test("fails with index-out-of-range and never clamps an add", () => {
    const reasons = failures(onTree(D4(), addText(4, "root", 3, "t3")));
    expect(reasons).toMatchObject([
      { code: "index-out-of-range", nodeId: "root", index: 3, count: 2 },
    ]);
    const doc = passes(onTree(D4(), addText(4, "root", 2, "t3")));
    expect(childIds(doc, "root")).toEqual(["t1", "box", "t3"]);
  });

  test("counts a move index after the node is taken out of its parent", () => {
    const doc = passes(
      onTree(D4(), {
        type: "move",
        base: 4,
        node: "t1",
        parent: "root",
        index: 1,
      }),
    );
    expect(childIds(doc, "root")).toEqual(["box", "t1"]);
    const reasons = failures(
      onTree(D4(), {
        type: "move",
        base: 4,
        node: "t1",
        parent: "root",
        index: 2,
      }),
    );
    expect(reasons).toMatchObject([
      { code: "index-out-of-range", nodeId: "root", index: 2, count: 1 },
    ]);
  });

  test("adding or moving into a node without children fails with not-a-container", () => {
    expect(failures(onTree(D4(), addText(4, "t1", 0, "t3")))).toMatchObject([
      { code: "not-a-container", nodeId: "t1" },
    ]);
    expect(
      failures(
        onTree(D4(), {
          type: "move",
          base: 4,
          node: "t2",
          parent: "t1",
          index: 0,
        }),
      ),
    ).toMatchObject([{ code: "not-a-container", nodeId: "t1" }]);
  });

  test("removing or moving the root fails with root-fixed", () => {
    expect(
      failures(onTree(D4(), { type: "remove", base: 4, node: "root" })),
    ).toMatchObject([{ code: "root-fixed", nodeId: "root" }]);
    expect(
      failures(
        onTree(D4(), {
          type: "move",
          base: 4,
          node: "root",
          parent: "box",
          index: 0,
        }),
      ),
    ).toMatchObject([{ code: "root-fixed" }]);
  });

  test("moving a node into itself or a descendant fails with move-into-own-subtree", () => {
    expect(
      failures(
        onTree(D4(), {
          type: "move",
          base: 4,
          node: "box",
          parent: "box",
          index: 0,
        }),
      ),
    ).toMatchObject([
      { code: "move-into-own-subtree", nodeId: "box", target: "box" },
    ]);
    const nested = passes(
      onTree(D4(), {
        type: "add",
        base: 4,
        parent: "box",
        index: 1,
        node: { type: "frame", id: "inner", children: [] },
      }),
    );
    expect(
      failures(
        onTree(nested, {
          type: "move",
          base: 5,
          node: "box",
          parent: "inner",
          index: 0,
        }),
      ),
    ).toMatchObject([
      { code: "move-into-own-subtree", nodeId: "box", target: "inner" },
    ]);
  });

  test("setting id, type, children or a key inside a string fails with key-not-settable", () => {
    const setKey = (key: string) =>
      failures(
        onTree(D4(), {
          type: "set",
          base: 4,
          node: "t1",
          key,
          value: "t9",
        }),
      );
    expect(setKey("id")).toMatchObject([
      { code: "key-not-settable", key: "id" },
    ]);
    expect(setKey("type")).toMatchObject([
      { code: "key-not-settable", key: "type" },
    ]);
    expect(setKey("children.0.text")).toMatchObject([
      { code: "key-not-settable", key: "children.0.text" },
    ]);
    expect(setKey("text.size")).toMatchObject([
      { code: "key-not-settable", key: "text.size" },
    ]);
  });

  test("a set creates missing middle levels and fails with invalid-shape when the result is wrong", () => {
    const reasons = failures(
      onTree(D4(), {
        type: "set",
        base: 4,
        node: "box",
        key: "layout.gap",
        value: 8,
      }),
    );
    expect(reasons).toMatchObject([
      {
        code: "invalid-shape",
        path: ["root", "children", 1, "layout", "direction"],
        nodeId: "box",
      },
    ]);
    const withDirection = passes(
      onTree(D4(), {
        type: "set",
        base: 4,
        node: "box",
        key: "layout.direction",
        value: "row",
      }),
    );
    const withGap = passes(
      onTree(withDirection, {
        type: "set",
        base: 5,
        node: "box",
        key: "layout.gap",
        value: 8,
      }),
    );
    expect(withGap.revision).toBe(6);
    expect(nodeOf(withGap, "box")["layout"]).toEqual({
      direction: "row",
      gap: 8,
    });
  });

  test("setting a required key to null fails with invalid-shape at that key", () => {
    const reasons = failures(
      onTree(D4(), {
        type: "set",
        base: 4,
        node: "t1",
        key: "text",
        value: null,
      }),
    );
    expect(reasons).toMatchObject([
      {
        code: "invalid-shape",
        path: ["root", "children", 0, "text"],
        nodeId: "t1",
      },
    ]);
  });

  test("a node inside a value can be set by its id", () => {
    expect(D5().revision).toBe(5);
    const set = passes(
      onD5({ type: "set", base: 5, node: "n1", key: "text", value: "Y" }),
    );
    expect(set.revision).toBe(6);
    expect(nodeOf(set, "n1")["text"]).toBe("Y");
    const moved = passes(
      onTree(
        set,
        { type: "set", base: 5, node: "c1", key: "position.x", value: 10 },
        cardScope,
      ),
    );
    expect(moved.revision).toBe(7);
    const reasons = failures(
      onTree(
        moved,
        { type: "set", base: 5, node: "n1", key: "text", value: "Q" },
        cardScope,
      ),
    );
    expect(reasons).toMatchObject([{ code: "conflict", latestRevision: 7 }]);
  });

  test("removing or moving a node inside a value touches the node that holds the value", () => {
    const removed = passes(onD5({ type: "remove", base: 5, node: "n1" }));
    expect(removed.revision).toBe(6);
    expect(nodeOf(removed, "c1")["props"]).toEqual({
      content: { nodes: [] },
    });
    const reasons = failures(
      onTree(
        removed,
        { type: "set", base: 5, node: "c1", key: "position.x", value: 10 },
        cardScope,
      ),
    );
    expect(reasons).toMatchObject([
      { code: "conflict", nodeId: "c1", latestRevision: 6 },
    ]);
    const moved = passes(
      onD5({ type: "move", base: 5, node: "n1", parent: "root", index: 0 }),
    );
    expect(childIds(moved, "root")).toEqual(["n1", "t1", "box", "c1"]);
    expect(nodeOf(moved, "c1")["props"]).toEqual({ content: { nodes: [] } });
  });

  test("replacing a nodes value touches the nodes that disappear", () => {
    const set = passes(
      onD5({ type: "set", base: 5, node: "n1", key: "text", value: "Y" }),
    );
    const replace: EditOperation = {
      type: "set",
      base: 5,
      node: "c1",
      key: "props.content",
      value: { nodes: [{ type: "text", id: "n2", text: "Z" }] },
    };
    expect(failures(onTree(set, replace, cardScope))).toMatchObject([
      { code: "conflict", nodeId: "n1", latestRevision: 6 },
    ]);
    const replaced = passes(onTree(set, { ...replace, base: 6 }, cardScope));
    expect(replaced.revision).toBe(7);
  });

  test("a replaced value cannot bring back the id of a node that left", () => {
    const set = passes(
      onD5({ type: "set", base: 5, node: "n1", key: "text", value: "Y" }),
    );
    const replaced = passes(
      onTree(
        set,
        {
          type: "set",
          base: 6,
          node: "c1",
          key: "props.content",
          value: { nodes: [{ type: "text", id: "n2", text: "Z" }] },
        },
        cardScope,
      ),
    );
    const reasons = failures(
      onTree(
        replaced,
        {
          type: "set",
          base: 7,
          node: "c1",
          key: "props.content",
          value: { nodes: [{ type: "text", id: "n1", text: "W" }] },
        },
        cardScope,
      ),
    );
    expect(reasons).toMatchObject([{ code: "node-id-reused", nodeId: "n1" }]);
  });

  test("a path that goes into a nodes value fails with key-not-settable", () => {
    const reasons = failures(
      onD5({
        type: "set",
        base: 5,
        node: "c1",
        key: "props.content.nodes.0.text",
        value: "Y",
      }),
    );
    expect(reasons).toMatchObject([
      {
        code: "key-not-settable",
        nodeId: "c1",
        key: "props.content.nodes.0.text",
      },
    ]);
  });

  test("a node removed before the base fails with unknown-node", () => {
    const reasons = failures(
      onTree(D4WithoutT2(), {
        type: "set",
        base: 5,
        node: "t2",
        key: "text",
        value: "C",
      }),
    );
    expect(reasons).toMatchObject([{ code: "unknown-node" }]);
  });

  test("returns only the reasons of the first stage that has any", () => {
    const conflictOnly = failures(onTree(D4(), addText(2, "box", 5, "t3")));
    expect(conflictOnly).toMatchObject([
      { code: "conflict", latestRevision: 4 },
    ]);

    const conflicts = failures(
      onTree(D4(), {
        type: "move",
        base: 1,
        node: "t2",
        parent: "root",
        index: 0,
      }),
    );
    expect(conflicts.map((reason) => reason.code)).toEqual([
      "conflict",
      "conflict",
      "conflict",
    ]);
    expect(new Set(conflicts.map((reason) => reason.nodeId))).toEqual(
      new Set(["t2", "box", "root"]),
    );

    const shapeOnly = failures(
      onTree(D4(), {
        type: "set",
        base: 4,
        node: "box",
        key: "layout.gap",
        value: { token: "color.primary" },
      }),
    );
    expect(shapeOnly.map((reason) => reason.code)).toEqual(["invalid-shape"]);
  });

  test("the step without validation still checks the shape but not the scope", () => {
    const badShape = applyUnvalidated(D4(), {
      type: "set",
      base: 4,
      node: "t1",
      key: "text",
      value: null,
    });
    expect(failures(badShape)).toMatchObject([
      { code: "invalid-shape", path: ["root", "children", 0, "text"] },
    ]);
    const badToken = applyUnvalidated(D4(), {
      type: "set",
      base: 4,
      node: "box",
      key: "background",
      value: { token: "space.md" },
    });
    expect(passes(badToken).revision).toBe(5);
  });
});

describe("apply on a draft document", () => {
  test("a token change reaches the draft and raises the revision", () => {
    const doc = passes(
      onDraft(d0, {
        type: "change-token",
        base: 0,
        token: "color.primary",
        value: "#0b57d0",
      }),
    );
    expect(doc.revision).toBe(1);
    expect(doc.tokens.color["primary"]).toBe("#0b57d0");
  });

  test("a token operation conflicts only with a later change to the same token", () => {
    const first = passes(
      onDraft(d0, {
        type: "change-token",
        base: 0,
        token: "color.primary",
        value: "#0b57d0",
      }),
    );
    const second = passes(
      onDraft(first, {
        type: "change-token",
        base: 0,
        token: "color.surface",
        value: "#f8f9fa",
      }),
    );
    expect(second.revision).toBe(2);
    const reasons = failures(
      onDraft(second, {
        type: "remove-token",
        base: 0,
        token: "color.primary",
      }),
    );
    expect(reasons).toMatchObject([{ code: "conflict", latestRevision: 2 }]);
  });

  test("adds a prop definition to a component", () => {
    const doc = passes(
      onDraft(d0, {
        type: "add-prop",
        base: 0,
        component: "Button",
        name: "note",
        def: { type: "string" },
      }),
    );
    expect(doc.revision).toBe(1);
    expect(doc.components["Button"]?.props["note"]).toEqual({ type: "string" });
  });

  test("a prop operation conflicts only with a later change to the same component", () => {
    const first = passes(
      onDraft(d0, {
        type: "add-prop",
        base: 0,
        component: "Button",
        name: "note",
        def: { type: "string" },
      }),
    );
    const second = passes(
      onDraft(first, {
        type: "add-prop",
        base: 0,
        component: "Badge",
        name: "tone",
        def: { type: "string" },
      }),
    );
    expect(second.revision).toBe(2);
    const reasons = failures(
      onDraft(second, {
        type: "remove-prop",
        base: 0,
        component: "Button",
        name: "note",
      }),
    );
    expect(reasons).toMatchObject([{ code: "conflict", latestRevision: 2 }]);
  });

  test("a rename changes only the name and touches the component", () => {
    const renamed = passes(
      onDraft(d0, {
        type: "rename-component",
        base: 0,
        id: "Badge",
        to: "Tag",
      }),
    );
    expect(renamed.revision).toBe(1);
    expect(renamed.components["Badge"]?.name).toBe("Tag");
    expect(Object.keys(renamed.components)).toEqual(["Button", "Badge"]);
    const reasons = failures(
      onDraft(renamed, {
        type: "add-prop",
        base: 0,
        component: "Badge",
        name: "size",
        def: { type: "string" },
      }),
    );
    expect(reasons).toMatchObject([{ code: "conflict", latestRevision: 1 }]);
  });

  test("adds and removes a component", () => {
    const added = passes(
      onDraft(d0, {
        type: "add-component",
        base: 0,
        id: "Card",
        component: {
          name: "Card",
          props: {},
          root: { type: "frame", id: "card", children: [] },
        },
      }),
    );
    expect(added.revision).toBe(1);
    const removed = passes(
      onDraft(added, { type: "remove-component", base: 1, id: "Card" }),
    );
    expect(removed.revision).toBe(2);
    expect(Object.keys(removed.components)).toEqual(["Button", "Badge"]);
  });

  test("validates against the draft after the operation", () => {
    const reasons = failures(
      onDraft(d0, { type: "remove-token", base: 0, token: "color.primary" }),
    );
    expect(reasons).toMatchObject([{ code: "unknown-token", nodeId: "btn" }]);
    const unused = passes(
      onDraft(d0, { type: "remove-token", base: 0, token: "color.surface" }),
    );
    expect(unused.tokens.color).toEqual({ primary: "#1a73e8" });
  });

  test("an instance keeps pointing at a renamed component", () => {
    const withCard = passes(
      onDraft(d0, {
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
      }),
    );
    expect(withCard.revision).toBe(1);
    const renamed = passes(
      onDraft(withCard, {
        type: "rename-component",
        base: 1,
        id: "Badge",
        to: "Tag",
      }),
    );
    expect(renamed.revision).toBe(2);
    const root = renamed.components["Card"]?.root as {
      children: { component: string }[];
    };
    expect(root.children[0]?.component).toBe("Badge");
  });

  test("a name held by another component fails with component-name-taken", () => {
    const before = structuredClone(d0);
    expect(
      failures(
        onDraft(d0, {
          type: "rename-component",
          base: 0,
          id: "Badge",
          to: "Button",
        }),
      ),
    ).toMatchObject([{ code: "component-name-taken", name: "Button" }]);
    expect(
      failures(
        onDraft(d0, {
          type: "add-component",
          base: 0,
          id: "Card",
          component: {
            name: "Badge",
            props: {},
            root: { type: "frame", id: "card", children: [] },
          },
        }),
      ),
    ).toMatchObject([{ code: "component-name-taken", name: "Badge" }]);
    expect(d0).toEqual(before);
    expect(d0.revision).toBe(0);
    const same = passes(
      onDraft(d0, {
        type: "rename-component",
        base: 0,
        id: "Badge",
        to: "Badge",
      }),
    );
    expect(same.components["Badge"]?.name).toBe("Badge");
  });

  test("adding what already exists fails with target-exists", () => {
    expect(
      failures(
        onDraft(d0, {
          type: "add-token",
          base: 0,
          token: "color.primary",
          value: "#000000",
        }),
      ),
    ).toMatchObject([{ code: "target-exists", target: "color.primary" }]);
    expect(
      failures(
        onDraft(d0, {
          type: "add-prop",
          base: 0,
          component: "Button",
          name: "label",
          def: { type: "string" },
        }),
      ),
    ).toMatchObject([{ code: "target-exists" }]);
    expect(
      failures(
        onDraft(d0, {
          type: "add-component",
          base: 0,
          id: "Badge",
          component: {
            name: "Pill",
            props: {},
            root: { type: "frame", id: "pill", children: [] },
          },
        }),
      ),
    ).toMatchObject([{ code: "target-exists" }]);
  });

  test("changing or removing what does not exist fails with target-missing", () => {
    expect(
      failures(
        onDraft(d0, {
          type: "change-token",
          base: 0,
          token: "color.accent",
          value: "#000000",
        }),
      ),
    ).toMatchObject([{ code: "target-missing", target: "color.accent" }]);
    expect(
      failures(
        onDraft(d0, {
          type: "remove-prop",
          base: 0,
          component: "Button",
          name: "size",
        }),
      ),
    ).toMatchObject([{ code: "target-missing" }]);
    expect(
      failures(
        onDraft(d0, {
          type: "rename-component",
          base: 0,
          id: "Card",
          to: "Tile",
        }),
      ),
    ).toMatchObject([{ code: "target-missing" }]);
  });

  test("a token value of the wrong type fails with invalid-shape at the token", () => {
    const reasons = failures(
      onDraft(d0, {
        type: "change-token",
        base: 0,
        token: "color.primary",
        value: 5,
      }),
    );
    expect(reasons).toMatchObject([
      { code: "invalid-shape", path: ["tokens", "color", "primary"] },
    ]);
  });

  test("a token name of the wrong form fails with invalid-token-name", () => {
    expect(
      failures(
        onDraft(d0, {
          type: "add-token",
          base: 0,
          token: "shadow.sm",
          value: "#000000",
        }),
      ),
    ).toMatchObject([{ code: "invalid-token-name", token: "shadow.sm" }]);
    expect(
      failures(
        onDraft(d0, {
          type: "change-token",
          base: 0,
          token: "primary",
          value: "#000000",
        }),
      ),
    ).toMatchObject([{ code: "invalid-token-name" }]);
    expect(
      failures(onDraft(d0, { type: "remove-token", base: 0, token: "color." })),
    ).toMatchObject([{ code: "invalid-token-name" }]);
  });
});

describe("apply with an operation that does not fit the document", () => {
  test("fails with operation-not-applicable and leaves the document as it was", () => {
    const draftBefore = structuredClone(d0);
    const treeBefore = structuredClone(D4());
    expect(
      failures(
        onDraft(d0, {
          type: "set",
          base: 0,
          node: "btn",
          key: "background",
          value: "#000000",
        }),
      ),
    ).toMatchObject([{ code: "operation-not-applicable" }]);
    const misfits: EditOperation[] = [
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
    for (const op of misfits) {
      expect(failures(onTree(D4(), op))).toMatchObject([
        { code: "operation-not-applicable" },
      ]);
    }
    expect(d0).toEqual(draftBefore);
    expect(D4()).toEqual(treeBefore);
  });
});
