/**
 * Public beta / creator landing copy + media.
 * Stored as JSON in platform_config.LANDING_CONTENT. Admin edits; public page reads.
 */

export const LANDING_COPY_FIELDS = [
  ["splashEyebrow", "Splash eyebrow"],
  ["splashTitle", "Splash title"],
  ["splashCaption", "Text under viewing window"],
  ["splashCta", "Splash button"],
  ["landingEyebrow", "Landing eyebrow"],
  ["landingHeadline", "Landing headline"],
  ["landingLede", "Landing supporting line"],
  ["ctaCreator", "Creator apply button"],
  ["ctaShopify", "Shopify owner button"],
  ["applyEyebrow", "Creator form eyebrow"],
  ["applyTitle", "Creator form title"],
  ["applyLede", "Creator form intro"],
  ["applyTerms", "Creator terms"],
  ["applySubmit", "Creator submit"],
  ["shopifyEyebrow", "Shopify form eyebrow"],
  ["shopifyTitle", "Shopify form title"],
  ["shopifyLede", "Shopify form intro"],
  ["shopifyTerms", "Shopify terms"],
  ["shopifySubmit", "Shopify submit"],
  ["thanksTitle", "Thanks title"],
  ["thanksLede", "Thanks body"],
] as const;

export type LandingCopyKey = (typeof LANDING_COPY_FIELDS)[number][0];

export type LandingCopy = Record<LandingCopyKey, string>;

export type LandingScene = {
  id: string;
  prompt: string;
  imageUrl: string;
};

export type LandingCard = {
  id: string;
  title: string;
  body: string;
  imageUrl: string;
};

export type LandingContent = {
  copy: LandingCopy;
  scenes: LandingScene[];
  cards: LandingCard[];
};

export const DEFAULT_LANDING_COPY: LandingCopy = {
  splashEyebrow: "AI Art Studio",
  splashTitle: "AI Art Studio",
  splashCaption: "From Prompt to Print...",
  splashCta: "Show me more",
  landingEyebrow: "Two ways in",
  landingHeadline: "You Promote it, Your Audience Prompts it, We Print it.",
  landingLede:
    "Creators get a hosted beta storefront. Shopify owners install the full customizer on their own shop. Same engine. Different door.",
  ctaCreator: "Apply for the Beta Creator Storefront",
  ctaShopify: "Already an Existing Shopify Store Owner?",
  applyEyebrow: "Creator beta",
  applyTitle: "Apply for the beta storefront",
  applyLede:
    "30 days. $0 upfront. You keep 100% of profit after fulfilment. Strong performance can unlock a larger storefront and an ongoing rev-share.",
  applyTerms:
    "I agree to the beta terms: 30 days, no upfront fee, fulfilment costs come out first, and a later rev-share storefront is by invitation only.",
  applySubmit: "Submit application",
  shopifyEyebrow: "Shopify merchants",
  shopifyTitle: "Install the full customizer",
  shopifyLede:
    "You already have a store. This path is the AI Art Studio app — full controls on your own Shopify catalogue, not a hosted creator shop.",
  shopifyTerms: "I agree to the merchant beta terms and confirm I own this Shopify store.",
  shopifySubmit: "Request merchant access",
  thanksTitle: "You're in the queue.",
  thanksLede: "We'll review the short form and email you. No charge to apply.",
};

export const DEFAULT_LANDING_SCENES: LandingScene[] = [
  {
    id: "s1",
    prompt: "A watercolor portrait of my rescue dog in a floral crown",
    imageUrl: "",
  },
  {
    id: "s2",
    prompt: "Neon kanji streetwear mark, midnight navy, chrome edge",
    imageUrl: "",
  },
  {
    id: "s3",
    prompt: "Art deco moon over the desert, gold foil on ivory",
    imageUrl: "",
  },
  {
    id: "s4",
    prompt: "Soft cosmic nebula for a phone case, deep violet",
    imageUrl: "",
  },
];

