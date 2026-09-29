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

  test("points at the value that does not fit inside the operation", () => {
    const result = Operation.array().safeParse([
      {
        type: "set",
        base: 3,
        node: "t1",
        key: "text",
        value: { token: "color.primary", prop: "label" },
      },
    ]);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      [0, "value"],
    ]);
  });

  test("points at the type key of an unknown operation and lists the accepted types", () => {
    const result = Operation.array().safeParse([{ type: "paint", node: "t1" }]);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      [0, "type"],
    ]);
    expect(result.error?.issues[0]?.message).toContain("'set'");
    expect(result.error?.issues[0]?.message).toContain("'switch-release'");
  });

  test("returns one error per value that does not fit in one operation", () => {
    const result = Operation.array().safeParse([
      { type: "set", base: 0, node: "n" },
    ]);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      [0, "key"],
      [0, "value"],
    ]);
  });

  test("reports an operation that is not an object as a type error at the operation", () => {
    const result = Operation.array().safeParse(["hello"]);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([[0]]);
    expect(result.error?.issues[0]?.message).toBe(
      "Invalid input: expected object, received string",
    );
  });
});
