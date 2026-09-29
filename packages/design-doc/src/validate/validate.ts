import type { DraftDocument, TreeDocument } from "../model/document";
import type { Node } from "../model/node";
import type { PropDef } from "../model/props";
import type { Scope } from "../model/scope";
import { TokenKind } from "../model/tokens";
import type { Value } from "../model/value";
import type { Validate } from "../roles";
import type { ValidateFailure } from "./failure";
import { has, matchesType } from "./prop-types";

type Edge = { from: string; to: string; nodeId: string };

type Shared = {
  out: ValidateFailure[];
  seenIds: Set<string>;
  edges: Edge[];
};

/** What one tree is checked against: its scope and, inside a component, its props. */
type Ctx = Shared & {
  scope: Scope;
  props: Record<string, PropDef> | null;
  component: string | null;
  repeats: string[];
};

type WithoutNode = ValidateFailure extends infer F
  ? F extends unknown
    ? Omit<F, "nodeId">
    : never
  : never;

const fail =
  (ctx: Ctx, nodeId: string) =>
  (failure: WithoutNode): void => {
    ctx.out.push({ ...failure, nodeId } as ValidateFailure);
  };

const checkToken = (
  ref: string,
  expected: TokenKind | null,
  ctx: Ctx,
  nodeId: string,
): void => {
  const dot = ref.indexOf(".");
  const kind = TokenKind.safeParse(ref.slice(0, dot));
  const name = ref.slice(dot + 1);
  const report = fail(ctx, nodeId);
  if (dot < 0 || !kind.success) {
    report({ code: "unknown-token", message: `unknown token "${ref}"` });
  } else if (expected !== null && kind.data !== expected) {
    report({
      code: "token-kind-mismatch",
      message: `"${ref}" is a ${kind.data} token but ${expected} is expected`,
    });
  } else if (!has(ctx.scope.tokens[kind.data], name)) {
    report({ code: "unknown-token", message: `unknown token "${ref}"` });
  }
};

const checkPropRef = (
  name: string,
  ctx: Ctx,
  nodeId: string,
): PropDef | undefined => {
  if (ctx.props !== null && has(ctx.props, name)) return ctx.props[name];
  fail(
    ctx,
    nodeId,
  )({
    code: "unknown-prop-reference",
    message: `unknown prop "${name}"`,
  });
  return undefined;
};

const checkVar = (ref: string, ctx: Ctx, nodeId: string): void => {
  const head = ref.split(".")[0]!;
  if (ctx.repeats.includes(head)) return;
  fail(
    ctx,
    nodeId,
  )({
    code: "var-outside-repeat",
    message: `"${ref}" is not inside a repeat named "${head}"`,
  });
};

const checkMatch = (
  value: Extract<Value, { match: string }>,
  ctx: Ctx,
  nodeId: string,
): void => {
  const def = checkPropRef(value.match, ctx, nodeId);
  if (def === undefined) return;
  const report = fail(ctx, nodeId);
  const optional = def.required !== true && def.default === undefined;
  const missingDefault = () => {
    if (value.default === undefined) {
      report({
        code: "match-default-required",
        message: `match on "${value.match}" needs a default`,
      });
    }
  };
  const covers = (values: string[]) => {
    const missing = values.filter((v) => !has(value.cases, v));
    if (missing.length > 0) {
      report({
        code: "match-not-exhaustive",
        message: `match on "${value.match}" does not cover ${missing.join(", ")}`,
      });
    }
  };
  switch (def.type) {
    case "enum":
      covers(def.values);
      if (optional) missingDefault();
      return;
    case "boolean":
      covers(["true", "false"]);
      if (optional) missingDefault();
      return;
    case "string":
    case "number":
      missingDefault();
      return;
    default:
      report({
        code: "match-unsupported-type",
        message: `"${value.match}" is a ${def.type} prop and cannot be matched`,
      });
  }
};

const walkValue = (
  value: Value,
  kind: TokenKind | null,
  ctx: Ctx,
  nodeId: string,
): void => {
  if (typeof value !== "object") return;
  if ("token" in value) return checkToken(value.token, kind, ctx, nodeId);
  if ("prop" in value) {
    checkPropRef(value.prop, ctx, nodeId);
    return;
  }
  if ("var" in value) return checkVar(value.var, ctx, nodeId);
  if ("match" in value) {
    checkMatch(value, ctx, nodeId);
    for (const branch of Object.values(value.cases)) {
      walkValue(branch, kind, ctx, nodeId);
    }
    if (value.default !== undefined)
      walkValue(value.default, kind, ctx, nodeId);
    return;
  }
  if ("object" in value) {
    for (const item of Object.values(value.object)) {
      walkValue(item, null, ctx, nodeId);
    }
    return;
  }
  if ("array" in value) {
    for (const item of value.array) walkValue(item, null, ctx, nodeId);
    return;
  }
  for (const node of value.nodes) walkNode(node, ctx);
};

