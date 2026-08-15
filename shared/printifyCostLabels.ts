/**
 * Normalize variant titles for Printify production-cost lookup.
 * Framed prints often differ by quote style / "X" vs "x" between Shopify and Printify.
 */
export function normalizeVariantLabelForCostMatch(label: string): string {
  return label
    .toLowerCase()
    .replace(/[""″‶‴''′‵]/g, "")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    // Only collapse numeric dimensions ("14 x 11" → "14x11"). A global
    // `\s*x\s*` also ate the space before XS/XL ("Black / XS" → "black /xs").
    .replace(/(\d+)\s*x\s*(\d+)/g, "$1x$2")
    .trim();
}

/** Build normalized-label → cost (cents) from Printify id costs + id→label map. */
export function buildCostsByNormalizedLabel(
  costs: Record<string, number>,
  printifyVariantLabels: Record<string, string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [printifyVid, label] of Object.entries(printifyVariantLabels)) {
    const cost = costs[printifyVid];
    if (cost == null || !label) continue;
    out[normalizeVariantLabelForCostMatch(label)] = cost;
  }
  return out;
}

const APPAREL_SIZE_RE = /^(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|5xl|6xl)$/;

function normalizeSizeToken(raw: string): string {
  const n = raw.replace(/\s/g, "").toLowerCase();
  if (n === "xxl") return "2xl";
  if (n === "xxxl") return "3xl";
  if (n === "xxxxl") return "4xl";
  return n;
}

function isSizeToken(raw: string): boolean {
  const n = normalizeSizeToken(raw);
  return APPAREL_SIZE_RE.test(n) || /^\d+x\d+/.test(n);
}

function splitSizeColor(norm: string): { size: string; color: string } | null {
  const parts = norm.split(" / ").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    return isSizeToken(parts[0]!) ? { size: normalizeSizeToken(parts[0]!), color: "" } : { size: parts[0]!, color: "" };
  }
  if (parts.length === 2) {
    const [a, b] = parts;
    if (isSizeToken(a!)) return { size: normalizeSizeToken(a!), color: b! };
    if (isSizeToken(b!)) return { size: normalizeSizeToken(b!), color: a! };
    return { size: a!, color: b! };
  }
  // "White / Navy / S" baseball-style — last size-looking token is the size.
  const sizeIdx = parts.findIndex((p) => isSizeToken(p));
  if (sizeIdx === -1) return { size: parts[0]!, color: parts.slice(1).join(" / ") };
  return {
    size: normalizeSizeToken(parts[sizeIdx]!),
    color: parts.filter((_, i) => i !== sizeIdx).join(" / "),
  };
}

function normalizeColorToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bgrey\b/g, "gray")
    .replace(/^solid\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function colorsMatch(a: string, b: string): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const na = normalizeColorToken(a);
  const nb = normalizeColorToken(b);
  return na === nb;
}

/** True when wizard title and Printify label refer to the same size + colour. Never substring-match XL inside 4XL. */
export function variantCostLabelsMatch(wizardTitle: string, printifyLabel: string): boolean {
  const a = normalizeVariantLabelForCostMatch(wizardTitle);
  const b = normalizeVariantLabelForCostMatch(printifyLabel);
  if (a === b) return true;
  if (a.replace(/\s*\/\s*/g, "/") === b.replace(/\s*\/\s*/g, "/")) return true;
  const sa = splitSizeColor(a);
  const sb = splitSizeColor(b);
  if (!sa || !sb) return false;
  if (sa.size !== sb.size) return false;
  return colorsMatch(sa.color, sb.color);
}

export type VariantCostLookup = {
  id: string;
  title?: string;
};

/**
 * Resolve production cost (cents) for a blank/wizard variant.
 * Callers must pass the matching tier maps (front vs front+back) — do not
 * fall back from costsBoth to front costs.
 */
export function resolveVariantCostCents(
  v: VariantCostLookup,
  args: {
    costs?: Record<string, number>;
    shopifyVariantCosts?: Record<string, number>;
    costsByNormalizedLabel?: Record<string, number>;
    printifyVariantLabels?: Record<string, string>;
  },
): number | undefined {
  const { costs, shopifyVariantCosts, costsByNormalizedLabel, printifyVariantLabels } = args;
  let costCents: number | undefined = shopifyVariantCosts?.[v.id];
  if (costCents == null && v.id.startsWith("printify:")) {
    const pid = v.id.slice("printify:".length);
    costCents = costs?.[pid] ?? costs?.[String(Number(pid))];
  }
  if (costCents == null) costCents = costs?.[v.id];

  const title = v.title?.trim();
  if (costCents == null && title && costsByNormalizedLabel) {
    const normTitle = normalizeVariantLabelForCostMatch(title);
    costCents = costsByNormalizedLabel[normTitle];
    if (costCents == null) {
      const compact = normTitle.replace(/\s*\/\s*/g, "/");
      for (const [label, cost] of Object.entries(costsByNormalizedLabel)) {
        if (label.replace(/\s*\/\s*/g, "/") === compact || variantCostLabelsMatch(title, label)) {
          costCents = cost;
          break;
        }
      }
    }
  }

  if (costCents == null && title && printifyVariantLabels && costs) {
    for (const [printifyVid, label] of Object.entries(printifyVariantLabels)) {
      if (!label || !variantCostLabelsMatch(title, label)) continue;
      const c = costs[printifyVid] ?? costs[String(Number(printifyVid))];
      if (c != null) {
        costCents = c;
        break;
      }
    }
  }

  return costCents;
}
