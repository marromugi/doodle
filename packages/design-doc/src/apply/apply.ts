import type { DraftDocument, TreeDocument } from "../model/document";
import type { EditOperation } from "../model/operation";
import type { Scope } from "../model/scope";
import type { Apply, Result } from "../roles";
import { validate } from "../validate/validate";
import { draftStep } from "./draft-step";
import type { ApplyFailure } from "./failure";
import { treeStep } from "./tree-step";

export type ApplyStep = {
  (doc: TreeDocument, op: EditOperation): Result<TreeDocument, ApplyFailure>;
  (doc: DraftDocument, op: EditOperation): Result<DraftDocument, ApplyFailure>;
};

/** Applies the operation without validating the result. */
export const applyStep: ApplyStep = (
  doc: TreeDocument | DraftDocument,
  op: EditOperation,
): Result<TreeDocument, ApplyFailure> & Result<DraftDocument, ApplyFailure> =>
  (doc.kind === "draft" ? draftStep(doc, op) : treeStep(doc, op)) as never;

export const apply: Apply = (
  doc: TreeDocument | DraftDocument,
  op: EditOperation,
  scope?: Scope,
): never => {
  const stepped: Result<TreeDocument | DraftDocument, ApplyFailure> = applyStep(
    doc as TreeDocument,
    op,
  );
  if (!stepped.ok) return stepped as never;
  const value = stepped.value;
  const failures =
    value.kind === "draft" ? validate(value) : validate(value, scope!);
  return (
    failures.length > 0 ? { ok: false, reasons: failures } : stepped
  ) as never;
};
