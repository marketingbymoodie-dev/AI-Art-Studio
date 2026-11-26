/**
 * GeoLite2-Country (self-hosted). No per-request vendor.
 *
 * Missing / unreadable DB → null (middleware falls through to US + prominent
 * selector). A readable but stale file is still used — better than treating
 * every visitor as US. Weekly refresh when MAXMIND_LICENSE_KEY is set.
 */
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { open, type Reader, type Response as MaxmindResponse } from "maxmind";

const LOG = "[geoip]";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_WARN_MS = 14 * 24 * 60 * 60 * 1000;

export type GeoLite2OperatorStatus =
  | "ok"
  | "no_license"
  | "db_missing"
  | "stale"
  | "error";

export type GeoLite2Status = {
  path: string;
  exists: boolean;
  ageDays: number | null;
  lastRefreshAt: string | null;
  lastError: string | null;
  readerOpen: boolean;
  licenseKeyPresent: boolean;
  stale: boolean;
  status: GeoLite2OperatorStatus;
};

export const GEOIP_STALE_WARN_DAYS = 14;

let reader: Reader<MaxmindResponse> | null = null;
let lastRefreshAt: Date | null = null;
let lastError: string | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function geoLite2DbPath(): string {
  const fromEnv = String(process.env.GEOIP_DB_PATH || "").trim();
  if (fromEnv) return fromEnv;
  return path.resolve(process.cwd(), "data", "GeoLite2-Country.mmdb");
}

function maxmindLicenseKey(): string {
  return String(process.env.MAXMIND_LICENSE_KEY || "").trim();
}

export function isPublicIp(ip: string): boolean {
  const v = String(ip || "").trim();
  if (!v) return false;
  if (v === "127.0.0.1" || v === "::1" || v === "0.0.0.0") return false;
  if (v.startsWith("10.")) return false;
  if (v.startsWith("192.168.")) return false;
  if (v.startsWith("169.254.")) return false;
  const m = v.match(/^172\.(\d+)\./);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 16 && n <= 31) return false;
  }
  if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return false;
  return true;
}

function fileAgeMs(filePath: string): number | null {
  try {
    const st = fs.statSync(filePath);
    return Date.now() - st.mtimeMs;
  } catch {
    return null;
  }
}

export function getGeoLite2Status(): GeoLite2Status {
  const p = geoLite2DbPath();
  const exists = fs.existsSync(p);
  const age = exists ? fileAgeMs(p) : null;
  const licenseKeyPresent = !!maxmindLicenseKey();
  const stale = age != null && age > STALE_WARN_MS;
  let status: GeoLite2OperatorStatus = "ok";
  if (!licenseKeyPresent) status = "no_license";
  else if (!exists) status = "db_missing";
  else if (lastError && !reader) status = "error";
  else if (stale) status = "stale";
  return {
    path: p,
    exists,
    ageDays: age == null ? null : Math.round((age / 86400000) * 10) / 10,
    lastRefreshAt: lastRefreshAt ? lastRefreshAt.toISOString() : null,
    lastError,
    readerOpen: !!reader,
    licenseKeyPresent,
    stale,
    status,
  };
}

function extractMmdbFromTarGz(archive: Buffer, destPath: string): void {
  const tar = zlib.gunzipSync(archive);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0+$/, "");
    const sizeOctal = header.subarray(124, 136).toString("utf8").replace(/\0/g, "").trim();
    const size = parseInt(sizeOctal, 8) || 0;
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (name.toLowerCase().endsWith(".mmdb") && size > 0 && dataEnd <= tar.length) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const tmp = `${destPath}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, tar.subarray(dataStart, dataEnd));
      fs.renameSync(tmp, destPath);
      return;
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error("GeoLite2 tarball did not contain a .mmdb file");
}

async function downloadGeoLite2(destPath: string): Promise<void> {
  const key = maxmindLicenseKey();
  if (!key) throw new Error("MAXMIND_LICENSE_KEY is not set");
  const url =
    `https://download.maxmind.com/app/geoip_download` +
    `?edition_id=GeoLite2-Country&license_key=${encodeURIComponent(key)}&suffix=tar.gz`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`MaxMind download HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  extractMmdbFromTarGz(buf, destPath);
}

async function openReader(filePath: string): Promise<void> {
  reader = await open<MaxmindResponse>(filePath);
  const age = fileAgeMs(filePath);
  if (age != null && age > STALE_WARN_MS) {
    console.warn(
      LOG,
      `using stale GeoLite2 DB (${(age / 86400000).toFixed(1)} days old) at ${filePath}`,
    );
  } else {
    console.log(LOG, `opened ${filePath}`);
  }
}

export async function refreshGeoLite2(opts?: { force?: boolean }): Promise<void> {
  const dest = geoLite2DbPath();
  const age = fileAgeMs(dest);
  const needsDownload =
    !!opts?.force || age == null || age > WEEK_MS;

  if (needsDownload && maxmindLicenseKey()) {
    try {
      const tmpDir = path.join(os.tmpdir(), "appai-geolite2");
      fs.mkdirSync(tmpDir, { recursive: true });
      const staged = path.join(tmpDir, "GeoLite2-Country.mmdb");
      await downloadGeoLite2(staged);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(staged, dest);
      lastRefreshAt = new Date();
      lastError = null;
      console.log(LOG, `refreshed GeoLite2 → ${dest}`);
    } catch (e: any) {
      lastError = e?.message || String(e);
      console.error(LOG, "refresh failed:", lastError);
      if (age == null) {
        reader = null;
        return;
      }
      // Keep the stale file; do not fail closed.
    }
  } else if (needsDownload && !maxmindLicenseKey()) {
    lastError = age == null ? "MAXMIND_LICENSE_KEY missing and no GeoLite2 DB on disk" : lastError;
    if (age == null) {
      console.warn(LOG, lastError);
    }
  }

  if (fs.existsSync(dest)) {
    try {
      await openReader(dest);
    } catch (e: any) {
      lastError = e?.message || String(e);
      reader = null;
      console.error(LOG, "failed to open DB:", lastError);
    }
  }
}

/** Returns ISO country or null (private IP / missing DB / unknown). Never throws. */
export async function lookupCountryForIp(ipRaw: string): Promise<string | null> {
  const ip = String(ipRaw || "").trim();
  if (!isPublicIp(ip)) return null;
  if (!reader) return null;
  try {
    const hit = reader.get(ip) as
      | { country?: { iso_code?: string }; registered_country?: { iso_code?: string } }
      | undefined;
    const code = hit?.country?.iso_code || hit?.registered_country?.iso_code;
    const normalized = String(code || "").trim().toUpperCase();
    return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
  } catch (e: any) {
    console.warn(LOG, "lookup failed:", e?.message || e);
    return null;
  }
}

export function startGeoLite2Refresh(): void {
  void refreshGeoLite2();
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    void refreshGeoLite2();
  }, 24 * 60 * 60 * 1000);
  if (typeof refreshTimer.unref === "function") refreshTimer.unref();
}
