import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  catalogueAttentionRank,
  catalogueBlockingNotes,
  catalogueCreateBlockers,
  catalogueReviewCounts,
  catalogueRowAttention,
  catalogueRowsToRetry,
  type CatalogueAttention,
  type CatalogueField,
  type CatalogueImportRow,
  type CatalogueImportStatus,
} from "@shared/catalogueBulkImport";
import { PETPOSTEROUS_ART_STYLE_LAUNCH, petposterousArtStyle } from "@shared/petposterousArtStyles";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS } from "@shared/petposterousCreative";
import { formatCatalogueSpend } from "@shared/cataloguePublish";
import { apiFetch } from "@/lib/queryClient";
import AdminLayout from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

type Created = { created: number; studioPath: string };
type DraftState = "skipped" | "waiting" | "drafting" | "done" | "failed";
type ReviewRow = CatalogueImportRow & {
  previewUrl: string;
  draftState: DraftState;
  draftError: string;
  costUsd: number | null;
  selected: boolean;
  importStatus: CatalogueImportStatus | "";
};

const DRAFTS_AT_ONCE = 4;
const DRAFT_TIMEOUT_MS = 75_000;
const STYLES = PETPOSTEROUS_ART_STYLE_LAUNCH.map((id) => {
  const style = petposterousArtStyle(id);
  if (!style?.launch) throw new Error(`${id} is listed as launch but is not a launch style`);
  return style;
});
const HUMOUR = Object.keys(PETPOSTEROUS_CONCEPT_FRAMEWORKS);
const FLAGGED_FIELD = "border-amber-700 bg-amber-50";
const IMAGE_MISSING = "Image missing — drop the PNG again";

function notesFor(notes: CatalogueAttention[], field: CatalogueField): CatalogueAttention[] {
  return notes.filter((note) => note.field === field);
}

function fieldClass(base: string, notes: CatalogueAttention[], field: CatalogueField): string {
  return notesFor(notes, field).length ? `${base} ${FLAGGED_FIELD}` : base;
}

