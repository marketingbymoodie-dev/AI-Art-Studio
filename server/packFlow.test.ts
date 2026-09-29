import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@shared/schema";

vi.mock("./customer-references", async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    storeReferenceDataUrl: vi.fn(async (o: any) => `${real.shopPathSegment(o.shop)}/${o.jobId}/${o.index}-${o.role}-abcdef12.png`),
    signReferencePath: vi.fn(async (path: string, shop: string) =>
      real.referencePathBelongsToShop(path, shop) ? `https://signed.example/${path}?token=x` : null,
    ),
  };
});

import { creativeBriefFromContext, hostPackReferences, packConceptText, packLayersForCompose, type PackGenerationContext } from "./pack-generation";
import { referencePathBelongsToShop } from "./customer-references";
import { parseCreativeBrief } from "@shared/creativeBrief";
import { getStylePackProfile } from "@shared/stylePackProfiles";
import { composeLayeredPrompt } from "@shared/promptLayers";
import { normalizeReferenceImages } from "@shared/referenceImages";
import { parseStyleInputCapabilities } from "@shared/stylePacks";
import { ConceptOptionsPicker } from "../client/src/components/designer/ConceptOptionsPicker";
import { PackCreativeControls } from "../client/src/components/designer/PackCreativeControls";
import { publicExperienceProfile } from "@shared/experienceProfile";
import { PETPOSTEROUS_EXPERIENCE_CONFIG } from "@shared/packs/petposterous";

const SHOP = "ai-art-studio-staging.myshopify.com";
const profile = getStylePackProfile("petposterous")!;
const ctx: PackGenerationContext = {
  packId: "pack-1",
  packSlug: "petposterous-v1",
  profile,
  capabilities: parseStyleInputCapabilities({ petPhoto: "optional", ownerPhoto: "optional", humor: { supported: true, default: "witty" }, relationship: { supported: true, default: "its-complicated" } }),
  humorId: "dry",
  relationshipId: "rivals",
  concept: "Malcolm sits beside the laundry basket like a calm criminal mastermind.",
  punchline: "WE HAD A DEAL.",
  wordsMode: "suggest",
  petName: "Malcolm",
  species: "Cat",
  personalityTraits: ["Sneaky", "Greedy"],
  behavior: "pees in the laundry basket when dinner is late",
  funnyTruth: "He negotiates with bodily fluids.",
  subjectPriority: "orange tabby, white chin",
  conceptIndex: 1,
};

describe("selected concept reaches the final image prompt", () => {
  it("visual joke, punchline, subject and all pack layers are composed", () => {
    const layers = packLayersForCompose(ctx, {
      isApparel: true,
      colorTier: "light",
      styleImageCount: 0,
      customerImages: [
        { url: "u1", role: "pet", label: "Malcolm" },
        { url: "u2", role: "owner", label: null },
      ],
    });
    const p = composeLayeredPrompt({
      category: "all",
      isApparelGeneration: true,
      generationModel: "gpt-image-2",
      styleLayer: "STYLE — PETTY CRIMES: …",
      userInput: ctx.behavior!,
      packLayers: layers,
    }).prompt;
    expect(p).toContain("CONCEPT: Malcolm sits beside the laundry basket");
    expect(p).toContain('"WE HAD A DEAL."');
    expect(p).toContain("SUBJECT: Malcolm, a cat; a bit sneaky, greedy.");
    expect(p).toContain("MUST STAY RECOGNISABLE: orange tabby, white chin");
    expect(p).toContain("HUMOUR: dry");
    expect(p).toContain("RELATIONSHIP: rivals");
    expect(p).toContain("Image 1: the customer's pet (Malcolm)");
    expect(p).toContain("Image 2: the pet's owner");
    expect(p).toContain("REFERENCE IDENTITY:");
    expect(p).toContain("GARMENT COLOUR: printed on a light garment");
    expect(p).not.toContain("He negotiates"); // funnyTruth guides writing only
  });

  it("no concept facts → no concept layer", () => {
    expect(packConceptText({ petName: null, species: null, personalityTraits: [], concept: null, subjectPriority: null })).toBeNull();
  });
});

describe("creative brief", () => {
  it("round-trips with pet + owner roles and never stores URLs", () => {
    const brief = creativeBriefFromContext(ctx, {
      styleSlug: "pp-petty-crimes",
      subStyle: "evidence",
      references: [
        { path: `${SHOP}/job1/0-pet-abcdef12.png`, role: "pet", label: "Malcolm" },
        { path: `${SHOP}/job1/1-owner-abcdef12.png`, role: "owner", label: null },
      ],
    });
    const back = parseCreativeBrief(JSON.parse(JSON.stringify(brief)))!;
    expect(back).toEqual(brief);
    expect(back.referenceImages.map((r) => r.role)).toEqual(["pet", "owner"]);
    expect(JSON.stringify(back)).not.toMatch(/https?:|data:/);
    expect(back.personalityTraits).toEqual(["Sneaky", "Greedy"]);
    expect(back.conceptIndex).toBe(1);
  });

  it("tolerates garbage and caps traits at 3", () => {
    expect(parseCreativeBrief(null)).toBeNull();
    expect(parseCreativeBrief({ v: 2 })).toBeNull();
    expect(parseCreativeBrief({ v: 1, personalityTraits: ["a", "b", "c", "d"] })!.personalityTraits).toEqual(["a", "b", "c"]);
  });
});

