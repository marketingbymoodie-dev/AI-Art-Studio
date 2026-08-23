/**
 * Phase 2 — weight-band engine + cart simulator (pure functions, no I/O).
 * Spec: docs/Shipping-rates-plan/shipping-rates-and-geo-gating-spec.md Part 1.
 *
 * Core encoding: 1 gram = 1 cent of additional-item cost in the class's
 * reference zone (US if present, else cheapest). Weight-conditional band
 * rates then approximate Printify's "first + (n-1) × additional" curve
 * per delivery profile; Shopify sums profiles across the cart.
 *
 * All money is USD cents against the Printify ceiling table.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type BandZoneCell = { first: number; additional: number };

export type BandGroup = {
  group: string;
  label?: string;
  variantIds: string[];
};

/**
 * Rate table for one shipping class, keyed by raw table zones (incl "ROW").
 * rates[zone][group] — every variant in a group shares the cell by construction.
 */
export type ClassRateTable = {
  classKey: string;
  groups: BandGroup[];
  rates: Record<string, Record<string, BandZoneCell>>;
};

export type BandConfig = {
  /**
   * Closed weight bands per profile zone; the engine always appends one open
   * band on top, so a zone writes maxBands + 1 Shopify method definitions.
   * Capped by the probed rates-per-zone limit (R2 probe 2026-08-23 on the
   * staging demo store: 40 same-named weight rates in one zone accepted and
   * persisted, 41 zones per profile, no errors — the "12 rates" figure in
   * Printify/Printful docs is their publisher convention, not a Shopify cap).
   * The reconciler still re-validates the cap per target shop on first apply.
   */
  maxBands: number;
  /** Split into per-group profiles when ref-zone delta spread exceeds this. */
  groupDeltaSplitThresholdCents: number;
  /**
   * Split when, in any zone, the groups' additional-rate scale factors
   * (add(Z)/add(ref)) diverge beyond this max/min ratio. A shared profile
   * prices every zone at the max scale, so divergent scales silently
   * overcharge the low-scale groups (observed: faux suede pillow CA at
   * 0.57× vs 1.53× — ~2.7× divergence, +$113 on a 12-pillow cart).
   */
  zoneScaleDivergenceMax: number;
  rounding: "up95" | "nearest95" | "none";
};

export const DEFAULT_BAND_CONFIG: BandConfig = {
  maxBands: 20,
  groupDeltaSplitThresholdCents: 200,
  zoneScaleDivergenceMax: 1.15,
  rounding: "up95",
};

/** `${zone}::${group}` entries; zone exclusion resolved with ROW fallthrough. */
export type ExclusionSet = Set<string>;

export type Profile = {
  /** `${classKey}#${group}` when split, `${classKey}#all` when shared. */
  key: string;
  classKey: string;
  groups: BandGroup[];
};

export type Band = {
  lowerGrams: number;
  /** null = unbounded final band. */
  upperGrams: number | null;
  priceCents: number;
};

export type ProfileZoneBands = {
  zone: string;
  bands: Band[];
  deltaCents: number;
  stepGrams: number;
  /** scale(Z) as an exact fraction add(Z)/add(ref) of the max-scale group. */
  scaleNum: number;
  scaleDen: number;
};

// ── Zone / cell resolution ────────────────────────────────────────────────────

export const ROW_ZONE = "ROW";

/**
 * Build a group-keyed rate table from the ingestion shape
 * (variantId -> zone -> cell, plus derived variant groups). Every variant in
 * a group has an identical rate vector by construction — the first variant
 * that has a cell for a zone speaks for the group.
 */
export function buildClassRateTable(
  classKey: string,
  byVariant: Record<string, Record<string, BandZoneCell>>,
  groups: Array<{ group: string; label?: string; printifyVariantIds: string[] }>,
): ClassRateTable {
  const rates: Record<string, Record<string, BandZoneCell>> = {};
  const outGroups: BandGroup[] = [];
  for (const g of groups) {
    outGroups.push({ group: g.group, label: g.label, variantIds: g.printifyVariantIds });
    for (const vid of g.printifyVariantIds) {
      const zones = byVariant[vid];
      if (!zones) continue;
      for (const [zone, cell] of Object.entries(zones)) {
        if (!rates[zone]) rates[zone] = {};
        if (!rates[zone][g.group]) {
          rates[zone][g.group] = { first: cell.first, additional: cell.additional };
        }
      }
    }
  }
  return { classKey, groups: outGroups, rates };
}

/** Printify falls through to REST_OF_THE_WORLD when a country has no row. */
export function effectiveCell(
  table: ClassRateTable,
  zone: string,
  group: string,
): { cell: BandZoneCell; matchedZone: string } | null {
  const exact = table.rates[zone]?.[group];
  if (exact) return { cell: exact, matchedZone: zone };
  const row = table.rates[ROW_ZONE]?.[group];
  if (row) return { cell: row, matchedZone: ROW_ZONE };
  return null;
}

