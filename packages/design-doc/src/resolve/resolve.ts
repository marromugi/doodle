import type { Node } from "../model/node";
import type { RenderNode } from "../model/render";
import { UNWRITTEN } from "../model/render";
import type { Resolve } from "../roles";
import {
  asArray,
  asBoolean,
  asNodes,
  asNumber,
  asString,
  asTypography,
  evaluate,
  FAILED,
  has,
  read,
  report,
  reportAt,
  settleProp,
  UNSPECIFIED,
  type Env,
  type Resolved,
} from "./values";

type Of<T extends Node["type"]> = Extract<Node, { type: T }>;

const written = <T>(value: T | typeof UNSPECIFIED | typeof FAILED) =>
  typeof value === "symbol" ? undefined : value;

const placed = (node: Node) =>
  node.position === undefined ? {} : { position: node.position };

/** Whether the node is drawn. A condition that cannot be read counts as drawn. */
const isDrawn = (node: Node, env: Env): boolean => {
  const when = node.when;
  if (when === undefined) return true;
  if (typeof when === "object" && "present" in when) {
    if (env.declared.has(when.present)) return env.passed.has(when.present);
    report(env, {
      code: "unresolved-reference",
      reference: when.present,
      nodeId: node.id,
      message: `"${when.present}" is not a prop of the component`,
    });
    return true;
  }
  const at = { nodeId: node.id, key: "when" };
  return written(asBoolean(evaluate(when, env, at), env, at)) ?? true;
};

const frame = (node: Of<"frame">, env: Env): RenderNode => {
  const layout = node.layout;
  const defaults = UNWRITTEN.layout;
  const number = (value: typeof node.radius, key: string) => {
    const at = { nodeId: node.id, key };
    return written(asNumber(read(value, env, at), env, at));
  };
  const gap = number(layout?.gap, "layout.gap");
  const padding = number(layout?.padding, "layout.padding");
  const backgroundAt = { nodeId: node.id, key: "background" };
  const background = written(
    asString(read(node.background, env, backgroundAt), env, backgroundAt),
  );
  const borderAt = { nodeId: node.id, key: "border.color" };
  const borderColor =
    node.border === undefined
      ? undefined
      : written(
          asString(read(node.border.color, env, borderAt), env, borderAt),
        );
  const radius = number(node.radius, "radius");
  return {
    type: "frame",
    source: env.source ?? node.id,
    width: node.width ?? UNWRITTEN.size,
    height: node.height ?? UNWRITTEN.size,
    ...placed(node),
    layout:
      layout === undefined
        ? { ...defaults }
        : {
            direction: layout.direction,
            gap: gap ?? defaults.gap,
            padding: padding ?? defaults.padding,
            align: layout.align ?? defaults.align,
            justify: layout.justify ?? defaults.justify,
          },
    ...(background === undefined ? {} : { background }),
    ...(node.border === undefined || borderColor === undefined
      ? {}
      : { border: { color: borderColor, width: node.border.width } }),
    ...(radius === undefined ? {} : { radius }),
    children: node.children.flatMap((child) => render(child, env)),
  };
};

const text = (node: Of<"text">, env: Env): RenderNode => {
  const textAt = { nodeId: node.id, key: "text" };
  const content = written(
    asString(evaluate(node.text, env, textAt), env, textAt),
  );
  const colorAt = { nodeId: node.id, key: "color" };
  const color = written(asString(read(node.color, env, colorAt), env, colorAt));
  const typographyAt = { nodeId: node.id, key: "typography" };
  const typography = written(
    asTypography(read(node.typography, env, typographyAt), env, typographyAt),
  );
  return {
    type: "text",
    source: env.source ?? node.id,
    width: node.width ?? UNWRITTEN.size,
    height: node.height ?? UNWRITTEN.size,
    ...placed(node),
    text: content ?? "",
    ...(color === undefined ? {} : { color }),
    ...(typography === undefined ? {} : { typography }),
  };
};

const image = (node: Of<"image">, env: Env): RenderNode => {
  for (const key of ["width", "height"] as const) {
    if (node[key] === undefined) {
      report(env, {
        code: "size-required",
        nodeId: node.id,
        key,
        message: `image "${node.id}" needs a ${key}`,
      });
    }
  }
  const at = { nodeId: node.id, key: "radius" };
  const radius = written(asNumber(read(node.radius, env, at), env, at));
  return {
    type: "image",
    source: env.source ?? node.id,
    width: node.width ?? UNWRITTEN.size,
    height: node.height ?? UNWRITTEN.size,
    ...placed(node),
    ...(radius === undefined ? {} : { radius }),
  };
};

/** Gives a slot or a repeat's position to what it drew, or reports that it cannot. */
const positionDrawn = (
  node: Of<"slot"> | Of<"repeat">,
  drawn: RenderNode[],
  start: number,
  env: Env,
): RenderNode[] => {
  if (node.position === undefined || drawn.length === 0) return drawn;
  if (drawn.length > 1) {
    reportAt(env, start, {
      code: "several-at-position",
      nodeId: node.id,
      count: drawn.length,
      message: `"${node.id}" has a position but drew ${drawn.length} nodes`,
    });
    return drawn;
  }
  const [only] = drawn as [RenderNode];
  if (only.position !== undefined) {
    reportAt(env, start, {
      code: "position-conflict",
      nodeId: node.id,
      message: `"${node.id}" and the node it drew both have a position`,
    });
    return drawn;
  }
  return [{ ...only, position: node.position }];
};

