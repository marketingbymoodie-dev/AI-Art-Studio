import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DecorFloatingFillPicker } from "./DecorFloatingFillPicker";

describe("DecorFloatingFillPicker", () => {
  it("has no White/None text labels; None is a swatch", () => {
    render(<DecorFloatingFillPicker value="#FFFFFF" onChange={vi.fn()} />);
    const root = screen.getByTestId("decor-floating-fill-picker");
    expect(root.textContent).not.toMatch(/\bWhite\b/);
    expect(root.textContent).not.toMatch(/\bNone\b/);
    expect(screen.getByTestId("decor-fill-none").getAttribute("aria-label")).toBe(
      "None (transparent)",
    );
    expect(screen.getByLabelText("Background colour")).toBeTruthy();
    expect(screen.getByLabelText("Background hex")).toBeTruthy();
  });

  it("defaults the colour input to white", () => {
    render(<DecorFloatingFillPicker value="#FFFFFF" onChange={vi.fn()} />);
    const color = screen.getByLabelText("Background colour") as HTMLInputElement;
    expect(color.value.toLowerCase()).toBe("#ffffff");
  });
});
