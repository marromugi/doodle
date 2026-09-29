import type { PropDef, PropType } from "../model/props";
import type { Value } from "../model/value";

export const has = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

type Typed = PropType | PropDef;

const sameType = (from: Typed, to: Typed): boolean => {
  if (from.type === "enum" && to.type === "string") return true;
  if (from.type !== to.type) return false;
  if (from.type === "enum" && to.type === "enum") {
    return from.values.every((v) => to.values.includes(v));
  }
  if (from.type === "token" && to.type === "token") {
    return to.kind === undefined || from.kind === to.kind;
  }
  if (from.type === "array" && to.type === "array") {
    return sameType(from.of, to.of);
  }
  if (from.type === "object" && to.type === "object") {
    const given = from.fields;
    const fields = to.fields;
    return (
      Object.keys(given).every(
        (key) => has(fields, key) && sameType(given[key]!, fields[key]!),
      ) &&
      Object.keys(fields).every(
        (key) =>
          fields[key]!.required !== true || given[key]?.required === true,
      )
    );
  }
  return true;
};

/**
 * Whether `value` can be passed to a prop of `type`. `props` are the
 * enclosing component's props, used to read the type of a `{ prop }` value.
 * A `{ var }` cannot be typed here and is accepted.
 */
export const matchesType = (
  value: Value,
  type: Typed,
  props: Record<string, PropDef> | null,
): boolean => {
  if (typeof value !== "object") {
    switch (type.type) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number";
      case "boolean":
        return typeof value === "boolean";
      case "enum":
        return typeof value === "string" && type.values.includes(value);
      default:
        return false;
    }
  }
  if ("var" in value) return true;
  if ("prop" in value) {
    const source =
      props !== null && has(props, value.prop) ? props[value.prop] : undefined;
    return source === undefined || sameType(source, type);
  }
  if ("match" in value) {
    const branches = Object.values(value.cases);
    if (value.default !== undefined) branches.push(value.default);
    return branches.every((branch) => matchesType(branch, type, props));
  }
  if ("token" in value) {
    return (
      type.type === "token" &&
      (type.kind === undefined || value.token.startsWith(`${type.kind}.`))
    );
  }
  if ("nodes" in value) return type.type === "node";
  if ("array" in value) {
    return (
      type.type === "array" &&
      value.array.every((item) => matchesType(item, type.of, props))
    );
  }
  if ("object" in value) {
    if (type.type !== "object") return false;
    const given = value.object;
    const fields = type.fields;
    return (
      Object.keys(given).every(
        (key) =>
          has(fields, key) && matchesType(given[key]!, fields[key]!, props),
      ) &&
      Object.keys(fields).every(
        (key) => fields[key]!.required !== true || has(given, key),
      )
    );
  }
  return false;
};
