import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANDING_CONTENT,
  isSafeLandingImageUrl,
  mergeLandingContent,
  parseLandingContentJson,
} from "./landingContent";

describe("isSafeLandingImageUrl", () => {
  it("allows empty, object-storage paths, and https", () => {
    expect(isSafeLandingImageUrl("")).toBe(true);
    expect(isSafeLandingImageUrl("/objects/uploads/abc.png")).toBe(true);
    expect(isSafeLandingImageUrl("https://cdn.example.com/tee.jpg")).toBe(true);
  });

  it("rejects unsafe schemes and path traversal", () => {
    expect(isSafeLandingImageUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLandingImageUrl("data:image/png;base64,aaaa")).toBe(false);
    expect(isSafeLandingImageUrl("/objects/../secret")).toBe(false);
    expect(isSafeLandingImageUrl("http://insecure.example/x.png")).toBe(false);
  });
});

describe("mergeLandingContent", () => {
  it("returns defaults for empty input", () => {
    const merged = mergeLandingContent(null);
    expect(merged.copy.landingHeadline).toBe(DEFAULT_LANDING_CONTENT.copy.landingHeadline);
    expect(merged.scenes.length).toBeGreaterThan(0);
    expect(merged.cards.length).toBeGreaterThan(0);
  });

  it("overrides copy and keeps other defaults", () => {
    const merged = mergeLandingContent({
      copy: { landingHeadline: "Promote. Prompt. Print." },
    });
    expect(merged.copy.landingHeadline).toBe("Promote. Prompt. Print.");
    expect(merged.copy.splashCaption).toBe(DEFAULT_LANDING_CONTENT.copy.splashCaption);
  });

  it("replaces scenes and drops empty prompts", () => {
    const merged = mergeLandingContent({
      scenes: [
        { id: "a", prompt: "Golden retriever on a tote", imageUrl: "/objects/uploads/tote.jpg" },
        { prompt: "   " },
      ],
    });
    expect(merged.scenes).toHaveLength(1);
    expect(merged.scenes[0].prompt).toBe("Golden retriever on a tote");
    expect(merged.scenes[0].imageUrl).toBe("/objects/uploads/tote.jpg");
  });

  it("strips unsafe card images", () => {
    const merged = mergeLandingContent({
      cards: [{ title: "We print it", body: "Fulfilment handled.", imageUrl: "javascript:bad" }],
    });
    expect(merged.cards[0].imageUrl).toBe("");
    expect(merged.cards[0].title).toBe("We print it");
  });
});

describe("parseLandingContentJson", () => {
  it("falls back on invalid JSON", () => {
    expect(parseLandingContentJson("{not json").copy.splashCta).toBe(
      DEFAULT_LANDING_CONTENT.copy.splashCta,
    );
  });
});