describe("private reference photos", () => {
  it("stores data URLs privately, signs for the model, persists paths only", async () => {
    const { refs, brief } = await hostPackReferences({
      shop: SHOP,
      jobId: "job-1",
      refs: normalizeReferenceImages([
        { url: "data:image/png;base64,AAAA", role: "pet", label: "Malcolm" },
        { url: "data:image/png;base64,BBBB", role: "owner" },
      ]),
    });
    expect(brief.map((b) => [b.role, b.label])).toEqual([["pet", "Malcolm"], ["owner", null]]);
    expect(brief.every((b) => b.path.startsWith(`${SHOP}/job-1/`))).toBe(true);
    expect(refs.every((r) => r.url.startsWith("https://signed.example/"))).toBe(true);
  });

  it("reuse: a stored path is re-signed for its own shop and rejected for another", async () => {
    const own = `${SHOP}/job-1/0-pet-abcdef12.png`;
    const other = "other-shop.myshopify.com/job-9/0-pet-abcdef12.png";
    const { refs, brief } = await hostPackReferences({
      shop: SHOP,
      jobId: "job-2",
      refs: normalizeReferenceImages([
        { storagePath: own, role: "pet", label: "Malcolm" },
        { storagePath: other, role: "pet" },
      ]),
    });
    expect(brief).toEqual([{ path: own, role: "pet", label: "Malcolm" }]);
    expect(refs).toHaveLength(1);
  });

  it("path guard: shape, prefix and traversal", () => {
    expect(referencePathBelongsToShop(`${SHOP}/job-1/0-pet-abcdef12.png`, SHOP)).toBe(true);
    expect(referencePathBelongsToShop(`${SHOP}/job-1/0-pet-abcdef12.png`, "evil.myshopify.com")).toBe(false);
    expect(referencePathBelongsToShop(`${SHOP}/../x/0-pet.png`, SHOP)).toBe(false);
    expect(referencePathBelongsToShop(`${SHOP}/job-1/secret.txt`, SHOP)).toBe(false);
    expect(referencePathBelongsToShop(42, SHOP)).toBe(false);
  });
});

describe("concept picker UI", () => {
  it("Quotes rows keep their original test ids, labels and edit control", () => {
    const onPick = vi.fn();
    render(
      createElement(ConceptOptionsPicker, {
        rows: [{ primary: "Line A" }, { primary: "Line B" }, { primary: "Line C" }],
        pick: 1,
        onPick,
        idStem: "quote",
        boxTestId: "quotes-options-box",
        edit: { editingIndex: null, onChange: vi.fn(), onCommit: vi.fn(), onBegin: vi.fn(), onRevert: vi.fn(), ariaLabel: (i: number) => `Edit quote ${i + 1}` },
        newLink: { label: "New theme", onClick: vi.fn(), testId: "button-quotes-new-theme" },
        moreLink: { label: "More quotes", onClick: vi.fn(), testId: "button-quotes-more" },
      }),
    );
    expect(screen.getByTestId("quotes-options-box")).toBeTruthy();
    expect(screen.getByTestId("text-quote-option-1").textContent).toBe("Line B");
    expect(screen.getByTestId("button-quote-option-1").className).toContain("bg-foreground text-background");
    expect(screen.getByLabelText("Edit quote 3")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-quote-option-2"));
    expect(onPick).toHaveBeenCalledWith(2);
    expect(screen.getByTestId("button-quotes-more").textContent).toBe("More quotes");
  });

  it("pack rows show punchline + visual idea only, no edit control", () => {
    render(
      createElement(ConceptOptionsPicker, {
        rows: [{ primary: "PROVE IT.", secondary: "The cat beside a shredded sofa, paws folded." }],
        pick: null,
        onPick: vi.fn(),
        idStem: "concept",
        boxTestId: "concept-options-box",
        newLink: { label: "Change the story", onClick: vi.fn(), testId: "button-concepts-new" },
        moreLink: { label: "3 more ideas", onClick: vi.fn(), testId: "button-concepts-more" },
      }),
    );
    const row = screen.getByTestId("text-concept-option-0");
    expect(row.textContent).toBe("PROVE IT.The cat beside a shredded sofa, paws folded.");
    expect(screen.queryByTestId("button-concept-edit-0")).toBeNull();
  });
});

describe("pack controls", () => {
  const pub = publicExperienceProfile(
    { slug: "petposterous", stylePackId: "p", config: PETPOSTEROUS_EXPERIENCE_CONFIG },
    { humorOptions: profile.humorOptions, relationshipOptions: profile.relationshipOptions, conceptWriter: true },
  );
  const base = { petName: "", species: "", personality: [] as string[], humor: "witty", relationship: "its-complicated", wordsMode: "suggest" as const, exactWords: "" };

  it("personality allows at most 3", () => {
    const onChange = vi.fn();
    render(createElement(PackCreativeControls, { profile: pub, capabilities: ctx.capabilities, state: { ...base, personality: ["bossy", "greedy", "sneaky"] }, onChange }));
    fireEvent.click(screen.getByTestId("chips-pack-personality-lazy"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("chips-pack-personality-bossy"));
    expect(onChange).toHaveBeenCalledWith({ personality: ["greedy", "sneaky"] });
  });

  it("humour row hidden when the style declares it unsupported", () => {
    const caps = parseStyleInputCapabilities({ humor: { supported: false }, relationship: { supported: true } });
    render(createElement(PackCreativeControls, { profile: pub, capabilities: caps, state: base, onChange: vi.fn() }));
    expect(screen.queryByTestId("chips-pack-humor")).toBeNull();
    expect(screen.getByTestId("chips-pack-relationship")).toBeTruthy();
    expect(screen.getByTestId("chips-pack-species")).toBeTruthy();
  });
});
