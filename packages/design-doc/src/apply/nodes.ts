/** A node or value read as plain JSON, so that one walk covers every node type. */
export type Json = { [key: string]: unknown };

export type Location = {
  node: Json;
  /** The node whose children list or `{ nodes }` value holds this node; null for the root. */
  parent: Json | null;
  /** The list this node sits in; null for the root. */
  list: Json[] | null;
};

export const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isNodesValue = (value: unknown): value is { nodes: Json[] } =>
  isRecord(value) &&
  Object.keys(value).length === 1 &&
  Array.isArray(value["nodes"]) &&
  value["nodes"].every(isRecord);

export const put = (target: Json, key: string, value: unknown): void => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

export const own = (target: object, key: string): boolean =>
  Object.hasOwn(target, key);

const childLists = (node: Json): Json[][] =>
  Array.isArray(node["children"]) ? [node["children"] as Json[]] : [];

/** The node lists held in a node's values, not counting its children. */
const valueLists = (node: Json): Json[][] => {
  const found: Json[][] = [];
  const scan = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(scan);
    } else if (isNodesValue(value)) {
      found.push(value.nodes);
    } else if (isRecord(value)) {
      Object.values(value).forEach(scan);
    }
  };
  for (const [key, value] of Object.entries(node)) {
    if (key !== "children") scan(value);
  }
  return found;
};

export const locate = (
  node: Json,
  id: string,
  parent: Json | null = null,
  list: Json[] | null = null,
): Location | null => {
  if (node["id"] === id) return { node, parent, list };
  for (const held of [...childLists(node), ...valueLists(node)]) {
    for (const child of held) {
      const found = locate(child, id, node, held);
      if (found) return found;
    }
  }
  return null;
};

/** The node's own ID and every ID under it, in children and in values. */
export const subtreeIds = (node: Json): string[] => {
  const ids = typeof node["id"] === "string" ? [node["id"]] : [];
  for (const held of [...childLists(node), ...valueLists(node)]) {
    for (const child of held) ids.push(...subtreeIds(child));
  }
  return ids;
};

/** Every ID of the nodes held in a node's values. */
export const valueIds = (node: Json): string[] =>
  valueLists(node).flatMap((held) => held.flatMap(subtreeIds));

export const isNodeLike = (value: unknown): value is Json =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["type"] === "string";
