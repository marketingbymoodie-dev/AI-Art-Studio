import { describe, expect, it } from "vitest";
import { cleanGarmentAccordion, garmentAccordionMetafields } from "./garmentAccordion";

const GILDAN = `<p>The Gildan Softstyle® 64000 redefines casual comfort with a modern unisex cut and ultra-soft materials. Solid colors are 100% cotton, while heathers and sport grey use polyester blends for added durability. Shoulders are reinforced with twill tape, there are no side seams for a smoother fit, and the ribbed-knit collar helps prevent curling. Whether for printing or everyday wear, the Gildan 64000 stands out as a dependable wardrobe staple.<br><br><strong>Disclaimer</strong>:<br>- Due to the fabric properties, the White color variant may appear off-white rather than bright white.<br>- Sleeve prints and neck labels are produced using DTF (Direct-to-Film) printing technology. This applies only to products fulfilled by the print providers OPT OnDemand and Shirt Monkey among the providers offering this item.</p><div>.:Made with 100% ring-spun cotton, the Gildan 64000 from the Gildan Softstyle® collection is a lightweight fabric (4.5 oz/yd² (153 g/m²)) that feels blissful to wear all year round. </div><div>.:The classic fit with the crew neckline deliver a clean, versatile style that can match any occasion, whether it's formal or semi-formal. </div><div>.:All shirts feature a pearlized, tear-away label for total wearing comfort. </div><div>.:Made using ethically grown and harvested US cotton. Gildan is also a proud member of the US Cotton Trust Protocol ensuring ethical and sustainable means of production. </div><div>.:This blank tee is certified by OEKO-TEX® STANDARD 100 (Certificate No. 168252, OETI - Institut fuer Oekologie) for safety and quality assurance.</div><div>.:Fabric blends: Heather colors - 35% ring-spun cotton, 65% polyester; Sport Grey and Antique colors - 90% cotton, 10% polyester, Graphite Heather - 50% ring-spun cotton, 50% polyester</div>`;

const COMFORT = `<p>Comfort Colors introduces the “Comfort Colors 1717” garment-dyed t-shirt; a fully customizable tee made with 100% ring-spun cotton. The soft-washed, garment-dyed fabric brings extra coziness to your wardrobe while the relaxed fit makes it an excellent daily choice. The double-needle stitching throughout the tee makes it highly durable, while the lack of side seams helps the shirt retain its tubular shape.</p><div>.:Heavyweight fabric (6.1 oz/yd² (206.8 g/m²))</div><div>.:Relaxed fit</div><div>.:Pre-shrunk 100% ring-spun US cotton</div><div>.:Available in 62 colors</div><div>.:Sewn-in label</div>`;

const SOFTSTYLE = ["White", "Black", "Sport Grey", "Light Blue", "Military Green", "Natural", "Navy", "Red", "Royal", "Dark Heather"];

function lines(copy: { comfort: string[]; durability: string[] }): string {
  return [...copy.comfort, ...copy.durability].join("\n");
}

describe("garment accordion copy", () => {
  it("rewrites a Gildan tee into short lines for the colours that type sells", () => {
    const copy = cleanGarmentAccordion(GILDAN, SOFTSTYLE);
    const text = lines(copy);
    expect(copy.comfort.join(" ")).toContain("Lightweight 4.5 oz ring-spun cotton");
    expect(copy.comfort.join(" ")).toMatch(/classic unisex fit/i);
    expect(copy.durability.join(" ")).toMatch(/tear-away label/i);
    expect(text).toContain("White may look slightly off-white.");
    expect(text).toContain("Sport Grey is 90% cotton, 10% polyester.");
    expect(text).toContain("Dark Heather is 35% cotton, 65% polyester.");
    expect(text).not.toMatch(/antique|graphite heather|62 colou?rs|direct-to-film/i);
    expect(copy.comfort.length + copy.durability.length).toBeLessThanOrEqual(5);
    expect(copy.comfort.length + copy.durability.length).toBeGreaterThanOrEqual(3);
  });

  it("leaves out blends and the white note when those colours are not sold", () => {
    const text = lines(cleanGarmentAccordion(GILDAN, ["Black", "Navy"]));
    expect(text).not.toMatch(/sport grey|dark heather|antique|graphite|off-white/i);
    expect(text).toContain("4.5 oz");
  });

  it("rewrites Comfort Colors without the colour count", () => {
    const copy = cleanGarmentAccordion(COMFORT, ["Black", "White", "Bay"]);
    const text = lines(copy);
    expect(copy.comfort.join(" ")).toContain("6.1 oz");
    expect(copy.comfort.join(" ")).toMatch(/relaxed fit/i);
    expect(copy.comfort.join(" ")).toMatch(/soft-washed/i);
    expect(text).not.toContain("4.5 oz");
    expect(text).not.toMatch(/62 colou?rs/i);
    expect(copy.durability.join(" ")).toMatch(/double-needle/i);
    expect(copy.durability.join(" ")).toMatch(/no side seams/i);
    expect(copy.durability.join(" ")).not.toMatch(/side-seamed/i);
    expect(copy.durability.join(" ")).toMatch(/sewn-in label/i);
    expect(copy.comfort.length + copy.durability.length).toBeLessThanOrEqual(5);
  });

  it("writes two rich text metafields from the cleaned lines", () => {
    const fields = garmentAccordionMetafields(COMFORT, ["Black", "White"]);
    expect(fields.map((field) => field.key)).toEqual(["garment_comfort", "garment_durability"]);
    expect(fields.every((field) => field.namespace === "ai_art_studio" && field.type === "rich_text_field")).toBe(true);
    const comfort = JSON.parse(fields[0].value);
    expect(comfort.children.some((node: { children: Array<{ value: string }> }) => node.children[0].value.includes("6.1 oz"))).toBe(true);
    expect(JSON.stringify(comfort)).not.toMatch(/62 colou?rs/i);
  });

  it("returns nothing when the type has no garment details", () => {
    expect(garmentAccordionMetafields("")).toEqual([]);
    expect(garmentAccordionMetafields(null)).toEqual([]);
  });
});
