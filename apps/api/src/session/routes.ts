import { Hono } from "hono";

export const sessionRoutes = new Hono<{ Bindings: Env }>();

// The client declares itself in the query: `kind=human`, or `kind=agent&agentId=…`.
sessionRoutes.get("/documents/:id/session", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected a WebSocket upgrade.", 426);
  }
  return await c.env.DOCUMENT_SESSION.getByName(c.req.param("id")).fetch(
    c.req.raw,
  );
});
