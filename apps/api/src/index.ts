import { app } from "./app";
import { DocumentSessionBase, type CatalogPort } from "./session";
import { d1SessionCatalog } from "./session-catalog";

export class DocumentSession extends DocumentSessionBase {
  protected catalog(): CatalogPort {
    return d1SessionCatalog(this.env.DB);
  }
}

export default app;
