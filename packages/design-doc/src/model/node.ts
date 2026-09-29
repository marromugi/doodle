import * as z from "zod";

import { Value } from "./value";

export const Size = z.union([z.literal("hug"), z.literal("fill"), z.number()]);
export type Size = z.infer<typeof Size>;

export const Position = z.strictObject({ x: z.number(), y: z.number() });
export type Position = z.infer<typeof Position>;

export const Condition = z.lazy(() =>
  z.union([z.strictObject({ present: z.string() }), Value]),
);
export type Condition = z.infer<typeof Condition>;

export const Layout = z.strictObject({
  direction: z.enum(["row", "column"]),
  get gap() {
    return Value.optional();
  },
  get padding() {
    return Value.optional();
  },
  align: z.enum(["start", "center", "end", "stretch"]).optional(),
  justify: z.enum(["start", "center", "end", "space-between"]).optional(),
});
export type Layout = z.infer<typeof Layout>;

export const Border = z.strictObject({
  get color() {
    return Value;
  },
  width: z.number(),
});
export type Border = z.infer<typeof Border>;

const Frame = z.strictObject({
  type: z.literal("frame"),
  id: z.string(),
  get when() {
    return Condition.optional();
  },
  position: Position.optional(),
  layout: Layout.optional(),
  width: Size.optional(),
  height: Size.optional(),
  get background() {
    return Value.optional();
  },
  border: Border.optional(),
  get radius() {
    return Value.optional();
  },
  get children() {
    return z.array(Node);
  },
});

const Text = z.strictObject({
  type: z.literal("text"),
  id: z.string(),
  get when() {
    return Condition.optional();
  },
  position: Position.optional(),
  get text() {
    return Value;
  },
  get color() {
    return Value.optional();
  },
  get typography() {
    return Value.optional();
  },
  width: Size.optional(),
  height: Size.optional(),
});

const Image = z.strictObject({
  type: z.literal("image"),
  id: z.string(),
  get when() {
    return Condition.optional();
  },
  position: Position.optional(),
  width: Size.optional(),
  height: Size.optional(),
  get radius() {
    return Value.optional();
  },
});

const Instance = z.strictObject({
  type: z.literal("instance"),
  id: z.string(),
  get when() {
    return Condition.optional();
  },
  position: Position.optional(),
  component: z.string(),
  get props() {
    return z.record(z.string(), Value);
  },
});

const Slot = z.strictObject({
  type: z.literal("slot"),
  id: z.string(),
  get when() {
    return Condition.optional();
  },
  position: Position.optional(),
  prop: z.string(),
});

const Repeat = z.strictObject({
  type: z.literal("repeat"),
  id: z.string(),
  get when() {
    return Condition.optional();
  },
  position: Position.optional(),
  each: z.union([
    z.strictObject({ prop: z.string() }),
    z.strictObject({ var: z.string() }),
  ]),
  as: z.string(),
  get children() {
    return z.array(Node);
  },
});

export const Node = z.discriminatedUnion("type", [
  Frame,
  Text,
  Image,
  Instance,
  Slot,
  Repeat,
]);
export type Node = z.infer<typeof Node>;
