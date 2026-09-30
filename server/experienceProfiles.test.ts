import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { effectiveStyleConfigForPage, profileAvailableToMerchant } from "./experience-profiles";
import { StudioNewsletterSignup } from "../client/src/components/studio-newsletter-signup";
import { resolveMobileShellBrandName } from "../client/src/components/designer/resolveMobileShellBrandName";

describe("profile availability (resolves only when explicitly assigned)", () => {
  const platform = { isActive: true, merchantId: null };
  it("platform profile needs an explicit merchant assignment", () => {
    expect(profileAvailableToMerchant(platform, "m1", false)).toBe(false);
    expect(profileAvailableToMerchant(platform, "m1", true)).toBe(true);
  });
  it("own profile only for its merchant; inactive never", () => {
    expect(profileAvailableToMerchant({ isActive: true, merchantId: "m1" }, "m1", false)).toBe(true);
    expect(profileAvailableToMerchant({ isActive: true, merchantId: "m1" }, "m2", true)).toBe(false);
    expect(profileAvailableToMerchant({ isActive: false, merchantId: null }, "m1", true)).toBe(false);
    expect(profileAvailableToMerchant(null, "m1", true)).toBe(false);
    expect(profileAvailableToMerchant(platform, null, true)).toBe(false);
  });
});

describe("page style source", () => {
  const category = { mode: "category" as const, category: "apparel" as const };
  it("no profile: the page's own config, unchanged", () => {
    expect(effectiveStyleConfigForPage(category, null)).toBe(category);
    expect(effectiveStyleConfigForPage(null, null)).toBeNull();
  });
  it("profile pack applies unless the page names its own pack", () => {
    expect(effectiveStyleConfigForPage(category, { stylePackId: "pk" })).toEqual({ mode: "pack", packId: "pk" });
    const own = { mode: "pack" as const, packId: "mine" };
    expect(effectiveStyleConfigForPage(own, { stylePackId: "pk" })).toBe(own);
    expect(effectiveStyleConfigForPage(category, { stylePackId: null })).toBe(category);
  });
});

describe("classic presentation without a profile", () => {
  it("newsletter keeps the Studio Art Class copy", () => {
    render(createElement(StudioNewsletterSignup, { source: "store_user" }));
    expect(
      screen.getByText("Join the Studio Art Class list. Discover prompt tips and tricks, inspiration from others and more."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Join" })).toBeTruthy();
  });

  it("newsletter uses profile copy when given", () => {
    render(createElement(StudioNewsletterSignup, { source: "store_user", introText: "New designs weekly.", buttonLabel: "Sign me up" }));
    expect(screen.getByText("New designs weekly.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign me up" })).toBeTruthy();
  });

  it("brand name: creator > profile > shop name > store name > default", () => {
    expect(resolveMobileShellBrandName({ shopNameParam: "Shop", merchantStoreName: "Store" })).toBe("Shop");
    expect(resolveMobileShellBrandName({})).toBe("AI Art Studio");
    expect(resolveMobileShellBrandName({ profileBrandName: "Petposterous", shopNameParam: "Shop" })).toBe("Petposterous");
    expect(
      resolveMobileShellBrandName({ isCreatorStorefront: true, creatorStoreName: "Creator", profileBrandName: "Petposterous" }),
    ).toBe("Creator");
  });
});

describe("newsletter success copy", () => {
  it("store success heading/body replace the classic line; credit detail kept", async () => {
    const { fireEvent, waitFor } = await import("@testing-library/react");
    const { vi } = await import("vitest");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ creditGranted: true, creditAmount: 1 }), { status: 200 }));
    render(
      createElement(StudioNewsletterSignup, {
        source: "store_user",
        customerId: "c1",
        successHeading: "You're on the list.",
        successBody: "Further correspondence will follow.",
      }),
    );
    fireEvent.change(screen.getByPlaceholderText("you@email.com"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(screen.getByTestId("newsletter-success")).toBeTruthy());
    expect(screen.getByText("You're on the list.")).toBeTruthy();
    expect(screen.getByText("Further correspondence will follow.")).toBeTruthy();
    expect(screen.getByText("1 Studio Credit added.")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("without store copy the classic message is unchanged", async () => {
    const { fireEvent, waitFor } = await import("@testing-library/react");
    const { vi } = await import("vitest");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ creditGranted: true, creditAmount: 1 }), { status: 200 }));
    render(createElement(StudioNewsletterSignup, { source: "store_user", customerId: "c1" }));
    fireEvent.change(screen.getAllByPlaceholderText("you@email.com").at(-1)!, { target: { value: "a@b.co" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Join" }).at(-1)!);
    await waitFor(() => expect(screen.getByText("You're on the list — 1 Studio Credit added.")).toBeTruthy());
    vi.unstubAllGlobals();
  });
});
