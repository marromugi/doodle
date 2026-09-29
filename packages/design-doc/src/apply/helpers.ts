import type { Result } from "../roles";
import type { ApplyFailure } from "./failure";

export const fail = (failure: ApplyFailure): Result<never, ApplyFailure> => ({
  ok: false,
  reasons: [failure],
});

/** One conflict per target whose last change is after `base`. */
export const conflictsOf = (
  latestRevision: number,
  changedAt: Record<string, number>,
  base: number,
  targets: string[],
  describe: (target: string) => { message: string; nodeId?: string },
): ApplyFailure[] =>
  targets
    .filter((t) => (changedAt[t] ?? 0) > base)
    .map((t) => ({ code: "conflict", latestRevision, ...describe(t) }));
