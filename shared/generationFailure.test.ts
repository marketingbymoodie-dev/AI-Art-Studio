import { describe, expect, it } from "vitest";
import {
  classifyGenerationFailure,
  extractHttpErrorPayload,
} from "./generationFailure";

describe("classifyGenerationFailure", () => {
  it("honors a typed API code in an HTTP error body", () => {
    const err = new Error(
      `HTTP 422: ${JSON.stringify({
        code: "CONTENT_PROMPT",
        message: "Your description was flagged — please edit it and try again.",
      })}`,
    );
    const c = classifyGenerationFailure(err);
    expect(c.kind).toBe("content_prompt");
    expect(c.code).toBe("CONTENT_PROMPT");
    expect(extractHttpErrorPayload(err)?.code).toBe("CONTENT_PROMPT");
  });

  it("classifies a 90s timeout as retriable", () => {
    const c = classifyGenerationFailure(
      new Error("Request to /api/generate timed out after 90000ms"),
    );
    expect(c.kind).toBe("retriable");
    expect(c.userMessage).toMatch(/too long/i);
  });

  it("classifies OpenAI/Replicate safety text as content, and names the image when mentioned", () => {
    const prompt = classifyGenerationFailure(
      "Replicate generation failed: Your request was rejected as a result of our safety system.",
    );
    expect(prompt.kind).toBe("content_both");
    const image = classifyGenerationFailure(
      "The input image was rejected by the safety system.",
    );
    expect(image.kind).toBe("content_reference");
  });

  it("does not treat the gpt-image-2 transparent reject as user content", () => {
    const c = classifyGenerationFailure(
      "gpt-image-2 rejected background:transparent (HTTP 400).",
    );
    expect(c.kind).toBe("retriable");
  });

  it("defaults a bland 500 to retriable", () => {
    const c = classifyGenerationFailure(
      new Error(`HTTP 500: ${JSON.stringify({ error: "Failed to generate artwork" })}`),
    );
    expect(c.kind).toBe("retriable");
  });
});