const walkInstance = (
  node: Extract<Node, { type: "instance" }>,
  ctx: Ctx,
): void => {
  const report = fail(ctx, node.id);
  for (const value of Object.values(node.props)) {
    walkValue(value, null, ctx, node.id);
  }
  if (!has(ctx.scope.components, node.component)) {
    report({
      code: "component-out-of-scope",
      message: `component "${node.component}" is not in the scope`,
    });
    return;
  }
  if (ctx.component !== null) {
    ctx.edges.push({
      from: ctx.component,
      to: node.component,
      nodeId: node.id,
    });
  }
  const defs = ctx.scope.components[node.component]!.props;
  for (const [name, def] of Object.entries(defs)) {
    if (def.required === true && !has(node.props, name)) {
      report({
        code: "missing-required-prop",
        prop: name,
        message: `required prop "${name}" is missing`,
      });
    }
  }
  for (const [name, value] of Object.entries(node.props)) {
    if (!has(defs, name)) {
      report({
        code: "unknown-prop",
        prop: name,
        message: `"${name}" is not a prop of "${node.component}"`,
      });
    } else if (!matchesType(value, defs[name]!, ctx.props)) {
      report({
        code: "prop-type-mismatch",
        prop: name,
        message: `the value of "${name}" does not match its type`,
      });
    }
  }
};

const walkNode = (node: Node, ctx: Ctx): void => {
  const id = node.id;
  if (ctx.seenIds.has(id)) {
    fail(
      ctx,
      id,
    )({
      code: "duplicate-node-id",
      message: `node id "${id}" is used more than once`,
    });
  }
  ctx.seenIds.add(id);

  if (node.when !== undefined) {
    if (typeof node.when === "object" && "present" in node.when) {
      checkPropRef(node.when.present, ctx, id);
    } else {
      walkValue(node.when, null, ctx, id);
    }
  }
  const style = (value: Value | undefined, kind: TokenKind | null) => {
    if (value !== undefined) walkValue(value, kind, ctx, id);
  };

  switch (node.type) {
    case "frame":
      style(node.layout?.gap, "space");
      style(node.layout?.padding, "space");
      style(node.background, "color");
      style(node.border?.color, "color");
      style(node.radius, "radius");
      for (const child of node.children) walkNode(child, ctx);
      return;
    case "text":
      style(node.text, null);
      style(node.color, "color");
      style(node.typography, "typography");
      return;
    case "image":
      style(node.radius, "radius");
      return;
    case "instance":
      walkInstance(node, ctx);
      return;
    case "slot":
      checkPropRef(node.prop, ctx, id);
      return;
    case "repeat":
      if ("prop" in node.each) checkPropRef(node.each.prop, ctx, id);
      else checkVar(node.each.var, ctx, id);
      if (ctx.repeats.includes(node.as)) {
        fail(
          ctx,
          id,
        )({
          code: "repeat-name-shadowed",
          message: `repeat name "${node.as}" is already used by an outer repeat`,
        });
      }
      for (const child of node.children) {
        walkNode(child, { ...ctx, repeats: [...ctx.repeats, node.as] });
      }
  }
};

const reaches = (edges: Edge[], from: string, target: string): boolean => {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of edges) if (edge.from === current) stack.push(edge.to);
  }
  return false;
};

const validateDraft = (doc: DraftDocument): ValidateFailure[] => {
  const scope: Scope = { tokens: doc.tokens, components: doc.components };
  const shared: Shared = { out: [], seenIds: new Set(), edges: [] };
  for (const [id, component] of Object.entries(doc.components)) {
    walkNode(component.root, {
      ...shared,
      scope,
      props: component.props,
      component: id,
      repeats: [],
    });
  }
  for (const edge of shared.edges) {
    if (reaches(shared.edges, edge.to, edge.from)) {
      shared.out.push({
        code: "component-cycle",
        nodeId: edge.nodeId,
        message: `"${edge.to}" nests "${edge.from}" again`,
      });
    }
  }
  return shared.out;
};

const validateTree = (doc: TreeDocument, scope: Scope): ValidateFailure[] => {
  const out: ValidateFailure[] = [];
  walkNode(doc.root, {
    out,
    seenIds: new Set(),
    edges: [],
    scope,
    props: null,
    component: null,
    repeats: [],
  });
  return out;
};

export const validate: Validate = (
  doc: TreeDocument | DraftDocument,
  scope?: Scope,
): ValidateFailure[] =>
  doc.kind === "draft" ? validateDraft(doc) : validateTree(doc, scope!);
