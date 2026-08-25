/**
 * Phase 4 Slice B — shared ship-to country helpers.
 * Cookie name, default, and the selector option list. Resolution order
 * (cookie > IP > US) lives on the server so listing and generate cannot diverge.
 */
export const SHIP_COUNTRY_COOKIE = "ship_country";
export const DEFAULT_SHIP_COUNTRY = "US";

export type ShipCountrySource = "cookie" | "ip" | "default";

export type ShipCountryOption = { code: string; name: string };

/** Shopper-facing list (ISO 3166-1 alpha-2). US first — it's the default. */
export const SHIP_COUNTRY_OPTIONS: ShipCountryOption[] = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "IE", name: "Ireland" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" },
  { code: "AT", name: "Austria" },
  { code: "CH", name: "Switzerland" },
  { code: "IT", name: "Italy" },
  { code: "ES", name: "Spain" },
  { code: "PT", name: "Portugal" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "PL", name: "Poland" },
  { code: "CZ", name: "Czechia" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "SG", name: "Singapore" },
  { code: "HK", name: "Hong Kong" },
  { code: "TW", name: "Taiwan" },
  { code: "IN", name: "India" },
  { code: "MX", name: "Mexico" },
  { code: "BR", name: "Brazil" },
  { code: "AR", name: "Argentina" },
  { code: "CL", name: "Chile" },
  { code: "ZA", name: "South Africa" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "IL", name: "Israel" },
  { code: "PH", name: "Philippines" },
];

/** ISO-4217 for the Phase 4 ship-to country. One map — shipping, gating, rewards copy. */
export const CURRENCY_BY_SHIP_COUNTRY: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  AU: "AUD",
  NZ: "NZD",
  IE: "EUR",
  DE: "EUR",
  FR: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  CH: "CHF",
  IT: "EUR",
  ES: "EUR",
  PT: "EUR",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  FI: "EUR",
  PL: "PLN",
  CZ: "CZK",
  JP: "JPY",
  KR: "KRW",
  SG: "SGD",
  HK: "HKD",
  TW: "TWD",
  IN: "INR",
  MX: "MXN",
  BR: "BRL",
  AR: "ARS",
  CL: "CLP",
  ZA: "ZAR",
  AE: "AED",
  IL: "ILS",
  PH: "PHP",
};

export function currencyForShipCountry(countryRaw: string | null | undefined): string {
  const c = String(countryRaw || "").trim().toUpperCase();
  return CURRENCY_BY_SHIP_COUNTRY[c] || "USD";
}

const OPTION_BY_CODE = new Map(SHIP_COUNTRY_OPTIONS.map((o) => [o.code, o]));

export function normalizeShipCountry(raw: unknown): string | null {
  const c = String(raw || "").trim().toUpperCase();
  if (c === "ROW") return "ROW";
  if (/^[A-Z]{2}$/.test(c)) return c;
  return null;
}

export function shipCountryName(code: string): string {
  const c = String(code || "").toUpperCase();
  return OPTION_BY_CODE.get(c)?.name || c;
}

/** Regional-indicator flag emoji (🇺🇸). */
export function shipCountryFlag(code: string): string {
  const c = String(code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0)));
}

export function formatShipCountryLabel(code: string): string {
  const flag = shipCountryFlag(code);
  const name = shipCountryName(code);
  return flag ? `${flag} ${name}` : name;
}

export type ResolvedShipCountry = {
  country: string;
  source: ShipCountrySource;
};

/**
 * Pure resolver: cookie override > IP detection > US default.
 * Invalid / ROW cookies are ignored so they cannot pin a shopper to a non-ISO zone.
 */
export function resolveShipCountryDecision(params: {
  cookieCountry?: unknown;
  ipCountry?: unknown;
}): ResolvedShipCountry {
  const cookie = normalizeShipCountry(params.cookieCountry);
  if (cookie && cookie !== "ROW") {
    return { country: cookie, source: "cookie" };
  }
  const ip = normalizeShipCountry(params.ipCountry);
  if (ip && ip !== "ROW") {
    return { country: ip, source: "ip" };
  }
  return { country: DEFAULT_SHIP_COUNTRY, source: "default" };
}