const slot = (node: Of<"slot">, env: Env): RenderNode[] => {
  const at = { nodeId: node.id, key: "prop" };
  const passed = written(
    asNodes(evaluate({ prop: node.prop }, env, at), env, at),
  );
  if (passed === undefined) return [];
  const start = env.out.length;
  const drawn = passed.nodes.flatMap((child) => render(child, passed.env));
  return positionDrawn(node, drawn, start, env);
};

const repeat = (node: Of<"repeat">, env: Env): RenderNode[] => {
  const at = { nodeId: node.id, key: "each" };
  const items = written(asArray(evaluate(node.each, env, at), env, at));
  if (items === undefined) return [];
  const start = env.out.length;
  const drawn = items.flatMap((item) => {
    const vars = new Map(env.vars).set(node.as, item);
    return node.children.flatMap((child) => render(child, { ...env, vars }));
  });
  return positionDrawn(node, drawn, start, env);
};

/** The instance's own position replaces the component root's. */
const positionInstance = (
  node: Of<"instance">,
  drawn: RenderNode[],
  start: number,
  env: Env,
): RenderNode[] => {
  if (drawn.length === 1) {
    const one: RenderNode = { ...drawn[0]! };
    delete one.position;
    return [{ ...one, ...placed(node) }];
  }
  if (node.position !== undefined && drawn.length > 1) {
    reportAt(env, start, {
      code: "several-at-position",
      nodeId: node.id,
      count: drawn.length,
      message: `"${node.id}" has a position but drew ${drawn.length} nodes`,
    });
  }
  return drawn;
};

const instance = (node: Of<"instance">, env: Env): RenderNode[] => {
  const component = has(env.scope.components, node.component)
    ? env.scope.components[node.component]
    : undefined;
  let expandable = component !== undefined;
  if (component === undefined) {
    report(env, {
      code: "unresolved-reference",
      reference: node.component,
      nodeId: node.id,
      message: `component "${node.component}" is not in the scope`,
    });
  } else if (env.owner !== null && env.chain.includes(node.component)) {
    expandable = false;
    report(env, {
      code: "component-cycle",
      nodeId: node.id,
      component: node.component,
      message: `"${node.component}" is already being expanded`,
    });
  }

  const given = new Map<string, Resolved>();
  for (const [name, value] of Object.entries(node.props)) {
    const at = { nodeId: node.id, key: `props.${name}` };
    const passed = evaluate(value, env, at);
    if (passed === FAILED) expandable = false;
    else if (passed !== UNSPECIFIED) given.set(name, passed);
  }
  if (component === undefined || !expandable) return [];

  const inner: Env = {
    scope: env.scope,
    declared: new Set(Object.keys(component.props)),
    props: new Map(),
    passed: new Set(),
    vars: new Map(),
    owner: node.component,
    source: env.source ?? node.id,
    lazy: new Map(),
    failedProps: new Set(),
    chain: [...env.chain, node.component],
    instances: [...env.instances, node.id],
    out: env.out,
  };
  for (const name of Object.keys(component.props)) {
    if (given.has(name)) {
      inner.props.set(name, given.get(name)!);
      inner.passed.add(name);
    }
  }
  const start = env.out.length;
  for (const [name, def] of Object.entries(component.props)) {
    if (inner.passed.has(name)) continue;
    if (def.default !== undefined) {
      const value = def.default;
      inner.lazy.set(name, () => {
        const at = { nodeId: component.root.id, key: `props.${name}` };
        const result = evaluate(value, inner, at);
        if (result === FAILED) {
          inner.failedProps.add(name);
          inner.props.set(name, UNSPECIFIED);
        } else {
          inner.props.set(name, result);
        }
        return result;
      });
    } else if (def.required !== true) {
      inner.props.set(name, UNSPECIFIED);
    }
  }
  for (const name of [...inner.lazy.keys()]) settleProp(name, inner);
  if (inner.failedProps.size > 0) return [];

  return positionInstance(node, render(component.root, inner), start, env);
};

/** The nodes drawn in place of one node: none, one, or several. */
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
    declared: new Set(),
    props: new Map(),
    passed: new Set(),
    vars: new Map(),
    owner: null,
    source: null,
    lazy: new Map(),
    failedProps: new Set(),
    chain: [],
    instances: [],
    out: [],
  };
  const drawn = render(tree, env);
  if (drawn.length > 1) {
    reportAt(env, 0, {
      code: "several-roots",
      nodeId: tree.id,
      count: drawn.length,
      message: `"${tree.id}" drew ${drawn.length} nodes but a tree has one root`,
    });
  }
  if (env.out.length > 0) return { ok: false, reasons: env.out };
  return { ok: true, value: { root: drawn[0] ?? null } };
};
