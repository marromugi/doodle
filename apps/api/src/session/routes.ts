import { Hono } from "hono";

import { DOCUMENT_ID_HEADER } from "./connection";

export const sessionRoutes = new Hono<{ Bindings: Env }>().get(
  "/documents/:documentId/session",
  (c) => {
    const documentId = c.req.param("documentId");
    const stub = c.env.DOCUMENT_SESSION.get(
      c.env.DOCUMENT_SESSION.idFromName(documentId),
    );
    const request = new Request(c.req.raw);
    request.headers.set(DOCUMENT_ID_HEADER, documentId);
    return stub.fetch(request);
  },
);
