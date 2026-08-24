import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHIP_COUNTRY,
  normalizeShipCountry,
  resolveShipCountryDecision,
  shipCountryFlag,
} from "./ship-country";
import { isPublicIp } from "../server/geoip";
import { shipCountryCookieOptions } from "../server/ship-country-middleware";

describe("resolveShipCountryDecision", () => {
  it("cookie beats IP", () => {
    expect(
      resolveShipCountryDecision({ cookieCountry: "AU", ipCountry: "US" }),
    ).toEqual({ country: "AU", source: "cookie" });
  });

  it("IP used when cookie is absent", () => {
    expect(resolveShipCountryDecision({ ipCountry: "GB" })).toEqual({
      country: "GB",
      source: "ip",
    });
  });

  it("defaults to US when cookie and IP are unknown", () => {
    expect(resolveShipCountryDecision({})).toEqual({
      country: DEFAULT_SHIP_COUNTRY,
      source: "default",
    });
    expect(resolveShipCountryDecision({ cookieCountry: "ROW", ipCountry: "zzz" })).toEqual({
      country: "US",
      source: "default",
    });
  });

  it("normalizes lowercase ISO codes", () => {
    expect(normalizeShipCountry("au")).toBe("AU");
    expect(normalizeShipCountry("Australia")).toBeNull();
  });
});

describe("isPublicIp", () => {
  it("rejects loopback and RFC1918", () => {
    expect(isPublicIp("127.0.0.1")).toBe(false);
    expect(isPublicIp("10.0.0.4")).toBe(false);
    expect(isPublicIp("192.168.1.9")).toBe(false);
    expect(isPublicIp("172.16.0.1")).toBe(false);
    expect(isPublicIp("::1")).toBe(false);
  });

  it("accepts a public IPv4", () => {
    expect(isPublicIp("1.1.1.1")).toBe(true);
  });
});

describe("shipCountryCookieOptions", () => {
  it("sets host-wide Domain on *.aiartstudio.app", () => {
    const opts = shipCountryCookieOptions({
      hostname: "luxe.aiartstudio.app",
      headers: { host: "luxe.aiartstudio.app" },
    } as any);
    expect(opts.domain).toBe(".aiartstudio.app");
    expect(opts.path).toBe("/");
    expect(opts.sameSite).toBe("lax");
  });

  it("does not set Domain on localhost", () => {
    const opts = shipCountryCookieOptions({
      hostname: "localhost",
      headers: { host: "localhost:5000" },
    } as any);
    expect(opts.domain).toBeUndefined();
  });
});

describe("shipCountryFlag", () => {
  it("renders AU as the Australian flag", () => {
    expect(shipCountryFlag("AU")).toBe("🇦🇺");
  });
});