/** Exclusion for (zone, group): exact zone verdict wins, else ROW's verdict. */
export function isExcluded(
  excluded: ExclusionSet,
  table: ClassRateTable,
  zone: string,
  group: string,
): boolean {
  if (table.rates[zone]?.[group]) return excluded.has(`${zone}::${group}`);
  if (table.rates[ROW_ZONE]?.[group]) return excluded.has(`${ROW_ZONE}::${group}`);
  return true; // no rate anywhere → not shippable
}

/** Reference zone: US if the table has it, else the zone with cheapest additionals. */
export function referenceZone(table: ClassRateTable): string {
  if (table.rates["US"]) return "US";
  let best: string | null = null;
  let bestSum = Number.MAX_SAFE_INTEGER;
  for (const [zone, cells] of Object.entries(table.rates)) {
    const sum = Object.values(cells).reduce((s, c) => s + c.additional, 0);
    if (sum < bestSum) {
      bestSum = sum;
      best = zone;
    }
  }
  if (!best) throw new Error(`Class ${table.classKey} has no zones`);
  return best;
}

/** Pseudo-weight per group: additional-item cents in the reference zone. */
export function computePseudoWeights(table: ClassRateTable): Record<string, number> {
  const ref = referenceZone(table);
  const out: Record<string, number> = {};
  for (const g of table.groups) {
    const hit = effectiveCell(table, ref, g.group);
    if (hit) {
      out[g.group] = hit.cell.additional;
      continue;
    }
    // Group missing from the reference zone: fall back to its cheapest zone.
    let cheapest: number | null = null;
    for (const cells of Object.values(table.rates)) {
      const cell = cells[g.group];
      if (cell && (cheapest == null || cell.additional < cheapest)) cheapest = cell.additional;
    }
    if (cheapest == null) throw new Error(`Group ${g.group} of ${table.classKey} has no rates`);
    out[g.group] = cheapest;
  }
  return out;
}

// ── Profile planning (spec 1.3 group-splitting rule) ─────────────────────────

/**
 * One profile per class, unless (a) ref-zone delta spread exceeds the split
 * threshold, (b) any zone excludes some groups but not others (a shared
 * profile cannot omit a zone for only part of its variants), or (c) the
 * groups' per-zone scale factors diverge (shared bands price at the max
 * scale, overcharging low-scale groups).
 */
export function planClassProfiles(
  table: ClassRateTable,
  excluded: ExclusionSet,
  config: BandConfig = DEFAULT_BAND_CONFIG,
): Profile[] {
  const ref = referenceZone(table);
  const deltas: number[] = [];
  for (const g of table.groups) {
    const hit = effectiveCell(table, ref, g.group);
    if (hit) deltas.push(hit.cell.first - hit.cell.additional);
  }
  const spread = deltas.length ? Math.max(...deltas) - Math.min(...deltas) : 0;

  let mixedExclusion = false;
  let scaleDivergent = false;
  const zones = Object.keys(table.rates);
  for (const zone of zones) {
    let sawExcluded = false;
    let sawOffered = false;
    let minScale = Infinity;
    let maxScale = -Infinity;
    for (const g of table.groups) {
      const zoneHit = effectiveCell(table, zone, g.group);
      if (!zoneHit) continue;
      if (isExcluded(excluded, table, zone, g.group)) {
        sawExcluded = true;
        continue; // excluded groups never share the zone's bands
      }
      sawOffered = true;
      const refHit = effectiveCell(table, ref, g.group);
      const addRef = refHit ? refHit.cell.additional : zoneHit.cell.additional;
      if (addRef > 0) {
        const scale = zoneHit.cell.additional / addRef;
        minScale = Math.min(minScale, scale);
        maxScale = Math.max(maxScale, scale);
      }
    }
    if (sawExcluded && sawOffered) mixedExclusion = true;
    if (sawOffered && maxScale > minScale * config.zoneScaleDivergenceMax) scaleDivergent = true;
    if (mixedExclusion && scaleDivergent) break;
  }

  const split =
    table.groups.length > 1 &&
    (spread > config.groupDeltaSplitThresholdCents || mixedExclusion || scaleDivergent);

  if (!split) {
    return [{ key: `${table.classKey}#all`, classKey: table.classKey, groups: table.groups }];
  }
  return table.groups.map((g) => ({
    key: `${table.classKey}#${g.group}`,
    classKey: table.classKey,
    groups: [g],
  }));
}

// ── Band generation (spec 1.3) ───────────────────────────────────────────────