function FieldReasons({ notes, field }: { notes: CatalogueAttention[]; field: CatalogueField }) {
  const mine = notesFor(notes, field);
  if (!mine.length) return null;
  return (
    <>
      {mine.map((note) => (
        <p key={`${field}-${note.message}`} className="mt-1 whitespace-normal break-words">{note.message}</p>
      ))}
    </>
  );
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function money(value: number): string {
  return `$${value.toFixed(4)}`;
}

type ConceptOptions = {
  enabled: boolean;
  model?: string;
  humors?: Array<{ id: string; label: string }>;
  looks?: Array<{ id: string; label: string }>;
  aspects?: string[];
};

function ConceptDesign({ onCreated }: { onCreated: (path: string) => void }) {
  const [options, setOptions] = useState<ConceptOptions | null>(null);
  const [concept, setConcept] = useState("");
  const [species, setSpecies] = useState("");
  const [humor, setHumor] = useState("witty");
  const [look, setLook] = useState("editorial-deadpan");
  const [wordsMode, setWordsMode] = useState<"none" | "exact">("none");
  const [exactWords, setExactWords] = useState("");
  const [garment, setGarment] = useState<"light" | "dark">("light");
  const [aspect, setAspect] = useState("3:4");
  const [draws, setDraws] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ model: string; error: string; created: Array<{ id: string; studioPath: string; estimatedCostUsd: number | null; actualCostUsd: number | null; prompt: string }> } | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/platform/catalogue-studio/concept").then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!cancelled && res.ok) setOptions(body);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!options?.enabled) return null;

  async function generate() {
    if (lock.current) return;
    lock.current = true;
    const requestId = crypto.randomUUID();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await apiFetch("/api/platform/catalogue-studio/concept", {
        method: "POST",
        body: JSON.stringify({
          requestId,
          concept,
          species,
          humor,
          look,
          wordsMode,
          exactWords,
          garment,
          aspect,
          draws,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(body.error || "Generation failed"));
      setResult(body);
      if (body.studioPath) onCreated(String(body.studioPath));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-md border p-3" data-testid="catalogue-concept">
      <h2 className="text-sm font-medium">New design from concept</h2>
      <p className="text-xs text-muted-foreground">
        {options.model ? `Model ${options.model}. ` : ""}
        Each draw is a pending candidate. Nothing is published. Estimated is the text-input quote. Actual is the provider usage total, including the image.
      </p>
      <label className="block text-xs">
        Concept
        <textarea className="mt-1 w-full rounded border bg-background px-2 py-1" rows={3} value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="The visual joke" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs">
          Species
          <input className="mt-1 h-8 w-full rounded border bg-background px-2" value={species} onChange={(e) => setSpecies(e.target.value)} />
        </label>
        <label className="block text-xs">
          Humour
          <select className="mt-1 h-8 w-full rounded border bg-background px-2" value={humor} onChange={(e) => setHumor(e.target.value)}>
            {(options.humors || []).map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </label>
        <label className="block text-xs">
          LOOK
          <select className="mt-1 h-8 w-full rounded border bg-background px-2" value={look} onChange={(e) => setLook(e.target.value)}>
            {(options.looks || []).map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </label>
        <label className="block text-xs">
          Words
          <select className="mt-1 h-8 w-full rounded border bg-background px-2" value={wordsMode} onChange={(e) => setWordsMode(e.target.value === "exact" ? "exact" : "none")}>
            <option value="none">No text</option>
            <option value="exact">Exact words</option>
          </select>
        </label>
        {wordsMode === "exact" ? (
          <label className="block text-xs sm:col-span-2">
            Exact words
            <input className="mt-1 h-8 w-full rounded border bg-background px-2" value={exactWords} onChange={(e) => setExactWords(e.target.value)} />
          </label>
        ) : null}
        <label className="block text-xs">
          Garment
          <select className="mt-1 h-8 w-full rounded border bg-background px-2" value={garment} onChange={(e) => setGarment(e.target.value === "dark" ? "dark" : "light")}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="block text-xs">
          Aspect
          <select className="mt-1 h-8 w-full rounded border bg-background px-2" value={aspect} onChange={(e) => setAspect(e.target.value)}>
            {(options.aspects || ["3:4"]).map((row) => <option key={row} value={row}>{row}</option>)}
          </select>
        </label>
        <label className="block text-xs">
          Draws
          <input className="mt-1 h-8 w-full rounded border bg-background px-2" type="number" min={1} max={4} value={draws} onChange={(e) => setDraws(Math.min(4, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
      </div>
      <Button type="button" size="sm" disabled={busy} onClick={() => void generate()}>
        {busy ? "Generating" : `Generate ${draws} ${draws === 1 ? "draw" : "draws"}`}
      </Button>
      {error ? <p className="text-xs">{error}</p> : null}
      {result ? (
        <div className="space-y-2 text-xs">
          <p>Model {result.model}. {result.created.length} stored.</p>
          {result.error ? <p>{result.error}</p> : null}
          {result.created.map((row, index) => (
            <div key={row.id}>
              <p>
                Draw {index + 1}: estimated {row.estimatedCostUsd == null ? "—" : formatCatalogueSpend(row.estimatedCostUsd)}
                {" · "}actual {row.actualCostUsd == null ? "—" : formatCatalogueSpend(row.actualCostUsd)}
                {" · "}
                <Link href={row.studioPath}>Open</Link>
              </p>
              <details>
                <summary>Prompt sent</summary>
                <pre className="mt-1 whitespace-pre-wrap">{row.prompt}</pre>
              </details>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function CatalogueBulkImportPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const filesRef = useRef<File[]>([]);
  const urlsRef = useRef<string[]>([]);
  const rowsRef = useRef<ReviewRow[]>([]);
  const saveChain = useRef(new Map<string, Promise<boolean>>());
  const batchIdRef = useRef("");
  const generation = useRef(0);
  const draftQueue = useRef<ReviewRow[]>([]);
  const draftWorkers = useRef(0);
  const addInput = useRef<HTMLInputElement>(null);

  function applyRows(updater: ReviewRow[] | ((prev: ReviewRow[]) => ReviewRow[])) {
    const next = typeof updater === "function" ? updater(rowsRef.current) : updater;
    rowsRef.current = next;
    setRows(next);
  }

  function rowPayload(row: ReviewRow) {
    return {
      rowNumber: row.rowNumber,
      filename: row.filename,
      style: row.style,
      species: row.species,
      humourOperator: row.humourOperator,
      truth: row.truth,
      device: row.device,
      exactWording: row.exactWording,
      acknowledgedWarnings: row.acknowledgedWarnings === true,
      source: row.source,
      lowConfidence: row.lowConfidence,
      proposedFilename: row.proposedFilename || "",
      failureReason: row.failureReason || row.draftError || "",
      importStatus: row.importStatus || (row.draftState === "failed" ? "failed" : "drafted"),
      selected: row.selected,
    };
  }

  async function saveRow(row: ReviewRow): Promise<boolean> {
    if (!batchIdRef.current || !row.filename) return false;
    try {
      const res = await apiFetch("/api/platform/catalogue-studio/candidates/import/row", {
        method: "POST",
        body: JSON.stringify({ batchId: batchIdRef.current, row: rowPayload(row) }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  function queueSave(row: ReviewRow): Promise<boolean> {
    const prev = saveChain.current.get(row.filename) || Promise.resolve(true);
    const next = prev.catch(() => false).then(() => saveRow(row));
    saveChain.current.set(row.filename, next);
    return next;
  }

  function keepUserEdits(snapshot: ReviewRow, current: ReviewRow, incoming: ReviewRow): ReviewRow {
    const changed = (key: "style" | "species" | "humourOperator" | "truth" | "device" | "exactWording") => current[key] !== snapshot[key];
    return {
      ...incoming,
      style: changed("style") ? current.style : incoming.style,
      species: changed("species") ? current.species : incoming.species,
      humourOperator: changed("humourOperator") ? current.humourOperator : incoming.humourOperator,
      truth: changed("truth") ? current.truth : incoming.truth,
      device: changed("device") ? current.device : incoming.device,
      exactWording: changed("exactWording") ? current.exactWording : incoming.exactWording,
      lowConfidence: {
        style: changed("style") ? current.lowConfidence.style : incoming.lowConfidence.style,
        humourOperator: changed("humourOperator") ? current.lowConfidence.humourOperator : incoming.lowConfidence.humourOperator,
      },
      selected: current.selected,
      acknowledgedWarnings: current.acknowledgedWarnings,
    };
  }

  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/platform/catalogue-studio/candidates/import/open").then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (cancelled || !res.ok || !body.batch?.batchId || filesRef.current.length || generation.current) return;
      batchIdRef.current = String(body.batch.batchId);
      const restored: ReviewRow[] = (body.batch.rows || []).map((row: CatalogueImportRow) => ({
        ...row,
        selected: row.selected !== false,
        importStatus: row.importStatus || "drafted",
        previewUrl: "",
        draftState: row.importStatus === "failed" ? "failed" as const : "done" as const,
        draftError: row.failureReason || "",
        costUsd: null,
        lowConfidence: row.lowConfidence || { style: false, humourOperator: false },
      }));
      applyRows(restored);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function forgetPreviews() {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
  }

  async function draftOne(row: ReviewRow, gen: number) {
    if (generation.current !== gen) return;
    const file = filesRef.current.find((item) => item.name.toLowerCase() === row.filename.toLowerCase());
    if (!file) {
      if (generation.current !== gen) return;
      const missing = `${row.filename} is not in the folder.`;
      const failed = { ...row, draftState: "failed" as const, draftError: missing, importStatus: "failed" as const, failureReason: missing };
      applyRows((prev) => prev.map((item) => item.filename === row.filename ? failed : item));
      void queueSave(failed);
      return;
    }
    applyRows((prev) => prev.map((item) => item.filename === row.filename ? { ...item, draftState: "drafting", draftError: "" } : item));
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
    try {
      const imageBase64 = await fileToDataUrl(file);
      if (generation.current !== gen) return;
      const res = await apiFetch("/api/platform/catalogue-studio/candidates/import/draft", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, imageBase64 }),
        signal: controller.signal,
        transport: "xhr",
      });
      const body = await res.json().catch(() => ({}));
      if (generation.current !== gen) return;
      if (!res.ok) {
        const draftError = String(body.error || body.message || `The draft failed (${res.status}).`);
        const failed: ReviewRow = {
          ...row,
          draftState: "failed",
          draftError,
          importStatus: "failed",
          failureReason: draftError,
          costUsd: typeof body.costUsd === "number" ? body.costUsd : row.costUsd,
        };
        applyRows((prev) => prev.map((item) => item.filename === row.filename ? failed : item));
        void queueSave(failed);
        return;
      }
      setError("");
      const done: ReviewRow = {
        ...row,
        draftState: "done",
        draftError: "",
        failureReason: "",
        importStatus: row.importStatus === "queued" ? "queued" : "drafted",
        style: String(body.style || ""),
        species: String(body.species || ""),
        humourOperator: String(body.humourOperator || ""),
        truth: String(body.truth || ""),
        device: String(body.device || ""),
        exactWording: String(body.exactWording || ""),
        lowConfidence: {
          style: body.lowConfidence?.style === true,
          humourOperator: body.lowConfidence?.humourOperator === true,
        },
        costUsd: typeof body.costUsd === "number" ? body.costUsd : null,
      };
      applyRows((prev) => prev.map((item) => item.filename === row.filename ? keepUserEdits(row, item, done) : item));
      const merged = rowsRef.current.find((item) => item.filename === row.filename);
      if (merged) void queueSave(merged);
    } catch (e: any) {
      if (generation.current !== gen) return;
      const timedOut = controller.signal.aborted || e?.name === "AbortError";
      const draftError = timedOut ? "The vision draft timed out." : String(e?.message || e);
      const failed: ReviewRow = { ...row, draftState: "failed", draftError, importStatus: "failed", failureReason: draftError };
      applyRows((prev) => prev.map((item) => item.filename === row.filename ? failed : item));
      void queueSave(failed);
    } finally {
      window.clearTimeout(timer);
    }
  }

  function enqueueDrafts(list: ReviewRow[]) {
    draftQueue.current.push(...list.filter((row) => row.source === "draft"));
    pumpDrafts();
  }

  function pumpDrafts() {
    while (draftWorkers.current < DRAFTS_AT_ONCE && draftQueue.current.length) {
      const row = draftQueue.current.shift();
      if (!row) break;
      const gen = generation.current;
      draftWorkers.current += 1;
      void draftOne(row, gen).finally(() => {
        draftWorkers.current -= 1;
        pumpDrafts();
      });
    }
  }

  function removeRow(filename: string) {
    const key = filename.toLowerCase();
    draftQueue.current = draftQueue.current.filter((row) => row.filename.toLowerCase() !== key);
    applyRows((prev) => {
      const row = prev.find((item) => item.filename.toLowerCase() === key);
      if (row?.previewUrl) {
        URL.revokeObjectURL(row.previewUrl);
        urlsRef.current = urlsRef.current.filter((url) => url !== row.previewUrl);
      }
      return prev.filter((item) => item.filename.toLowerCase() !== key);
    });
    filesRef.current = filesRef.current.filter((file) => file.name.toLowerCase() !== key);
    setFiles(filesRef.current);
    setFailures((prev) => prev.filter((failure) => !failure.toLowerCase().includes(key)));
    if (batchIdRef.current) {
      void apiFetch("/api/platform/catalogue-studio/candidates/import/abort", {
        method: "POST",
        body: JSON.stringify({ batchId: batchIdRef.current, filenames: [filename] }),
      });
    }
  }

  function pngInBrowser(filename: string): boolean {
    return filesRef.current.some((file) => file.name.toLowerCase() === filename.toLowerCase());
  }

  function imageMissing(row: ReviewRow): boolean {
    if (row.importStatus === "queued" || row.contentHash) return false;
    if (row.draftState === "waiting" || row.draftState === "drafting") return false;
    return !pngInBrowser(row.filename);
  }

  function attachDroppedPng(file: File) {
    const name = basename((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
    const key = name.toLowerCase();
    const current = rowsRef.current.find((row) => row.filename.toLowerCase() === key && row.importStatus !== "queued");
    const url = URL.createObjectURL(file);
    if (!current) {
      URL.revokeObjectURL(url);
      return;
    }
    urlsRef.current = [...urlsRef.current, url];
    filesRef.current = [...filesRef.current.filter((item) => item.name.toLowerCase() !== key), file];
    setFiles(filesRef.current);
    const needsDraft = current.source === "draft" && !current.style && !current.exactWording;
    const revived: ReviewRow = {
      ...current,
      previewUrl: url,
      importStatus: "drafted",
      failureReason: "",
      draftError: "",
      draftState: needsDraft ? "waiting" : "done",
    };
    applyRows((prev) => prev.map((row) => row.filename.toLowerCase() === key && row.importStatus !== "queued" ? revived : row));
    if (needsDraft) enqueueDrafts([revived]);
    else void queueSave(revived);
  }

  async function takeFiles(list: File[] | FileList | null, mode: "replace" | "append") {
    const entriesIn = list ? Array.from(list) : [];
    console.info("[catalogue-import] takeFiles", mode, entriesIn.length, entriesIn.map((file) => file.name));
    if (!entriesIn.length) {
      console.info("[catalogue-import] takeFiles stopped: no files");
      return;
    }
    const gen = mode === "replace" ? (generation.current += 1) : generation.current;
    if (mode === "replace" || !batchIdRef.current) batchIdRef.current = crypto.randomUUID();
    if (mode === "replace") {
      draftQueue.current = [];
      forgetPreviews();
      applyRows([]);
      setFailures([]);
      setCreated(null);
      filesRef.current = [];
      setFiles([]);
    }
    setBusy("Reading the folder");
    setError("");
    try {
      const entries = entriesIn;
      const nameOf = (file: File) => basename((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
      const held = new Set(filesRef.current.map((file) => file.name.toLowerCase()));
      const existingRow = (file: File) => rowsRef.current.find((row) => row.filename.toLowerCase() === nameOf(file).toLowerCase());
      const reviveFiles = mode === "append"
        ? entries.filter((file) => {
          const row = existingRow(file);
          if (!/\.png$/i.test(nameOf(file)) || !row || row.importStatus === "queued") return false;
          const heldFile = held.has(nameOf(file).toLowerCase());
          if (!heldFile) return true;
          return row.importStatus === "failed" || row.draftState === "failed" || !!row.failureReason;
        })
        : [];
      const reviveNames = new Set(reviveFiles.map((file) => nameOf(file).toLowerCase()));
      const existingNames = new Set(mode === "append" ? rowsRef.current.map((row) => row.filename.toLowerCase()) : []);
      const already = mode === "append"
        ? entries.filter((file) => /\.png$/i.test(nameOf(file)) && held.has(nameOf(file).toLowerCase()) && !reviveNames.has(nameOf(file).toLowerCase()))
        : [];
      const pngs = entries.filter((file) => /\.png$/i.test(nameOf(file)) && !reviveNames.has(nameOf(file).toLowerCase()) && !existingNames.has(nameOf(file).toLowerCase()) && (mode === "replace" || !held.has(nameOf(file).toLowerCase())));
      const csvs = entries.filter((file) => /\.csv$/i.test(nameOf(file)));
      const otherImages = entries.filter((file) => /\.(jpe?g|webp|gif)$/i.test(nameOf(file)));
      const local = otherImages.map((file) => `${nameOf(file)} is not a PNG.`);
      const notes = [
        ...local,
        ...(already.length ? [`${already.map((file) => nameOf(file)).join(", ")} ${already.length === 1 ? "is" : "are"} already in the table and not redrafted.`] : []),
      ];
      if (csvs.length > 1) {
        const message = `Drop one CSV. Found ${csvs.map((file) => nameOf(file)).join(", ")}.`;
        if (mode === "replace") setFailures([message, ...notes]);
        else setError([message, ...notes].join(" "));
        return;
      }
      if (!pngs.length) {
        for (const file of reviveFiles) attachDroppedPng(file);
        if (notes.length) setError(notes.join(" "));
        return;
      }
      const text = csvs.length === 1 ? await csvs[0].text() : "";
      await apiFetch("/api/platform/catalogue-studio/candidates/import/batch", {
        method: "POST",
        body: JSON.stringify({ batchId: batchIdRef.current }),
      }).catch(() => undefined);
      const planRes = await apiFetch("/api/platform/catalogue-studio/candidates/import/plan", {
        method: "POST",
        body: JSON.stringify({ csv: text, filenames: pngs.map((file) => nameOf(file)) }),
      });
      const plan = await planRes.json();
      if (!planRes.ok) throw new Error(plan.error || "The folder could not be read.");
      if (generation.current !== gen) return;
      const wanted = new Set(pngs.map((file) => nameOf(file).toLowerCase()));
      const planFailures = (Array.isArray(plan.failures) ? plan.failures : []).filter((failure: string) => (
        mode === "replace" || !failure.endsWith("is in the CSV and was not uploaded.")
      ));
      const planRows = (Array.isArray(plan.rows) ? plan.rows : []).filter((row: CatalogueImportRow) => wanted.has(row.filename.toLowerCase()));
      if (mode === "append" && planFailures.some((failure: string) => failure.startsWith("CSV header must be"))) {
        setError([planFailures[0], ...notes].filter(Boolean).join(" "));
        return;
      }
      const urls = pngs.map((file) => URL.createObjectURL(file));
      const byName = new Map(pngs.map((file, index) => [nameOf(file).toLowerCase(), urls[index]]));
      const start = mode === "append" ? filesRef.current.length : 0;
      const next: ReviewRow[] = planRows.map((row: CatalogueImportRow, index: number) => ({
        ...row,
        rowNumber: start + index + 1,
        selected: true,
        importStatus: "" as const,
        lowConfidence: row.lowConfidence || { style: false, humourOperator: false },
        previewUrl: byName.get(row.filename.toLowerCase()) || "",
        draftState: row.source === "draft" ? "waiting" as const : "skipped" as const,
        draftError: "",
        costUsd: row.source === "draft" ? null : 0,
      }));
      const keptNames = new Set(next.map((row) => row.filename.toLowerCase()));
      const keptFiles = pngs.filter((file) => keptNames.has(nameOf(file).toLowerCase()));
      for (const [name, url] of byName) {
        if (!keptNames.has(name)) URL.revokeObjectURL(url);
      }
      const keptUrls = keptFiles.map((file) => byName.get(nameOf(file).toLowerCase()) || "").filter(Boolean);
      urlsRef.current = mode === "replace" ? keptUrls : [...urlsRef.current, ...keptUrls];
      filesRef.current = mode === "replace" ? keptFiles : [...filesRef.current, ...keptFiles];
      setFiles(filesRef.current);
      applyRows((prev) => (mode === "replace" ? next : [...prev, ...next]));
      if (mode === "replace") {
        setFailures([...planFailures, ...notes]);
      } else {
        const attached = planFailures.filter((failure: string) => next.some((row) => failure.toLowerCase().includes(row.filename.toLowerCase())));
        const loose = planFailures.filter((failure: string) => !attached.includes(failure));
        setFailures((prev) => [...prev, ...attached]);
        if (notes.length || loose.length) setError([...loose, ...notes].join(" "));
      }
      setBusy("");
      for (const file of reviveFiles) attachDroppedPng(file);
      enqueueDrafts(next);
    } catch (e: any) {
      console.error("[catalogue-import] takeFiles failed", e);
      if (generation.current === gen) setError(String(e?.message || e));
      throw e;
    } finally {
      if (generation.current === gen) setBusy("");
    }
  }

  function edit(filename: string, patch: Partial<ReviewRow>) {
    setError("");
    let changed: ReviewRow | null = null;
    applyRows((prev) => prev.map((row) => {
      if (row.filename !== filename) return row;
      const next = { ...row, ...patch };
      if ("style" in patch) next.lowConfidence = { ...next.lowConfidence, style: false };
      if ("humourOperator" in patch) next.lowConfidence = { ...next.lowConfidence, humourOperator: false };
      if (["style", "species", "humourOperator", "truth", "device", "exactWording"].some((key) => key in patch)) {
        next.acknowledgedWarnings = false;
      }
      if (patch.acknowledgedWarnings === true && next.importStatus !== "queued") {
        const cleared = { ...next, importStatus: "drafted" as const, failureReason: "", draftError: "", draftState: "done" as const, acknowledgedWarnings: true };
        const peers = rowsRef.current.map((item) => item.filename === next.filename ? cleared : item);
        if (!catalogueBlockingNotes(cleared, peers).length) {
          next.importStatus = "drafted";
          next.failureReason = "";
          next.draftError = "";
          next.draftState = "done";
        }
      }
      changed = next;
      return next;
    }));
    if (changed) void queueSave(changed);
  }

  function renameRow(row: ReviewRow) {
    const nextName = row.proposedFilename || "";
    if (!nextName) return;
    const file = filesRef.current.find((item) => item.name.toLowerCase() === row.filename.toLowerCase());
    if (file) {
      const renamed = new File([file], nextName, { type: file.type });
      filesRef.current = filesRef.current.map((item) => item === file ? renamed : item);
      setFiles(filesRef.current);
    }
    applyRows((prev) => prev.map((item) => item.filename === row.filename ? { ...item, filename: nextName, proposedFilename: "" } : item));
    const renamed = rowsRef.current.find((item) => item.filename === nextName);
    if (renamed) void queueSave(renamed);
  }

  function readyRows(list: ReviewRow[] = rowsRef.current): ReviewRow[] {
    return list.filter((row) => {
      if (imageMissing(row)) return false;
      if (!row.selected || row.importStatus === "queued" || row.importStatus === "failed" || row.draftState === "failed") return false;
      if (row.draftState === "waiting" || row.draftState === "drafting") return false;
      return catalogueBlockingNotes(row, list).length === 0;
    });
  }

  async function uploadRow(row: ReviewRow, batchId: string): Promise<ReviewRow> {
    const file = filesRef.current.find((item) => item.name.toLowerCase() === row.filename.toLowerCase());
    if (!file) {
      if (row.importStatus === "uploaded" || row.contentHash) return row;
      const failureReason = `${row.filename} is not in the folder.`;
      return { ...row, importStatus: "failed", failureReason, draftError: failureReason };
    }
    const imageBase64 = await fileToDataUrl(file);
    const send = () => apiFetch("/api/platform/catalogue-studio/candidates/import/file", {
      method: "POST",
      body: JSON.stringify({ batchId, filename: file.name, imageBase64 }),
    });
    let res = await send();
    if (res.status === 401) res = await send();
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const failureReason = String(body.error || body.message || `${file.name} was not stored.`);
      return { ...row, importStatus: "failed", failureReason, draftError: failureReason };
    }
    return { ...row, importStatus: "uploaded", contentHash: String(body.hash || row.contentHash || ""), failureReason: "", draftError: "" };
  }

  async function createBatch() {
    const batchId = batchIdRef.current || crypto.randomUUID();
    batchIdRef.current = batchId;
    setBusy("Saving edits");
    setError("");
    setCreated(null);
    try {
      await Promise.all([...saveChain.current.values()]);
      const chosen = readyRows(rowsRef.current);
      if (!chosen.length) {
        setError("Nothing is ready to queue. Fix the flagged rows first.");
        return;
      }
      const saved = await Promise.all(chosen.map((row) => queueSave(rowsRef.current.find((item) => item.filename === row.filename) || row)));
      if (saved.some((ok) => !ok)) {
        setError("An edit was not saved. Fix it, then create again.");
        return;
      }
      const fresh = readyRows(rowsRef.current).filter((row) => chosen.some((item) => item.filename === row.filename));
      if (fresh.length !== chosen.length) {
        setError("A row was still flagged, so nothing was queued.");
        return;
      }
      setBusy(`Uploading 1 of ${fresh.length}`);
      const uploaded: ReviewRow[] = [];
      for (let i = 0; i < fresh.length; i++) {
        setBusy(`Uploading ${i + 1} of ${fresh.length}: ${fresh[i].filename}`);
        const stored = await uploadRow(fresh[i], batchId);
        uploaded.push(stored);
        applyRows((prev) => prev.map((item) => item.filename === stored.filename ? stored : item));
        void queueSave(stored);
      }
      const failedUploads = uploaded.filter((row) => row.importStatus === "failed");
      const toQueue = uploaded.filter((row) => row.importStatus !== "failed");
      if (!toQueue.length) {
        setError(failedUploads.map((row) => row.failureReason || row.filename).join(" ") || "Nothing was stored.");
        return;
      }
      setBusy("Creating candidates");
      const res = await apiFetch("/api/platform/catalogue-studio/candidates/import/commit", {
        method: "POST",
        body: JSON.stringify({
          batchId,
          filenames: toQueue.map((row) => row.filename),
          rows: toQueue.map((row) => rowPayload(row)),
        }),
      });
      const body = await res.json().catch(() => ({}));
      const messages = Array.isArray(body.failures) ? body.failures.map(String) : [];
      const queued = (Number(body.created) || 0) + (Number(body.reused) || 0);
      if (!res.ok || messages.length || queued !== toQueue.length) {
        const shown = messages.length ? messages : [body.error || body.message || "Not every row was queued."];
        console.error("[catalogue-import] commit failed", shown);
        applyRows((prev) => prev.map((row) => {
          const match = shown.find((message) => message.toLowerCase().includes(row.filename.toLowerCase()));
          if (!match) return row;
          return { ...row, importStatus: "failed", failureReason: match, draftError: match, draftState: "failed" };
        }));
        setError([...shown, ...failedUploads.map((row) => row.failureReason || "")].filter(Boolean).join(" "));
        setCreated(null);
        return;
      }
      if (failedUploads.length) {
        setError(failedUploads.map((row) => row.failureReason || row.filename).join(" "));
        setCreated(null);
        return;
      }
      const queuedNames = new Set(toQueue.map((row) => row.filename));
      applyRows((prev) => prev.map((item) => queuedNames.has(item.filename) ? { ...item, importStatus: "queued", failureReason: "" } : item));
      setCreated({ created: queued, studioPath: String(body.studioPath || "") });
    } catch (e: any) {
      console.error("[catalogue-import] create failed", e);
      setError(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  function retryFailed() {
    enqueueDrafts(catalogueRowsToRetry(rows));
  }

  const draftRows = rows.filter((row) => row.source === "draft");
  const drafted = draftRows.filter((row) => row.draftState === "done" || row.draftState === "failed").length;
  const drafting = draftRows.some((row) => row.draftState === "waiting" || row.draftState === "drafting");
  const spent = rows.reduce((sum, row) => sum + (typeof row.costUsd === "number" ? row.costUsd : 0), 0);
  const ordered = [...rows].sort((a, b) => catalogueAttentionRank(a, rows) - catalogueAttentionRank(b, rows) || a.rowNumber - b.rowNumber);
  const queueCount = readyRows(rows).length;
  const counts = catalogueReviewCounts(rows);
  const missingNotes = rows.filter((row) => imageMissing(row)).map((row) => `${row.filename}: ${IMAGE_MISSING}`);
  const blockers = [...failures, ...missingNotes, ...catalogueCreateBlockers(rows)];
  const ready = queueCount > 0 && !failures.length && !drafting && !created;

  return (
    <AdminLayout>
      <section className="space-y-3" data-testid="catalogue-bulk-import">
        <ConceptDesign onCreated={() => undefined} />
        <h1 className="text-lg font-medium">Import catalogue designs</h1>
        <p className="text-xs text-muted-foreground">
          Drop a folder of PNGs. A CSV is optional. Where a CSV row exists, those values are kept and the image is not redrafted.
          Everything else is read by the vision model. Nothing is created until this table is clean, and approval stays on the Studio page.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="block text-xs">
            Folder
            <input
              className="mt-1 block w-full text-xs"
              type="file"
              multiple
              // @ts-expect-error directory upload is non-standard and is the folder the operator has
              webkitdirectory=""
              onClick={() => console.info("[catalogue-import] folder click")}
              onChange={(e) => {
                const picked = e.target.files ? Array.from(e.target.files) : [];
                console.info("[catalogue-import] folder change", picked.length, picked.map((file) => file.name));
                e.target.value = "";
                void takeFiles(picked, "replace");
              }}
            />
          </label>
          <Button asChild variant="outline" size="sm" disabled={!!busy || !!created}>
            <label>
              Add more files
              <input
                ref={addInput}
                className="sr-only"
                type="file"
                multiple
                accept=".png,.csv,image/png,text/csv"
                disabled={!!busy || !!created}
                onClick={() => console.info("[catalogue-import] add-more click")}
                onChange={(e) => {
                  const picked = e.target.files ? Array.from(e.target.files) : [];
                  console.info("[catalogue-import] add-more change", picked.length, picked.map((file) => file.name));
                  e.target.value = "";
                  void takeFiles(picked, "append");
                }}
              />
            </label>
          </Button>
        </div>
        {busy ? <p className="text-xs">{busy}</p> : null}
        {draftRows.length ? (
          <p className="text-xs" data-testid="catalogue-bulk-import-progress">
            Drafted {drafted} of {draftRows.length}. Vision cost {drafting ? "so far " : ""}{money(spent)}.
          </p>
        ) : null}
        {failures.length ? (
          <ul className="space-y-1" data-testid="catalogue-bulk-import-failures">
            {failures.map((failure, index) => (
              <li key={`${index}-${failure}`} className="text-xs">{failure}</li>
            ))}
          </ul>
        ) : null}
        {rows.length ? (
          <p className="text-xs" data-testid="catalogue-bulk-import-summary">
            {counts.total} {counts.total === 1 ? "row" : "rows"}: {counts.ready} ready, {counts.attention} need attention, {counts.failed} failed
            {counts.drafting ? `, ${counts.drafting} still drafting` : ""}
          </p>
        ) : null}
        {rows.length ? (
          <div className="max-h-[36rem] overflow-auto">
            <table className="w-max min-w-full text-left text-xs">
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Style</th>
                  <th>Species</th>
                  <th>Humour</th>
                  <th>Truth</th>
                  <th>Device</th>
                  <th>Wording</th>
                  <th>Cost</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ordered.map((row) => {
                  const notes = catalogueRowAttention(row, rows);
                  const blocking = catalogueBlockingNotes(row, rows);
                  const softFlags = notes.some((note) => note.tone === "warn");
                  const styleUnsure = row.lowConfidence?.style && !row.style;
                  const humourUnsure = row.lowConfidence?.humourOperator && !row.humourOperator;
                  const locked = !!busy || row.draftState === "waiting" || row.draftState === "drafting";
                  const stateLabel = row.importStatus === "queued"
                    ? "Queued"
                    : row.source === "csv"
                      ? "From the CSV"
                      : row.draftState === "drafting" || row.draftState === "waiting"
                        ? "Drafting"
                        : row.draftState === "failed" || row.importStatus === "failed"
                          ? "Draft failed"
                          : "Drafted";
                  return (
                    <tr key={`${row.rowNumber}-${row.filename}`} className="align-top">
                      <td className="min-w-48 py-2 pr-2">
                        <input aria-label={`Queue ${row.filename}`} type="checkbox" checked={row.selected} disabled={locked || row.importStatus === "queued"} onChange={(e) => edit(row.filename, { selected: e.target.checked })} />
                        {row.previewUrl ? <img src={row.previewUrl} alt="" className="h-16 w-16 bg-[#808080] object-contain" /> : null}
                        <div>{row.filename}</div>
                        <div className="text-muted-foreground">{stateLabel}</div>
                        {imageMissing(row) ? <p className="mt-1 whitespace-normal break-words">{IMAGE_MISSING}</p> : null}
                        {row.draftState === "failed" && row.source === "draft" && row.importStatus !== "queued" ? (
                          <button type="button" className="underline" onClick={() => void draftOne(row, generation.current)}>Retry this draft</button>
                        ) : null}
                        {row.proposedFilename ? (
                          <button type="button" className="underline" onClick={() => renameRow(row)}>Rename to {row.proposedFilename}</button>
                        ) : null}
                        <FieldReasons notes={notes} field="filename" />
                        {softFlags ? (
                          <button
                            type="button"
                            className="mt-1 underline"
                            disabled={locked}
                            aria-label={`${row.acknowledgedWarnings ? "Checks confirmed" : "Confirm checks"} ${row.filename}`}
                            onClick={() => edit(row.filename, { acknowledgedWarnings: !row.acknowledgedWarnings })}
                          >
                            {row.acknowledgedWarnings ? "Checks confirmed" : "Confirm checks"}
                          </button>
                        ) : null}
                      </td>
                      <td className="min-w-36 py-2 pr-2">
                        <select
                          aria-label={`${row.filename} style`}
                          className={fieldClass("h-8 w-full rounded border bg-background px-1", blocking, "style")}
                          value={STYLES.some((style) => style.id === row.style) ? row.style : ""}
                          disabled={locked}
                          onChange={(e) => edit(row.filename, { style: e.target.value })}
                        >
                          <option value="">{styleUnsure ? "Low confidence" : "Choose"}</option>
                          {STYLES.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
                        </select>
                        <FieldReasons notes={notes} field="style" />
                      </td>
                      <td className="min-w-36 py-2 pr-2">
                        <input aria-label={`${row.filename} species`} className={fieldClass("h-8 w-full rounded border bg-background px-1", blocking, "species")} value={row.species} disabled={locked} onChange={(e) => edit(row.filename, { species: e.target.value })} />
                        <FieldReasons notes={notes} field="species" />
                      </td>
                      <td className="min-w-36 py-2 pr-2">
                        <select
                          aria-label={`${row.filename} humour`}
                          className={fieldClass("h-8 w-full rounded border bg-background px-1", blocking, "humourOperator")}
                          value={HUMOUR.includes(row.humourOperator) ? row.humourOperator : ""}
                          disabled={locked}
                          onChange={(e) => edit(row.filename, { humourOperator: e.target.value })}
                        >
                          <option value="">{humourUnsure ? "Low confidence" : "Choose"}</option>
                          {HUMOUR.map((id) => <option key={id} value={id}>{id}</option>)}
                        </select>
                        <FieldReasons notes={notes} field="humourOperator" />
                      </td>
                      <td className="min-w-48 py-2 pr-2">
                        <textarea aria-label={`${row.filename} truth`} className={fieldClass("w-full rounded border bg-background px-1", blocking, "truth")} rows={2} value={row.truth} disabled={locked} onChange={(e) => edit(row.filename, { truth: e.target.value })} />
                        <FieldReasons notes={notes} field="truth" />
                      </td>
                      <td className="min-w-48 py-2 pr-2">
                        <textarea aria-label={`${row.filename} device`} className={fieldClass("w-full rounded border bg-background px-1", blocking, "device")} rows={2} value={row.device} disabled={locked} onChange={(e) => edit(row.filename, { device: e.target.value })} />
                        <FieldReasons notes={notes} field="device" />
                      </td>
                      <td className="min-w-56 py-2 pr-2">
                        <textarea aria-label={`${row.filename} wording`} className={fieldClass("w-full rounded border bg-background px-1", blocking, "exactWording")} rows={2} value={row.exactWording} disabled={locked} onChange={(e) => edit(row.filename, { exactWording: e.target.value })} />
                        <FieldReasons notes={notes} field="exactWording" />
                      </td>
                      <td className="py-2">{typeof row.costUsd === "number" ? money(row.costUsd) : "—"}</td>
                      <td className="py-2 pl-2 text-right">
                        <button
                          type="button"
                          aria-label={`Remove ${row.filename}`}
                          className="rounded p-1 text-muted-foreground hover:text-foreground"
                          disabled={!!busy || !!created}
                          onClick={() => removeRow(row.filename)}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {error ? <p className="text-xs" data-testid="catalogue-bulk-import-error">{error}</p> : null}
        {rows.length && !created ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={!!busy || !ready} onClick={() => void createBatch()}>
              Create {queueCount} pending {queueCount === 1 ? "candidate" : "candidates"}{draftRows.length ? ` · vision ${money(spent)}` : ""}
            </Button>
            {catalogueRowsToRetry(rows).some((row) => row.source === "draft") ? (
              <Button type="button" size="sm" variant="outline" disabled={!!busy || drafting} onClick={retryFailed}>Retry failed only</Button>
            ) : null}
            {blockers.length ? <p className="text-xs" data-testid="catalogue-bulk-import-blockers">{blockers.join("; ")}</p> : null}
          </div>
        ) : null}
        {created ? (
          <p className="text-sm" data-testid="catalogue-bulk-import-created">
            Created {created.created} {created.created === 1 ? "candidate" : "candidates"}.{" "}
            {created.studioPath ? <Link href={created.studioPath}>Open the first one in the Studio</Link> : null}
          </p>
        ) : null}
      </section>
    </AdminLayout>
  );
}
