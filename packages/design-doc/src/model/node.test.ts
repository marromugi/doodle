import { describe, expect, test } from "vitest";

import { Node } from "./node";

describe("Node", () => {
  test("keeps a brace-wrapped string as the literal string", () => {
    const result = Node.safeParse({ type: "text", id: "t1", text: "{name}" });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ type: "text", text: "{name}" });
  });

  test("reads an image node", () => {
    expect(Node.safeParse({ type: "image", id: "i1" }).success).toBe(true);
  });

  test("rejects a node type outside the six kinds", () => {
    expect(Node.safeParse({ type: "video", id: "v1" }).success).toBe(false);
  });

  test("reads a frame with a flex layout and a positioned child", () => {
    const frame = {
      type: "frame",
      id: "f1",
      layout: { direction: "row", gap: 8 },
      children: [
        { type: "text", id: "t1", text: "A", position: { x: 10, y: 20 } },
      ],
    };
    expect(Node.safeParse(frame).success).toBe(true);
    expect(
      Node.safeParse({ ...frame, layout: { direction: "grid", gap: 8 } })
        .success,
    ).toBe(false);
  });

  test("reads hug, fill and a number as a width and rejects auto", () => {
    for (const width of ["hug", "fill", 120]) {
      expect(
        Node.safeParse({ type: "frame", id: "f1", width, children: [] })
          .success,
      ).toBe(true);
    }
    expect(
      Node.safeParse({ type: "frame", id: "f1", width: "auto", children: [] })
        .success,
    ).toBe(false);
  });

  test("rejects shadow and gradient keys on a frame", () => {
    const base = { type: "frame", id: "f1", children: [] };
    expect(
      Node.safeParse({ ...base, shadow: "0 1px 2px #000000" }).success,
    ).toBe(false);
    expect(Node.safeParse({ ...base, gradient: "#000000" }).success).toBe(
      false,
    );
  });

  test("reads a when condition on text and on image", () => {
    expect(
      Node.safeParse({
        type: "text",
        id: "t1",
        text: "A",
        when: { present: "note" },
      }).success,
    ).toBe(true);
    expect(
      Node.safeParse({
        type: "image",
        id: "i1",
        when: { prop: "visible" },
      }).success,
    ).toBe(true);
  });

  test("reads an instance that names its component by id", () => {
    expect(
      Node.safeParse({
        type: "instance",
        id: "i1",
        component: "cmp_badge",
        props: {},
      }).success,
    ).toBe(true);
  });
});
