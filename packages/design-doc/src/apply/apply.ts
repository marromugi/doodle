import { DraftDocument, TreeDocument, type Document } from "../model/document";
import type { EditOperation } from "../model/operation";
import type { Scope } from "../model/scope";
import { TokenKind } from "../model/tokens";
import type { Apply, Result } from "../roles";
import { validate } from "../validate/validate";
import type { ApplyFailure } from "./failure";
import {
  isNodeLike,
  isNodesValue,
  isRecord,
  locate,
  own,
  put,
  subtreeIds,
  valueIds,
  type Json,
} from "./nodes";

export type ApplyUnvalidated = {
  (doc: TreeDocument, op: EditOperation): Result<TreeDocument, ApplyFailure>;
  (doc: DraftDocument, op: EditOperation): Result<DraftDocument, ApplyFailure>;
};

type Target = { kind: "nodes" | "tokens" | "components"; id: string };

/** What an operation did to the document, for the history record. */
type Change = { touched: Target[]; removed: string[]; entering: string[] };

/** One operation against one document: what it touches, what it gets wrong, and how it changes a copy. */
type Plan = {
  targets: Target[];
  check: () => ApplyFailure | null;
  build: (next: Json) => Change;
};

const NODE_OPERATIONS = new Set(["add", "set", "remove", "move"]);
const RESERVED_KEYS = new Set(["id", "type", "children"]);

const node = (id: string): Target => ({ kind: "nodes", id });
const token = (id: string): Target => ({ kind: "tokens", id });
const component = (id: string): Target => ({ kind: "components", id });

const unknownNode = (id: string): ApplyFailure => ({
  code: "unknown-node",
  nodeId: id,
  message: `no node "${id}"`,
});

const notAContainer = (id: string): ApplyFailure => ({
  code: "not-a-container",
  nodeId: id,
  message: `node "${id}" cannot have children`,
});

const notSettable = (nodeId: string, key: string): ApplyFailure => ({
  code: "key-not-settable",
  nodeId,
  key,
  message: `"${key}" cannot be set on node "${nodeId}"`,
});

const outOfRange = (
  nodeId: string,
  index: number,
  count: number,
): ApplyFailure => ({
  code: "index-out-of-range",
  nodeId,
  index,
  count,
  message: `index ${index} is outside 0..${count} in "${nodeId}"`,
});

const firstReusedId = (
  ids: string[],
  everUsed: Set<string>,
  live: Set<string>,
): ApplyFailure | null => {
  const id = ids.find((each) => everUsed.has(each) && !live.has(each));
  return id === undefined
    ? null
    : {
        code: "node-id-reused",
        nodeId: id,
        message: `node ID "${id}" was used before and cannot be used again`,
      };
};

/** Sets a dot path inside one node. Returns the failure when the path cannot be set. */
const setPath = (
  target: Json,
  nodeId: string,
  key: string,
  value: unknown,
): ApplyFailure | null => {
  const segments = key.split(".");
  if (RESERVED_KEYS.has(segments[0]!)) return notSettable(nodeId, key);
  let current: Json = target;
  for (const [i, segment] of segments.entries()) {
    if (isNodesValue(current)) return notSettable(nodeId, key);
    if (i === segments.length - 1) {
      put(current, segment, structuredClone(value));
      return null;
    }
    const inner = own(current, segment) ? current[segment] : undefined;
    if (inner === undefined) {
      const created: Json = {};
      put(current, segment, created);
      current = created;
    } else if (isRecord(inner)) {
      current = inner;
    } else {
      return notSettable(nodeId, key);
    }
  }
  return null;
};

/** IDs of the nodes held by the value a dot path currently points at. */
const idsInside = (owner: Json, key: string): string[] => {
  let current: unknown = owner;
  for (const segment of key.split(".")) {
    if (!isRecord(current) || !own(current, segment)) return [];
    current = current[segment];
  }
  return valueIds({ value: current });
};

