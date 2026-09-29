import { FakeCatalog, fakeCatalogPort } from "./fake-catalog";
import { DocumentSessionBase, type CatalogPort } from "./index";

export { default } from "../index";
export { FakeCatalog };

export type TestEnv = Env & {
  FAKE_CATALOG: DurableObjectNamespace<FakeCatalog>;
};

/** The document session wired to the fake catalog. */
export class DocumentSession extends DocumentSessionBase {
  protected catalog(): CatalogPort {
    return fakeCatalogPort(
      (this.env as TestEnv).FAKE_CATALOG.getByName("catalog"),
    );
  }
}
