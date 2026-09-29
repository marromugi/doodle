import { Hono } from "hono";

export const sessionRoutes = new Hono<{ Bindings: Env }>();

// The client declares itself in the query: `kind=human`, or `kind=agent&agentId=…`.
sessionRoutes.get("/documents/:id/session", async (c) => {
  return await c.env.DOCUMENT_SESSION.getByName(c.req.param("id")).fetch(
    c.req.raw,
  );
});