export const DEFAULT_LANDING_CARDS: LandingCard[] = [
  {
    id: "c1",
    title: "You promote it",
    body: "Share one link from Instagram, TikTok, or YouTube — or put the customizer on products you already sell.",
    imageUrl: "",
  },
  {
    id: "c2",
    title: "Your audience prompts it",
    body: "They type. Art appears on a live mockup. No design file, no back-and-forth.",
    imageUrl: "",
  },
  {
    id: "c3",
    title: "We print it",
    body: "Fulfilment is handled. You keep the product profit after print and shipping costs.",
    imageUrl: "",
  },
  {
    id: "c4",
    title: "Creator beta",
    body: "No Shopify store? We host yourname.aiartstudio.app for 30 days, $0 upfront, 100% of profit after fulfilment.",
    imageUrl: "",
  },
  {
    id: "c5",
    title: "Grow the deal",
    body: "Perform in beta and you may be invited to a larger platform storefront with an ongoing rev-share.",
    imageUrl: "",
  },
];

export const DEFAULT_LANDING_CONTENT: LandingContent = {
  copy: DEFAULT_LANDING_COPY,
  scenes: DEFAULT_LANDING_SCENES,
  cards: DEFAULT_LANDING_CARDS,
};

const MAX_SCENES = 12;
const MAX_CARDS = 12;
const MAX_SHORT = 160;
const MAX_LINE = 400;
const MAX_BODY = 800;

function clip(raw: unknown, max: number): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function isSafeLandingImageUrl(url: string): boolean {
  if (!url) return true;
  if (url.startsWith("/objects/")) return !url.includes("..");
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function safeImageUrl(raw: unknown): string {
  const url = String(raw ?? "").trim();
  return isSafeLandingImageUrl(url) ? url.slice(0, 2000) : "";
}

function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function sanitizeScenes(raw: unknown): LandingScene[] {
  if (!Array.isArray(raw)) return DEFAULT_LANDING_SCENES.map((s) => ({ ...s }));
  const out: LandingScene[] = [];
  for (const item of raw.slice(0, MAX_SCENES)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const prompt = clip(row.prompt, MAX_LINE);
    if (!prompt) continue;
    out.push({
      id: clip(row.id, 40) || newId("s"),
      prompt,
      imageUrl: safeImageUrl(row.imageUrl ?? row.image),
    });
  }
  return out.length ? out : DEFAULT_LANDING_SCENES.map((s) => ({ ...s }));
}

function sanitizeCards(raw: unknown): LandingCard[] {
  if (!Array.isArray(raw)) return DEFAULT_LANDING_CARDS.map((c) => ({ ...c }));
  const out: LandingCard[] = [];
  for (const item of raw.slice(0, MAX_CARDS)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = clip(row.title, MAX_SHORT);
    const body = clip(row.body, MAX_BODY);
    if (!title && !body) continue;
    out.push({
      id: clip(row.id, 40) || newId("c"),
      title: title || "Untitled",
      body,
      imageUrl: safeImageUrl(row.imageUrl ?? row.image),
    });
  }
  return out.length ? out : DEFAULT_LANDING_CARDS.map((c) => ({ ...c }));
}

export function mergeLandingContent(raw: unknown): LandingContent {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const copySrc =
    src.copy && typeof src.copy === "object" ? (src.copy as Record<string, unknown>) : src;
  const copy = { ...DEFAULT_LANDING_COPY };
  for (const [key] of LANDING_COPY_FIELDS) {
    if (copySrc[key] != null) copy[key] = clip(copySrc[key], MAX_BODY);
  }
  return {
    copy,
    scenes: sanitizeScenes(src.scenes),
    cards: sanitizeCards(src.cards),
  };
}

export function parseLandingContentJson(json: string | null | undefined): LandingContent {
  if (!json) return structuredClone(DEFAULT_LANDING_CONTENT);
  try {
    return mergeLandingContent(JSON.parse(json));
  } catch {
    return structuredClone(DEFAULT_LANDING_CONTENT);
  }
}
