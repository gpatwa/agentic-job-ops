import { describe, expect, it } from "vitest";
import {
  looksLikeSecret,
  redactErrorForLog,
  redactForLog,
  truncateForLog
} from "../../server/security/redaction";

describe("looksLikeSecret", () => {
  it("treats sk- prefixed strings as secrets", () => {
    expect(looksLikeSecret("sk-abc123def4567890")).toBe(true);
  });

  it("treats Bearer-prefixed strings as secrets", () => {
    expect(looksLikeSecret("Bearer abcdef0123456789")).toBe(true);
  });

  it("treats long base64-ish runs as secrets", () => {
    expect(looksLikeSecret("Q2FtZWwgQ2FzZSBhbmQgZ29vZCBzdHVmZg")).toBe(true);
  });

  it("does not treat short strings as secrets", () => {
    expect(looksLikeSecret("hello")).toBe(false);
    expect(looksLikeSecret("sk-tiny")).toBe(false);
  });

  it("does not treat regular sentences as secrets", () => {
    expect(looksLikeSecret("This is a perfectly normal log line.")).toBe(false);
  });
});

describe("truncateForLog", () => {
  it("returns short strings unchanged", () => {
    expect(truncateForLog("hi")).toBe("hi");
  });

  it("truncates long strings with a length annotation", () => {
    const long = "a".repeat(200);
    const out = truncateForLog(long, 64);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("more chars");
  });
});

describe("redactForLog", () => {
  it("collapses string values on key-name patterns", () => {
    const out = redactForLog({
      OPENAI_API_KEY: "sk-very-real-key-1234567890",
      AZURE_OPENAI_API_KEY: "azure-key",
      Authorization: "Bearer abcdef0123456789"
    });
    expect(out).toEqual({
      OPENAI_API_KEY: "[redacted-secret]",
      AZURE_OPENAI_API_KEY: "[redacted-secret]",
      Authorization: "[redacted-secret]"
    });
  });

  it("collapses user-content fields without echoing the value", () => {
    const out = redactForLog({
      resumeText: "Jane Doe\nSenior Product Manager\n+1 555 555 0100",
      coverLetter: "Dear hiring manager…",
      answers: ["a", "b", "c", "d", "e", "f"]
    });
    expect(out).toEqual({
      resumeText: expect.stringMatching(/^\[redacted-user-content len=\d+\]$/),
      coverLetter: expect.stringMatching(/^\[redacted-user-content len=\d+\]$/),
      answers: expect.stringMatching(/^\[redacted-user-content count=\d+\]$/)
    });
  });

  it("redacts secret-shaped string VALUES even on benign keys", () => {
    const out = redactForLog({
      note: "sk-abcdef0123456789012345"
    }) as Record<string, unknown>;
    expect(out.note).toBe("[redacted-secret]");
  });

  it("recursively walks nested structures", () => {
    const out = redactForLog({
      headers: { Authorization: "Bearer abcdef0123456789" },
      meta: { resumeText: "long content here" }
    }) as Record<string, Record<string, string>>;
    expect(out.headers.Authorization).toBe("[redacted-secret]");
    expect(out.meta.resumeText).toMatch(/^\[redacted-user-content len=/);
  });

  it("truncates long benign strings instead of dropping them", () => {
    // The string must contain whitespace/punctuation so the long-
    // base64-ish secret heuristic doesn't claim it.
    const benign = ("Lorem ipsum dolor sit amet, " as string).repeat(40);
    const out = redactForLog({
      summary: benign
    }) as Record<string, string>;
    expect(out.summary).toContain("more chars");
    expect(out.summary).not.toContain("[redacted-secret]");
  });
});

describe("redactErrorForLog", () => {
  it("preserves error name and redacts sk- secrets in the message", () => {
    const out = redactErrorForLog(new Error("OpenAI key sk-secret-12345678 rejected"));
    expect(out.name).toBe("Error");
    expect(out.message).toContain("sk-[redacted]");
    expect(out.message).not.toContain("sk-secret");
  });

  it("redacts long token-shaped substrings", () => {
    const out = redactErrorForLog(new Error("token=abcdef0123456789abcdef0123456789abcdef0123456789 rejected"));
    expect(out.message).toContain("[redacted-token]");
  });

  it("handles non-Error inputs", () => {
    const out = redactErrorForLog("plain string error");
    expect(out.name).toBe("UnknownError");
    expect(out.message).toBe("plain string error");
  });
});
