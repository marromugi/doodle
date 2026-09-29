import type { PropDef } from "../model/props";
import type { Value } from "../model/value";
import type { PropsFailure } from "./failure";
import { fitsPropType, has } from "./type";

/** Checks the props passed to an instance against the component's prop definitions. */
export const checkInstanceProps = (input: {
  nodeId: string;
  component: string;
  props: Record<string, Value>;
  defs: Record<string, PropDef>;
  enclosing: Record<string, PropDef> | null;
}): PropsFailure[] => {
  const { nodeId, component, props, defs, enclosing } = input;
  const out: PropsFailure[] = [];
  for (const [name, def] of Object.entries(defs)) {
    if (def.required === true && !has(props, name)) {
      out.push({
        code: "missing-required-prop",
        prop: name,
        message: `required prop "${name}" is missing`,
        nodeId,
      });
    }
  }
  for (const [name, value] of Object.entries(props)) {
    if (!has(defs, name)) {
      out.push({
        code: "unknown-prop",
        prop: name,
        message: `"${name}" is not a prop of "${component}"`,
        nodeId,
      });
    } else if (!fitsPropType(value, defs[name]!, enclosing)) {
      out.push({
        code: "prop-type-mismatch",
        prop: name,
        message: `the value of "${name}" does not match its type`,
        nodeId,
      });
    }
  }
  return out;
};
