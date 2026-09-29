import { describe, expect, test } from "vitest";

import type { DraftDocument, TreeDocument } from "../model/document";
import { summarize } from "./summarize";

const history = { nodes: {}, tokens: {}, components: {}, nodeIds: [] };

describe("summarize", () => {
  test("a tree document gives its revision and the given update time, and nothing else", () => {
    const doc: TreeDocument = {
      kind: "tree",
      revision: 7,
      release: { designSystem: "ds_1", release: "rel_1" },
      history,
      root: { type: "frame", id: "root", children: [] },
    };

    const summary = summarize(doc, "2026-09-29T10:00:00.000Z");

    expect(Object.keys(summary).sort()).toEqual(["revision", "updatedAt"]);
    expect(summary.updatedAt).toBe("2026-09-29T10:00:00.000Z");
    expect(summary.revision).toBe(7);
  });

  test("a draft document gives its revision and the given update time", () => {
    const doc: DraftDocument = {
      kind: "draft",
      revision: 0,
      tokens: { color: {}, typography: {}, space: {}, radius: {} },
      components: {},
      history,
    };

    const summary = summarize(doc, "2026-09-01T00:00:00.000Z");

    expect(summary.updatedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(summary.revision).toBe(0);
  });
});
