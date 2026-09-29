import * as z from "zod";

import { Node } from "./node";
import { Component } from "./scope";
import { Tokens } from "./tokens";

export const ReleaseRef = z.strictObject({
  designSystem: z.string(),
  release: z.string(),
});
export type ReleaseRef = z.infer<typeof ReleaseRef>;

export const History = z.strictObject({
  nodes: z.record(z.string(), z.number()),
  tokens: z.record(z.string(), z.number()),
  components: z.record(z.string(), z.number()),
  nodeIds: z.array(z.string()),
});
export type History = z.infer<typeof History>;

export const TreeDocument = z.strictObject({
  kind: z.literal("tree"),
  revision: z.number().int().nonnegative(),
  release: ReleaseRef.nullable(),
  root: Node,
  history: History,
});
export type TreeDocument = z.infer<typeof TreeDocument>;

export const DraftDocument = z
  .strictObject({
    kind: z.literal("draft"),
    revision: z.number().int().nonnegative(),
    tokens: Tokens,
    components: z.record(z.string(), Component),
    history: History,
  })
  .refine(
    (doc) => {
      const names = Object.values(doc.components).map((c) => c.name);
      return new Set(names).size === names.length;
    },
    { message: "component names must be unique", path: ["components"] },
  );
export type DraftDocument = z.infer<typeof DraftDocument>;

export const Document = z.discriminatedUnion("kind", [
  TreeDocument,
  DraftDocument,
]);
export type Document = z.infer<typeof Document>;
