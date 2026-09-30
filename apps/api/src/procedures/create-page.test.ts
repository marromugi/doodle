import { env, exports } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import { Client, human } from "../session/test-client";
import { creationCatalogFromDb } from "./catalog-d1";
import { createFile } from "./create-file";
import { createPage } from "./create-page";
import { documentSessionsFromEnv } from "./sessions-port";
import { addFile, fakes } from "./test-ports";

const reference = { designSystem: "ds_1", release: "rel_1" };

describe("createPage", () => {
  test("a page in an app that references rel_1 registers one skeleton document with release rel_1, and a client reads a skeleton without nodes verified by ds_1 rel_1", async () => {
    const { catalog, ports } = fakes();
    const appFileId = addFile(catalog, { kind: "app", reference });
    const realSessions = { ...ports, sessions: documentSessionsFromEnv(env) };

    const result = await createPage(realSessions, { appFileId, name: "Home" });

    if (!result.ok) throw new Error(result.message);
    expect(catalog.registrations).toEqual([
      {
        id: result.skeletonDocumentId,
        file: appFileId,
        kind: "skeleton",
        page: result.pageId,
        request: null,
        release: "rel_1",
      },
    ]);
    const client = await Client.connect(result.skeletonDocumentId, human);
    expect(await client.read()).toMatchObject({
      type: "document",
      document: {
        kind: "tree",
        release: { designSystem: "ds_1", release: "rel_1" },
        root: { type: "frame", children: [] },
      },
    });
  });

  test("a page in an app without a design system registers a skeleton with no release and initialises it with release null", async () => {
    const { catalog, sessions, ports } = fakes();
    const appFileId = addFile(catalog, { kind: "app" });

    const result = await createPage(ports, { appFileId, name: "Home" });

    if (!result.ok) throw new Error(result.message);
    expect(catalog.registrations).toMatchObject([
      { id: result.skeletonDocumentId, kind: "skeleton", release: null },
    ]);
    expect(sessions.contents.get(result.skeletonDocumentId)).toMatchObject({
      release: null,
    });
  });

  test("pages named ホーム and with 50 characters are created with those names", async () => {
    const { catalog, ports } = fakes();
    const appFileId = addFile(catalog, { kind: "app" });

    const home = await createPage(ports, { appFileId, name: "ホーム" });
    const long = await createPage(ports, { appFileId, name: "a".repeat(50) });

    expect(home.ok && long.ok).toBe(true);
    expect(catalog.pages.map((page) => page.name)).toEqual([
      "ホーム",
      "a".repeat(50),
    ]);
  });

  test("the names empty, only spaces and 51 characters are refused for their name and create no page or document", async () => {
    const { catalog, sessions, ports } = fakes();
    const appFileId = addFile(catalog, { kind: "app" });

    for (const name of ["", "   ", "a".repeat(51)]) {
      const result = await createPage(ports, { appFileId, name });
      expect(result).toMatchObject({ ok: false, code: "invalid_name" });
    }

    expect(catalog.pages).toEqual([]);
    expect(catalog.registrations).toEqual([]);
    expect(sessions.contents.size).toBe(0);
  });

  test("two pages named ホーム in one app are both created with different IDs", async () => {
    const { catalog, ports } = fakes();
    const appFileId = addFile(catalog, { kind: "app" });

    const first = await createPage(ports, { appFileId, name: "ホーム" });
    const second = await createPage(ports, { appFileId, name: "ホーム" });

    if (!first.ok || !second.ok) throw new Error("the pages were not created");
    expect(first.pageId).not.toBe(second.pageId);
  });

  test("pages made as B then A in the real catalog are listed by the catalog API as B then A", async () => {
    const { sessions, eraseRetry } = fakes();
    const ports = {
      catalog: creationCatalogFromDb(env.DB),
      sessions,
      eraseRetry,
    };
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

  test("when the document reports it already has content, the page fails as initialization_failed and nothing is registered", async () => {
    const { catalog, sessions, ports } = fakes();
    const appFileId = addFile(catalog, { kind: "app", reference });
    sessions.initializeStatus = "already_initialized";

    const result = await createPage(ports, { appFileId, name: "Home" });

    expect(result).toMatchObject({ ok: false, code: "initialization_failed" });
    expect(catalog.registrations).toEqual([]);
    expect(catalog.pages).toEqual([]);
  });

  test("when the catalog says the file is gone at write time, the page fails as file_not_found and the initialised skeleton is erased", async () => {
    const { catalog, sessions, ports } = fakes();
    catalog.answer.readApp = { status: "found", reference: null };
    catalog.answer.writePageWithSkeleton = { status: "file_not_found" };

    const result = await createPage(ports, {
      appFileId: "file_x",
      name: "Home",
    });

    expect(result).toMatchObject({ ok: false, code: "file_not_found" });
    expect(sessions.erased).toEqual([...sessions.contents.keys()]);
    expect(sessions.erased).toHaveLength(1);
  });

  test("when the session cannot be reached, the page fails as session_unavailable and the skeleton ID is handed to the erase retry", async () => {
    const { catalog, sessions, eraseRetry, ports } = fakes();
    const appFileId = addFile(catalog, { kind: "app" });
    sessions.initializeStatus = "unreachable";

    const result = await createPage(ports, { appFileId, name: "Home" });

    expect(result).toMatchObject({ ok: false, code: "session_unavailable" });
    expect(eraseRetry.handed).toEqual(sessions.initializeCalls);
    expect(eraseRetry.handed).toHaveLength(1);
  });

  test("when the registration is refused and the erase does not arrive, the page fails as registration_failed and the skeleton ID is handed to the erase retry", async () => {
    const { catalog, sessions, eraseRetry, ports } = fakes();
    const appFileId = addFile(catalog, { kind: "app" });
    catalog.answer.writePageWithSkeleton = { status: "id_in_use" };
    sessions.eraseStatus = "unreachable";

    const result = await createPage(ports, { appFileId, name: "Home" });

    expect(result).toMatchObject({ ok: false, code: "registration_failed" });
    expect(eraseRetry.handed).toEqual([...sessions.contents.keys()]);
    expect(eraseRetry.handed).toHaveLength(1);
  });

  test("when the erase retry does not answer either, the page still fails as session_unavailable", async () => {
    const { catalog, sessions, eraseRetry, ports } = fakes();
    const appFileId = addFile(catalog, { kind: "app" });
    sessions.initializeStatus = "unreachable";
    eraseRetry.answer = { status: "unreachable" };

    const result = await createPage(ports, { appFileId, name: "Home" });

    expect(result).toMatchObject({ ok: false, code: "session_unavailable" });
  });
});
