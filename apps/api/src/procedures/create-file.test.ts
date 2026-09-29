import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import { Client, human } from "../session/test-client";
import { sessionsFromEnv } from "./adapters";
import { createFile } from "./create-file";
import { fakeCatalog, fakeSessions } from "./test-ports";

const setup = () => {
  const catalog = fakeCatalog();
  const sessions = fakeSessions();
  return { catalog, sessions, ports: { catalog, sessions } };
};

const names = (catalog: { files: { name: string }[] }) =>
  catalog.files.map((file) => file.name);

describe("createFile", () => {
  test("an app named Shop is created and appears in the catalog", async () => {
    const { catalog, ports } = setup();

    const result = await createFile(ports, {
      kind: "app",
      name: "Shop",
      reference: null,
    });

    expect(result.ok).toBe(true);
    expect(catalog.files).toMatchObject([{ kind: "app", name: "Shop" }]);
  });

  test("design systems with a 50 character name and a 1 character name are created", async () => {
    const { ports } = setup();

    const long = await createFile(ports, {
      kind: "designSystem",
      name: "a".repeat(50),
    });
    const short = await createFile(ports, { kind: "designSystem", name: "a" });

    expect(long.ok).toBe(true);
    expect(short.ok).toBe(true);
  });

  test("an empty name and a 51 character name are refused for their name and create nothing", async () => {
    const { catalog, sessions, ports } = setup();

    for (const name of ["", "a".repeat(51)]) {
      const result = await createFile(ports, {
        kind: "app",
        name,
        reference: null,
      });
      expect(result).toMatchObject({ ok: false, code: "invalid_name" });
    }

    expect(catalog.files).toEqual([]);
    expect(sessions.contents.size).toBe(0);
  });

  test("a name of only whitespace is refused for its name and creates nothing", async () => {
    const { catalog, sessions, ports } = setup();

    const result = await createFile(ports, {
      kind: "app",
      name: "   ",
      reference: null,
    });

    expect(result).toMatchObject({ ok: false, code: "invalid_name" });
    expect(catalog.files).toEqual([]);
    expect(sessions.contents.size).toBe(0);
  });

  test("two apps named Shop are both created with different IDs", async () => {
    const { catalog, ports } = setup();

    const first = await createFile(ports, {
      kind: "app",
      name: "Shop",
      reference: null,
    });
    const second = await createFile(ports, {
      kind: "app",
      name: "Shop",
      reference: null,
    });

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.fileId).not.toBe(second.fileId);
    expect(names(catalog)).toEqual(["Shop", "Shop"]);
  });

  test("an app made with a release reference keeps it, and one made without has none", async () => {
    const { catalog, ports } = setup();

    await createFile(ports, {
      kind: "app",
      name: "Shop",
      reference: { designSystem: "ds_1", release: "rel_1" },
    });
    const plain = await createFile(ports, {
      kind: "app",
      name: "Plain",
      reference: null,
    });

    expect(plain.ok).toBe(true);
    expect(catalog.files).toMatchObject([
      { name: "Shop", reference: { designSystem: "ds_1", release: "rel_1" } },
      { name: "Plain", reference: null },
    ]);
  });

  test("a design system named Tokens gets one registered draft document that a client reads as empty", async () => {
    const { catalog } = setup();

    const result = await createFile(
      { catalog, sessions: sessionsFromEnv(env) },
      { kind: "designSystem", name: "Tokens" },
    );

    if (!result.ok) throw new Error(result.message);
    expect(catalog.files).toMatchObject([{ id: result.fileId, name: "Tokens" }]);
    expect(catalog.documents).toEqual([
      {
        id: result.draftDocumentId,
        file: result.fileId,
        kind: "dsDraft",
        release: null,
      },
    ]);
    const client = await Client.connect(result.draftDocumentId!, human);
    const read = await client.read();
    expect(read).toMatchObject({
      type: "document",
      document: {
        kind: "draft",
        tokens: { color: {}, typography: {}, space: {}, radius: {} },
        components: {},
      },
    });
  });

  test("when the registry refuses the draft, the design system fails, the draft is erased and no file is left", async () => {
    const { catalog, sessions, ports } = setup();
    catalog.failRegistration = true;

    const result = await createFile(ports, {
      kind: "designSystem",
      name: "Tokens",
    });

    expect(result).toMatchObject({ ok: false, code: "registration_failed" });
    expect(names(catalog)).not.toContain("Tokens");
    expect(sessions.erased).toEqual([...sessions.contents.keys()]);
    expect(sessions.erased).toHaveLength(1);
  });

  test("when the draft cannot be initialised, the design system fails and no file is left", async () => {
    const { catalog, sessions, ports } = setup();
    sessions.result = {
      ok: false,
      code: "already_initialized",
      message: "The document already has content.",
    };

    const result = await createFile(ports, {
      kind: "designSystem",
      name: "Tokens",
    });

    expect(result).toMatchObject({ ok: false, code: "initialization_failed" });
    expect(names(catalog)).not.toContain("Tokens");
    expect(catalog.documents).toEqual([]);
  });
});