/** Cosmetic rounding. up95 never rounds down; nearest95 may (≤49c, opt-in). */
export function roundBandPrice(cents: number, mode: BandConfig["rounding"]): number {
  if (mode === "none") return cents;
  const base = Math.floor(cents / 100) * 100 + 95;
  if (mode === "up95") {
    return base >= cents ? base : base + 100;
  }
  // nearest95
  const candidates = [base - 100, base, base + 100].filter((c) => c >= 95);
  let best = candidates[0];
  for (const c of candidates) {
    if (Math.abs(c - cents) < Math.abs(best - cents)) best = c;
  }
  return best;
}

/**
 * Weight-conditional bands for one profile in one zone, or null when the zone
 * is not offered (all groups excluded / no rates). Throws if the split rule
 * was violated (some groups excluded, some offered — caller must split).
 */
export function generateProfileZoneBands(
  table: ClassRateTable,
  profile: Profile,
  zone: string,
  excluded: ExclusionSet,
  config: BandConfig = DEFAULT_BAND_CONFIG,
): ProfileZoneBands | null {
  const ref = referenceZone(table);
  const offered = profile.groups.filter(
    (g) => effectiveCell(table, zone, g.group) && !isExcluded(excluded, table, zone, g.group),
  );
  if (offered.length === 0) return null;
  const droppable = profile.groups.filter(
    (g) => effectiveCell(table, zone, g.group) && isExcluded(excluded, table, zone, g.group),
  );
  if (droppable.length > 0) {
    throw new Error(
      `Profile ${profile.key} zone ${zone}: mixed exclusion — planClassProfiles must split first`,
    );
  }

  let deltaCents = 0;
  let stepGrams = Number.MAX_SAFE_INTEGER;
  let scaleNum = 0;
  let scaleDen = 1;
  for (const g of offered) {
    const zoneHit = effectiveCell(table, zone, g.group)!;
    const refHit = effectiveCell(table, ref, g.group);
    const addRef = refHit ? refHit.cell.additional : zoneHit.cell.additional;
    deltaCents = Math.max(deltaCents, zoneHit.cell.first - zoneHit.cell.additional);
    stepGrams = Math.min(stepGrams, addRef);
    // scale(Z) = max over groups of add(Z)/add(ref); compare fractions exactly.
    if (zoneHit.cell.additional * scaleDen > scaleNum * addRef) {
      scaleNum = zoneHit.cell.additional;
      scaleDen = addRef;
    }
  }
  if (!Number.isFinite(stepGrams) || stepGrams <= 0) stepGrams = 1;

  const bands: Band[] = [];
  for (let k = 1; k <= config.maxBands; k++) {
    const lower = (k - 1) * stepGrams + (k === 1 ? 0 : 1);
    const upper = k * stepGrams;
    const price = deltaCents + Math.ceil((upper * scaleNum) / scaleDen);
    bands.push({
      lowerGrams: lower,
      upperGrams: upper,
      priceCents: roundBandPrice(price, config.rounding),
    });
  }
  // Final open band — generous cap; the simulator flags any cart that hits it.
  const capPrice =
    deltaCents + Math.ceil((2 * config.maxBands * stepGrams * scaleNum) / scaleDen);
  bands.push({
    lowerGrams: config.maxBands * stepGrams + 1,
    upperGrams: null,
    priceCents: roundBandPrice(capPrice, config.rounding),
  });

  return { zone, bands, deltaCents, stepGrams, scaleNum, scaleDen };
}

// ── Simulator (spec 1.5) ──────────────────────────────────────────────────────

export type CartItem = {
  classKey: string;
  /** Group key within the class (simulator works at group granularity). */
  group: string;
  quantity: number;
};

export type SimOk = {
  status: "ok";
  trueCents: number;
  chargedCents: number;
  overshootCents: number;
  overshootPct: number;
  hitOpenBand: boolean;
  /** Same-class extra-profile deltas — the analytical cross-group mix penalty. */
  crossProfilePenaltyCents: number;
  profilesUsed: number;
};

export type SimBlocked = { status: "blocked"; reason: string };
export type SimResult = SimOk | SimBlocked;

/**
 * True Printify ceiling cost for one class's items in a zone:
 * the unit with the highest first-item rate is charged first-item;
 * every other unit is charged its own additional rate (ROW fallthrough).
 */
export function truePrintifyClassCostCents(
  table: ClassRateTable,
  items: Array<{ group: string; quantity: number }>,
  zone: string,
  excluded: ExclusionSet,
): { cents: number } | { blocked: string } {
  let additionalSum = 0;
  let maxFirstMinusAdd = -Infinity;
  let units = 0;
  for (const item of items) {
    if (item.quantity <= 0) continue;
    if (isExcluded(excluded, table, zone, item.group)) {
      return { blocked: `${table.classKey}/${item.group} excluded in ${zone}` };
    }
    const hit = effectiveCell(table, zone, item.group);
    if (!hit) return { blocked: `${table.classKey}/${item.group} has no rate for ${zone}` };
    additionalSum += hit.cell.additional * item.quantity;
    maxFirstMinusAdd = Math.max(maxFirstMinusAdd, hit.cell.first - hit.cell.additional);
    units += item.quantity;
  }
  if (units === 0) return { cents: 0 };
  return { cents: additionalSum + maxFirstMinusAdd };
}

