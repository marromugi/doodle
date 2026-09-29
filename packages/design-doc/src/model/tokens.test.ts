import { describe, expect, test } from "vitest";

import { DraftDocument } from "./document";
import { Scope } from "./scope";
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

describe("a colour token", () => {
  const withColor = (color: Record<string, string>) => ({
    color,
    typography: {},
    space: {},
    radius: {},
  });
  const draft = (color: Record<string, string>) => ({
    kind: "draft",
    revision: 0,
    tokens: withColor(color),
    components: {},
    history: { nodes: {}, tokens: {}, components: {}, nodeIds: [] },
  });
  const good = { primary: "#1a73e8" };
  const bad = { primary: "url(https://example.com/a.png)" };

  test("a draft with a colour token that is a colour passes the schema", () => {
    expect(DraftDocument.safeParse(draft(good)).success).toBe(true);
  });

  test("a draft with a colour token that is not a colour fails the schema", () => {
    expect(DraftDocument.safeParse(draft(bad)).success).toBe(false);
  });

  test("a component scope with a colour token that is not a colour fails the schema", () => {
    expect(
      Scope.safeParse({ tokens: withColor(good), components: {} }).success,
    ).toBe(true);
    expect(
      Scope.safeParse({ tokens: withColor(bad), components: {} }).success,
    ).toBe(false);
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
