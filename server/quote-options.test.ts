import { describe, expect, it } from "vitest";
import { redactAnthropicSecrets, stagingQuoteErrorPayload, summarizeAnthropicError } from "./quote-options";

describe("summarizeAnthropicError", () => {
  it("extracts type and message from the standard Anthropic error envelope", () => {
    const detail = summarizeAnthropicError(
      400,
      JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message: "temperature is not supported" },
      }),
    );
    expect(detail).toEqual({
      anthropicStatus: 400,
      anthropicType: "invalid_request_error",
      anthropicMessage: "temperature is not supported",
    });
  });

  it("never echoes an API key from the body", () => {
    const detail = summarizeAnthropicError(
      401,
      JSON.stringify({
        error: { type: "authentication_error", message: "invalid x-api-key sk-ant-secret123456" },
      }),
    );
    expect(detail.anthropicMessage).toContain("[redacted]");
    expect(detail.anthropicMessage).not.toContain("sk-ant-");
    expect(redactAnthropicSecrets("Bearer sk-ant-abc_def")).toBe("Bearer [redacted]");
  });

  it("truncates a non-JSON body", () => {
    const detail = summarizeAnthropicError(404, "not json " + "x".repeat(400));
    expect(detail.anthropicStatus).toBe(404);
    expect(detail.anthropicType).toBeNull();
    expect(detail.anthropicMessage?.length).toBe(300);
  });
});

describe("stagingQuoteErrorPayload", () => {
  it("echoes stage and redacts keys from detail", () => {
    const payload = stagingQuoteErrorPayload({
      message: "Quote writer is unavailable",
      quoteStage: "fetch",
      anthropicStatus: 401,
      anthropicType: "authentication_error",
      anthropicMessage: "API key is invalid.",
      quoteDetail: "got sk-ant-secret123",
    });
    expect(payload.quoteStage).toBe("fetch");
    expect(payload.anthropicStatus).toBe(401);
    expect(String(payload.quoteDetail)).toContain("[redacted]");
    expect(JSON.stringify(payload)).not.toContain("sk-ant-");
  });
});
