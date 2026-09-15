import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MobileCustomizerShell } from "./MobileCustomizerShell";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "mobile-customizer.css"),
  "utf8",
);

describe("MobileCustomizerShell top bar", () => {
  it("renders Back · brand · Credits · Help · Gallery · Cart in that order", () => {
    render(
      <MobileCustomizerShell
        brandName="Willow & Finch Creative Collective"
        isLoggedIn
        creditsLabel={4}
        onBack={vi.fn()}
        onOpenCart={vi.fn()}
      />,
    );

    const bar = screen.getByTestId("mobile-shell-topbar");
    const ids = [...bar.querySelectorAll("[data-testid]")].map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(ids).toEqual([
      "button-mobile-back",
      "button-mobile-home",
      "button-mobile-credits",
      "button-mobile-help",
      "button-mobile-gallery",
      "button-mobile-cart",
    ]);
    expect(screen.queryByTestId("button-mobile-login")).toBeNull();
    expect(bar.querySelector(".appai-mshell-brand-label")?.textContent).toBe(
      "Willow & Finch Creative Collective",
    );
  });

  it("keeps Credits visible when logged out (no Sign-in swap)", () => {
    render(
      <MobileCustomizerShell
        brandName="AI Art Studio"
        isLoggedIn={false}
        creditsLabel={0}
        onBack={vi.fn()}
        onLogin={vi.fn()}
        onOpenCart={vi.fn()}
      />,
    );
    expect(screen.getByTestId("button-mobile-credits")).toBeTruthy();
    expect(screen.getByTestId("button-mobile-cart")).toBeTruthy();
    expect(screen.queryByTestId("button-mobile-login")).toBeNull();
  });
});

const styleSlot = {
  id: "style",
  label: "Style",
  icon: <span />,
  title: "Art style",
  content: <div>style body</div>,
};

const sizeSlot = {
  id: "size",
  label: "Size",
  icon: <span />,
  title: "Size & ratio",
  content: <div>size body</div>,
};

describe("MobileCustomizerShell bottom group", () => {
  it("covers the bottom group when chromeCovered (Gallery / OTP)", () => {
    render(
      <MobileCustomizerShell
        brandName="AI Art Studio"
        isLoggedIn
        onBack={vi.fn()}
        chromeCovered
        primaryAction={<button type="button">Generate</button>}
        bottomSlots={[styleSlot]}
      />,
    );
    expect(screen.getByTestId("mobile-bottomgroup").className).toMatch(
      /is-covered/,
    );
    expect(screen.queryByTestId("mobile-rail")).toBeNull();
  });

  it("does not hide the rail when a sheet is open", () => {
    render(
      <MobileCustomizerShell
        brandName="AI Art Studio"
        isLoggedIn
        onBack={vi.fn()}
        primaryAction={<button type="button">Generate</button>}
        railSlots={[sizeSlot]}
        bottomSlots={[styleSlot]}
      />,
    );
    fireEvent.click(screen.getByTestId("button-mobile-rtool-size"));
    expect(screen.getByTestId("mobile-sheet-size").className).toMatch(/show/);
    expect(screen.getByTestId("mobile-bottomgroup").className).toMatch(
      /is-covered/,
    );
    expect(screen.getByTestId("mobile-rail").className).not.toMatch(/tucked/);
    expect(screen.getByTestId("mobile-rail").className).not.toMatch(
      /is-covered/,
    );
  });

  it("keeps the rail tucked after auto-dismiss with retractRail", () => {
    const { rerender } = render(
      <MobileCustomizerShell
        brandName="AI Art Studio"
        isLoggedIn
        onBack={vi.fn()}
        primaryAction={<button type="button">Generate</button>}
        railSlots={[sizeSlot]}
        closeSheetRequest={null}
      />,
    );
    expect(screen.getByTestId("mobile-rail").className).not.toMatch(/tucked/);
    rerender(
      <MobileCustomizerShell
        brandName="AI Art Studio"
        isLoggedIn
        onBack={vi.fn()}
        primaryAction={<button type="button">Generate</button>}
        railSlots={[sizeSlot]}
        closeSheetRequest={{ nonce: 1, retractRail: true }}
      />,
    );
    expect(screen.getByTestId("mobile-rail").className).toMatch(/tucked/);
  });
});

describe("mobile-customizer.css canvas scoping", () => {
  it("does not force flex-column on closed-preview canvas children", () => {
    const baseChild = css.match(
      /\.appai-mobile-shell \.appai-mobile-canvas > \* \{([^}]+)\}/,
    );
    expect(baseChild?.[1]).toBeTruthy();
    expect(baseChild?.[1]).not.toMatch(/flex-direction:\s*column/);
    expect(css).toMatch(
      /\.appai-mobile-shell \.appai-mobile-canvas--placer > \*/,
    );
  });
});
