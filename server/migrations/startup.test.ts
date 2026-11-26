import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const startupSrc = readFileSync("server/migrations/startup.ts", "utf8");

describe("startup DATA_MIGRATIONS", () => {
  it("does not use a SQL string as a tagged-template tag (missing comma)", () => {
    const start = startupSrc.indexOf("const DATA_MIGRATIONS");
    const end = startupSrc.indexOf("];", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = startupSrc.slice(start, end);
    // `sql1` `sql2`  or  `sql1`\n  // comment\n  `sql2`
    // calls the first string as a function → TypeError: "UPDATE ..." is not a function
    expect(block).not.toMatch(/`\s*(?:\/\/[^\n]*\s*)*`/);
  });

  it("clamps legacy customer credits so credit_balances_credits_check cannot fail", () => {
    const start = startupSrc.indexOf("const DATA_MIGRATIONS");
    const end = startupSrc.indexOf("];", start);
    const block = startupSrc.slice(start, end);
    expect(block).toMatch(/GREATEST\(COALESCE\(credits, 0\), 0\)/);
    expect(block).toMatch(/GREATEST\(c\.credits, 0\) < cb\.credits/);
  });
});

describe("startup TABLE_MIGRATIONS", () => {
  it("creates core tables that COLUMN_MIGRATIONS and storefront paths assume exist", () => {
    const start = startupSrc.indexOf("const TABLE_MIGRATIONS");
    const end = startupSrc.indexOf("const INDEX_MIGRATIONS");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = startupSrc.slice(start, end);
    for (const name of ["designs", "shared_designs", "orders", "cached_panel_images"]) {
      expect(block).toContain(`name: "${name}"`);
      expect(block).toContain(`CREATE TABLE IF NOT EXISTS "${name}"`);
    }
  });
});
