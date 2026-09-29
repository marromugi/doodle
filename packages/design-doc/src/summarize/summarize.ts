import type { Summarize } from "../roles";

export const summarize: Summarize = (doc, updatedAt) => ({
  revision: doc.revision,
  updatedAt,
});
