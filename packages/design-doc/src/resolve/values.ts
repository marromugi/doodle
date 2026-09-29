import type { Node } from "../model/node";
import type { Scope } from "../model/scope";
import { TokenKind, Typography } from "../model/tokens";
import type { Value } from "../model/value";
import type { ResolveFailure } from "./failure";

/** A value with every reference read. A `nodes` value keeps the env it was written in. */
export type Resolved =
  | string
  | number
  | boolean
  | { object: Record<string, Resolved> }
  | { array: Resolved[] }
  | { nodes: Node[]; env: Env }
  | { typography: Typography };

/** A prop that was not passed and has no default. */
export const UNSPECIFIED = Symbol("unspecified");
/** A value that could not be read; the reason is already reported. */
export const FAILED = Symbol("failed");

export type Held = Resolved | typeof UNSPECIFIED;
export type Evaluated = Held | typeof FAILED;

/** Where a value is read: the node and the key inside it. */
export type At = { nodeId: string; key: string };

/** What one tree is resolved against: where it is written and what it can read. */
export type Env = {
  scope: Scope;
  declared: ReadonlySet<string>;
  props: Map<string, Held>;
  passed: Set<string>;
  vars: Map<string, Resolved>;
  owner: string | null;
  /** The outermost page-written instance being expanded, if any. */
  source: string | null;
  /** Defaults not read yet; a default is read the first time it is needed. */
  lazy: Map<string, () => Evaluated>;
  failedProps: Set<string>;
  chain: string[];
  instances: string[];
  out: ResolveFailure[];
};

type WithoutInstances = ResolveFailure extends infer F
  ? F extends unknown
    ? Omit<F, "instances">
    : never
  : never;

const withInstances = (env: Env, failure: WithoutInstances): ResolveFailure =>
  ({ ...failure, instances: env.instances }) as ResolveFailure;

export const report = (env: Env, failure: WithoutInstances): void => {
  env.out.push(withInstances(env, failure));
};

/** Puts a failure among the ones already reported, at `index`. */
export const reportAt = (
  env: Env,
  index: number,
  failure: WithoutInstances,
): void => {
  env.out.splice(index, 0, withInstances(env, failure));
};

export const has = (from: object, key: string): boolean =>
  Object.hasOwn(from, key);

const unresolved = (env: Env, at: At, reference: string): typeof FAILED => {
  report(env, {
    code: "unresolved-reference",
    reference,
    nodeId: at.nodeId,
    message: `"${reference}" cannot be resolved`,
  });
  return FAILED;
};

type Kind = Extract<
  ResolveFailure,
  { code: "value-kind-mismatch" }
>["expected"][number];

const kindOf = (value: Resolved): Kind => {
  if (typeof value !== "object") return typeof value as Kind;
  if ("object" in value) return "object";
  if ("array" in value) return "array";
  if ("nodes" in value) return "nodes";
  return "typography";
};

const mismatch = (env: Env, at: At, expected: Kind[]): typeof FAILED => {
  report(env, {
    code: "value-kind-mismatch",
    nodeId: at.nodeId,
    key: at.key,
    expected,
    message: `"${at.key}" of "${at.nodeId}" needs ${expected.join(" or ")}`,
  });
  return FAILED;
};

const evaluateToken = (ref: string, env: Env, at: At): Evaluated => {
  const dot = ref.indexOf(".");
  const kind = TokenKind.safeParse(ref.slice(0, dot));
  if (dot < 0 || !kind.success) return unresolved(env, at, ref);
  const table: Record<string, string | number | Typography> =
    env.scope.tokens[kind.data];
  const name = ref.slice(dot + 1);
  if (!has(table, name)) return unresolved(env, at, ref);
  const token = table[name]!;
  return typeof token === "object" ? { typography: token } : token;
};

const evaluateVar = (ref: string, env: Env, at: At): Evaluated => {
  const [head, ...path] = ref.split(".") as [string, ...string[]];
  if (!env.vars.has(head)) return unresolved(env, at, ref);
  let current = env.vars.get(head)!;
  for (const step of path) {
    if (typeof current !== "object" || !("object" in current)) {
      return mismatch(env, at, ["object"]);
    }
    if (!has(current.object, step)) return unresolved(env, at, ref);
    current = current.object[step]!;
  }
  return current;
};

