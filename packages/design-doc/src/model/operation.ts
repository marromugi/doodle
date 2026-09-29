import * as z from "zod";

import { Node } from "./node";
import { PropDef } from "./props";
import { Component } from "./scope";
import { Typography } from "./tokens";
import { Value } from "./value";

const base = z.number().int().nonnegative();

export const EditOperation = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("add"),
    base,
    parent: z.string(),
    index: z.number().int().nonnegative(),
    node: Node,
  }),
  z.strictObject({
    type: z.literal("set"),
    base,
    node: z.string(),
    key: z.string(),
    value: Value.nullable(),
  }),
  z.strictObject({ type: z.literal("remove"), base, node: z.string() }),
  z.strictObject({
    type: z.literal("move"),
    base,
    node: z.string(),
    parent: z.string(),
    index: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.enum(["add-token", "change-token"]),
    base,
    token: z.string(),
    value: z.union([z.string(), z.number(), Typography]),
  }),
  z.strictObject({
    type: z.literal("remove-token"),
    base,
    token: z.string(),
  }),
  z.strictObject({
    type: z.literal("add-component"),
    base,
    id: z.string(),
    component: Component,
  }),
  z.strictObject({
    type: z.literal("remove-component"),
    base,
    id: z.string(),
  }),
  z.strictObject({
    type: z.literal("rename-component"),
    base,
    id: z.string(),
    to: z.string(),
  }),
  z.strictObject({
    type: z.enum(["add-prop", "change-prop"]),
    base,
    component: z.string(),
    name: z.string(),
    def: PropDef,
  }),
  z.strictObject({
    type: z.literal("remove-prop"),
    base,
    component: z.string(),
    name: z.string(),
  }),
]);
export type EditOperation = z.infer<typeof EditOperation>;

export const SwitchReleaseOperation = z.strictObject({
  type: z.literal("switch-release"),
  base,
  release: z.string(),
  fixes: z.array(EditOperation),
});
export type SwitchReleaseOperation = z.infer<typeof SwitchReleaseOperation>;

export const Operation = z.union([EditOperation, SwitchReleaseOperation]);
export type Operation = z.infer<typeof Operation>;
