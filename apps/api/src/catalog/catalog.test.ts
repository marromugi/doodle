import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, expectTypeOf, test } from "vitest";

import { addFile, registerDocument } from "./index";

const db = env.DB;

type Item = Record<string, unknown> & { id: string; name: string };

async function get(path: string) {
  const res = await exports.default.fetch(`http://localhost${path}`);
  return { status: res.status, body: (await res.json()) as any };
}

async function listFiles(): Promise<Item[]> {
  const { body } = await get("/api/files");
  return body.files;
}

async function itemOf(id: string): Promise<Item> {
  const item = (await listFiles()).find((file) => file.id === id);
  if (item === undefined) throw new Error(`no item ${id}`);
  return item;
}

async function addDesignSystem(name = "Acme DS"): Promise<string> {
  const result = await addFile(db, { kind: "designSystem", name });
  if (!result.ok) throw new Error(result.message);
  return result.file.id;
}

async function addApp(
  reference: { designSystem: string; release: string } | null,
  name = "Shop",
): Promise<string> {
  const result = await addFile(db, { kind: "app", name, reference });
  if (!result.ok) throw new Error(result.message);
  return result.file.id;
}

async function insertRelease(
  id: string,
  designSystem: string,
  createdAt: string,
) {
  await db
    .prepare(
      "INSERT INTO releases (id, design_system_id, created_at, message, draft_revision, content) VALUES (?, ?, ?, NULL, 4, '{}')",
    )
    .bind(id, designSystem, createdAt)
    .run();
}

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM documents"),
    db.prepare("DELETE FROM releases"),
    db.prepare("DELETE FROM files"),
  ]);
});

describe("recording files", () => {
  test("a recorded design system appears alone in the list with no release and no apps", async () => {
    const added = await addFile(db, {
      kind: "designSystem",
      name: "Acme DS",
    });
    expect(added).toEqual({
      ok: true,
      file: {
        id: expect.any(String),
        kind: "designSystem",
        name: "Acme DS",
        createdAt: expect.any(String),
      },
    });
    if (!added.ok) return;

    const { status, body } = await get("/api/files");
    expect(status).toBe(200);
    expect(body).toEqual({
      files: [
        {
          id: added.file.id,
          kind: "designSystem",
          name: "Acme DS",
          updatedAt: added.file.createdAt,
          latestRelease: null,
          usedByApps: 0,
          referenced: false,
        },
      ],
    });
  });

  const name50 = "あ".repeat(50);
  const name51 = "あ".repeat(51);

  test.each(["A", name50, "Acme DS"])(
    "name %j is recorded and listed",
    async (name) => {
      await addDesignSystem("Acme DS");

      const result = await addFile(db, { kind: "designSystem", name });

      expect(result.ok).toBe(true);
      expect(await listFiles()).toHaveLength(2);
    },
  );

  test.each([name51, "", "   "])(
    "name %j fails with invalid_name and is not recorded",
    async (name) => {
      await addDesignSystem("Acme DS");

      const result = await addFile(db, { kind: "designSystem", name });

      expect(result).toEqual({
        ok: false,
        code: "invalid_name",
        message: expect.any(String),
      });
      expect(await listFiles()).toHaveLength(1);
    },
  );

  test("an app recorded without a reference lists a null reference and no newer release", async () => {
    const app = await addApp(null);

    expect(await itemOf(app)).toEqual({
      id: app,
      kind: "app",
      name: "Shop",
      updatedAt: expect.any(String),
      reference: null,
      hasNewerRelease: false,
    });
  });

  test("an app that references a release lists the same pair and its design system counts it", async () => {
    const ds = await addDesignSystem();
    await insertRelease("rel_a", ds, "2026-01-01T00:00:00Z");

    const app = await addApp({ designSystem: ds, release: "rel_a" });

    expect((await itemOf(app)).reference).toEqual({
      designSystem: ds,
      release: "rel_a",
    });
    const dsItem = await itemOf(ds);
    expect(dsItem.usedByApps).toBe(1);
    expect(dsItem.referenced).toBe(true);
  });

  test("a design system counts two apps that reference it", async () => {
    const ds = await addDesignSystem();
    await insertRelease("rel_a", ds, "2026-01-01T00:00:00Z");

    await addApp({ designSystem: ds, release: "rel_a" }, "Shop");
    await addApp({ designSystem: ds, release: "rel_a" }, "Blog");

    expect((await itemOf(ds)).usedByApps).toBe(2);
  });

  test("an app that references a missing release fails and is not recorded", async () => {
    const ds = await addDesignSystem();

    const result = await addFile(db, {
      kind: "app",
      name: "Shop",
      reference: { designSystem: ds, release: "rel_missing" },
    });

    expect(result).toEqual({
      ok: false,
      code: "reference_not_found",
      message: expect.any(String),
    });
    expect(await listFiles()).toHaveLength(1);
  });

  test("an app that pairs a release with another design system fails and is not recorded", async () => {
    const first = await addDesignSystem("First");
    const second = await addDesignSystem("Second");
    await insertRelease("rel_a", first, "2026-01-01T00:00:00Z");

    const result = await addFile(db, {
      kind: "app",
      name: "Shop",
      reference: { designSystem: second, release: "rel_a" },
    });

    expect(result).toEqual({
      ok: false,
      code: "reference_not_found",
      message: expect.any(String),
    });
    expect(await listFiles()).toHaveLength(2);
  });
});

