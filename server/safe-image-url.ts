/**
 * Allowlist for server-side image fetches driven by client-supplied URLs.
 *
 * Endpoints that fetch an `imageUrl` on behalf of an anonymous storefront
 * visitor fetch from the server's network position, which on Railway can reach
 * internal services and the cloud metadata endpoint. Only the origins our own
 * design pipeline writes to are accepted; everything else is refused before any
 * network call happens.
 */

/** Public origin of this app. Never derived from the request Host header —
 *  that header is client-controlled and is itself an SSRF vector. */
export function selfPublicOrigin(): string | null {
  const env =
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "");
  if (!env) return null;
  return env.replace(/\/$/, "");
}

/** Host suffixes the design pipeline legitimately stores artwork on. */
function allowedHostSuffixes(): string[] {
  const suffixes = [
    "images.printify.com", // Printify blanks/placeholders (see /api/proxy-svg)
    ".supabase.co", // design + mockup buckets (server/supabaseDesigns.ts)
    "replicate.delivery", // generation + vectorizer output
    ".replicate.delivery",
  ];
  const supabaseUrl = process.env.SUPABASE_URL;
  if (supabaseUrl) {
    try {
      suffixes.push(new URL(supabaseUrl).hostname.toLowerCase());
    } catch {
      /* misconfigured SUPABASE_URL — the .supabase.co suffix still covers it */
    }
  }
  const self = selfPublicOrigin();
  if (self) {
    try {
      suffixes.push(new URL(self).hostname.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  return suffixes;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

function isIpLiteral(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // URL parsing gives bracketless IPv6 in `hostname` for `http://[::1]/`.
  return hostname.includes(":") || /^\[.*\]$/.test(hostname);
}

/** Private, loopback, link-local and carrier-grade-NAT IPv4 ranges. */
function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // includes 169.254.169.254 (cloud metadata)
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export type SafeImageUrl =
  | { ok: true; url: string }
  | { ok: false; status: number; reason: string };

/**
 * Resolve a client-supplied image reference to a URL that is safe to fetch.
 * Accepts app-relative `/objects/...` paths (resolved against the configured
 * public origin) and absolute URLs on allowlisted hosts. `data:` URLs are the
 * caller's responsibility — they involve no network fetch.
 */
export function resolveAllowedImageUrl(raw: string): SafeImageUrl {
  const input = String(raw || "").trim();
  if (!input) return { ok: false, status: 400, reason: "imageUrl is required" };

  let candidate = input;
  if (candidate.startsWith("/")) {
    const self = selfPublicOrigin();
    if (!self) {
      return { ok: false, status: 500, reason: "App public origin is not configured" };
    }
    candidate = `${self}${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, status: 400, reason: "imageUrl is not a valid URL" };
  }

  const selfOrigin = selfPublicOrigin();
  const isLocalSelf = !!selfOrigin && url.origin === selfOrigin && url.protocol === "http:";
  if (url.protocol !== "https:" && !isLocalSelf) {
    return { ok: false, status: 403, reason: "Only https image URLs are allowed" };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".internal") || hostname.endsWith(".local")) {
    return { ok: false, status: 403, reason: "Image host is not allowed" };
  }
  // No allowlisted origin is an IP literal, so every IP is refused. Private
  // ranges get their own reason so the log distinguishes a probe from a typo.
  if (isIpLiteral(hostname)) {
    return {
      ok: false,
      status: 403,
      reason: isPrivateIpv4(hostname)
        ? "Private and internal addresses are not allowed"
        : "Image host is not allowed",
    };
  }

  const allowed = allowedHostSuffixes().some(
    (suffix) => hostname === suffix.replace(/^\./, "") || hostname.endsWith(suffix),
  );
  if (!allowed) {
    return { ok: false, status: 403, reason: "Image host is not allowed" };
  }

  return { ok: true, url: url.toString() };
}
