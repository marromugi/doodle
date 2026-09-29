import { defineConfig } from "orval";

export default defineConfig({
  api: {
    input: "../api/openapi.json",
    output: {
      target: "src/api/generated",
      mode: "tags-split",
      client: "react-query",
      httpClient: "fetch",
      clean: true,
      formatter: "prettier",
      override: {
        query: { useQuery: true, useSuspenseQuery: true },
      },
    },
  },
});
