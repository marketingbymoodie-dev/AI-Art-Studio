import { describe, expect, it } from "vitest";
import {
  isContext1MockupLabel,
  isContextLikeMockupLabel,
  isFrontPersonMockupLabel,
  isOnPersonMockupLabel,
  isPersonMockupLabel,
  lifestyleMockupPreferenceRank,
  normalizeMockupCameraLabel,
  personMockupPreferenceRank,
} from "./printifyMockupLabels";

describe("isContextLikeMockupLabel", () => {
  it("accepts lifestyle / context / room cameras", () => {
    expect(isContextLikeMockupLabel("lifestyle")).toBe(true);
    expect(isContextLikeMockupLabel("context-1")).toBe(true);
    expect(isContextLikeMockupLabel("Context 2")).toBe(true);
    expect(isContextLikeMockupLabel("context2")).toBe(true);
    expect(isContextLikeMockupLabel("Lifestyle Room")).toBe(true);
    expect(isContextLikeMockupLabel("Lifestyle Woman")).toBe(true);
    expect(isContextLikeMockupLabel("Lifestyle Man")).toBe(true);
    expect(isContextLikeMockupLabel("bedroom")).toBe(true);
    expect(isContextLikeMockupLabel("wall")).toBe(true);
  });

  it("accepts Printify On Person lifestyle cameras", () => {
    expect(isContextLikeMockupLabel("On Person")).toBe(true);
    expect(isContextLikeMockupLabel("on+person")).toBe(true);
    expect(isContextLikeMockupLabel("on-person")).toBe(true);
    expect(isContextLikeMockupLabel("on-person-1-front")).toBe(true);
  });

  it("ranks On Person above Context 1 for Lifestyle Shot", () => {
    expect(lifestyleMockupPreferenceRank("on-person")).toBeLessThan(
      lifestyleMockupPreferenceRank("context-1"),
    );
    expect(lifestyleMockupPreferenceRank("on-person")).toBeLessThan(
      lifestyleMockupPreferenceRank("context-2"),
    );
    expect(isOnPersonMockupLabel("On Person")).toBe(true);
    expect(isContext1MockupLabel("context-1")).toBe(true);
    expect(isContext1MockupLabel("context-2")).toBe(false);
  });

  it("rejects flatlay and side-person cameras", () => {
    expect(isContextLikeMockupLabel("front")).toBe(false);
    expect(isContextLikeMockupLabel("front side")).toBe(false);
    expect(isContextLikeMockupLabel("side person")).toBe(false);
    expect(isContextLikeMockupLabel("front person")).toBe(false);
    expect(isContextLikeMockupLabel("back")).toBe(false);
  });
});

describe("normalizeMockupCameraLabel", () => {
  it("normalizes plus and underscores", () => {
    expect(normalizeMockupCameraLabel("Front+Side")).toBe("front side");
    expect(normalizeMockupCameraLabel("context_1")).toBe("context 1");
  });
});

describe("person mockup labels", () => {
  it("accepts Front / Side / Back Person and ranks Front first", () => {
    expect(isFrontPersonMockupLabel("Front Person")).toBe(true);
    expect(isPersonMockupLabel("front-person")).toBe(true);
    expect(isPersonMockupLabel("Side Person")).toBe(true);
    expect(isPersonMockupLabel("back person")).toBe(true);
    expect(isPersonMockupLabel("front side")).toBe(false);
    expect(personMockupPreferenceRank("Front Person")).toBeLessThan(
      personMockupPreferenceRank("Side Person"),
    );
    expect(personMockupPreferenceRank("Side Person")).toBeLessThan(
      personMockupPreferenceRank("Back Person"),
    );
  });

  it("treats zip-hoodie on-person-N-front as person, not tote On Person", () => {
    expect(isPersonMockupLabel("on-person-1-front")).toBe(true);
    expect(isPersonMockupLabel("on-person-2-front")).toBe(true);
    expect(isFrontPersonMockupLabel("on-person-1-front")).toBe(true);
    expect(isPersonMockupLabel("on-person-1-back")).toBe(true);
    expect(isPersonMockupLabel("On Person")).toBe(false);
    expect(isPersonMockupLabel("on-person")).toBe(false);
    expect(isOnPersonMockupLabel("On Person")).toBe(true);
    expect(personMockupPreferenceRank("on-person-1-front")).toBe(
      personMockupPreferenceRank("Front Person"),
    );
  });
});
