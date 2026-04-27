/**
 * GET /api/health
 *
 * Lightweight liveness check. Intentionally returns NO secrets,
 * NO version strings that could fingerprint the deployment, and NO
 * provider configuration details. Use /api/ai/status for the
 * (still-redacted) provider snapshot.
 */
export interface HealthResponse {
  ok: true;
  service: "agentic-job-ops-api";
  time: string;
}

export function getHealthResponse(now: () => Date = () => new Date()): {
  status: number;
  body: HealthResponse;
} {
  return {
    status: 200,
    body: {
      ok: true,
      service: "agentic-job-ops-api",
      time: now().toISOString()
    }
  };
}
