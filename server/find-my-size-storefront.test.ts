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
    hideThemeSizeGuide: (doc: Document) => void;
    placeLauncher: (doc: Document, guide: unknown, listing: boolean) => boolean;
    watchLauncher: (doc: Document, guide: unknown, listing: boolean) => void;
  };
}).AppaiFindMySize;

function pickerFields(selectedSize = "M", selectedColor = "White"): string {
  const size = (name: string) => `<label><input type="radio" name="Size" value="${name}"${name === selectedSize ? " checked" : ""}> ${name}</label>`;
  const color = (name: string) => `<label><input type="radio" name="Color" value="${name}"${name === selectedColor ? " checked" : ""}> ${name}</label>`;
  return `<fieldset><legend>Size</legend>${["S", "M", "L"].map(size).join("")}</fieldset>
    <fieldset><legend>Color</legend>${["White", "Black"].map(color).join("")}</fieldset>`;
}

function replacePicker(selectedSize = "M", selectedColor = "White"): void {
  document.querySelector("variant-picker")!.innerHTML = pickerFields(selectedSize, selectedColor);
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

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
  it("suggests 2XL for 185 cm / 85 kg relaxed on the Comfort Colors guide", () => {
    expect(finder.suggest(guide, 185, 85, "relaxed")).toBe("2XL");
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
    height.value = "155";
    height.dispatchEvent(new Event("input", { bubbles: true }));
    weight.value = "62";
    weight.dispatchEvent(new Event("input", { bubbles: true }));
    button(root, "Relaxed").click();
    button(root, "Find my size").click();
    expect(root.textContent).toContain("Estimated starting size");
    expect(root.textContent).toContain("Use size L");
    button(root, "Use size L").click();
    const selected = document.querySelector('input[value="L"]') as HTMLInputElement;
    expect(selected.checked).toBe(true);
  });

  it("opens the guarantee policy in a new tab", () => {
    document.body.innerHTML = "<div></div>";
    const root = finder.openDialog(document, {
      ...guide,
      guarantee: {
        title: "30-day money-back & fit guarantee",
        detail: "Wrong size? We'll send you a new tee.",
        url: "https://petposterous.myshopify.com/policies/refund-policy",
      },
    });
    const link = root.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://petposterous.myshopify.com/policies/refund-policy");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener");
    expect(link?.textContent).toBe("30-day money-back & fit guarantee");
  });

  it("returns from Compare measurements to Suggest my size", () => {
    document.body.innerHTML = "<div></div>";
    const root = finder.openDialog(document, guide);
    button(root, "Compare measurements").click();
    expect(root.textContent).toContain("Garment measurements");
    expect(root.textContent).not.toContain("Sleeve");
    const close = root.querySelector("[data-close]") as HTMLButtonElement;
    expect(close.getAttribute("aria-label")).toBe("Close");
    expect(close.textContent?.trim()).toBe("");
    const flat = root.querySelector(".appai-fms__svg")?.innerHTML || "";
    expect(flat).toContain("L72 48 L98 48");
    expect(flat).toContain('y1="48"');
    expect(root.querySelector("style")?.textContent).toContain("--font-body--family");
    expect(button(root, "Suggest my size").getAttribute("aria-pressed")).toBe("false");
    button(root, "Back to Find my size").click();
    expect(root.textContent).toContain("How we suggest a size");
    expect(button(root, "Suggest my size").getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector("[data-field=height]")).toBeTruthy();
  });

  it("labels sleeve length on a sweatshirt", () => {
    document.body.innerHTML = "<div></div>";
    const root = finder.openDialog(document, { ...guide, shape: "sweatshirt", garmentWord: "Sweatshirt" });
    button(root, "Compare measurements").click();
    expect(root.textContent).toContain("Sleeve length from centre back");
    expect(root.querySelector(".appai-fms__svg")?.innerHTML).toContain("L72 48 L98 48");
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

  it("hides the theme Size Guide trigger and leaves Find my size", () => {
    document.body.innerHTML = `
      <button class="bmp-size-guide__trigger"><span>Size Guide</span></button>
      <button class="popup-link__button">Size chart</button>
      <button class="appai-fms__launcher">Find my size</button>
    `;
    finder.hideThemeSizeGuide(document);
    const css = document.getElementById("appai-hide-theme-size-guide")?.textContent || "";
    expect(css).toContain(".bmp-size-guide__trigger{display:none !important;}");
    expect((document.querySelector(".popup-link__button") as HTMLElement).style.display).toBe("none");
    expect((document.querySelector(".appai-fms__launcher") as HTMLElement).style.display).toBe("");
  });

  it("keeps one Find my size button after Use size, a size click, and a colour click", async () => {
    document.body.innerHTML = `<variant-picker>${pickerFields()}</variant-picker>`;
    finder.watchLauncher(document, guide, true);
    expect(document.querySelectorAll(".appai-fms__launcher")).toHaveLength(1);

    expect(finder.chooseSize(document, "L")).toBe(true);
    expect((document.querySelector('input[value="L"]') as HTMLInputElement).checked).toBe(true);
    replacePicker("L");
    await settle();
    expect(document.querySelectorAll(".appai-fms__launcher")).toHaveLength(1);

    (document.querySelector('input[value="M"]') as HTMLInputElement).click();
    replacePicker("M");
    await settle();
    expect(document.querySelectorAll(".appai-fms__launcher")).toHaveLength(1);

    (document.querySelector('input[value="Black"]') as HTMLInputElement).click();
    replacePicker("M", "Black");
    await settle();
    expect(document.querySelectorAll(".appai-fms__launcher")).toHaveLength(1);
    expect(document.querySelector(".appai-fms__launcher")?.parentElement?.textContent).toContain("Size");
  });
});
