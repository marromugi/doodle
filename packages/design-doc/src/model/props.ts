import * as z from "zod";

import { TokenKind } from "./tokens";
import { Value } from "./value";

const ScalarType = z.enum(["string", "number", "boolean", "node"]);

export const PropType = z.discriminatedUnion("type", [
  z.strictObject({ type: ScalarType }),
  z.strictObject({
    type: z.literal("enum"),
    values: z.array(z.string()).min(1),
  }),
  z.strictObject({ type: z.literal("token"), kind: TokenKind.optional() }),
  z.strictObject({
    type: z.literal("object"),
    get fields() {
      return z.record(z.string(), PropDefShape);
    },
  }),
  z.strictObject({
    type: z.literal("array"),
    get of() {
      return PropType;
    },
  }),
]);
export type PropType = z.infer<typeof PropType>;

const required = z.literal(true).optional();

const PropDefShape = z.discriminatedUnion("type", [
  z.strictObject({
    type: ScalarType,
    required,
    get default() {
      return Value.optional();
    },
  }),
  z.strictObject({
    type: z.literal("enum"),
    values: z.array(z.string()).min(1),
    required,
    get default() {
      return Value.optional();
    },
  }),
  z.strictObject({
    type: z.literal("token"),
    kind: TokenKind.optional(),
    required,
    get default() {
      return Value.optional();
    },
  }),
  z.strictObject({
    type: z.literal("object"),
    get fields() {
      return z.record(z.string(), PropDefShape);
    },
    required,
    get default() {
      return Value.optional();
    },
  }),
  z.strictObject({
    type: z.literal("array"),
    get of() {
      return PropType;
    },
    required,
    get default() {
      return Value.optional();
    },
  }),
]);
type PropDefShape = z.infer<typeof PropDefShape>;

const typeIsExclusive = (type: PropType): boolean => {
  if (type.type === "object") {
    return Object.values(type.fields).every(defIsExclusive);
  }
  if (type.type === "array") return typeIsExclusive(type.of);
  return true;
};

const defIsExclusive = (def: PropDefShape): boolean => {
  if (def.required === true && def.default !== undefined) return false;
  if (def.type === "object") {
    return Object.values(def.fields).every(defIsExclusive);
  }
  if (def.type === "array") return typeIsExclusive(def.of);
  return true;
};

export const PropDef = PropDefShape.refine(defIsExclusive, {
  message: "a prop is required or has a default, not both",
});
export type PropDef = z.infer<typeof PropDef>;
