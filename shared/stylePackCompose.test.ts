import { describe, expect, it } from "vitest";
import { composeLayeredPrompt, PACK_LAYER_ORDER, wrapLayeredArtworkPrompt } from "./promptLayers";
import { buildPackPromptLayers, type StylePackPromptProfile } from "./stylePackProfiles";
import { parseStyleInputCapabilities } from "./stylePacks";
import { buildRoleReferenceInstruction, normalizeReferenceImages } from "./referenceImages";

const legacyInput = {
  category: "apparel",
  isApparelGeneration: true,
  generationModel: "gpt-image-2",
  catalogSlug: "centered-graphic",
  styleLayer: "T-shirt graphic, centered flat vector illustration, bold clean shapes. Create a centered graphic of",
  subStyleLayer: "Retro layout",
  userInput: "a bear on a bike",
};

// Captured from the pre-pack compose; must never change for legacy styles.
const LEGACY_GOLDEN =
  "=== ARTWORK DESCRIPTION ===\nIsolated centered graphic on a TRANSPARENT background, for screen printing. Isolated motif, screen-print ready, clean crisp edges, no background scene, no ground shadow, no plate. No border or outline around text. Clean legible lettering. No scenic plate, no white mat, no rectangular card.\n\nT-shirt graphic, centered flat vector illustration, bold clean shapes. Create a centered graphic of\n\nRetro layout\n\na bear on a bike";

/** Synthetic profile — real pack content is written separately. */
const profile: StylePackPromptProfile = {
  key: "test-pack",
  creativeBase: "CREATIVE BASE: the pet is a character with agency. " + "Observe real behaviour. ".repeat(30),
  textRule: "TEXT RULE: prefer no words; at most six.",
  referenceIdentity: "IDENTITY: keep breed, coat, markings and face exactly.",
  rendererExtra: { apparel: "RENDERER-APPAREL: only the props the joke needs.", decor: "RENDERER-DECOR: use the space for story." },
  garmentColour: { light: "COLOUR-LIGHT: avoid white.", dark: "COLOUR-DARK: bright inks, avoid black." },
  humorOptions: [
    { id: "witty", label: "Witty", fragment: "HUMOR-WITTY: clever observational twist." },
    { id: "dry", label: "Dry", fragment: "HUMOR-DRY: deadpan." },
  ],
  relationshipOptions: [{ id: "its-complicated", label: "It's Complicated", fragment: "REL-COMPLICATED: love and rivalry." }],
  concept: { system: "Write concepts.", punchlineMaxWords: 6 },
};

const caps = parseStyleInputCapabilities({
  petPhoto: "optional",
  ownerPhoto: "optional",
  humor: { supported: true, default: "witty" },
  relationship: { supported: true, default: "its-complicated" },
});

describe("legacy compose is unchanged", () => {
  it("matches the pre-pack golden prompt, with or without an explicit null", () => {
    expect(wrapLayeredArtworkPrompt(composeLayeredPrompt(legacyInput))).toBe(LEGACY_GOLDEN);
    expect(wrapLayeredArtworkPrompt(composeLayeredPrompt({ ...legacyInput, packLayers: null }))).toBe(LEGACY_GOLDEN);
    expect(composeLayeredPrompt(legacyInput)).not.toHaveProperty("packLayered");
  });
});

