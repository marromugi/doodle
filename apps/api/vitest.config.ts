import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  // The first browser launch on a machine downloads Chrome.
  test: { name: "api", testTimeout: 120_000 },
});
