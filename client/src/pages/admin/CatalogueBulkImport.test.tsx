import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const calls: { url: string; body: { filenames?: string[]; filename?: string; rows?: { filename: string }[] } }[] = [];
const commitFailures = vi.hoisted(() => ({ current: [] as string[] }));
const draftFailure = vi.hoisted(() => ({ current: "" }));
const draftFailuresFor = vi.hoisted(() => ({ current: [] as string[] }));
const draftWording = vi.hoisted(() => ({ current: "" }));
const fileStatuses = vi.hoisted(() => ({ current: new Map<string, number[]>() }));
const openBatch = vi.hoisted(() => ({ current: null as { batchId: string; rows: unknown[] } | null }));

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
    if (String(url).endsWith("/open")) {
      return { ok: true, json: async () => ({ batch: openBatch.current }) };
    }
    if (String(url).endsWith("/commit") && commitFailures.current.length) {
      return { ok: false, status: 400, json: async () => ({ created: 0, reused: 0, firstId: "", studioPath: "", failures: commitFailures.current }) };
    }
    if (String(url).endsWith("/commit")) {
      return { ok: true, json: async () => ({ created: body.rows?.length || 0, reused: 0, firstId: "candidate-1", studioPath: "/admin/catalogue-studio?candidate=candidate-1", failures: [] }) };
    }
    if (String(url).endsWith("/file")) {
      const queued = fileStatuses.current.get(String(body.filename || ""));
      const status = queued && queued.length ? queued.shift() : 200;
      if (status === 401) return { ok: false, status: 401, json: async () => ({ message: "Unauthorized: invalid token" }) };
      return { ok: true, json: async () => ({ ok: true, hash: `hash-${body.filename}` }) };
    }
    if (String(url).endsWith("/draft")) {
      if (draftFailure.current || draftFailuresFor.current.includes(String(body.filename || ""))) {
        return { ok: false, status: 502, json: async () => ({ error: draftFailure.current || "The draft failed" }) };
      }
      return {
        ok: true,
        json: async () => ({
          style: "woodcut",
          species: "dog",
          humourOperator: "pp-sleep-warfare",
          truth: "The dog is asleep.",
          device: "The dog is drawn flat.",
          exactWording: draftWording.current,
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
    commitFailures.current = [];
    draftFailure.current = "";
    draftFailuresFor.current = [];
    draftWording.current = "";
    fileStatuses.current = new Map();
    openBatch.current = null;
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

  it("shows a vision failure on the row instead of leaving it drafting", async () => {
    draftFailure.current = "ANTHROPIC_API_KEY is not configured";
    render(<CatalogueBulkImportPage />);
    const [folderInput] = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    choose(folderInput, [png("boxer-a.png")]);
    expect(await screen.findByText("Draft failed")).toBeTruthy();
    expect(screen.getByText("ANTHROPIC_API_KEY is not configured")).toBeTruthy();
    expect(screen.queryByText("Drafting")).toBeNull();
    expect((screen.getByRole("button", { name: /Create 0 pending candidates/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a commit failure beside Create and leaves the drafted row in place", async () => {
    commitFailures.current = ["plan is not defined"];
    render(<CatalogueBulkImportPage />);
    const [folderInput] = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    choose(folderInput, [png("boxer-a.png")]);
    const create = await screen.findByRole("button", { name: /Create 1 pending candidate/ });
    await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(create);
    expect((await screen.findByTestId("catalogue-bulk-import-error")).textContent).toContain("plan is not defined");
    expect(screen.getByText("boxer-a.png")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Create 1 pending candidate/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps a long punchline editable and still lets that row queue", async () => {
    draftWording.current = "the dog has collected every card today";
    render(<CatalogueBulkImportPage />);
    const [folderInput] = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    choose(folderInput, [png("boxer-a.png")]);
    expect(await screen.findByText(/long for a shirt/)).toBeTruthy();
    const create = await screen.findByRole("button", { name: /Create 1 pending candidate/ });
    await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false));
    const wording = screen.getByLabelText("boxer-a.png wording") as HTMLTextAreaElement;
    expect(wording.value).toBe("the dog has collected every card today");
  });

  it("retries a 401 on one file and still commits the next", async () => {
    fileStatuses.current.set("boxer-a.png", [401]);
    render(<CatalogueBulkImportPage />);
    const [folderInput] = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    choose(folderInput, [png("boxer-a.png"), png("boxer-b.png")]);
    const create = await screen.findByRole("button", { name: /Create 2 pending candidates/ });
    await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(create);
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/commit"))).toBe(true));
    const uploads = calls.filter((call) => call.url.endsWith("/file"));
    expect(uploads.filter((call) => call.body.filename === "boxer-a.png")).toHaveLength(2);
    expect(uploads.filter((call) => call.body.filename === "boxer-b.png")).toHaveLength(1);
    const commit = calls.filter((call) => call.url.endsWith("/commit")).at(-1);
    expect(commit?.body.rows?.map((row) => row.filename).sort()).toEqual(["boxer-a.png", "boxer-b.png"]);
    expect(calls.some((call) => call.url.endsWith("/abort"))).toBe(false);
  });

  it("reloads a failed row and retries only that row", async () => {
    openBatch.current = {
      batchId: "batch-1",
      rows: [
        {
          rowNumber: 1,
          filename: "kept.png",
          style: "woodcut",
          species: "dog",
          humourOperator: "pp-sleep-warfare",
          truth: "asleep",
          device: "on the bed",
          exactWording: "",
          source: "draft",
          lowConfidence: { style: false, humourOperator: false },
          importStatus: "queued",
          selected: true,
        },
        {
          rowNumber: 2,
          filename: "boxer-a.png",
          style: "",
          species: "",
          humourOperator: "",
          truth: "",
          device: "",
          exactWording: "",
          source: "draft",
          lowConfidence: { style: false, humourOperator: false },
          importStatus: "failed",
          failureReason: "The draft failed",
          selected: true,
        },
      ],
    };
    render(<CatalogueBulkImportPage />);
    expect(await screen.findByText("kept.png")).toBeTruthy();
    expect(screen.getByText("boxer-a.png")).toBeTruthy();
    expect(screen.getByText("The draft failed")).toBeTruthy();
    const before = drafts().length;
    fireEvent.click(screen.getByRole("button", { name: "Retry failed only" }));
    await waitFor(() => expect(screen.getByText("boxer-a.png is not in the folder.")).toBeTruthy());
    expect(drafts().length).toBe(before);
    expect(drafts().some((call) => call.body.filename === "kept.png")).toBe(false);
  });
});
