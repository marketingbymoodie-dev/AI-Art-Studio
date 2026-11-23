import { describe, expect, it } from "vitest";
import { chooseMyPetPanelId } from "./my-pet-panel";

const comfort = "comfort-colours-1717-white-hex-ffffff-colour";

describe("chooseMyPetPanelId", () => {
  it("keeps the candidate panel when that scene exists on the product type", () => {
    expect(chooseMyPetPanelId(comfort, [
      { panelId: comfort, isDefault: true, kind: "white-master" },
      { panelId: comfort, isDefault: true, kind: "produced" },
    ])).toBe(comfort);
  });

  it("does not reuse a panel that belongs to another type", () => {
    expect(chooseMyPetPanelId(comfort, [
      { panelId: "Mockup_02", isDefault: false, kind: "white-master" },
      { panelId: "Mockup_01", isDefault: true, kind: "white-master" },
      { panelId: "Mockup_01", isDefault: true, kind: "produced" },
    ])).toBe("Mockup_01");
  });

  it("falls back to the type's white master when nothing is marked default", () => {
    expect(chooseMyPetPanelId(comfort, [
      { panelId: "Mockup_08", kind: "white-master" },
      { panelId: "Mockup_01", kind: "produced" },
    ])).toBe("Mockup_08");
  });

  it("returns null when the product type has no scenes", () => {
    expect(chooseMyPetPanelId(comfort, [])).toBeNull();
  });
});
