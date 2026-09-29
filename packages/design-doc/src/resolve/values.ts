import type { Node } from "../model/node";
import type { Scope } from "../model/scope";
import type { Typography } from "../model/tokens";
import type { Value } from "../model/value";
import type { ResolveFailure } from "./failure";

/** A value with every reference resolved. `nodes` keeps the environment its nodes were written in. */
export type Concrete =
  | string
  | number
  | boolean
  | { kind: "object"; fields: Record<string, Concrete> }
  | { kind: "array"; items: Concrete[] }
  | { kind: "nodes"; nodes: Node[]; env: Env }
  | { kind: "typography"; value: Typography };

/** `null` is a prop that was not specified. */
export type Slot = Concrete | null;

export type Env = {
  scope: Scope;
  /** Declared props of the enclosing component; empty outside a component. */
  props: Map<string, Slot>;
  /** Names of the props the instance passed. */
  passed: Set<string>;
  vars: Map<string, Concrete>;
  /** IDs of the components being expanded, outermost first. */
  expanding: string[];
};

/** Where a value is read: the node and the key inside it. */
export type At = { nodeId: string; key: string };

type Kind = Extract<
  ResolveFailure,
  { code: "value-kind-mismatch" }
>["expected"];

/** Thrown inside the role and turned into a returned failure at its boundary. */
export class Failed extends Error {
  constructor(readonly failure: ResolveFailure) {
    super(failure.message);
  }
}

export const unresolved = (reference: string, nodeId: string): Failed =>
  new Failed({
    code: "unresolved-reference",
    reference,
    nodeId,
    message: `"${reference}" cannot be resolved in node "${nodeId}"`,
  });

const mismatch = (at: At, expected: Kind): Failed =>
  new Failed({
    code: "value-kind-mismatch",
    nodeId: at.nodeId,
    key: at.key,
    expected,
    message: `"${at.key}" of node "${at.nodeId}" needs ${expected.join(" or ")}`,
  });

const has = <T extends object>(from: T, key: string): boolean =>
  Object.hasOwn(from, key);

const isObject = (
  value: Concrete,
): value is Extract<Concrete, { kind: "object" }> =>
  typeof value === "object" && value.kind === "object";

const readToken = (reference: string, env: Env, at: At): Concrete => {
  const dot = reference.indexOf(".");
  const kind = reference.slice(0, dot);
  const name = reference.slice(dot + 1);
  const tokens = env.scope.tokens;
  if (dot < 0 || !has(tokens, kind)) throw unresolved(reference, at.nodeId);
  const group: Record<string, string | number | Typography> =
    tokens[kind as keyof typeof tokens];
  if (!has(group, name)) throw unresolved(reference, at.nodeId);
  const found = group[name]!;
  return typeof found === "object"
    ? { kind: "typography", value: found }
    : found;
};

const readProp = (name: string, env: Env, at: At): Slot => {
  const slot = env.props.get(name);
  if (slot === undefined) throw unresolved(name, at.nodeId);
  return slot;
};

const readVar = (path: string, env: Env, at: At): Concrete => {
  const [name, ...steps] = path.split(".");
  let current = env.vars.get(name!);
  if (current === undefined) throw unresolved(path, at.nodeId);
  for (const step of steps) {
    if (!isObject(current)) throw mismatch(at, ["object"]);
    if (!has(current.fields, step)) throw unresolved(path, at.nodeId);
    current = current.fields[step]!;
  }
  return current;
};

const readMatch = (
  value: Extract<Value, { match: string }>,
  env: Env,
  at: At,
): Slot => {
  const read = readProp(value.match, env, at);
  if (read === null) {
    return value.default === undefined
      ? null
      : evaluate(value.default, env, at);
  }
  if (typeof read === "object") {
    throw mismatch(at, ["string", "number", "boolean"]);
  }
  const text = typeof read === "string" ? read : JSON.stringify(read);
  if (has(value.cases, text)) return evaluate(value.cases[text]!, env, at);
  if (value.default !== undefined) return evaluate(value.default, env, at);
  throw new Failed({
    code: "no-matching-case",
    nodeId: at.nodeId,
    key: at.key,
    prop: value.match,
    message: `"${value.match}" has no case for ${text} in "${at.key}" of node "${at.nodeId}"`,
  });
};

/** Resolves every reference in a value. Returns null when the value is an unspecified prop. */
export const evaluate = (value: Value, env: Env, at: At): Slot => {
  if (typeof value !== "object") return value;
  if ("token" in value) return readToken(value.token, env, at);
  if ("prop" in value) return readProp(value.prop, env, at);
  if ("var" in value) return readVar(value.var, env, at);
  if ("match" in value) return readMatch(value, env, at);
  if ("nodes" in value) return { kind: "nodes", nodes: value.nodes, env };
  if ("array" in value) {
    const items = value.array
      .map((item) => evaluate(item, env, at))
      .filter((item) => item !== null);
    return { kind: "array", items };
  }
  const fields: Record<string, Concrete> = {};
  for (const [key, field] of Object.entries(value.object)) {
    const resolved = evaluate(field, env, at);
    if (resolved !== null) fields[key] = resolved;
  }
  return { kind: "object", fields };
};

export const asString = (slot: Slot, at: At): string | null => {
  if (slot === null || typeof slot === "string") return slot;
  throw mismatch(at, ["string"]);
};

export const asNumber = (slot: Slot, at: At): number | null => {
  if (slot === null || typeof slot === "number") return slot;
  throw mismatch(at, ["number"]);
};

export const asBoolean = (slot: Slot, at: At): boolean | null => {
  if (slot === null || typeof slot === "boolean") return slot;
  throw mismatch(at, ["boolean"]);
};

export const asTypography = (slot: Slot, at: At): Typography | null => {
  if (slot === null) return null;
  if (typeof slot === "object" && slot.kind === "typography") {
    return slot.value;
  }
  throw mismatch(at, ["typography"]);
};

export const asNodes = (
  slot: Slot,
  at: At,
): Extract<Concrete, { kind: "nodes" }> | null => {
  if (slot === null) return null;
  if (typeof slot === "object" && slot.kind === "nodes") return slot;
  throw mismatch(at, ["nodes"]);
};

export const asArray = (slot: Slot, at: At): Concrete[] | null => {
  if (slot === null) return null;
  if (typeof slot === "object" && slot.kind === "array") return slot.items;
  throw mismatch(at, ["array"]);
};
