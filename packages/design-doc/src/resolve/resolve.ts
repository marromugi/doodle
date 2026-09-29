import type { Node } from "../model/node";
import type { RenderNode, RenderShape } from "../model/render";
import { UNWRITTEN } from "../model/render";
import type { Scope } from "../model/scope";
import type { Value } from "../model/value";
import type { Resolve } from "../roles";
import {
  asArray,
  asBoolean,
  asNodes,
  asNumber,
  asString,
  asTypography,
  evaluate,
  Failed,
  unresolved,
  type Env,
  type Slot,
} from "./values";

type Of<T extends Node["type"]> = Extract<Node, { type: T }>;

const has = (from: object, key: string): boolean => Object.hasOwn(from, key);

const read = (value: Value, env: Env, nodeId: string, key: string): Slot =>
  evaluate(value, env, { nodeId, key });

const readString = (
  value: Value | undefined,
  env: Env,
  nodeId: string,
  key: string,
): string | null =>
  value === undefined
    ? null
    : asString(read(value, env, nodeId, key), { nodeId, key });

const readNumber = (
  value: Value | undefined,
  env: Env,
  nodeId: string,
  key: string,
): number | null =>
  value === undefined
    ? null
    : asNumber(read(value, env, nodeId, key), { nodeId, key });

/** Whether the node is drawn. An unspecified condition counts as not written. */
const isDrawn = (node: Node, env: Env): boolean => {
  const when = node.when;
  if (when === undefined) return true;
  if (typeof when === "object" && "present" in when) {
    if (!env.props.has(when.present)) throw unresolved(when.present, node.id);
    return env.passed.has(when.present);
  }
  const at = { nodeId: node.id, key: "when" };
  return asBoolean(evaluate(when, env, at), at) ?? true;
};

const sizes = (node: Of<"frame"> | Of<"text"> | Of<"image">) => ({
  width: node.width ?? UNWRITTEN.size,
  height: node.height ?? UNWRITTEN.size,
});

const placed = (node: Node) =>
  node.position === undefined ? {} : { position: node.position };

const frame = (node: Of<"frame">, env: Env): RenderNode => {
  const layout = node.layout;
  const defaults = UNWRITTEN.layout;
  const out: RenderNode = {
    type: "frame",
    source: node.id,
    ...sizes(node),
    ...placed(node),
    layout:
      layout === undefined
        ? { ...defaults }
        : {
            direction: layout.direction,
            gap:
              readNumber(layout.gap, env, node.id, "layout.gap") ??
              defaults.gap,
            padding:
              readNumber(layout.padding, env, node.id, "layout.padding") ??
              defaults.padding,
            align: layout.align ?? defaults.align,
            justify: layout.justify ?? defaults.justify,
          },
    children: [],
  };
  const background = readString(node.background, env, node.id, "background");
  if (background !== null) out.background = background;
  if (node.border !== undefined) {
    const color = readString(node.border.color, env, node.id, "border.color");
    if (color !== null) out.border = { color, width: node.border.width };
  }
  const radius = readNumber(node.radius, env, node.id, "radius");
  if (radius !== null) out.radius = radius;
  out.children = node.children.flatMap((child) => render(child, env));
  return out;
};

const text = (node: Of<"text">, env: Env): RenderNode => {
  const out: RenderNode = {
    type: "text",
    source: node.id,
    ...sizes(node),
    ...placed(node),
    text: readString(node.text, env, node.id, "text") ?? "",
  };
  const color = readString(node.color, env, node.id, "color");
  if (color !== null) out.color = color;
  if (node.typography !== undefined) {
    const at = { nodeId: node.id, key: "typography" };
    const typography = asTypography(evaluate(node.typography, env, at), at);
    if (typography !== null) out.typography = typography;
  }
  return out;
};

const image = (node: Of<"image">, env: Env): RenderNode => {
  for (const key of ["width", "height"] as const) {
    if (node[key] === undefined) {
      throw new Failed({
        code: "size-required",
        nodeId: node.id,
        key,
        message: `image "${node.id}" needs a ${key}`,
      });
    }
  }
  const out: RenderNode = {
    type: "image",
    source: node.id,
    ...sizes(node),
    ...placed(node),
  };
  const radius = readNumber(node.radius, env, node.id, "radius");
  if (radius !== null) out.radius = radius;
  return out;
};

/** The component's declared props, filled from what the instance passed and the defaults. */
const propsOf = (node: Of<"instance">, scope: Scope, env: Env): Env => {
  const component = scope.components[node.component]!;
  const inner: Env = {
    scope,
    props: new Map(),
    passed: new Set(),
    vars: new Map(),
    expanding: [...env.expanding, node.component],
  };
  for (const [name, def] of Object.entries(component.props)) {
    const at = { nodeId: node.id, key: `props.${name}` };
    const given = has(node.props, name)
      ? evaluate(node.props[name]!, env, at)
      : null;
    if (given !== null) {
      inner.props.set(name, given);
      inner.passed.add(name);
    } else if (def.default !== undefined) {
      inner.props.set(
        name,
        evaluate(def.default, { ...inner, props: new Map() }, at),
      );
    } else if (def.required !== true) {
      inner.props.set(name, null);
    }
  }
  return inner;
};

const instance = (node: Of<"instance">, env: Env): RenderNode[] => {
  const scope = env.scope;
  if (!has(scope.components, node.component)) {
    throw unresolved(node.component, node.id);
  }
  if (env.expanding.includes(node.component)) {
    throw unresolved(node.component, node.id);
  }
  const inner = propsOf(node, scope, env);
  const root = scope.components[node.component]!.root;
  return render(root, inner).map((each) => ({
    ...each,
    source: node.id,
    ...placed(node),
  }));
};

const slot = (node: Of<"slot">, env: Env): RenderNode[] => {
  const at = { nodeId: node.id, key: "prop" };
  const passed = asNodes(evaluate({ prop: node.prop }, env, at), at);
  if (passed === null) return [];
  return passed.nodes.flatMap((child) => render(child, passed.env));
};

const repeat = (node: Of<"repeat">, env: Env): RenderNode[] => {
  const at = { nodeId: node.id, key: "each" };
  const items = asArray(evaluate(node.each, env, at), at);
  if (items === null) return [];
  return items.flatMap((item) => {
    const vars = new Map(env.vars).set(node.as, item);
    return node.children.flatMap((child) => render(child, { ...env, vars }));
  });
};

/** The nodes drawn in place of one node: none, one, or several for a slot and a repeat. */
const render = (node: Node, env: Env): RenderNode[] => {
  if (!isDrawn(node, env)) return [];
  switch (node.type) {
    case "frame":
      return [frame(node, env)];
    case "text":
      return [text(node, env)];
    case "image":
      return [image(node, env)];
    case "instance":
      return instance(node, env);
    case "slot":
      return slot(node, env);
    case "repeat":
      return repeat(node, env);
  }
};

export const resolve: Resolve = (tree, scope) => {
  const env: Env = {
    scope,
    props: new Map(),
    passed: new Set(),
    vars: new Map(),
    expanding: [],
  };
  try {
    const [root] = render(tree, env);
    const value: RenderShape = { root: root ?? null };
    return { ok: true, value };
  } catch (error) {
    if (error instanceof Failed) return { ok: false, reasons: [error.failure] };
    throw error;
  }
};
