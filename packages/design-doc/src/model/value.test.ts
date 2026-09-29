import { describe, expect, test } from "vitest";

import { Value } from "./value";

describe("Value", () => {
  test("reads token, prop, var and match references", () => {
    expect(Value.safeParse({ token: "color.primary" }).success).toBe(true);
    expect(Value.safeParse({ prop: "label" }).success).toBe(true);
    expect(Value.safeParse({ var: "item.label" }).success).toBe(true);
    expect(
      Value.safeParse({
        match: "tone",
        cases: { primary: "#1a73e8", neutral: "#ffffff" },
      }).success,
    ).toBe(true);
  });

  test("rejects a reference that has two kind keys", () => {
    expect(
      Value.safeParse({ token: "color.primary", prop: "label" }).success,
    ).toBe(false);
  });

  test("reads wrapped object, array and nodes values", () => {
    expect(Value.safeParse({ object: { label: "A" } }).success).toBe(true);
    expect(
      Value.safeParse({ array: [{ object: { label: "A" } }] }).success,
    ).toBe(true);
    expect(
      Value.safeParse({ nodes: [{ type: "image", id: "i1" }] }).success,
    ).toBe(true);
  });

  test("rejects an unwrapped object", () => {
    expect(Value.safeParse({ label: "A" }).success).toBe(false);
  });
});
