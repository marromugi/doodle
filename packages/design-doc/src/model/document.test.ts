import { describe, expect, test } from "vitest";

import { Document, DraftDocument } from "./document";

const history = { nodes: {}, tokens: {}, components: {}, nodeIds: [] };
const emptyTokens = { color: {}, typography: {}, space: {}, radius: {} };
const badge = (id: string, name: string) => ({
  [id]: {
    name,
    props: {},
    root: { type: "frame", id: id.slice(4), children: [] },
  },
});

describe("Document", () => {
  test("reads a tree document with a root", () => {
    const tree = {
      kind: "tree",
      revision: 0,
      release: null,
      root: { type: "frame", id: "root", children: [] },
      history,
    };
    expect(Document.safeParse(tree).success).toBe(true);
    const { root: _omitted, ...withoutRoot } = tree;
    expect(Document.safeParse(withoutRoot).success).toBe(false);
  });

  test("reads a draft document with tokens and components", () => {
    expect(
      Document.safeParse({
        kind: "draft",
        revision: 0,
        tokens: emptyTokens,
        components: {},
        history,
      }).success,
    ).toBe(true);
  });
});

describe("DraftDocument", () => {
  const draft = (components: unknown) => ({
    kind: "draft",
    revision: 0,
    tokens: emptyTokens,
    components,
    history,
  });

  test("reads a component that has a name", () => {
    expect(
      DraftDocument.safeParse(draft(badge("cmp_badge", "Badge"))).success,
    ).toBe(true);
  });

  test("rejects a component without a name", () => {
    expect(
      DraftDocument.safeParse(
        draft({
          cmp_badge: {
            props: {},
            root: { type: "frame", id: "badge", children: [] },
          },
        }),
      ).success,
    ).toBe(false);
  });

  test("rejects two components that share a name", () => {
    expect(
      DraftDocument.safeParse(
        draft({ ...badge("cmp_a", "Badge"), ...badge("cmp_b", "Badge") }),
      ).success,
    ).toBe(false);
  });

  test("reads two components that have different names", () => {
    expect(
      DraftDocument.safeParse(
        draft({ ...badge("cmp_a", "Badge"), ...badge("cmp_b", "Tag") }),
      ).success,
    ).toBe(true);
  });
});
