import type {
  DraftDocument,
  ReleaseRef,
  TreeDocument,
} from "@doodle/design-doc";

const ROOT_ID = "root";

const emptyHistory = (nodeIds: string[]) => ({
  nodes: {},
  tokens: {},
  components: {},
  nodeIds,
});

/** A skeleton or a proposal with no nodes, verified by the given release. */
export const emptyTree = (release: ReleaseRef | null): TreeDocument => ({
  kind: "tree",
  revision: 0,
  release,
  root: { type: "frame", id: ROOT_ID, children: [] },
  history: emptyHistory([ROOT_ID]),
});

/** A design system draft with no tokens and no components. */
export const emptyDraft = (): DraftDocument => ({
  kind: "draft",
  revision: 0,
  tokens: { color: {}, typography: {}, space: {}, radius: {} },
  components: {},
  history: emptyHistory([]),
});
