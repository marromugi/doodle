import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import { Client, human } from "../session/test-client";
import { createFile } from "./create-file";
import { documentSessionsFromEnv } from "./sessions-port";
import { fakes } from "./test-ports";

describe("createFile", () => {
  test("an app named Shop is created and the catalog lists an app named Shop", async () => {
    const { catalog, ports } = fakes();

    const result = await createFile(ports, {
      kind: "app",
      name: "Shop",
      reference: null,
    });

    expect(result).toEqual({ ok: true, fileId: expect.any(String) });
    expect(catalog.files).toMatchObject([{ kind: "app", name: "Shop" }]);
  });

  test("design systems named with 50 characters and with 1 character are both created", async () => {
    const { ports } = fakes();

    const long = await createFile(ports, {
      kind: "designSystem",
      name: "a".repeat(50),
    });
    const short = await createFile(ports, { kind: "designSystem", name: "a" });

    expect(long.ok).toBe(true);
    expect(short.ok).toBe(true);
  });

  test.each(["", "a".repeat(51)])(
    "the name %j is refused for its name and nothing is created",
    async (name) => {
      const { catalog, sessions, ports } = fakes();

      const result = await createFile(ports, { kind: "designSystem", name });

      expect(result).toMatchObject({ ok: false, code: "invalid_name" });
      expect(catalog.files).toEqual([]);
      expect(sessions.contents.size).toBe(0);
    },
  );

  test("a name of only spaces is refused for its name and no file or document is created", async () => {
    const { catalog, sessions, ports } = fakes();

    const result = await createFile(ports, {
      kind: "app",
      name: "   ",
      reference: null,
    });

    expect(result).toMatchObject({ ok: false, code: "invalid_name" });
    expect(catalog.files).toEqual([]);
    expect(sessions.contents.size).toBe(0);
  });

  test("two apps named Shop are both created with different IDs and both are listed", async () => {
    const { catalog, ports } = fakes();

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

    if (!first.ok || !second.ok) throw new Error("the apps were not created");
    expect(first.fileId).not.toBe(second.fileId);
    expect(catalog.files.filter((file) => file.name === "Shop")).toHaveLength(
      2,
    );
  });

  test("an app that names release rel_1 of ds_1 references it, and an app without a reference is created too", async () => {
    const { catalog, ports } = fakes();
    catalog.releases.push({ designSystem: "ds_1", release: "rel_1" });

    const referencing = await createFile(ports, {
      kind: "app",
      name: "Shop",
      reference: { designSystem: "ds_1", release: "rel_1" },
    });
    const plain = await createFile(ports, {
      kind: "app",
      name: "Plain",
      reference: null,
    });

    expect(referencing.ok && plain.ok).toBe(true);
    expect(catalog.files).toMatchObject([
      { name: "Shop", reference: { designSystem: "ds_1", release: "rel_1" } },
      { name: "Plain", reference: null },
    ]);
  });

  test("a design system Tokens registers one draft document of that file, and a client reads a draft without tokens or components", async () => {
    const { catalog, ports } = fakes();
    const realSessions = { ...ports, sessions: documentSessionsFromEnv(env) };

    const result = await createFile(realSessions, {
      kind: "designSystem",
      name: "Tokens",
    });

    if (!result.ok) throw new Error(result.message);
    expect(catalog.registrations).toEqual([
      {
        id: result.draftDocumentId,
        file: result.fileId,
        kind: "dsDraft",
        page: null,
        request: null,
        release: null,
      },
    ]);
    const client = await Client.connect(result.draftDocumentId!, human);
    expect(await client.read()).toMatchObject({
      type: "document",
      document: {
        kind: "draft",
        tokens: { color: {}, typography: {}, space: {}, radius: {} },
        components: {},
      },
    });
  });

  test("when the catalog refuses the draft registration with an ID in use, the file fails as registration_failed and the draft document is erased", async () => {
    const { catalog, sessions, ports } = fakes();
    catalog.answer.writeDesignSystemFile = { status: "id_in_use" };

    const result = await createFile(ports, {
      kind: "designSystem",
      name: "Tokens",
    });

    expect(result).toMatchObject({ ok: false, code: "registration_failed" });
    expect(sessions.erased).toEqual([...sessions.contents.keys()]);
    expect(sessions.erased).toHaveLength(1);
  });

  test("when the draft cannot be initialised, the file fails as initialization_failed and the catalog has no file named Tokens", async () => {
    const { catalog, sessions, ports } = fakes();
    sessions.initializeStatus = "already_initialized";

    const result = await createFile(ports, {
      kind: "designSystem",
      name: "Tokens",
    });

    expect(result).toMatchObject({ ok: false, code: "initialization_failed" });
    expect(catalog.files.filter((file) => file.name === "Tokens")).toEqual([]);
    expect(catalog.registrations).toEqual([]);
  });

  test("an app that references a release the catalog does not have fails as reference_not_found and no Shop exists", async () => {
    const { catalog, sessions, ports } = fakes();

    const result = await createFile(ports, {
      kind: "app",
      name: "Shop",
      reference: { designSystem: "ds_1", release: "rel_x" },
    });

    expect(result).toMatchObject({ ok: false, code: "reference_not_found" });
    expect(catalog.files).toEqual([]);
    expect(sessions.initializeCalls).toEqual([]);
  });
});
