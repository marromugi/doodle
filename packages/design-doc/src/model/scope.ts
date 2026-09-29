import * as z from "zod";

import { Node } from "./node";
import { PropDef } from "./props";
import { Tokens } from "./tokens";

export const Component = z.strictObject({
  name: z.string(),
  props: z.record(z.string(), PropDef),
  root: Node,
});
export type Component = z.infer<typeof Component>;

export const Scope = z.strictObject({
  tokens: Tokens,
  components: z.record(z.string(), Component),
});
export type Scope = z.infer<typeof Scope>;