const treePlan = (
  doc: TreeDocument,
  op: EditOperation,
): Plan | ApplyFailure => {
  const root = doc.root as unknown as Json;
  const live = new Set(subtreeIds(root));
  const everUsed = new Set(doc.history.nodeIds);
  const rootOf = (next: Json): Json => next["root"] as Json;

  switch (op.type) {
    case "add": {
      const parent = locate(root, op.parent);
      const entering = subtreeIds(op.node as unknown as Json);
      return {
        targets: [node(op.node.id), node(op.parent)],
        check: () => {
          if (!parent) return unknownNode(op.parent);
          const children = parent.node["children"];
          if (!Array.isArray(children)) return notAContainer(op.parent);
          if (op.index > children.length) {
            return outOfRange(op.parent, op.index, children.length);
          }
          return firstReusedId(entering, everUsed, live);
        },
        build: (next) => {
          const at = locate(rootOf(next), op.parent)!;
          (at.node["children"] as Json[]).splice(
            op.index,
            0,
            structuredClone(op.node) as unknown as Json,
          );
          return {
            touched: [node(op.node.id), node(op.parent)],
            removed: [],
            entering,
          };
        },
      };
    }

    case "set": {
      const target = locate(root, op.node);
      let failure: ApplyFailure | null = null;
      let dropped: string[] = [];
      let replaced: string[] = [];
      let entering: string[] = [];
      if (target) {
        const trial = structuredClone(target.node);
        failure = setPath(trial, op.node, op.key, op.value);
        if (!failure) {
          const before = new Set(valueIds(target.node));
          const after = new Set(valueIds(trial));
          replaced = idsInside(target.node, op.key);
          dropped = [...before].filter((id) => !after.has(id));
          entering = [...after].filter((id) => !before.has(id));
        }
      }
      return {
        targets: [node(op.node), ...replaced.map(node)],
        check: () => {
          if (!target) return unknownNode(op.node);
          return failure ?? firstReusedId(entering, everUsed, live);
        },
        build: (next) => {
          const at = locate(rootOf(next), op.node)!;
          setPath(at.node, op.node, op.key, op.value);
          return {
            touched: [node(op.node), ...replaced.map(node)],
            removed: dropped,
            entering,
          };
        },
      };
    }

    case "remove": {
      const target = locate(root, op.node);
      const removed = target ? subtreeIds(target.node) : [];
      return {
        targets: [
          node(op.node),
          ...(target?.parent ? [node(target.parent["id"] as string)] : []),
        ],
        check: () => {
          if (!target) return unknownNode(op.node);
          if (!target.parent) {
            return {
              code: "root-fixed",
              nodeId: op.node,
              message: `the root "${op.node}" cannot be removed`,
            };
          }
          return null;
        },
        build: (next) => {
          const at = locate(rootOf(next), op.node)!;
          at.list!.splice(at.list!.indexOf(at.node), 1);
          return {
            touched: [node(at.parent!["id"] as string)],
            removed,
            entering: [],
          };
        },
      };
    }

    case "move": {
      const target = locate(root, op.node);
      const parent = locate(root, op.parent);
      const oldParent = target?.parent ? (target.parent["id"] as string) : null;
      return {
        targets: [
          node(op.node),
          node(op.parent),
          ...(oldParent === null ? [] : [node(oldParent)]),
        ],
        check: () => {
          if (!target) return unknownNode(op.node);
          if (!parent) return unknownNode(op.parent);
          if (!target.parent) {
            return {
              code: "root-fixed",
              nodeId: op.node,
              message: `the root "${op.node}" cannot be moved`,
            };
          }
          const children = parent.node["children"];
          if (!Array.isArray(children)) return notAContainer(op.parent);
          if (subtreeIds(target.node).includes(op.parent)) {
            return {
              code: "move-into-own-subtree",
              nodeId: op.node,
              target: op.parent,
              message: `"${op.node}" cannot move into "${op.parent}", which is inside it`,
            };
          }
          const count = children.length - (target.list === children ? 1 : 0);
          if (op.index > count) return outOfRange(op.parent, op.index, count);
          return null;
        },
        build: (next) => {
          const at = locate(rootOf(next), op.node)!;
          const into = locate(rootOf(next), op.parent)!;
          at.list!.splice(at.list!.indexOf(at.node), 1);
          (into.node["children"] as Json[]).splice(op.index, 0, at.node);
          return {
            touched: [node(op.node), node(op.parent), node(oldParent!)],
            removed: [],
            entering: [],
          };
        },
      };
    }

    default:
      throw new Error(`not a node operation: ${op.type}`);
  }
};

