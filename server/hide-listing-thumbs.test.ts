/**
 * @vitest-environment jsdom
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
require("../extensions/theme-extension/assets/appai-hide-listing-thumbs.js");
const thumbs = (window as unknown as {
  AppaiHideListingThumbs: {
    apply: (doc: Document) => boolean;
    install: (doc: Document) => void;
    isThumbClick: (target: Element) => boolean;
  };
}).AppaiHideListingThumbs;

function page(): void {
  document.body.innerHTML = `
    <section id="shopify-section-product">
      <media-gallery>
        <slideshow-component>
          <slideshow-slides><img alt="main" src="white.jpg"></slideshow-slides>
          <slideshow-controls><button class="slideshow-controls__thumbnail">Black</button></slideshow-controls>
        </slideshow-component>
      </media-gallery>
      <variant-picker>
        <label><input type="radio" name="Color" value="White">White</label>
      </variant-picker>
    </section>
  `;
}

describe("listing thumbnail strip", () => {
  it("marks the main gallery and leaves the hero and the swatch in place", () => {
    page();
    expect(thumbs.apply(document)).toBe(true);
    const gallery = document.querySelector("media-gallery");
    expect(gallery?.getAttribute("data-appai-hide-thumbs")).toBe("1");
    expect(document.querySelector("slideshow-slides img")).toBeTruthy();
    expect(document.querySelector("variant-picker input")).toBeTruthy();
    expect(thumbs.isThumbClick(document.querySelector(".slideshow-controls__thumbnail") as Element)).toBe(true);
    expect(thumbs.isThumbClick(document.querySelector("variant-picker input") as Element)).toBe(false);
  });

  it("re-marks a gallery the theme replaces", async () => {
    page();
    thumbs.install(document);
    const section = document.querySelector("#shopify-section-product") as HTMLElement;
    section.querySelector("media-gallery")?.remove();
    section.insertAdjacentHTML("afterbegin", `
      <media-gallery>
        <slideshow-component>
          <slideshow-slides><img alt="main" src="black.jpg"></slideshow-slides>
          <slideshow-controls><button class="slideshow-controls__thumbnail">White</button></slideshow-controls>
        </slideshow-component>
      </media-gallery>
    `);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("media-gallery")?.getAttribute("data-appai-hide-thumbs")).toBe("1");
    expect(document.querySelector("slideshow-slides img")?.getAttribute("src")).toBe("black.jpg");
  });
});
