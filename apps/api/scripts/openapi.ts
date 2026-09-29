import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { app, openAPIConfig } from "../src/app";

const doc = app.getOpenAPI31Document(openAPIConfig);
writeFileSync(
  resolve(import.meta.dirname, "../openapi.json"),
  `${JSON.stringify(doc, null, 2)}\n`,
);
