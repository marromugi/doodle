import { applyUnvalidated } from "../apply/apply";
import { diff } from "../diff/diff";
import type { TreeDocument } from "../model/document";
import type { Rebase } from "../roles";
import { validate } from "../validate/validate";

/** Applies `fixes` in order, checks what remains against `newScope`, then validates the result. */
export const rebase: Rebase = (doc, oldScope, newScope, fixes) => {
  let current: TreeDocument = doc;
  for (const [index, fix] of fixes.entries()) {
    if (fix.base !== doc.revision) {
      return {
        ok: false,
        reason: {
          code: "fix-failed",
          index,
          reasons: [
            {
              code: "conflict",
              latestRevision: doc.revision,
              message: `fix ${index} was read at revision ${fix.base} but the document is at revision ${doc.revision}`,
            },
          ],
        },
      };
    }
    const step = applyUnvalidated(current, { ...fix, base: current.revision });
    if (!step.ok) {
      return {
        ok: false,
        reason: { code: "fix-failed", index, reasons: step.reasons },
      };
    }
    current = step.value;
  }

  const remaining = diff(current, oldScope, newScope);
  if (remaining.length > 0) {
    return { ok: false, reason: { code: "remaining", remaining } };
  }
  const reasons = validate(current, newScope);
  if (reasons.length > 0) {
    return { ok: false, reason: { code: "invalid", reasons } };
  }
  return { ok: true, value: current };
};
