import type { EraseRetry } from "./erase-retry";
import type { EraseRetryPort } from "./ports";

const INSTANCE_NAME = "erase-retry";

type Namespace = { ERASE_RETRY: DurableObjectNamespace<EraseRetry> };

export const eraseRetryStub = (env: Namespace) =>
  env.ERASE_RETRY.get(env.ERASE_RETRY.idFromName(INSTANCE_NAME));

/** The erase retry the create procedures use. A failed call is an unreachable erase retry. */
export const eraseRetryFromEnv = (env: Namespace): EraseRetryPort => ({
  async hand(documentId) {
    try {
      await eraseRetryStub(env).hand(documentId);
      return { status: "accepted" };
    } catch (error) {
      console.error(error);
      return { status: "unreachable" };
    }
  },
});