describe("the document registry", () => {
  test("registered documents are looked up by id as registered", async () => {
    const app = await addApp(null);
    expect(
      await registerDocument(db, {
        id: "doc_skel_1",
        file: app,
        kind: "skeleton",
        page: "p_1",
        release: null,
      }),
    ).toEqual({ ok: true });
    expect(
      await registerDocument(db, {
        id: "doc_prop_1",
        file: app,
        kind: "proposal",
        page: "p_1",
        request: "req_1",
        release: null,
      }),
    ).toEqual({ ok: true });

    expect(await get("/api/documents/doc_prop_1")).toEqual({
      status: 200,
      body: {
        id: "doc_prop_1",
        file: app,
        kind: "proposal",
        page: "p_1",
        request: "req_1",
        release: null,
      },
    });
    expect(await get("/api/documents/doc_skel_1")).toEqual({
      status: 200,
      body: {
        id: "doc_skel_1",
        file: app,
        kind: "skeleton",
        page: "p_1",
        release: null,
      },
    });
  });

  test("a design system draft is looked up with kind dsDraft and a null release", async () => {
    const ds = await addDesignSystem();
    await registerDocument(db, {
      id: "doc_draft_1",
      file: ds,
      kind: "dsDraft",
      release: null,
    });

    const { status, body } = await get("/api/documents/doc_draft_1");

    expect(status).toBe(200);
    expect(body.kind).toBe("dsDraft");
    expect(body.release).toBeNull();
  });

  test("registering an id twice fails and keeps the first registration", async () => {
    const app = await addApp(null);
    await registerDocument(db, {
      id: "doc_skel_1",
      file: app,
      kind: "skeleton",
      page: "p_1",
      release: null,
    });

    const again = await registerDocument(db, {
      id: "doc_skel_1",
      file: app,
      kind: "skeleton",
      page: "p_2",
      release: null,
    });

    expect(again).toEqual({
      ok: false,
      code: "document_exists",
      message: expect.any(String),
    });
    expect((await get("/api/documents/doc_skel_1")).body.page).toBe("p_1");
  });

  test("registering a document for a missing file fails", async () => {
    const result = await registerDocument(db, {
      id: "doc_skel_1",
      file: "file_missing",
      kind: "skeleton",
      page: "p_1",
      release: null,
    });

    expect(result).toEqual({
      ok: false,
      code: "file_not_found",
      message: expect.any(String),
    });
  });

  test("looking up an unregistered id answers 404 document_not_found", async () => {
    const { status, body } = await get("/api/documents/doc_none");

    expect(status).toBe(404);
    expect(body).toEqual({
      code: "document_not_found",
      message: expect.any(String),
    });
  });

  test("a proposal without a request does not compile", async () => {
    const app = await addApp(null);
    const proposal = {
      id: "doc_prop_2",
      file: app,
      kind: "proposal",
      page: "p_1",
      release: null,
    } as const;

    expectTypeOf(registerDocument).toBeCallableWith(db, {
      ...proposal,
      request: "req_1",
    });
    expectTypeOf(registerDocument).toBeCallableWith(
      db,
      // @ts-expect-error a proposal carries the request it answers
      proposal,
    );
  });
});

describe("releases on design system items", () => {
  test("the latest release is the one created last", async () => {
    const ds = await addDesignSystem();
    await insertRelease("rel_b", ds, "2026-02-01T00:00:00Z");
    await insertRelease("rel_a", ds, "2026-01-01T00:00:00Z");

    expect((await itemOf(ds)).latestRelease).toEqual({
      id: "rel_b",
      createdAt: "2026-02-01T00:00:00Z",
      message: null,
    });
  });

  test("an app on the older release has a newer release and an app on the latest does not", async () => {
    const ds = await addDesignSystem();
    await insertRelease("rel_a", ds, "2026-01-01T00:00:00Z");
    await insertRelease("rel_b", ds, "2026-02-01T00:00:00Z");

    const onOlder = await addApp({ designSystem: ds, release: "rel_a" }, "Old");
    const onLatest = await addApp(
      { designSystem: ds, release: "rel_b" },
      "Latest",
    );

    expect((await itemOf(onOlder)).hasNewerRelease).toBe(true);
    expect((await itemOf(onLatest)).hasNewerRelease).toBe(false);
  });
});

describe("recent files", () => {
  test("twelve files recorded a second apart list the newest ten, newest first", async () => {
    let now = Date.parse("2026-03-01T00:00:00Z");
    const clock = () => new Date((now += 1000));
    for (let i = 1; i <= 12; i++) {
      const name = `f${String(i).padStart(2, "0")}`;
      const result = await addFile(db, { kind: "designSystem", name }, clock);
      expect(result.ok).toBe(true);
    }

    const { status, body } = await get("/api/files/recent");

    expect(status).toBe(200);
    expect(body.files.map((file: Item) => file.name)).toEqual([
      "f12",
      "f11",
      "f10",
      "f09",
      "f08",
      "f07",
      "f06",
      "f05",
      "f04",
      "f03",
    ]);
  });
});
