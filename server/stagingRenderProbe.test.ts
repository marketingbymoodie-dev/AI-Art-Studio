import { describe, expect, it } from "vitest";
import { stagingProbeAllowed } from "./routes/staging-render-probe";

const TOKEN = "probe-token-0123456789abcdefghij";
const req = (token?: string) => ({ get: (h: string) => (h === "x-appai-probe-token" ? token : undefined) }) as any;

describe("staging render probe gate", () => {
  it("allows only staging with the exact configured token", () => {
    expect(stagingProbeAllowed(req(TOKEN), { RAILWAY_ENVIRONMENT_NAME: "Staging", STAGING_PROBE_TOKEN: TOKEN })).toBe(true);
  });
  it("is closed in production, without a token, with a short token, or a wrong token", () => {
    expect(stagingProbeAllowed(req(TOKEN), { RAILWAY_ENVIRONMENT_NAME: "production", STAGING_PROBE_TOKEN: TOKEN })).toBe(false);
    expect(stagingProbeAllowed(req(TOKEN), { RAILWAY_ENVIRONMENT_NAME: "Staging" })).toBe(false);
    expect(stagingProbeAllowed(req("short"), { RAILWAY_ENVIRONMENT_NAME: "Staging", STAGING_PROBE_TOKEN: "short" })).toBe(false);
    expect(stagingProbeAllowed(req(TOKEN.replace("0", "X")), { RAILWAY_ENVIRONMENT_NAME: "Staging", STAGING_PROBE_TOKEN: TOKEN })).toBe(false);
    expect(stagingProbeAllowed(req(undefined), { RAILWAY_ENVIRONMENT_NAME: "Staging", STAGING_PROBE_TOKEN: TOKEN })).toBe(false);
  });
});
