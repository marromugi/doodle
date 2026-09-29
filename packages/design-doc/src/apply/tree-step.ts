import type { TreeDocument } from "../model/document";
import type { Node } from "../model/node";
import type { EditOperation } from "../model/operation";
import type { Result } from "../roles";
import type { ApplyFailure } from "./failure";
import { conflictsOf, fail } from "./helpers";

type Container = Extract<Node, { children: Node[] }>;

const isContainer = (node: Node): node is Container =>
  node.type === "frame" || node.type === "repeat";

const find = (node: Node, id: string): Node | undefined => {
  if (node.id === id) return node;
  if (!isContainer(node)) return undefined;
  for (const child of node.children) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return undefined;
};

const idsOf = (node: Node): string[] =>
  isContainer(node) ? [node.id, ...node.children.flatMap(idsOf)] : [node.id];

const parentOf = (root: Node, id: string): Container | undefined => {
  if (!isContainer(root)) return undefined;
  if (root.children.some((c) => c.id === id)) return root;
  for (const child of root.children) {
    const hit = parentOf(child, id);
    if (hit) return hit;
  }
  return undefined;
};

const mapNode = (node: Node, id: string, f: (n: Node) => Node): Node => {
  if (node.id === id) return f(node);
  if (!isContainer(node)) return node;
  return {
    ...node,
    children: node.children.map((c) => mapNode(c, id, f)),
  };
};

const mapContainer = (
  root: Node,
  id: string,
  f: (children: Node[]) => Node[],
): Node =>
  mapNode(root, id, (n) =>
    isContainer(n) ? { ...n, children: f(n.children) } : n,
  );

const insertAt = (children: Node[], index: number, node: Node): Node[] => {
  const at = Math.min(index, children.length);
  return [...children.slice(0, at), node, ...children.slice(at)];
};

const finish = (
  doc: TreeDocument,
  root: Node,
  touched: string[],
  added: string[],
  removed: string[],
): Result<TreeDocument, ApplyFailure> => {
  const revision = doc.revision + 1;
  const nodes = { ...doc.history.nodes };
  for (const id of [...touched, ...added, ...removed]) nodes[id] = revision;
  const nodeIds = [...new Set([...doc.history.nodeIds, ...added, ...removed])];
  return {
    ok: true,
    value: {
      ...doc,
      revision,
      root,
      history: { ...doc.history, nodes, nodeIds },
    },
  };
};

const conflicts = (
  doc: TreeDocument,
  base: number,
  targets: string[],
): ApplyFailure[] =>
  conflictsOf(doc.revision, doc.history.nodes, base, targets, (id) => ({
    message: `node "${id}" changed after revision ${base}`,
    nodeId: id,
  }));

const unknownNode = (id: string) =>
  fail({
    code: "unknown-node",
    message: `node "${id}" does not exist`,
    nodeId: id,
  });

const notApplicable = (message: string, nodeId?: string) =>
  fail({ code: "operation-not-applicable", message, nodeId });

const dropTouched = (ids: (string | undefined)[]): string[] =>
  ids.filter((id): id is string => id !== undefined);

export const treeStep = (
  doc: TreeDocument,
  op: EditOperation,
): Result<TreeDocument, ApplyFailure> => {
  const { root } = doc;
  switch (op.type) {
    case "set": {
      const early = conflicts(doc, op.base, [op.node]);
      if (early.length > 0) return { ok: false, reasons: early };
      const node = find(root, op.node);
      if (!node) return unknownNode(op.node);
      const next = mapNode(root, op.node, (n) => {
        const { [op.key]: _old, ...rest } = n as Record<string, unknown>;
        return (
          op.value === null ? rest : { ...rest, [op.key]: op.value }
        ) as Node;
      });
      return finish(doc, next, [op.node], [], []);
    }
    case "add": {
      const ids = idsOf(op.node);
      const live = new Set(idsOf(root));
      const known = new Set([
        ...doc.history.nodeIds,
        ...Object.keys(doc.history.nodes),
      ]);
      const reused = ids.find((id) => known.has(id) && !live.has(id));
      if (reused !== undefined) {
        return fail({
          code: "node-id-reused",
          message: `node id "${reused}" was used before and cannot be reused`,
          nodeId: reused,
        });
      }
      const early = conflicts(doc, op.base, [op.parent]);
      if (early.length > 0) return { ok: false, reasons: early };
      const parent = find(root, op.parent);
      if (!parent) return unknownNode(op.parent);
      if (!isContainer(parent)) {
        return notApplicable(`node "${op.parent}" has no children`, op.parent);
      }
      const next = mapContainer(root, op.parent, (cs) =>
        insertAt(cs, op.index, op.node),
      );
      return finish(doc, next, [op.parent], ids, []);
    }
    case "remove": {
      const parent = parentOf(root, op.node);
      const early = conflicts(doc, op.base, dropTouched([op.node, parent?.id]));
      if (early.length > 0) return { ok: false, reasons: early };
      const node = find(root, op.node);
      if (!node) return unknownNode(op.node);
      if (!parent) return notApplicable("the root cannot be removed", op.node);
      const next = mapContainer(root, parent.id, (cs) =>
        cs.filter((c) => c.id !== op.node),
      );
      return finish(doc, next, [parent.id], [], idsOf(node));
    }
    case "move": {
      const source = parentOf(root, op.node);
      const early = conflicts(
        doc,
        op.base,
        dropTouched([op.node, op.parent, source?.id]),
      );
      if (early.length > 0) return { ok: false, reasons: early };
      const node = find(root, op.node);
      if (!node) return unknownNode(op.node);
      const target = find(root, op.parent);
      if (!target) return unknownNode(op.parent);
      if (!source) return notApplicable("the root cannot be moved", op.node);
      if (!isContainer(target)) {
        return notApplicable(`node "${op.parent}" has no children`, op.parent);
      }
      if (idsOf(node).includes(op.parent)) {
        return notApplicable("a node cannot move into itself", op.node);
      }
      const detached = mapContainer(root, source.id, (cs) =>
        cs.filter((c) => c.id !== op.node),
      );
      const next = mapContainer(detached, op.parent, (cs) =>
        insertAt(cs, op.index, node),
      );
      return finish(doc, next, [op.node, op.parent, source.id], [], []);
    }
    default:
      return notApplicable(`"${op.type}" does not apply to a tree document`);
  }
};
