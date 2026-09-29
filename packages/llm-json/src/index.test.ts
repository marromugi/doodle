import type {
  DecodeFailure,
  Operation,
  TreeDocument,
} from "@doodle/design-doc";
import { describe, expect, test } from "vitest";

import { jsonRepresentation } from "./index";

const history = { nodes: {}, tokens: {}, components: {}, nodeIds: [] };

const failureReasons = (
  result: ReturnType<typeof jsonRepresentation.decodeOperations>,
): DecodeFailure[] => (result.ok ? [] : result.reasons);

const shapePaths = (reasons: DecodeFailure[], depth: number) =>
  reasons.flatMap((r) =>
    r.code === "invalid-shape" ? [r.path.slice(0, depth)] : [],
  );

describe("jsonRepresentation.encode", () => {
  test("a tree document read back as JSON equals the document", () => {
    const doc: TreeDocument = {
      kind: "tree",
      revision: 3,
      release: { designSystem: "ds_1", release: "rel_1" },
      history,
      root: {
        type: "frame",
        id: "root",
        children: [{ type: "text", id: "t1", text: "Hello" }],
      },
    };

    const text = jsonRepresentation.encode(doc);

    expect(JSON.parse(text)).toEqual(doc);
  });
});

describe("jsonRepresentation.decodeOperations", () => {
  test("a JSON array with one set operation gives that operation alone", () => {
    const text =
      '[{"type":"set","base":3,"node":"t1","key":"text","value":"Hi"}]';

    const result = jsonRepresentation.decodeOperations(text);

    const expected: Operation[] = [
      { type: "set", base: 3, node: "t1", key: "text", value: "Hi" },
    ];
    expect(result).toEqual({ ok: true, value: expected });
  });

  test("an empty JSON array gives an empty list of operations", () => {
    const result = jsonRepresentation.decodeOperations("[]");

    expect(result).toEqual({ ok: true, value: [] });
  });

  test("text that is not JSON fails as unreadable", () => {
    const result = jsonRepresentation.decodeOperations("set t1 text Hi");

    expect(result.ok).toBe(false);
    expect(failureReasons(result).map((r) => r.code)).toEqual(["unreadable"]);
  });

  test("an unknown operation type fails as invalid-shape with a path starting at the first item", () => {
    const result = jsonRepresentation.decodeOperations(
      '[{"type":"paint","node":"t1"}]',
    );

    const reasons = failureReasons(result);
    expect(result.ok).toBe(false);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.map((r) => r.code)).toEqual(
      reasons.map(() => "invalid-shape"),
    );
    expect(shapePaths(reasons, 1)).toEqual(reasons.map(() => [0]));
  });

  test("a set operation with a token-bound value fails as invalid-shape with a path starting at the value", () => {
    const result = jsonRepresentation.decodeOperations(
      '[{"type":"set","base":3,"node":"t1","key":"text","value":{"token":"color.primary","prop":"label"}}]',
    );

    const reasons = failureReasons(result);
    expect(result.ok).toBe(false);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.map((r) => r.code)).toEqual(
      reasons.map(() => "invalid-shape"),
    );
    expect(shapePaths(reasons, 2)).toEqual(reasons.map(() => [0, "value"]));
  });
});