const parseToken = (name: string): { kind: TokenKind; name: string } | null => {
  const dot = name.indexOf(".");
  const kind = TokenKind.safeParse(name.slice(0, dot));
  const rest = name.slice(dot + 1);
  return dot < 0 || !kind.success || rest === ""
    ? null
    : { kind: kind.data, name: rest };
};

const draftPlan = (
  doc: DraftDocument,
  op: EditOperation,
): Plan | ApplyFailure => {
  const missing = (target: string): ApplyFailure => ({
    code: "target-missing",
    target,
    message: `"${target}" does not exist`,
  });
  const exists = (target: string): ApplyFailure => ({
    code: "target-exists",
    target,
    message: `"${target}" already exists`,
  });
  const nameTaken = (name: string, except: string): ApplyFailure | null =>
    Object.entries(doc.components).some(
      ([id, each]) => id !== except && each.name === name,
    )
      ? {
          code: "component-name-taken",
          name,
          message: `another component is already named "${name}"`,
        }
      : null;
  const dictOf = (next: Json, key: string): Json => next[key] as Json;

  switch (op.type) {
    case "add-token":
    case "change-token":
    case "remove-token": {
      const parsed = parseToken(op.token);
      return {
        targets: [token(op.token)],
        check: () => {
          if (!parsed) {
            return {
              code: "invalid-token-name",
              token: op.token,
              message: `"${op.token}" is not a token name of the form kind.name`,
            };
          }
          const has = own(doc.tokens[parsed.kind], parsed.name);
          if (op.type === "add-token") {
            return has ? exists(op.token) : null;
          }
          return has ? null : missing(op.token);
        },
        build: (next) => {
          const table = dictOf(dictOf(next, "tokens"), parsed!.kind);
          if (op.type === "remove-token") {
            delete table[parsed!.name];
          } else {
            put(table, parsed!.name, structuredClone(op.value));
          }
          return { touched: [token(op.token)], removed: [], entering: [] };
        },
      };
    }

    case "add-component":
      return {
        targets: [component(op.id)],
        check: () =>
          own(doc.components, op.id)
            ? exists(op.id)
            : nameTaken(op.component.name, op.id),
        build: (next) => {
          put(dictOf(next, "components"), op.id, structuredClone(op.component));
          return { touched: [component(op.id)], removed: [], entering: [] };
        },
      };

    case "remove-component":
      return {
        targets: [component(op.id)],
        check: () => (own(doc.components, op.id) ? null : missing(op.id)),
        build: (next) => {
          delete dictOf(next, "components")[op.id];
          return { touched: [component(op.id)], removed: [], entering: [] };
        },
      };

    case "rename-component":
      return {
        targets: [component(op.id)],
        check: () =>
          own(doc.components, op.id) ? nameTaken(op.to, op.id) : missing(op.id),
        build: (next) => {
          const target = dictOf(dictOf(next, "components"), op.id);
          target["name"] = op.to;
          return { touched: [component(op.id)], removed: [], entering: [] };
        },
      };

    case "add-prop":
    case "change-prop":
    case "remove-prop":
      return {
        targets: [component(op.component)],
        check: () => {
          if (!own(doc.components, op.component)) return missing(op.component);
          const has = own(doc.components[op.component]!.props, op.name);
          if (op.type === "add-prop") return has ? exists(op.name) : null;
          return has ? null : missing(op.name);
        },
        build: (next) => {
          const props = dictOf(
            dictOf(dictOf(next, "components"), op.component),
            "props",
          );
          if (op.type === "remove-prop") {
            delete props[op.name];
          } else {
            put(props, op.name, structuredClone(op.def));
          }
          return {
            touched: [component(op.component)],
            removed: [],
            entering: [],
          };
        },
      };

    default:
      throw new Error(`not a draft operation: ${op.type}`);
  }
};

