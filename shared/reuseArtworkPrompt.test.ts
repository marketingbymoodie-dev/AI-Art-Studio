import { describe, expect, it } from "vitest";
import {
  REUSE_REGENERATE_PREFIX,
  buildReuseRegeneratePrompt,
  composeReuseRegenerateUserPrompt,
  isReuseRegeneratePrompt,
  unwrapReuseOriginalIdea,
} from "./reuseArtworkPrompt";
import { userPromptRequestsPattern } from "./stylePromptCompatibility";

describe("reuseArtworkPrompt", () => {
  it("keeps a plain idea", () => {
    expect(unwrapReuseOriginalIdea("angry bird")).toBe("angry bird");
    expect(buildReuseRegeneratePrompt("angry bird")).toBe(
      `${REUSE_REGENERATE_PREFIX} Original idea: angry bird`,
    );
  });

  it("unwraps nested recreate wrappers", () => {
    const nested =
      "Recreate this artwork as a SINGLE centered motif. Do not tile. Original idea: Recreate this artwork as closely as possible for the new product aspect ratio. Original idea: angry bird";
    expect(unwrapReuseOriginalIdea(nested)).toBe("angry bird");
    expect(buildReuseRegeneratePrompt(nested)).toBe(
      `${REUSE_REGENERATE_PREFIX} Original idea: angry bird`,
    );
  });

  it("does not look like a pattern request", () => {
    expect(userPromptRequestsPattern(buildReuseRegeneratePrompt("angry bird"))).toBe(false);
  });

  it("detects reuse regenerate prompts", () => {
    expect(isReuseRegeneratePrompt(buildReuseRegeneratePrompt("mona lisa"))).toBe(true);
    expect(isReuseRegeneratePrompt("a watercolor of the mona lisa")).toBe(false);
  });

  it("appends optional customer changes", () => {
    expect(
      composeReuseRegenerateUserPrompt(
        buildReuseRegeneratePrompt("angry bird"),
        "change the colours from red to green",
      ),
    ).toBe(
      `${REUSE_REGENERATE_PREFIX} Original idea: angry bird change the colours from red to green`,
    );
  });
});
