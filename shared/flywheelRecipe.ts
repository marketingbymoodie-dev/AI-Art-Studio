/**
 * Recipe fields a design candidate must have at insert.
 * Title and description are written later, at approval.
 */
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS } from "./petposterousCreative";
import { petposterousArtStyle } from "./petposterousArtStyles";

export const ART_STYLE_DEVICE_STRUCTURES = [
  "portrait_verdict",
  "object_evidence",
  "human_role",
  "occupied_territory",
  "refusing_request",
  "aftermath",
  "pure_type",
  "negative_space",
] as const;

export type ArtStyleDeviceStructure = (typeof ART_STYLE_DEVICE_STRUCTURES)[number];

export const FLYWHEEL_SPECIES = ["dog", "cat", "other"] as const;
export type FlywheelSpecies = (typeof FLYWHEEL_SPECIES)[number];

const PRODUCT_FAMILIES = ["apparel", "poster", "pillow", "tapestry", "bedding"] as const;

export type CandidateConceptSource = "generated" | "manual";

export type AdminCandidateDraft = {
  shopDomain: string;
  /** generated | manual. Set from which fields the operator supplied, not from a free-text flag. */
  conceptSource: CandidateConceptSource;
  /** approved is only available when the operator wrote the concept. */
  status: "pending" | "approved";
  humourOperator: string;
  darknessLevel: number;
  species: FlywheelSpecies;
  deviceStructure: ArtStyleDeviceStructure;
  deviceText: string;
  funnyTruth: string;
  punchline: string;
  artStyle: string;
  behaviour: string;
  productFamily: string;
  credentialRef: string;
  renderProbeResultId: number | null;
};

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function humourOperatorId(value: unknown): string | null {
  const id = clip(value, 80);
  return Object.prototype.hasOwnProperty.call(PETPOSTEROUS_CONCEPT_FRAMEWORKS, id) ? id : null;
}

export function darknessLevel(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

export function flywheelSpecies(value: unknown): FlywheelSpecies | null {
  const species = clip(value, 20).toLowerCase();
  return (FLYWHEEL_SPECIES as readonly string[]).includes(species) ? species as FlywheelSpecies : null;
}

export function deviceStructureId(value: unknown): ArtStyleDeviceStructure | null {
  const id = clip(value, 40);
  return (ART_STYLE_DEVICE_STRUCTURES as readonly string[]).includes(id) ? id as ArtStyleDeviceStructure : null;
}

export function flywheelShopDomain(value: unknown): string | null {
  const shop = clip(value, 80).toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ? shop : null;
}

/**
 * The admin probe is the only caller that may insert.
 * petSwap is the same route used as a storefront stand-in, and it never inserts.
 * A request body cannot choose the source.
 */
export function adminCandidateDraft(input: {
  source: unknown;
  petSwap: unknown;
  shopDomain: unknown;
  humourOperator: unknown;
  darknessLevel: unknown;
  species: unknown;
  deviceStructure: unknown;
  deviceText: unknown;
  funnyTruth: unknown;
  punchline: unknown;
  artStyle: unknown;
  behaviour: unknown;
  productFamily: unknown;
  credentialRef: unknown;
  renderProbeResultId: unknown;
  /** Probe image draw. Draws after the first are the same design, not a new candidate. */
  imageVariant?: unknown;
  /** The operator typed the truth. Skips the truth writer. */
  suppliedTruth?: unknown;
  /** The operator typed the device. Skips the device writer. */
  suppliedDevice?: unknown;
  /** Manual concepts may skip the pending queue. Ignored for generated rows. */
  approveNow?: unknown;
}): { draft: AdminCandidateDraft } | { skip: string } {
  if (input.petSwap === true) return { skip: "pet-swap" };
  if (input.source !== "admin-probe") return { skip: "source" };
  const imageVariant = Number(input.imageVariant);
  if (Number.isInteger(imageVariant) && imageVariant > 1) return { skip: "extra-render" };
  const shopDomain = flywheelShopDomain(input.shopDomain);
  if (!shopDomain) return { skip: "shop" };
  const humourOperator = humourOperatorId(input.humourOperator);
  if (!humourOperator) return { skip: "operator" };
  const darkness = darknessLevel(input.darknessLevel);
  if (darkness == null) return { skip: "darkness" };
  const species = flywheelSpecies(input.species);
  if (!species) return { skip: "species" };
  const deviceStructure = deviceStructureId(input.deviceStructure);
  if (!deviceStructure) return { skip: "structure" };
  const deviceText = clip(input.deviceText, 400);
  if (!deviceText) return { skip: "device" };
  const funnyTruth = clip(input.funnyTruth, 400);
  if (!funnyTruth) return { skip: "truth" };
  const artStyle = clip(input.artStyle, 40);
  if (!petposterousArtStyle(artStyle)) return { skip: "art-style" };
  const behaviour = clip(input.behaviour, 400);
  if (!behaviour) return { skip: "behaviour" };
  const productFamily = clip(input.productFamily, 20);
  if (!(PRODUCT_FAMILIES as readonly string[]).includes(productFamily)) return { skip: "product" };
  const credentialRef = clip(input.credentialRef, 80);
  if (!credentialRef || /[\r\n]/.test(credentialRef)) return { skip: "credential" };
  const probeId = Number(input.renderProbeResultId);
  const renderProbeResultId = Number.isInteger(probeId) && probeId > 0 ? probeId : null;
  const conceptSource: CandidateConceptSource = input.suppliedTruth === true || input.suppliedDevice === true ? "manual" : "generated";
  const status = conceptSource === "manual" && input.approveNow === true ? "approved" : "pending";
  return {
    draft: {
      shopDomain,
      conceptSource,
      status,
      humourOperator,
      darknessLevel: darkness,
      species,
      deviceStructure,
      deviceText,
      funnyTruth,
      punchline: clip(input.punchline, 120),
      artStyle,
      behaviour,
      productFamily,
      credentialRef,
      renderProbeResultId,
    },
  };
}
