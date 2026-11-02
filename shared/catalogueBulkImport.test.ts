import { describe, expect, it } from "vitest";
import { CATALOGUE_IMPORT_COLUMNS, planCatalogueImport } from "./catalogueBulkImport";

const header = CATALOGUE_IMPORT_COLUMNS.join(",");

function csv(...lines: string[]): string {
  return [header, ...lines].join("\n");
}

describe("catalogue bulk import", () => {
  it("accepts a clean batch, including a blank punchline and a bird", () => {
    const plan = planCatalogueImport({
      csv: csv(
        'dog.png,woodcut,dog,pp-sleep-warfare,"the bed, apparently, is his","dog in the middle, human at the edge",',
        "bird.png,pen-ink,bird,pp-petty-crimes,the bird files a complaint,a small bird with a notebook,FILED",
      ),
      filenames: ["Dog.PNG", "bird.png"],
    });
    expect(plan.failures).toEqual([]);
    expect(plan.rows.map((row) => row.filename)).toEqual(["Dog.PNG", "bird.png"]);
    expect(plan.rows[0]).toMatchObject({
      style: "woodcut",
      species: "dog",
      humourOperator: "pp-sleep-warfare",
      truth: "the bed, apparently, is his",
      device: "dog in the middle, human at the edge",
      exactWording: "",
    });
    expect(plan.rows[1].species).toBe("bird");
    expect(plan.rows[1].exactWording).toBe("FILED");
  });

  it("names every failure and still returns the parsed rows", () => {
    const plan = planCatalogueImport({
      csv: csv(
        "dog.png,watercolor,dog,deadpan,,a dog,hello",
        "dog.png,woodcut,,pp-sleep-warfare,asleep,a dog,",
        "missing.png,woodcut,dog,pp-sleep-warfare,asleep,a dog,",
      ),
      filenames: ["dog.png", "extra.png", "extra.png"],
    });
    expect(plan.rows).toHaveLength(3);
    expect(plan.failures).toEqual([
      "extra.png duplicates extra.png.",
      'Row 2 (dog.png): style "watercolor" is not one of vintage-engraving, pen-ink, woodcut, retro-character, bold-type, folk-graphic.',
      'Row 2 (dog.png): humour_operator "deadpan" is not one of the sixteen frameworks.',
      "Row 2 (dog.png): truth is blank.",
      "dog.png is on more than one row (2 and 3).",
      "Row 3 (dog.png): species is blank.",
      "missing.png is in the CSV and was not uploaded.",
      "extra.png was uploaded and has no CSV row.",
    ]);
  });

  it("refuses a header that is not the template", () => {
    const plan = planCatalogueImport({
      csv: "file,style\ndog.png,woodcut",
      filenames: ["dog.png"],
    });
    expect(plan.rows).toEqual([]);
    expect(plan.failures).toEqual([
      "CSV header must be filename, style, species, humour_operator, truth, device, exact_wording.",
      "dog.png was uploaded and has no CSV row.",
    ]);
  });
});
