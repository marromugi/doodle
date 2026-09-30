import { describe, expect, test } from "vitest";

import { createFileProcedureRoutes } from "./routes";
import { addFile, addRequest, fakes, type Fakes } from "./test-ports";

const reference = { designSystem: "ds_1", release: "rel_1" };

const post = async (setup: Fakes, path: string, body: unknown) => {
  const routes = createFileProcedureRoutes(() => setup.ports);
  const response = await routes.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
};

describe("the file creation routes", () => {
  test("a refused registration of the page and its skeleton answers registration_failed with 500 and the created skeleton is erased", async () => {
    const setup = fakes();
    const app = addFile(setup.catalog, { kind: "app" });
    setup.catalog.answer.writePageWithSkeleton = { status: "id_in_use" };

    const response = await post(setup, `/files/${app}/pages`, {
      name: "ホーム",
    });

    expect(response).toMatchObject({
      status: 500,
      body: { code: "registration_failed" },
    });
    expect(setup.sessions.erased).toEqual([...setup.sessions.contents.keys()]);
    expect(setup.sessions.erased).toHaveLength(1);
  });

  test("a page for a file the catalog does not have answers file_not_found with 404, and for a design system file not_an_app with 400, and nothing is initialised or written", async () => {
    const setup = fakes();
    addFile(setup.catalog, { id: "ds_1", kind: "designSystem" });

    const missing = await post(setup, "/files/f_x/pages", { name: "ホーム" });
    const notApp = await post(setup, "/files/ds_1/pages", { name: "ホーム" });

    expect(missing).toMatchObject({
      status: 404,
      body: { code: "file_not_found" },
    });
    expect(notApp).toMatchObject({
      status: 400,
      body: { code: "not_an_app" },
    });
    expect(setup.sessions.initializeCalls).toEqual([]);
    expect(setup.catalog.pages).toEqual([]);
    expect(setup.catalog.registrations).toEqual([]);
  });

  test("a candidate for a request that does not exist answers request_not_found with 404, and for a request whose page is missing catalog_inconsistent with 500, and nothing is initialised", async () => {
    const setup = fakes();
    setup.catalog.requests.push({
      id: "req_2",
      page: "p_gone",
      state: "inProgress",
      agent: "agt_A",
    });

    const missing = await post(setup, "/requests/req_none/candidate", {
      agentId: "agt_A",
    });
    const inconsistent = await post(setup, "/requests/req_2/candidate", {
      agentId: "agt_A",
    });

    expect(missing).toMatchObject({
      status: 404,
      body: { code: "request_not_found" },
    });
    expect(inconsistent).toMatchObject({
      status: 500,
      body: { code: "catalog_inconsistent" },
    });
    expect(setup.sessions.initializeCalls).toEqual([]);
  });

  test("an app that references release rel_x, which the catalog does not have, answers reference_not_found with 404 and no Shop exists", async () => {
    const setup = fakes();

    const response = await post(setup, "/files", {
      kind: "app",
      name: "Shop",
      reference: { designSystem: "ds_1", release: "rel_x" },
    });

    expect(response).toMatchObject({
      status: 404,
      body: { code: "reference_not_found" },
    });
    expect(setup.catalog.files.filter((file) => file.name === "Shop")).toEqual(
      [],
    );
  });

  test("a catalog that does not answer the request read gives catalog_unavailable with 503 and nothing is initialised", async () => {
    const setup = fakes();
    setup.catalog.answer.readRequest = { status: "unreachable" };

    const response = await post(setup, "/requests/req_1/candidate", {
      agentId: "agt_A",
    });

    expect(response).toMatchObject({
      status: 503,
      body: { code: "catalog_unavailable" },
    });
    expect(setup.sessions.initializeCalls).toEqual([]);
  });

  test("a session that does not answer the initialisation gives session_unavailable with 503 and no page is added", async () => {
    const setup = fakes();
    const app = addFile(setup.catalog, { kind: "app", reference });
    setup.sessions.initializeStatus = "unreachable";

    const response = await post(setup, `/files/${app}/pages`, {
      name: "ホーム",
    });

    expect(response).toMatchObject({
      status: 503,
      body: { code: "session_unavailable" },
    });
    expect(setup.catalog.pages).toEqual([]);
  });

  test("a catalog write that does not answer gives catalog_unavailable and the skeleton is neither erased nor handed to the erase retry", async () => {
    const setup = fakes();
    const app = addFile(setup.catalog, { kind: "app", reference });
    setup.catalog.answer.writePageWithSkeleton = { status: "unreachable" };

    const response = await post(setup, `/files/${app}/pages`, {
      name: "ホーム",
    });

    expect(response).toMatchObject({
      status: 503,
      body: { code: "catalog_unavailable" },
    });
    expect(setup.sessions.erased).toEqual([]);
    expect(setup.eraseRetry.handed).toEqual([]);
  });

  test("an empty file name answers 400", async () => {
    const setup = fakes();

    const response = await post(setup, "/files", {
      kind: "designSystem",
      name: "",
    });

    expect(response.status).toBe(400);
  });

  test("a candidate asked by an agent that does not hold the request answers 409", async () => {
    const setup = fakes();
    const app = addFile(setup.catalog, { kind: "app" });
    addRequest(setup.catalog, {
      id: "req_1",
      page: "p1",
      file: app,
      state: "inProgress",
      agent: "agt_A",
    });

    const response = await post(setup, "/requests/req_1/candidate", {
      agentId: "agt_B",
    });

    expect(response).toMatchObject({
      status: 409,
      body: { code: "taken_by_another_agent" },
    });
  });

  test("a page whose document cannot be initialised answers 500", async () => {
    const setup = fakes();
    const app = addFile(setup.catalog, { kind: "app" });
    setup.sessions.initializeStatus = "already_initialized";

    const response = await post(setup, `/files/${app}/pages`, {
      name: "ホーム",
    });

    expect(response).toMatchObject({
      status: 500,
      body: { code: "initialization_failed" },
    });
  });
});