const isFailure = (value: Plan | ApplyFailure): value is ApplyFailure =>
  "code" in value;

const conflictsOf = (
  doc: Document,
  op: EditOperation,
  targets: Target[],
): ApplyFailure[] => {
  const seen = new Set<string>();
  const conflicts: ApplyFailure[] = [];
  for (const { kind, id } of targets) {
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const record = doc.history[kind];
    if (own(record, id) && record[id]! > op.base) {
      conflicts.push({
        code: "conflict",
        latestRevision: doc.revision,
        message: `"${id}" changed at revision ${record[id]} after revision ${op.base}`,
        ...(kind === "nodes" ? { nodeId: id } : {}),
      });
    }
  }
  return conflicts;
};

/** The innermost node the path runs through, if any. */
const nodeIdAt = (
  doc: Document,
  path: (string | number)[],
): string | undefined => {
  let current: unknown = doc;
  let id: string | undefined;
  for (const segment of path) {
    if (isNodeLike(current)) id = current["id"] as string;
    if (typeof current !== "object" || current === null) return id;
    current = (current as Record<string | number, unknown>)[segment];
  }
  if (isNodeLike(current)) id = current["id"] as string;
  return id;
};

const shapeFailures = (next: Document): ApplyFailure[] => {
  const parsed = (
    next.kind === "tree" ? TreeDocument : DraftDocument
  ).safeParse(next);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue): ApplyFailure => {
    const path = issue.path.map((segment) =>
      typeof segment === "number" ? segment : String(segment),
    );
    const nodeId = nodeIdAt(next, path);
    return {
      code: "invalid-shape",
      path,
      message: issue.message,
      ...(nodeId === undefined ? {} : { nodeId }),
    };
  });
};

const applyStep = (
  doc: Document,
  op: EditOperation,
): Result<Document, ApplyFailure> => {
  if (NODE_OPERATIONS.has(op.type) !== (doc.kind === "tree")) {
    return {
      ok: false,
      reasons: [
        {
          code: "operation-not-applicable",
          message: `"${op.type}" does not apply to a ${doc.kind} document`,
        },
      ],
    };
  }
  const plan = doc.kind === "tree" ? treePlan(doc, op) : draftPlan(doc, op);

  const conflicts = conflictsOf(doc, op, isFailure(plan) ? [] : plan.targets);
  if (conflicts.length > 0) return { ok: false, reasons: conflicts };
  if (isFailure(plan)) return { ok: false, reasons: [plan] };
  const mistake = plan.check();
  if (mistake) return { ok: false, reasons: [mistake] };

  const next = structuredClone(doc) as unknown as Json;
  const change = plan.build(next);
  const revision = doc.revision + 1;
  const history = next["history"] as Json;
  for (const { kind, id } of [...change.touched, ...change.removed.map(node)]) {
    put(history[kind] as Json, id, revision);
  }
  const everUsed = history["nodeIds"] as string[];
  for (const id of [...change.entering, ...change.removed]) {
    if (!everUsed.includes(id)) everUsed.push(id);
  }
  next["revision"] = revision;

  const changed = next as unknown as Document;
  const shape = shapeFailures(changed);
  return shape.length > 0
    ? { ok: false, reasons: shape }
    : { ok: true, value: changed };
};

export const applyUnvalidated = applyStep as ApplyUnvalidated;

export const apply: Apply = ((
  doc: Document,
  op: EditOperation,
  scope?: Scope,
): Result<Document, ApplyFailure> => {
  const result = applyStep(doc, op);
  if (!result.ok) return result;
  const value = result.value;
  const reasons =
    value.kind === "tree" ? validate(value, scope!) : validate(value);
  return reasons.length > 0 ? { ok: false, reasons } : result;
}) as Apply;
