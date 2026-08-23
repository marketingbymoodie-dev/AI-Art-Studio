/**
 * Phase 2 deliverable — tolerance report for the weight-band engine.
 *
 * Loads every ingested shipping class (latest Printify snapshot + Phase 1
 * tier verdicts) from the database, generates band profiles, then throws
 * seeded random carts at every destination zone and compares what the bands
 * would charge against the true Printify ceiling cost.
 *
 * Usage: npx tsx scripts/shipping-band-tolerance-report.ts [--carts 2000] [--out tmp/report.md]
 */
import "../server/load-env";
import fs from "fs";
import path from "path";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import {
  DEFAULT_BAND_CONFIG,
  DEFAULT_TOLERANCE,
  allowedOvershootCents,
  buildClassRateTable,
  planClassProfiles,
  simulateCart,
  type BandConfig,
  type CartItem,
  type ClassRateTable,
  type ExclusionSet,
  type SimOk,
} from "../shared/shipping-bands";

const SEED = 20260823;
const argCarts = process.argv.indexOf("--carts");
const CARTS_PER_ZONE = argCarts > -1 ? Number(process.argv[argCarts + 1]) : 2000;
const argOut = process.argv.indexOf("--out");
const OUT_FILE = argOut > -1 ? process.argv[argOut + 1] : "tmp/shipping-band-tolerance-report.md";

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = <T,>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

type ClassData = {
  classKey: string;
  name: string;
  table: ClassRateTable;
  excluded: ExclusionSet;
  /** zones with at least one shippable group (incl fallthrough-only via ROW) */
  shippableZones: Set<string>;
  profileCount: number;
};

async function loadClasses(): Promise<ClassData[]> {
  const clsRes = await db.execute(sql`
    select id, blueprint_id, provider_id, name, variant_groups_json,
           group_delta_split_threshold_cents
    from shipping_classes
    where last_error is null order by id`);
  const classes = ((clsRes as any).rows ?? clsRes) as any[];
  const out: ClassData[] = [];
  for (const cls of classes) {
    const snapRes = await db.execute(sql`
      select raw_json from shipping_table_snapshots
      where shipping_class_id = ${cls.id} order by fetched_at desc limit 1`);
    const snap = ((snapRes as any).rows ?? snapRes)[0];
    if (!snap) continue;
    const ratesRes = await db.execute(sql`
      select country_code, variant_group, shippable from shipping_rates
      where shipping_class_id = ${cls.id}`);
    const rates = ((ratesRes as any).rows ?? ratesRes) as any[];

    const classKey = `${cls.blueprint_id}:${cls.provider_id}`;
    const raw = JSON.parse(snap.raw_json);
    let groups: any[];
    try {
      groups = JSON.parse(cls.variant_groups_json);
    } catch {
      continue;
    }
    const table = buildClassRateTable(classKey, raw.byVariant, groups);
    const excluded: ExclusionSet = new Set(
      rates.filter((r) => !r.shippable).map((r) => `${r.country_code}::${r.variant_group}`),
    );
    const shippableZones = new Set<string>(
      rates.filter((r) => r.shippable).map((r) => r.country_code),
    );
    // Per-class merge lever (493:36 monitor note): overrides the default
    // group-delta split threshold when set. The simulator below still runs the
    // platform default config; no class sets an override today, and the Phase 3
    // desired-state generator is where per-class configs are applied for real.
    const classConfig: BandConfig =
      cls.group_delta_split_threshold_cents != null
        ? { ...DEFAULT_BAND_CONFIG, groupDeltaSplitThresholdCents: cls.group_delta_split_threshold_cents }
        : DEFAULT_BAND_CONFIG;
    out.push({
      classKey,
      name: cls.name,
      table,
      excluded,
      shippableZones,
      profileCount: planClassProfiles(table, excluded, classConfig).length,
    });
  }
  return out;
}

