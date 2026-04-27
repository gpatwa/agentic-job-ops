import { describe, expect, it, vi } from "vitest";
import { fetchAiProbe } from "../src/services/resumeIntelligenceApiClient";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

const VALID_PROBE = {
  ok: true,
  provider: "openai",
  model: "gpt-4.1-mini",
  latencyMs: 320,
  observedAt: new Date().toISOString(),
  cached: false,
  staleAfterMs: 60000
};

describe("fetchAiProbe", () => {
  it("returns the parsed snapshot on a 200 response", async () => {
    const fetchImpl = vi.fn(
      async (
        _input: string | URL | Request,
        _init?: RequestInit
      ): Promise<Response> => jsonResponse(VALID_PROBE)
    );
    const out = await fetchAiProbe({
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(out?.ok).toBe(true);
    expect(out?.provider).toBe("openai");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [path] = fetchImpl.mock.calls[0];
    expect(path).toBe("/api/ai/probe");
  });

  it("appends ?force=1 when force is set", async () => {
    const fetchImpl = vi.fn(
      async (
        _input: string | URL | Request,
        _init?: RequestInit
      ): Promise<Response> => jsonResponse(VALID_PROBE)
    );
    await fetchAiProbe({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      force: true
    });
    const [path] = fetchImpl.mock.calls[0];
    expect(path).toBe("/api/ai/probe?force=1");
  });

  it("returns null when the API server is unreachable (no exception thrown)", async () => {
    const fetchImpl = vi.fn(
      async (): Promise<Response> => {
        throw new TypeError("Failed to fetch");
      }
    );
    const out = await fetchAiProbe({
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(out).toBeNull();
  });

  it("returns null on a 5xx response", async () => {
    const fetchImpl = vi.fn(
      async (): Promise<Response> => jsonResponse({ error: "down" }, { status: 503 })
    );
    const out = await fetchAiProbe({
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(out).toBeNull();
  });
});
