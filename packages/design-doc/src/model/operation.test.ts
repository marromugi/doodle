import { describe, expect, test } from "vitest";

import { Operation } from "./operation";

describe("Operation", () => {
  test("reads remove-token and switch-release", () => {
    expect(
      Operation.safeParse({
        type: "remove-token",
        base: 0,
        token: "color.primary",
      }).success,
    ).toBe(true);
    expect(
      Operation.safeParse({
        type: "switch-release",
        base: 0,
        release: "rel_8f3a2c",
        fixes: [],
      }).success,
    ).toBe(true);
  });

  test("rejects undo", () => {
    expect(Operation.safeParse({ type: "undo", base: 0 }).success).toBe(false);
  });
});