describe("pack compose", () => {
  const referenceInstruction = buildRoleReferenceInstruction({
    styleImageCount: 0,
    customerImages: [
      { role: "pet", label: "Malcolm" },
      { role: "owner", label: "Sarah" },
    ],
    identityRules: profile.referenceIdentity,
  });
  const packLayers = buildPackPromptLayers({
    profile,
    capabilities: caps,
    isApparel: true,
    colorTier: "dark",
    concept: "VISUAL-JOKE: the cat sits on the only warm laptop.",
    punchline: "HE HEARD YOU",
    referenceInstruction,
  });
  const layered = composeLayeredPrompt({
    ...legacyInput,
    styleLayer: "STYLE-SCENARIO: petty crime, the pet is the unapologetic suspect.",
    subStyleLayer: "SUBSTYLE: mugshot",
    userInput: "USER: Malcolm steals my seat",
    packLayers,
  });

  it("keeps every layer, in the documented order", () => {
    const markers = [
      "Isolated centered graphic on a TRANSPARENT background", // base
      "CREATIVE BASE:",
      "REFERENCE IMAGES (2, in order):",
      "HUMOR-WITTY:",
      "REL-COMPLICATED:",
      "STYLE-SCENARIO:",
      "SUBSTYLE: mugshot",
      "USER: Malcolm",
      "VISUAL-JOKE:",
      '"HE HEARD YOU"',
      "TEXT RULE:",
      "RENDERER-APPAREL:",
      "COLOUR-DARK:",
    ];
    const positions = markers.map((m) => layered.prompt.indexOf(m));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(layered.packLayered).toBe(true);
    expect(PACK_LAYER_ORDER[0]).toBe("base");
  });

  it("numbers photos by role and adds identity rules", () => {
    expect(layered.prompt).toContain("Image 1: the customer's pet (Malcolm)");
    expect(layered.prompt).toContain("Image 2: the pet's owner (Sarah)");
    expect(layered.prompt).toContain("IDENTITY: keep breed");
    expect(layered.prompt.length).toBeGreaterThan(900);
  });

  it("defaults humour/relationship from the style's declared capabilities", () => {
    const l = buildPackPromptLayers({ profile, capabilities: caps, isApparel: false });
    expect(l.humor).toContain("HUMOR-WITTY");
    expect(l.relationship).toContain("REL-COMPLICATED");
    expect(l.rendererExtra).toContain("RENDERER-DECOR");
    expect(l.garmentColour).toBeNull();
    const chosen = buildPackPromptLayers({ profile, capabilities: caps, isApparel: true, humorId: "dry" });
    expect(chosen.humor).toContain("HUMOR-DRY");
    expect(chosen.garmentColour).toContain("COLOUR-LIGHT");
  });

  it("a style that declares humour unsupported never gets the layer", () => {
    const noHumor = parseStyleInputCapabilities({ humor: { supported: false }, relationship: { supported: true } });
    const l = buildPackPromptLayers({ profile, capabilities: noHumor, isApparel: true, humorId: "dry" });
    expect(l.humor).toBeNull();
  });

  it("no punchline = no verbatim text instruction", () => {
    const l = composeLayeredPrompt({ ...legacyInput, packLayers: { ...packLayers, punchline: "" } });
    expect(l.prompt).not.toContain("EXACTLY as written");
  });
});

describe("reference images", () => {
  it("accepts legacy string[] unchanged, role-tagged objects, and the single field", () => {
    expect(normalizeReferenceImages(["data:a", "https://b"]).map((r) => [r.url, r.role])).toEqual([
      ["data:a", "other"],
      ["https://b", "other"],
    ]);
    expect(
      normalizeReferenceImages([
        { url: "https://p", role: "pet", label: "  Malcolm " },
        { url: "https://o", role: "owner" },
        { url: "https://x", role: "boss" },
        { url: "" },
      ]),
    ).toEqual([
      { url: "https://p", role: "pet", label: "Malcolm" },
      { url: "https://o", role: "owner", label: null },
      { url: "https://x", role: "other", label: null },
    ]);
    expect(normalizeReferenceImages(undefined, "https://single")).toEqual([
      { url: "https://single", role: "other", label: null },
    ]);
    expect(normalizeReferenceImages(["1", "2", "3", "4", "5", "6"])).toHaveLength(5);
  });

  it("pet only: one numbered image plus identity rules", () => {
    const text = buildRoleReferenceInstruction({
      styleImageCount: 0,
      customerImages: [{ role: "pet", label: null }],
      identityRules: "IDENTITY",
    });
    expect(text).toBe(
      "REFERENCE IMAGES (1, in order):\nImage 1: the customer's pet — the main subject; keep it recognisably this exact animal.\nDo not duplicate subjects.\nIDENTITY",
    );
  });

  it("style references are numbered first and never mistaken for the customer's subject", () => {
    const text = buildRoleReferenceInstruction({
      styleImageCount: 2,
      customerImages: [{ role: "pet", label: "Rex" }, { role: "owner", label: null }],
      identityRules: "IDENTITY",
    });
    expect(text).toContain("Image 1: style reference");
    expect(text).toContain("Image 2: style reference");
    expect(text).toContain("Image 3: the customer's pet (Rex)");
    expect(text).toContain("Image 4: the pet's owner");
  });

  it("untagged photos get no identity rules; no images = no block", () => {
    const text = buildRoleReferenceInstruction({ styleImageCount: 0, customerImages: [{ role: "other", label: null }], identityRules: "IDENTITY" });
    expect(text).not.toContain("IDENTITY");
    expect(buildRoleReferenceInstruction({ styleImageCount: 0, customerImages: [] })).toBe("");
  });
});
