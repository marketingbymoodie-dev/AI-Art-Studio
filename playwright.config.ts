import { defineConfig, devices } from "@playwright/test";

/**
 * UI QA for pricing modeller (mocked APIs).
 * Service-layer counter/stamp cases live in server/pricing-qa.integration.test.ts.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4177",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx vite --config e2e/pricing-qa/vite.config.ts",
    url: "http://127.0.0.1:4177",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
