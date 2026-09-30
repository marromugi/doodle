import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import { registerDocument } from "../catalog";
import { creationCatalogFromDb } from "./catalog-d1";

const catalog = creationCatalogFromDb(env.DB);

const count = async (table: "files" | "pages" | "documents") => {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ${table}`,
  ).first<{
    count: number;
  }>();
  return row!.count;
};

const rows = async () => ({
  files: await count("files"),
  pages: await count("pages"),
  documents: await count("documents"),
});

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

const makeApp = async (): Promise<string> => {
  const written = await catalog.writeAppFile({ name: "Shop", reference: null });
  if (written.status !== "written") throw new Error(written.status);
  return written.fileId;
};

const makeDesignSystem = async (): Promise<string> => {
  const written = await catalog.writeDesignSystemFile({
    name: "Tokens",
    draftDocumentId: id("doc_draft"),
  });
  if (written.status !== "written") throw new Error(written.status);
  return written.fileId;
};

const pageInput = (appFileId: string, over: Record<string, unknown> = {}) => ({
  pageId: id("page"),
  appFileId,
  name: "ホーム",
  skeletonDocumentId: id("doc_skel"),
  release: null,
  ...over,
});

describe("the catalog writes of the create procedures", () => {
  test("a page and skeleton written for a file that does not exist answer file_not_found and add no row", async () => {
    const before = await rows();

    const result = await catalog.writePageWithSkeleton(pageInput("f_x"));

    expect(result).toEqual({ status: "file_not_found" });
    expect(await rows()).toEqual(before);
  });

  test("a page and skeleton written for a design system file answer not_an_app and add no row", async () => {
    const designSystem = await makeDesignSystem();
    const before = await rows();

    const result = await catalog.writePageWithSkeleton(pageInput(designSystem));

    expect(result).toEqual({ status: "not_an_app" });
    expect(await rows()).toEqual(before);
  });

  test("a page written with the ID of an existing page answers id_in_use and adds no row", async () => {
    const app = await makeApp();
    const first = pageInput(app);
    expect((await catalog.writePageWithSkeleton(first)).status).toBe("written");
    const before = await rows();

    const result = await catalog.writePageWithSkeleton(
      pageInput(app, { pageId: first.pageId }),
    );

    expect(result).toEqual({ status: "id_in_use" });
    expect(await rows()).toEqual(before);
  });

  test("a page written again with the same page ID and skeleton document ID answers id_in_use and adds no row", async () => {
    const app = await makeApp();
    const first = pageInput(app);
    expect((await catalog.writePageWithSkeleton(first)).status).toBe("written");
    const before = await rows();

    const result = await catalog.writePageWithSkeleton(first);

    expect(result).toEqual({ status: "id_in_use" });
    expect(await rows()).toEqual(before);
  });

  test("a page written with a skeleton document ID that the registry already holds answers id_in_use and adds no page row", async () => {
    const app = await makeApp();
    const skeleton = id("doc_skel");
    await registerDocument(env.DB, {
      id: skeleton,
      file: app,
      kind: "skeleton",
      page: id("page"),
      release: null,
    });
    const before = await rows();

    const result = await catalog.writePageWithSkeleton(
      pageInput(app, { skeletonDocumentId: skeleton }),
    );

    expect(result).toEqual({ status: "id_in_use" });
    expect(await rows()).toEqual(before);
  });

  test("a design system file written with a draft document ID that the registry already holds answers id_in_use and adds no file row", async () => {
    const app = await makeApp();
    const draft = id("doc_draft");
    await registerDocument(env.DB, {
      id: draft,
      file: app,
      kind: "dsDraft",
      release: null,
    });
    const before = await rows();

    const result = await catalog.writeDesignSystemFile({
      name: "Tokens",
      draftDocumentId: draft,
    });

    expect(result).toEqual({ status: "id_in_use" });
    expect(await rows()).toEqual(before);
  });
});
