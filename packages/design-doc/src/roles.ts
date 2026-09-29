import type { ApplyFailure } from "./apply/failure";
import type { Discrepancy } from "./model/discrepancy";
import type { Document, DraftDocument, TreeDocument } from "./model/document";
import type { Node } from "./model/node";
import type { EditOperation } from "./model/operation";
import type { RenderShape } from "./model/render";
import type { Scope } from "./model/scope";
import type { Summary } from "./model/summary";
import type { RebaseFailure } from "./rebase/failure";
import type { ResolveFailure } from "./resolve/failure";
import type { ValidateFailure } from "./validate/failure";

export type Result<T, F> = { ok: true; value: T } | { ok: false; reasons: F[] };

export type Validate = {
  (doc: TreeDocument, scope: Scope): ValidateFailure[];
  (doc: DraftDocument): ValidateFailure[];
};

export type Apply = {
  (
    doc: TreeDocument,
    op: EditOperation,
    scope: Scope,
  ): Result<TreeDocument, ApplyFailure>;
  (doc: DraftDocument, op: EditOperation): Result<DraftDocument, ApplyFailure>;
};

export type Resolve = (
  tree: Node,
  scope: Scope,
) => Result<RenderShape, ResolveFailure>;

export type Diff = (
  doc: TreeDocument,
  oldScope: Scope,
  newScope: Scope,
) => Discrepancy[];

export type Rebase = (
  doc: TreeDocument,
  oldScope: Scope,
  newScope: Scope,
  fixes: EditOperation[],
) => { ok: true; value: TreeDocument } | { ok: false; reason: RebaseFailure };

export type Summarize = (doc: Document, updatedAt: string) => Summary;