type ZoneStats = {
  zone: string;
  carts: number;
  blocked: number;
  openBand: number;
  exact: number;
  overshoots: number[]; // up95, non-open-band
  overshootPcts: number[];
  undercharges: number;
  toleranceBreaches: number;
  worst: Array<{ over: number; pct: number; trueCents: number; charged: number; desc: string }>;
  worstOpenBand: { over: number; desc: string } | null;
};

function describeCart(cart: CartItem[], byKey: Map<string, ClassData>): string {
  return cart
    .map((c) => {
      const cd = byKey.get(c.classKey)!;
      const label =
        cd.table.groups.find((g) => g.group === c.group)?.label?.slice(0, 20) || c.group;
      return `${c.quantity}× ${cd.name.replace(/ — provider \d+/, "")} [${c.group} ${label}]`;
    })
    .join(" + ");
}

async function main() {
  const config: BandConfig = DEFAULT_BAND_CONFIG; // up95, production default
  const classes = await loadClasses();
  const byKey = new Map(classes.map((c) => [c.classKey, c]));
  const tables: Record<string, ClassRateTable> = {};
  const exclusions: Record<string, ExclusionSet> = {};
  for (const c of classes) {
    tables[c.classKey] = c.table;
    exclusions[c.classKey] = c.excluded;
  }

  // Zone universe: every zone with any shippable rate row, plus fallthrough
  // sample countries with no explicit row anywhere (they hit ROW zones).
  const zones = Array.from(new Set(classes.flatMap((c) => Array.from(c.shippableZones)))).sort();
  const fallthroughSamples = ["JP", "BR", "ZA", "IN", "KR"].filter((z) => !zones.includes(z));

  const rng = makeRng(SEED);
  const stats: ZoneStats[] = [];
  let grandCarts = 0;

  for (const zone of [...zones, ...fallthroughSamples]) {
    // Only draw from classes that can ship *something* to this zone
    // (explicit row or ROW fallthrough).
    const candidates = classes.filter((c) => {
      const zoneKeys = c.shippableZones;
      return zoneKeys.has(zone) || zoneKeys.has("ROW");
    });
    if (candidates.length === 0) continue;

    const zs: ZoneStats = {
      zone,
      carts: 0,
      blocked: 0,
      openBand: 0,
      exact: 0,
      overshoots: [],
      overshootPcts: [],
      undercharges: 0,
      toleranceBreaches: 0,
      worst: [],
      worstOpenBand: null,
    };

    for (let i = 0; i < CARTS_PER_ZONE; i++) {
      const classCount = rng() < 0.7 ? 1 : 2 + Math.floor(rng() * 2);
      const chosen = new Set<string>();
      const cart: CartItem[] = [];
      for (let k = 0; k < classCount; k++) {
        const cd = pick(rng, candidates);
        if (chosen.has(cd.classKey)) continue;
        chosen.add(cd.classKey);
        const groupCount = 1 + Math.floor(rng() * Math.min(3, cd.table.groups.length));
        const groups = new Set<string>();
        for (let j = 0; j < groupCount; j++) groups.add(pick(rng, cd.table.groups).group);
        for (const group of Array.from(groups)) {
          cart.push({ classKey: cd.classKey, group, quantity: 1 + Math.floor(rng() * 14) });
        }
      }
      let total = cart.reduce((s, c) => s + c.quantity, 0);
      for (const item of cart) {
        if (total <= 15) break;
        const trim = Math.min(item.quantity - 1, total - 15);
        item.quantity -= trim;
        total -= trim;
      }

      zs.carts++;
      grandCarts++;
      const sim = simulateCart(cart, zone, tables, config, exclusions);
      if (sim.status !== "ok") {
        zs.blocked++;
        continue;
      }
      if (sim.chargedCents < sim.trueCents) zs.undercharges++;
      if (sim.hitOpenBand) {
        zs.openBand++;
        if (!zs.worstOpenBand || sim.overshootCents > zs.worstOpenBand.over) {
          zs.worstOpenBand = { over: sim.overshootCents, desc: describeCart(cart, byKey) };
        }
        continue;
      }
      if (sim.overshootCents > allowedOvershootCents(sim, config)) zs.toleranceBreaches++;
      if (sim.overshootCents <= 99 * sim.profilesUsed) zs.exact++; // only cosmetic rounding
      zs.overshoots.push(sim.overshootCents);
      zs.overshootPcts.push(sim.overshootPct);
      zs.worst.push({
        over: sim.overshootCents,
        pct: sim.overshootPct,
        trueCents: sim.trueCents,
        charged: sim.chargedCents,
        desc: describeCart(cart, byKey),
      });
      zs.worst.sort((a, b) => b.over - a.over);
      zs.worst = zs.worst.slice(0, 3);
    }
    stats.push(zs);
  }

  const pctl = (arr: number[], p: number) => {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };

  const lines: string[] = [];
  lines.push(`# Shipping band tolerance report`);
  lines.push(``);
  lines.push(
    `Seed ${SEED} · ${CARTS_PER_ZONE} carts/zone · ${grandCarts} carts total · rounding ${config.rounding} · maxBands ${config.maxBands}`,
  );
  lines.push(
    `Classes: ${classes.length} (${classes.reduce((s, c) => s + c.profileCount, 0)} delivery profiles) · tolerance = max(${usd(
      DEFAULT_TOLERANCE.absCents,
    )}, ${DEFAULT_TOLERANCE.pct * 100}% of true) + cross-group penalty + rounding`,
  );
  lines.push(``);
  lines.push(`## Per-class profile plan`);
  lines.push(``);
  for (const c of classes) {
    lines.push(
      `- ${c.classKey} ${c.name}: ${c.table.groups.length} group(s) → ${c.profileCount} profile(s)${
        c.excluded.size ? ` · ${c.excluded.size} excluded zone-group(s)` : ""
      }`,
    );
  }
  lines.push(``);
  lines.push(`## Per-zone results (rounding ${config.rounding})`);
  lines.push(``);
  lines.push(
    `| Zone | Carts | Blocked | Open band | ~Exact | Median over | p95 over | Max over | Max over % | Under | Breach |`,
  );
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const zs of stats) {
    const maxPct = zs.overshootPcts.length ? Math.max(...zs.overshootPcts) : 0;
    lines.push(
      `| ${zs.zone} | ${zs.carts} | ${zs.blocked} | ${zs.openBand} | ${zs.exact} | ${usd(
        pctl(zs.overshoots, 0.5),
      )} | ${usd(pctl(zs.overshoots, 0.95))} | ${usd(
        zs.overshoots.length ? Math.max(...zs.overshoots) : 0,
      )} | ${(maxPct * 100).toFixed(1)}% | ${zs.undercharges} | ${zs.toleranceBreaches} |`,
    );
  }
  lines.push(``);
  lines.push(`## Worst-case carts per zone`);
  lines.push(``);
  for (const zs of stats) {
    if (zs.worst.length === 0) continue;
    lines.push(`### ${zs.zone}`);
    for (const w of zs.worst) {
      lines.push(
        `- over ${usd(w.over)} (${(w.pct * 100).toFixed(1)}%) — true ${usd(
          w.trueCents,
        )}, charged ${usd(w.charged)}: ${w.desc}`,
      );
    }
    if (zs.worstOpenBand) {
      lines.push(
        `- [open band] over ${usd(zs.worstOpenBand.over)}: ${zs.worstOpenBand.desc}`,
      );
    }
    lines.push(``);
  }

  const totalUnder = stats.reduce((s, z) => s + z.undercharges, 0);
  const totalBreach = stats.reduce((s, z) => s + z.toleranceBreaches, 0);
  lines.push(`## Verdict`);
  lines.push(``);
  lines.push(`- Undercharges (charged < true): **${totalUnder}** (must be 0)`);
  lines.push(`- Tolerance breaches off the open band: **${totalBreach}** (must be 0)`);

  const report = lines.join("\n");
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, report);
  console.log(report);
  console.log(`\nWritten to ${OUT_FILE}`);
  process.exit(totalUnder === 0 && totalBreach === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("REPORT_FAILED:", e?.stack || e);
  process.exit(1);
});
