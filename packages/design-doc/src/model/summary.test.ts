import { describe, expect, test } from "vitest";

import { Summary } from "./summary";

describe("Summary", () => {
  test("reads a revision with an update time", () => {
    expect(
      Summary.safeParse({
        revision: 3,
        updatedAt: "2026-09-29T10:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  test("rejects a page count", () => {
    expect(
      Summary.safeParse({
        revision: 3,
        updatedAt: "2026-09-29T10:00:00.000Z",
        pages: 1,
      }).success,
    ).toBe(false);
  });

  test("rejects a summary without an update time", () => {
    expect(Summary.safeParse({ revision: 3 }).success).toBe(false);
  });
});
