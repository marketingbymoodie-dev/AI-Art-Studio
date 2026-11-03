import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const calls: { url: string; body: { filenames?: string[]; filename?: string } }[] = [];

vi.mock("@/components/admin-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/queryClient", () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(url), body });
    if (String(url).endsWith("/plan")) {
      const rows = (body.filenames || []).map((filename: string, index: number) => ({
        rowNumber: index + 1,
        filename,
        style: "",
        species: "",
        humourOperator: "",
        truth: "",
        device: "",
        exactWording: "",
        source: "draft",
        lowConfidence: { style: false, humourOperator: false },
      }));
      return { ok: true, json: async () => ({ rows, failures: [] }) };
    }
    if (String(url).endsWith("/draft")) {
      return {
        ok: true,
        json: async () => ({
          style: "woodcut",
          species: "dog",
          humourOperator: "pp-sleep-warfare",
          truth: "The dog is asleep.",
          device: "The dog is drawn flat.",
          exactWording: "",
          lowConfidence: { style: false, humourOperator: false },
          costUsd: 0.01,
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  }),
}));

import CatalogueBulkImportPage from "./CatalogueBulkImport";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "catalogue-import-"));

function png(name: string): File {
  const bytes = fs.readFileSync(path.join(folder, name));
  const file = new File([bytes], name, { type: "image/png" });
  Object.defineProperty(file, "webkitRelativePath", { value: `batch/${name}` });
  return file;
}

function choose(input: HTMLInputElement, files: File[]) {
  const list = Object.assign([...files], {
    item: (index: number) => files[index] ?? null,
  }) as unknown as FileList;
  Object.defineProperty(input, "files", { configurable: true, value: list });
  fireEvent.change(input);
}

function plans() {
  return calls.filter((call) => call.url.endsWith("/plan"));
}

function drafts() {
  return calls.filter((call) => call.url.endsWith("/draft"));
}

describe("catalogue import file inputs", () => {
  beforeAll(async () => {
    URL.createObjectURL = () => "blob:preview";
    URL.revokeObjectURL = () => undefined;
    for (const name of ["boxer-a.png", "boxer-b.png", "extra.png"]) {
      await sharp({
        create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
      }).png().toFile(path.join(folder, name));
    }
  });

  beforeEach(() => {
    calls.length = 0;
  });

  it("replaces the batch from a folder, appends new files, and drops a row", async () => {
    render(<CatalogueBulkImportPage />);
    const [folderInput, addInput] = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];

    choose(folderInput, [png("boxer-a.png"), png("boxer-b.png")]);
    await waitFor(() => expect(plans()).toHaveLength(1));
    expect(plans()[0].body.filenames).toEqual(["boxer-a.png", "boxer-b.png"]);
    expect(await screen.findByText("boxer-a.png")).toBeTruthy();
    expect(screen.getByText("boxer-b.png")).toBeTruthy();
    await waitFor(() => expect(drafts().map((call) => call.body.filename).sort()).toEqual(["boxer-a.png", "boxer-b.png"]));

    choose(folderInput, [png("extra.png")]);
    await waitFor(() => expect(plans()).toHaveLength(2));
    expect(plans()[1].body.filenames).toEqual(["extra.png"]);
    await waitFor(() => expect(screen.queryByText("boxer-a.png")).toBeNull());
    expect(screen.getByText("extra.png")).toBeTruthy();

    choose(addInput, [png("boxer-a.png")]);
    await waitFor(() => expect(plans()).toHaveLength(3));
    expect(plans()[2].body.filenames).toEqual(["boxer-a.png"]);
    expect(screen.getByText("extra.png")).toBeTruthy();
    expect(await screen.findByText("boxer-a.png")).toBeTruthy();
    await waitFor(() => expect(drafts().filter((call) => call.body.filename === "boxer-a.png").length).toBeGreaterThan(0));
    const boxerDrafts = drafts().filter((call) => call.body.filename === "boxer-a.png").length;

    choose(addInput, [png("boxer-a.png")]);
    expect(await screen.findByText(/already in the table and not redrafted/)).toBeTruthy();
    expect(plans()).toHaveLength(3);
    expect(drafts().filter((call) => call.body.filename === "boxer-a.png")).toHaveLength(boxerDrafts);

    fireEvent.click(screen.getByRole("button", { name: "Remove extra.png" }));
    expect(screen.queryByText("extra.png")).toBeNull();
    expect(screen.getByText("boxer-a.png")).toBeTruthy();
  });
});
