import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "apps/api",
      "packages/design-doc",
      "apps/web/vitest.unit.config.ts",
      "apps/web/vitest.storybook.config.ts",
    ],
  },
});
