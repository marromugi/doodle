import { describe, expect, test } from "vitest";

import { PropDef } from "./props";

describe("PropDef", () => {
  test("reads required, default and optional definitions", () => {
    expect(PropDef.safeParse({ type: "string", required: true }).success).toBe(
      true,
    );
    expect(PropDef.safeParse({ type: "string", default: "OK" }).success).toBe(
      true,
    );
    expect(PropDef.safeParse({ type: "string" }).success).toBe(true);
  });

  test("rejects a definition with both required and a default", () => {
    expect(
      PropDef.safeParse({ type: "string", required: true, default: "OK" })
        .success,
    ).toBe(false);
  });

  test("reads an array of objects nested in each other", () => {
    expect(
      PropDef.safeParse({
        type: "array",
        of: {
          type: "object",
          fields: {
            label: { type: "string", required: true },
            tone: { type: "enum", values: ["a", "b"] },
          },
        },
      }).success,
    ).toBe(true);
  });

  test("rejects a type outside the eight kinds", () => {
    expect(PropDef.safeParse({ type: "date" }).success).toBe(false);
  });

  test("points at the type of a definition that does not fit", () => {
    const inObject = PropDef.safeParse({
      type: "object",
      fields: { a: { type: "nope" } },
    });
    expect(inObject.success).toBe(false);
    expect(inObject.error?.issues.map((issue) => issue.path)).toEqual([
      ["fields", "a", "type"],
    ]);
    const inArray = PropDef.safeParse({
      type: "array",
      of: { type: "nope" },
    });
    expect(inArray.success).toBe(false);
    expect(inArray.error?.issues.map((issue) => issue.path)).toEqual([
      ["of", "type"],
    ]);
  });
});