/** Reads a default the first time it is needed. A default in a loop stays unread and is unresolved. */
export const settleProp = (name: string, env: Env): Evaluated => {
  if (env.props.has(name)) return env.props.get(name)!;
  if (env.failedProps.has(name)) return FAILED;
  const settle = env.lazy.get(name);
  if (settle === undefined) return FAILED;
  env.lazy.delete(name);
  return settle();
};

const evaluateProp = (name: string, env: Env, at: At): Evaluated =>
  env.props.has(name) || env.failedProps.has(name) || env.lazy.has(name)
    ? settleProp(name, env)
    : unresolved(env, at, name);

const evaluateMatch = (
  value: Extract<Value, { match: string }>,
  env: Env,
  at: At,
): Evaluated => {
  const held = evaluateProp(value.match, env, at);
  if (held === FAILED) return FAILED;
  const fallback = (): Evaluated =>
    value.default === undefined
      ? UNSPECIFIED
      : evaluate(value.default, env, at);
  if (held === UNSPECIFIED) return fallback();
  if (typeof held === "object") {
    return mismatch(env, at, ["string", "number", "boolean"]);
  }
  const text = typeof held === "string" ? held : JSON.stringify(held);
  if (has(value.cases, text)) return evaluate(value.cases[text]!, env, at);
  if (value.default !== undefined) return evaluate(value.default, env, at);
  report(env, {
    code: "no-matching-case",
    nodeId: at.nodeId,
    key: at.key,
    prop: value.match,
    message: `no case of the match on "${value.match}" fits ${text}`,
  });
  return FAILED;
};

/** Reads every reference in `value`. Unspecified parts of an object or an array are left out. */
export const evaluate = (value: Value, env: Env, at: At): Evaluated => {
  if (typeof value !== "object") return value;
  if ("token" in value) return evaluateToken(value.token, env, at);
  if ("prop" in value) return evaluateProp(value.prop, env, at);
  if ("var" in value) return evaluateVar(value.var, env, at);
  if ("match" in value) return evaluateMatch(value, env, at);
  if ("nodes" in value) return { nodes: value.nodes, env };
  const items = "object" in value ? value.object : value.array;
  const read = Object.entries(items).map(
    ([key, item]) => [key, evaluate(item, env, at)] as const,
  );
  if (read.some(([, item]) => item === FAILED)) return FAILED;
  const kept = read.flatMap(([key, item]) =>
    item === UNSPECIFIED || item === FAILED ? [] : [[key, item] as const],
  );
  return "object" in value
    ? { object: Object.fromEntries(kept) }
    : { array: kept.map(([, item]) => item) };
};

/** Reads an optional value. A value that is not written is unspecified. */
export const read = (value: Value | undefined, env: Env, at: At): Evaluated =>
  value === undefined ? UNSPECIFIED : evaluate(value, env, at);

const only =
  <K extends Kind, T>(kind: K, pick: (value: Resolved) => T) =>
  (
    evaluated: Evaluated,
    env: Env,
    at: At,
  ): T | typeof UNSPECIFIED | typeof FAILED => {
    if (evaluated === UNSPECIFIED || evaluated === FAILED) return evaluated;
    return kindOf(evaluated) === kind
      ? pick(evaluated)
      : mismatch(env, at, [kind]);
  };

export const asString = only("string", (value) => value as string);
export const asNumber = only("number", (value) => value as number);
export const asBoolean = only("boolean", (value) => value as boolean);
export const asNodes = only(
  "nodes",
  (value) => value as { nodes: Node[]; env: Env },
);
export const asArray = only(
  "array",
  (value) => (value as { array: Resolved[] }).array,
);

const plain = (value: Resolved): unknown => {
  if (typeof value !== "object") return value;
  if ("object" in value) {
    return Object.fromEntries(
      Object.entries(value.object).map(([key, item]) => [key, plain(item)]),
    );
  }
  return undefined;
};

export const asTypography = (
  evaluated: Evaluated,
  env: Env,
  at: At,
): Typography | typeof UNSPECIFIED | typeof FAILED => {
  if (evaluated === UNSPECIFIED || evaluated === FAILED) return evaluated;
  if (typeof evaluated === "object" && "typography" in evaluated) {
    return evaluated.typography;
  }
  const parsed = Typography.safeParse(plain(evaluated));
  return parsed.success ? parsed.data : mismatch(env, at, ["typography"]);
};
