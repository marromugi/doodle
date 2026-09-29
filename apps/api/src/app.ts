import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { catalogRoutes } from "./catalog";
import { fileProcedureRoutes } from "./procedures/routes";
import { sessionRoutes } from "./session/routes";

export const app = new OpenAPIHono<{ Bindings: Env }>().basePath("/api");

const HealthSchema = z.object({ status: z.literal("ok") }).openapi("Health");

app.openapi(
  createRoute({
    method: "get",
    path: "/health",
    operationId: "getHealth",
    tags: ["system"],
    responses: {
      200: {
        description: "API が動いています。",
        content: { "application/json": { schema: HealthSchema } },
      },
    },
  }),
  (c) => c.json({ status: "ok" as const }, 200),
);

app.route("/", catalogRoutes);
app.route("/", fileProcedureRoutes);
app.route("/", sessionRoutes);

export const openAPIConfig = {
  openapi: "3.1.0",
  info: { title: "doodle API", version: "0.0.0" },
};

app.doc31("/openapi.json", openAPIConfig);
