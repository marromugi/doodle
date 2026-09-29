import { describe, expect, test } from "vitest";

import { Tokens, Typography } from "./tokens";

describe("Tokens", () => {
  const tokens = {
    color: { primary: "#1a73e8" },
    typography: {},
    space: { md: 16 },
    radius: { md: 8 },
  };

  test("reads the four token kinds", () => {
    expect(Tokens.safeParse(tokens).success).toBe(true);
  });

  test("rejects a fifth kind", () => {
    expect(Tokens.safeParse({ ...tokens, shadow: {} }).success).toBe(false);
  });
});

describe("Typography", () => {
  const typography = {
    family: "Inter",
    size: 16,
    weight: 400,
    lineHeight: 24,
    letterSpacing: 0,
  };

  test("reads family, size, weight, line height and letter spacing", () => {
    expect(Typography.safeParse(typography).success).toBe(true);
  });

  test("rejects a typography without letter spacing", () => {
    const { letterSpacing: _omitted, ...rest } = typography;
    expect(Typography.safeParse(rest).success).toBe(false);
  });
});
