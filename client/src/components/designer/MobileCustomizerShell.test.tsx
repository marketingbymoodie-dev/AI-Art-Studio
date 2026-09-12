import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MobileCustomizerShell } from "./MobileCustomizerShell";

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
