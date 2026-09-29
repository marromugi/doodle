import * as z from "zod";

import { Position, Size } from "./node";
import { Typography } from "./tokens";

export const RenderLayout = z.strictObject({
  direction: z.enum(["row", "column"]),
  gap: z.number(),
  padding: z.number(),
  align: z.enum(["start", "center", "end", "stretch"]),
  justify: z.enum(["start", "center", "end", "space-between"]),
});
export type RenderLayout = z.infer<typeof RenderLayout>;

const Frame = z.strictObject({
  type: z.literal("frame"),
  source: z.string(),
  width: Size,
  height: Size,
  position: Position.optional(),
  layout: RenderLayout,
  background: z.string().optional(),
  border: z.strictObject({ color: z.string(), width: z.number() }).optional(),
  radius: z.number().optional(),
  get children() {
    return z.array(RenderNode);
  },
});

const Text = z.strictObject({
  type: z.literal("text"),
  source: z.string(),
  width: Size,
  height: Size,
  position: Position.optional(),
  text: z.string(),
  color: z.string().optional(),
  typography: Typography.optional(),
});

const Image = z.strictObject({
  type: z.literal("image"),
  source: z.string(),
  width: Size,
  height: Size,
  position: Position.optional(),
  radius: z.number().optional(),
});

export const RenderNode = z.discriminatedUnion("type", [Frame, Text, Image]);
export type RenderNode = z.infer<typeof RenderNode>;

export const RenderShape = z.strictObject({ root: RenderNode.nullable() });
export type RenderShape = z.infer<typeof RenderShape>;

export const UNWRITTEN = {
  size: "hug",
  layout: {
    direction: "row",
    gap: 0,
    padding: 0,
    align: "start",
    justify: "start",
  },
} as const satisfies { size: Size; layout: RenderLayout };
