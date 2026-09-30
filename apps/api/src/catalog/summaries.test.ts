import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";

import { addFile, registerDocument } from "./index";

const db = env.DB;

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Item = Record<string, unknown> & { id: string };

async function request(method: string, path: string, body?: unknown) {
  const res = await exports.default.fetch(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text === "" ? undefined : (JSON.parse(text) as any),
  };
}

const get = (path: string) => request("GET", path);
const putSummary = (doc: string, body: unknown) =>
  request("PUT", `/api/documents/${doc}/summary`, body);
const putThumbnail = (doc: string, body: unknown) =>
  request("PUT", `/api/documents/${doc}/thumbnail`, body);

async function itemOf(id: string): Promise<Item> {
  const { body } = await get("/api/files");
  const item = (body.files as Item[]).find((file) => file.id === id);
  if (item === undefined) throw new Error(`no item ${id}`);
  return item;
}

async function addApp(
  name: string,
  createdAt = "2026-01-01T00:00:00Z",
): Promise<string> {
  const id = `app_${name}`;
  await db
    .prepare(
      "INSERT INTO files (id, workspace_id, kind, name, created_at, reference_design_system_id, reference_release_id) VALUES (?, 'personal', 'app', ?, ?, NULL, NULL)",
    )
    .bind(id, name, createdAt)
    .run();
  return id;
}

async function addDesignSystem(
  draft: string,
  name = "Acme DS",
): Promise<string> {
  const result = await addFile(db, { kind: "designSystem", name, draft });
  if (!result.ok) throw new Error(result.message);
  return result.file.id;
}

async function registerSkeleton(id: string, file: string) {
  const result = await registerDocument(db, {
    id,
    file,
    kind: "skeleton",
    page: `p_${id}`,
    release: null,
  });
  if (!result.ok) throw new Error(result.message);
}

async function insertRelease(
  id: string,
  designSystem: string,
  draftRevision: number,
) {
  await db
    .prepare(
      "INSERT INTO releases (id, design_system_id, created_at, message, draft_revision, content) VALUES (?, ?, '2026-01-05T00:00:00Z', NULL, ?, '{}')",
    )
    .bind(id, designSystem, draftRevision)
    .run();
}

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM document_summaries"),
    db.prepare("DELETE FROM document_thumbnails"),
    db.prepare("DELETE FROM documents"),
    db.prepare("DELETE FROM releases"),
    db.prepare("DELETE FROM files"),
  ]);
});

describe("document summaries", () => {
  test("a summary sent for a registered document is returned as sent", async () => {
    await registerSkeleton("doc_1", await addApp("Shop"));
    const summary = { updatedAt: "2026-09-01T00:00:00Z", revision: 5 };

    expect(await putSummary("doc_1", summary)).toEqual({
      status: 200,
      body: summary,
    });
    expect(await get("/api/documents/doc_1/summary")).toEqual({
      status: 200,
      body: summary,
    });
  });

  test("an older summary sent later succeeds and the newer one stays", async () => {
    await registerSkeleton("doc_1", await addApp("Shop"));
    await putSummary("doc_1", {
      updatedAt: "2026-09-01T00:00:00Z",
      revision: 5,
    });

    expect(
      await putSummary("doc_1", {
        updatedAt: "2026-08-01T00:00:00Z",
        revision: 3,
      }),
    ).toEqual({
      status: 200,
      body: { updatedAt: "2026-09-01T00:00:00Z", revision: 5 },
    });
    expect(await get("/api/documents/doc_1/summary")).toEqual({
      status: 200,
      body: { updatedAt: "2026-09-01T00:00:00Z", revision: 5 },
    });
  });

  test("a newer summary sent later replaces the kept one", async () => {
    await registerSkeleton("doc_1", await addApp("Shop"));
    await putSummary("doc_1", {
      updatedAt: "2026-09-01T00:00:00Z",
      revision: 5,
    });
    await putSummary("doc_1", {
      updatedAt: "2026-08-01T00:00:00Z",
      revision: 3,
    });

    await putSummary("doc_1", {
      updatedAt: "2026-09-02T00:00:00Z",
      revision: 7,
    });

    expect(await get("/api/documents/doc_1/summary")).toEqual({
      status: 200,
      body: { updatedAt: "2026-09-02T00:00:00Z", revision: 7 },
    });
  });

  test("two documents each return their own summary", async () => {
    const app = await addApp("Shop");
    await registerSkeleton("doc_1", app);
    await registerSkeleton("doc_2", app);
    await putSummary("doc_1", {
      updatedAt: "2026-09-01T00:00:00Z",
      revision: 5,
    });
    await putSummary("doc_2", {
      updatedAt: "2026-09-02T00:00:00Z",
      revision: 2,
    });

    expect((await get("/api/documents/doc_1/summary")).body).toEqual({
      updatedAt: "2026-09-01T00:00:00Z",
      revision: 5,
    });
    expect((await get("/api/documents/doc_2/summary")).body).toEqual({
      updatedAt: "2026-09-02T00:00:00Z",
      revision: 2,
    });
  });

  test("asking for the summary of a document that sent none answers 404 summary_not_found", async () => {
    await registerSkeleton("doc_2", await addApp("Shop"));

    expect(await get("/api/documents/doc_2/summary")).toEqual({
      status: 404,
      body: { code: "summary_not_found", message: expect.any(String) },
    });
  });
});

