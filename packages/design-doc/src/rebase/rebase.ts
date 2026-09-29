import { applyUnvalidated } from "../apply/apply";
import { diff } from "../diff/diff";
import type { TreeDocument } from "../model/document";
import type { EditOperation } from "../model/operation";
import type { Scope } from "../model/scope";
import type { Rebase } from "../roles";
import { validate } from "../validate/validate";

/** Applies every fix without validating in between, then requires no discrepancy and a valid document. */
export const rebase: Rebase = (
  doc: TreeDocument,
  oldScope: Scope,
  newScope: Scope,
  fixes: EditOperation[],
) => {
  let fixed = doc;
  for (const [index, fix] of fixes.entries()) {
    const step = applyUnvalidated(fixed, fix);
    if (!step.ok) {
      return {
        ok: false,
        reason: { code: "fix-failed", index, reasons: step.reasons },
      };
    }
    fixed = step.value;
  }

  const remaining = diff(fixed, oldScope, newScope);
  if (remaining.length > 0) {
    return { ok: false, reason: { code: "remaining", remaining } };
  }

  const reasons = validate(fixed, newScope);
  if (reasons.length > 0) {
    return { ok: false, reason: { code: "invalid", reasons } };
  }
  return { ok: true, value: fixed };
};