function bandPriceForWeight(bands: Band[], weightGrams: number): { price: number; open: boolean } {
  for (const b of bands) {
    if (weightGrams >= b.lowerGrams && (b.upperGrams == null || weightGrams <= b.upperGrams)) {
      return { price: b.priceCents, open: b.upperGrams == null };
    }
  }
  const last = bands[bands.length - 1];
  return { price: last.priceCents, open: true };
}

/**
 * Simulate a cart to one destination zone: true ceiling cost vs what the
 * generated band profiles would charge (Shopify sums one rate per profile).
 */
export function simulateCart(
  cart: CartItem[],
  zone: string,
  tables: Record<string, ClassRateTable>,
  config: BandConfig = DEFAULT_BAND_CONFIG,
  excludedByClass: Record<string, ExclusionSet> = {},
): SimResult {
  const byClass = new Map<string, CartItem[]>();
  for (const item of cart) {
    if (item.quantity <= 0) continue;
    const list = byClass.get(item.classKey) || [];
    list.push(item);
    byClass.set(item.classKey, list);
  }

  let trueCents = 0;
  let chargedCents = 0;
  let hitOpenBand = false;
  let crossProfilePenaltyCents = 0;
  let profilesUsed = 0;

  for (const [classKey, items] of Array.from(byClass.entries())) {
    const table = tables[classKey];
    if (!table) return { status: "blocked", reason: `unknown class ${classKey}` };
    const excluded = excludedByClass[classKey] ?? new Set<string>();

    const truth = truePrintifyClassCostCents(table, items, zone, excluded);
    if ("blocked" in truth) return { status: "blocked", reason: truth.blocked };
    trueCents += truth.cents;

    const weights = computePseudoWeights(table);
    const profiles = planClassProfiles(table, excluded, config);
    const zoneDeltas: number[] = [];
    for (const profile of profiles) {
      const profileGroups = new Set(profile.groups.map((g) => g.group));
      const inProfile = items.filter((i) => profileGroups.has(i.group));
      if (inProfile.length === 0) continue;
      const zoneBands = generateProfileZoneBands(table, profile, zone, excluded, config);
      if (!zoneBands) {
        return { status: "blocked", reason: `${profile.key} does not offer ${zone}` };
      }
      const weight = inProfile.reduce((s, i) => s + weights[i.group] * i.quantity, 0);
      const { price, open } = bandPriceForWeight(zoneBands.bands, weight);
      chargedCents += price;
      hitOpenBand = hitOpenBand || open;
      profilesUsed++;
      zoneDeltas.push(zoneBands.deltaCents);
    }
    // Cross-group mix penalty: every same-class profile beyond the first
    // charges its own delta on top of Printify's single first-item.
    if (zoneDeltas.length > 1) {
      const maxDelta = Math.max(...zoneDeltas);
      crossProfilePenaltyCents += zoneDeltas.reduce((s, d) => s + d, 0) - maxDelta;
    }
  }

  const overshootCents = chargedCents - trueCents;
  return {
    status: "ok",
    trueCents,
    chargedCents,
    overshootCents,
    overshootPct: trueCents > 0 ? overshootCents / trueCents : 0,
    hitOpenBand,
    crossProfilePenaltyCents,
    profilesUsed,
  };
}

// ── Tolerance policy (spec 1.5 — recorded after first run) ───────────────────

export type ToleranceConfig = {
  absCents: number;
  pct: number;
};

/** Chosen tolerance: ≤ $3.00 or ≤ 15% of true cost, whichever is larger. */
export const DEFAULT_TOLERANCE: ToleranceConfig = { absCents: 300, pct: 0.15 };

/**
 * Allowed overshoot for a simulated cart:
 *   base tolerance (max of abs/pct)
 * + the analytical cross-group penalty (per-group profiles double-charge
 *   deltas on same-class mixes — accepted trade-off per spec 1.3)
 * + rounding headroom (up95 adds ≤ 99c per profile).
 * Open-band carts (> maxBands steps in one profile) are excluded from the
 * tolerance assertion and reported separately.
 */
export function allowedOvershootCents(
  sim: SimOk,
  config: BandConfig,
  tolerance: ToleranceConfig = DEFAULT_TOLERANCE,
): number {
  const base = Math.max(tolerance.absCents, Math.round(sim.trueCents * tolerance.pct));
  const rounding = config.rounding === "none" ? 0 : 99 * sim.profilesUsed;
  return base + sim.crossProfilePenaltyCents + rounding;
}
