/**
 * @vitest-environment jsdom
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { defaultEaseForShape, measurementsFromPrintifyChart } from "@shared/findMySize";

const require = createRequire(import.meta.url);
require("../extensions/theme-extension/assets/appai-find-my-size.js");
const finder = (window as unknown as {
  AppaiFindMySize: {
    suggest: (guide: unknown, heightCm: number, weightKg: number, fit: string) => string;
    openDialog: (doc: Document, guide: unknown) => HTMLElement;
    chooseSize: (doc: Document, name: string) => boolean;
  };
}).AppaiFindMySize;

const comfort = measurementsFromPrintifyChart({
  model: "Comfort Colors 1717",
  selectedSizes: ["S", "M", "L", "XL", "2XL", "3XL"],
  measurements: [
    ["S", "M", "L", "XL", "2XL", "3XL", "4XL"],
    ["Width, in", "18.25", "20.25", "22.00", "24.00", "26.00", "27.75", "29.75"],
    ["Length, in", "26.62", "28.00", "29.37", "30.75", "31.62", "32.50", "33.50"],
    ["Sleeve length from center back, in", "16.25", "17.75", "19.00", "20.50", "21.75", "23.25", "24.63"],
    ["Size tolerance, in", "1.50", "1.50", "1.50", "1.50", "1.50", "1.50", "1.50"],
  ],
});

const guide = {
  garmentWord: "T-Shirt",
  shape: "tee",
  ease: defaultEaseForShape("tee"),
  measurements: comfort,
  guarantee: null,
};

function button(root: ParentNode, name: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find((item) => item.textContent?.trim() === name);
  if (!found) throw new Error("missing button " + name);
  return found;
}

describe("storefront find my size", () => {
  it("suggests L for 185 cm / 85 kg relaxed on type 58", () => {
    expect(finder.suggest(guide, 185, 85, "relaxed")).toBe("L");
  });

  it("opens on Suggest my size, Relaxed, and centimetres, then selects L", () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Size</legend>
        <label><input type="radio" name="Size" value="S"> S</label>
        <label><input type="radio" name="Size" value="M"> M</label>
        <label><input type="radio" name="Size" value="L"> L</label>
      </fieldset>
    `;
    const root = finder.openDialog(document, guide);
    expect(button(root, "Suggest my size").getAttribute("aria-pressed")).toBe("true");
    expect(button(root, "Compare measurements").getAttribute("aria-pressed")).toBe("false");
    expect(button(root, "Relaxed").getAttribute("aria-pressed")).toBe("true");
    expect(button(root, "cm / kg").getAttribute("aria-pressed")).toBe("true");
    expect(button(root, "ft / lb").getAttribute("aria-pressed")).toBe("false");

    const height = root.querySelector("[data-field=height]") as HTMLInputElement;
    const weight = root.querySelector("[data-field=weight]") as HTMLInputElement;
    height.value = "185";
    height.dispatchEvent(new Event("input", { bubbles: true }));
    weight.value = "85";
    weight.dispatchEvent(new Event("input", { bubbles: true }));
    button(root, "Relaxed").click();
    button(root, "Find my size").click();
    expect(root.textContent).toContain("Estimated starting size");
    expect(root.textContent).toContain("Use size L");
    button(root, "Use size L").click();
    const selected = document.querySelector('input[value="L"]') as HTMLInputElement;
    expect(selected.checked).toBe(true);
  });

  it("returns from Compare measurements to Suggest my size", () => {
    document.body.innerHTML = "<div></div>";
    const root = finder.openDialog(document, guide);
    button(root, "Compare measurements").click();
    expect(root.textContent).toContain("Garment measurements");
    expect(root.querySelector("svg")).toBeTruthy();
    expect(button(root, "Suggest my size").getAttribute("aria-pressed")).toBe("false");
    button(root, "Back to Find my size").click();
    expect(root.textContent).toContain("How we suggest a size");
    expect(button(root, "Suggest my size").getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector("[data-field=height]")).toBeTruthy();
  });

  it("says what is missing instead of staying blank", () => {
    document.body.innerHTML = "<div></div>";
    const root = finder.openDialog(document, guide);
    button(root, "Find my size").click();
    expect(root.textContent).toContain("Enter your height and weight.");
  });
});
