import { getAiStatusSnapshot, getServerConfig } from "../config/env";
import type { AiStatusSnapshot } from "../config/env";

/**
 * GET /api/ai/status
 *
 * Returns the redacted provider snapshot. The frontend uses this
 * to know whether to attempt the live LLM path or skip straight to
 * deterministic, and to label the source badge in the UI.
 *
 * Hard rule: this response must NEVER include the API key, the
 * Azure endpoint host, or any other secret-shaped value. The
 * snapshot is built from `getAiStatusSnapshot` which enforces that
 * contract.
 */
export function getAiStatusResponse(): {
  status: number;
  body: AiStatusSnapshot;
} {
  return {
    status: 200,
    body: getAiStatusSnapshot(getServerConfig())
  };
}
