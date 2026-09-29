import { resolve } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    resolve(import.meta.dirname, "migrations"),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // The session tests run the worker with the session wired to a fake catalog.
        main: "./src/session/test-worker.ts",
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
          durableObjects: { FAKE_CATALOG: "FakeCatalog" },
        },
      }),
    ],
    test: {
      name: "api",
      // The first browser launch on a machine downloads Chrome.
      testTimeout: 120_000,
      setupFiles: ["./src/test-setup.ts"],
    },
  };
});
