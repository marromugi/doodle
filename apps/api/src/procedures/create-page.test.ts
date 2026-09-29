import { env, exports } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import { Client, human } from "../session/test-client";
import { catalogFromDb, sessionsFromEnv } from "./adapters";
import { createFile } from "./create-file";
import { createPage } from "./create-page";
import { addApp, fakeCatalog, fakeSessions } from "./test-ports";

const reference = { designSystem: "ds_1", release: "rel_1" };

const setup = (appReference: typeof reference | null = null) => {
  const catalog = fakeCatalog();
  const sessions = fakeSessions();
  const appFileId = addApp(catalog, appReference);
  return { catalog, sessions, appFileId, ports: { catalog, sessions } };
};

describe("createPage", () => {
  test("a page in an app with a release reference gets one registered skeleton document that a client reads without nodes", async () => {
    const { catalog, appFileId } = setup(reference);

    const result = await createPage(
      { catalog, sessions: sessionsFromEnv(env) },
      { appFileId, name: "Home" },
    );

    if (!result.ok) throw new Error(result.message);
    expect(catalog.documents).toEqual([
      {
        id: result.skeletonDocumentId,
        file: appFileId,
        kind: "skeleton",
        page: result.pageId,
        release: "rel_1",
      },
    ]);
    const client = await Client.connect(result.skeletonDocumentId, human);
    const read = await client.read();
    expect(read).toMatchObject({
      type: "document",
      document: {
        kind: "tree",
        release: { designSystem: "ds_1", release: "rel_1" },
        root: { type: "frame", children: [] },
      },
    });
  });

  test("a page in an app without a design system has a skeleton with no release", async () => {
    const { catalog, sessions, appFileId, ports } = setup(null);

    const result = await createPage(ports, { appFileId, name: "Home" });

    if (!result.ok) throw new Error(result.message);
    expect(catalog.documents).toMatchObject([
      { id: result.skeletonDocumentId, kind: "skeleton", release: null },
    ]);
    expect(sessions.contents.get(result.skeletonDocumentId)).toMatchObject({
      release: null,
    });
  });

  test("when the registry refuses the skeleton, the page fails and the document is erased", async () => {
    const { catalog, sessions, appFileId, ports } = setup(reference);
    catalog.failRegistration = true;

    const result = await createPage(ports, { appFileId, name: "Home" });

    expect(result).toMatchObject({ ok: false, code: "registration_failed" });
    expect(sessions.erased).toEqual([...sessions.contents.keys()]);
    expect(sessions.erased).toHaveLength(1);
  });

  test("pages named ホーム and with 50 characters are created with those names", async () => {
    const { catalog, appFileId, ports } = setup();

    const home = await createPage(ports, { appFileId, name: "ホーム" });
    const long = await createPage(ports, {
      appFileId,
      name: "a".repeat(50),
    });

    expect(home.ok && long.ok).toBe(true);
    expect(catalog.pages.map((page) => page.name)).toEqual([
      "ホーム",
      "a".repeat(50),
    ]);
  });

  test("an empty name, a whitespace name and a 51 character name are refused for their name and create nothing", async () => {
    const { catalog, sessions, appFileId, ports } = setup();

    for (const name of ["", "   ", "a".repeat(51)]) {
      const result = await createPage(ports, { appFileId, name });
      expect(result).toMatchObject({ ok: false, code: "invalid_name" });
    }

    expect(catalog.pages).toEqual([]);
    expect(sessions.contents.size).toBe(0);
  });

  test("two pages named ホーム in one app are both created with different IDs", async () => {
    const { appFileId, ports } = setup();

    const first = await createPage(ports, { appFileId, name: "ホーム" });
    const second = await createPage(ports, { appFileId, name: "ホーム" });

    if (!first.ok || !second.ok) throw new Error("the pages were not created");
    expect(first.pageId).not.toBe(second.pageId);
  });

  test("pages made as B then A are listed by the catalog API as B then A", async () => {
    const ports = { catalog: catalogFromDb(env.DB), sessions: fakeSessions() };
    const file = await createFile(ports, {
      kind: "app",
      name: "Shop",
      reference: null,
    });
    if (!file.ok) throw new Error(file.message);

    await createPage(ports, { appFileId: file.fileId, name: "B" });
    await createPage(ports, { appFileId: file.fileId, name: "A" });

    const response = await exports.default.fetch(
      `http://localhost/api/files/${file.fileId}/pages`,
    );
    const body = (await response.json()) as { pages: { name: string }[] };
    expect(body.pages.map((page) => page.name)).toEqual(["B", "A"]);
  });

  test("when the document cannot be initialised, the page fails and nothing is registered", async () => {
    const { catalog, sessions, appFileId, ports } = setup(reference);
    sessions.result = {
      ok: false,
      code: "already_initialized",
      message: "The document already has content.",
    };

    const result = await createPage(ports, { appFileId, name: "Home" });

    expect(result).toMatchObject({ ok: false, code: "initialization_failed" });
    expect(catalog.documents).toEqual([]);
  });
});
