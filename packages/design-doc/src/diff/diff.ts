import type { Discrepancy } from "../model/discrepancy";
import type { TreeDocument } from "../model/document";
import type { Node } from "../model/node";
import type { Scope } from "../model/scope";
import { TokenKind } from "../model/tokens";
import type { Value } from "../model/value";
import { checkInstanceProps } from "../props/check";
import type { Diff } from "../roles";

const own = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

const tokenExists = (ref: string, scope: Scope): boolean => {
  const dot = ref.indexOf(".");
  const kind = TokenKind.safeParse(ref.slice(0, dot));
  return (
    dot >= 0 && kind.success && own(scope.tokens[kind.data], ref.slice(dot + 1))
  );
};

/** Token references and nested nodes found in one value, in reading order. */
const readValue = (value: Value, refs: string[], nested: Node[]): void => {
  if (typeof value !== "object") return;
  if ("token" in value) refs.push(value.token);
  else if ("object" in value) {
    for (const item of Object.values(value.object)) {
      readValue(item, refs, nested);
    }
  } else if ("array" in value) {
    for (const item of value.array) readValue(item, refs, nested);
  } else if ("nodes" in value) nested.push(...value.nodes);
  else if ("match" in value) {
    for (const branch of Object.values(value.cases)) {
      readValue(branch, refs, nested);
    }
    if (value.default !== undefined) readValue(value.default, refs, nested);
  }
};

/** The values a node holds itself, not those of its children. */
const valuesOf = (node: Node): Value[] => {
  const held: (Value | undefined)[] = [];
  const when = node.when;
  if (
    when !== undefined &&
    (typeof when !== "object" || !("present" in when))
  ) {
    held.push(when);
  }
  switch (node.type) {
    case "frame":
      held.push(
        node.layout?.gap,
        node.layout?.padding,
        node.background,
        node.border?.color,
        node.radius,
      );
      break;
    case "text":
      held.push(node.text, node.color, node.typography);
      break;
    case "image":
      held.push(node.radius);
      break;
    case "instance":
      held.push(...Object.values(node.props));
      break;
    default:
  }
  return held.filter((value) => value !== undefined);
};

const walk = (node: Node, newScope: Scope, out: Discrepancy[]): void => {
  if (node.type === "instance") {
    if (!own(newScope.components, node.component)) {
      out.push({
        kind: "component-removed",
        nodeId: node.id,
        component: node.component,
      });
    } else {
      const reasons = checkInstanceProps({
        nodeId: node.id,
        component: node.component,
        props: node.props,
        defs: newScope.components[node.component]!.props,
        enclosing: null,
      });
      if (reasons.length > 0) {
        out.push({
          kind: "props-mismatch",
          nodeId: node.id,
          component: node.component,
          reasons,
        });
      }
    }
  }

  const refs: string[] = [];
  const nested: Node[] = [];
  for (const value of valuesOf(node)) readValue(value, refs, nested);
  for (const token of new Set(refs)) {
    if (!tokenExists(token, newScope)) {
      out.push({ kind: "token-removed", nodeId: node.id, token });
    }
  }

  const children =
    node.type === "frame" || node.type === "repeat" ? node.children : [];
  for (const child of [...children, ...nested]) walk(child, newScope, out);
};

/** Every use in `doc` that `newScope` no longer supports. */
export const diff: Diff = (
  doc: TreeDocument,
  _oldScope: Scope,
  newScope: Scope,
): Discrepancy[] => {
  const out: Discrepancy[] = [];
  walk(doc.root, newScope, out);
  return out;
};