describe("document thumbnails", () => {
  test("an image put for a document is returned with its type and revision", async () => {
    await registerSkeleton("doc_1", await addApp("Shop"));
    const thumbnail = {
      state: "ready",
      revision: 5,
      contentType: "image/png",
      image: PNG,
    };

    expect(await putThumbnail("doc_1", thumbnail)).toEqual({
      status: 204,
      body: undefined,
    });
    expect(await get("/api/documents/doc_1/thumbnail")).toEqual({
      status: 200,
      body: thumbnail,
    });
  });

  test("a reason put after an image is returned in its place", async () => {
    await registerSkeleton("doc_1", await addApp("Shop"));
    await putThumbnail("doc_1", {
      state: "ready",
      revision: 5,
      contentType: "image/png",
      image: PNG,
    });
    const failed = {
      state: "failed",
      revision: 6,
      reason: "トークン color.primary が見つかりません",
    };

    expect(await putThumbnail("doc_1", failed)).toEqual({
      status: 204,
      body: undefined,
    });
    expect(await get("/api/documents/doc_1/thumbnail")).toEqual({
      status: 200,
      body: failed,
    });
  });

  test("an older image put later is dropped with 204 and the newer reason stays", async () => {
    await registerSkeleton("doc_1", await addApp("Shop"));
    const failed = {
      state: "failed",
      revision: 6,
      reason: "トークン color.primary が見つかりません",
    };
    await putThumbnail("doc_1", failed);

    expect(
      await putThumbnail("doc_1", {
        state: "ready",
        revision: 4,
        contentType: "image/png",
        image: PNG,
      }),
    ).toEqual({ status: 204, body: undefined });
    expect(await get("/api/documents/doc_1/thumbnail")).toEqual({
      status: 200,
      body: failed,
    });
  });

  test("a document with no thumbnail put answers 200 with state none", async () => {
    await registerSkeleton("doc_2", await addApp("Shop"));

    expect(await get("/api/documents/doc_2/thumbnail")).toEqual({
      status: 200,
      body: { state: "none" },
    });
  });
});

describe("file updated times", () => {
  test("a file takes the summary time of its document and recent files follow it", async () => {
    const a = await addApp("A", "2026-01-01T00:00:00Z");
    const b = await addApp("B", "2026-01-02T00:00:00Z");
    await registerSkeleton("doc_a", a);

    await putSummary("doc_a", {
      updatedAt: "2026-03-01T00:00:00Z",
      revision: 2,
    });

    expect((await itemOf(a)).updatedAt).toBe("2026-03-01T00:00:00Z");
    expect((await itemOf(b)).updatedAt).toBe("2026-01-02T00:00:00Z");
    const recent = await get("/api/files/recent");
    expect(
      recent.body.files.map((file: Item) => [file.id, file.updatedAt]),
    ).toEqual([
      [a, "2026-03-01T00:00:00Z"],
      [b, "2026-01-02T00:00:00Z"],
    ]);
  });

  test("a file keeps the newest summary time among its documents", async () => {
    const a = await addApp("A", "2026-01-01T00:00:00Z");
    await registerSkeleton("doc_a", a);
    await registerSkeleton("doc_a2", a);
    await putSummary("doc_a", {
      updatedAt: "2026-03-01T00:00:00Z",
      revision: 2,
    });

    await putSummary("doc_a2", {
      updatedAt: "2026-02-01T00:00:00Z",
      revision: 1,
    });

    expect((await itemOf(a)).updatedAt).toBe("2026-03-01T00:00:00Z");
  });
});

describe("unreleased changes on design system items", () => {
  test("a draft at the release's revision has none and one revision ahead has some", async () => {
    const ds = await addDesignSystem("doc_draft");
    await insertRelease("rel_a", ds, 4);

    await putSummary("doc_draft", {
      updatedAt: "2026-03-01T00:00:00Z",
      revision: 4,
    });
    expect((await itemOf(ds)).hasUnreleasedChanges).toBe(false);

    await putSummary("doc_draft", {
      updatedAt: "2026-03-01T00:00:00Z",
      revision: 5,
    });
    expect(await itemOf(ds)).toMatchObject({
      id: ds,
      hasUnreleasedChanges: true,
    });
  });

  test("a design system with no release is false at draft revision 0 and true at revision 1", async () => {
    const ds = await addDesignSystem("doc_draft2");

    await putSummary("doc_draft2", {
      updatedAt: "2026-03-01T00:00:00Z",
      revision: 0,
    });
    expect((await itemOf(ds)).hasUnreleasedChanges).toBe(false);

    await putSummary("doc_draft2", {
      updatedAt: "2026-03-02T00:00:00Z",
      revision: 1,
    });
    expect((await itemOf(ds)).hasUnreleasedChanges).toBe(true);
  });
});

describe("documents that are not registered", () => {
  test("a summary and an image sent for an unregistered document are kept and stay after registering", async () => {
    const summary = { updatedAt: "2026-09-01T00:00:00Z", revision: 1 };
    const thumbnail = {
      state: "ready",
      revision: 1,
      contentType: "image/png",
      image: PNG,
    };

    expect(await putSummary("doc_new", summary)).toEqual({
      status: 200,
      body: summary,
    });
    expect((await putThumbnail("doc_new", thumbnail)).status).toBe(204);
    expect(await get("/api/documents/doc_new/summary")).toEqual({
      status: 200,
      body: summary,
    });
    expect(await get("/api/documents/doc_new/thumbnail")).toEqual({
      status: 200,
      body: thumbnail,
    });

    await registerSkeleton("doc_new", await addApp("Shop"));

    expect((await get("/api/documents/doc_new/summary")).body).toEqual(summary);
    expect((await get("/api/documents/doc_new/thumbnail")).body).toEqual(
      thumbnail,
    );
  });
});
