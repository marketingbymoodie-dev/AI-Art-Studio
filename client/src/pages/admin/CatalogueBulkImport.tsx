import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  catalogueRowIssues,
  planCatalogueImport,
  type CatalogueImportRow,
} from "@shared/catalogueBulkImport";
import { PETPOSTEROUS_ART_STYLE_LAUNCH, petposterousArtStyle } from "@shared/petposterousArtStyles";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS } from "@shared/petposterousCreative";
import { apiFetch } from "@/lib/queryClient";
import AdminLayout from "@/components/admin-layout";
import { Button } from "@/components/ui/button";

type Created = { created: number; studioPath: string };
type DraftState = "skipped" | "waiting" | "drafting" | "done" | "failed";
type ReviewRow = CatalogueImportRow & {
  previewUrl: string;
  draftState: DraftState;
  draftError: string;
  costUsd: number | null;
};

const DRAFTS_AT_ONCE = 4;
const STYLES = PETPOSTEROUS_ART_STYLE_LAUNCH.map((id) => {
  const style = petposterousArtStyle(id);
  if (!style?.launch) throw new Error(`${id} is listed as launch but is not a launch style`);
  return style;
});
const HUMOUR = Object.keys(PETPOSTEROUS_CONCEPT_FRAMEWORKS);

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

export default function CatalogueBulkImportPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const filesRef = useRef<File[]>([]);
  const urlsRef = useRef<string[]>([]);
  const generation = useRef(0);

  function forgetPreviews() {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
  }

  async function draftOne(row: ReviewRow, gen: number) {
    const file = filesRef.current.find((item) => item.name.toLowerCase() === row.filename.toLowerCase());
    if (!file) {
      setRows((prev) => prev.map((item) => item.filename === row.filename ? { ...item, draftState: "failed", draftError: `${row.filename} is not in the folder.` } : item));
      return;
    }
    setRows((prev) => prev.map((item) => item.filename === row.filename ? { ...item, draftState: "drafting", draftError: "" } : item));
    try {
      const imageBase64 = await fileToDataUrl(file);
      if (generation.current !== gen) return;
      const res = await apiFetch("/api/platform/catalogue-studio/candidates/import/draft", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, imageBase64 }),
      });
      const body = await res.json().catch(() => ({}));
      if (generation.current !== gen) return;
      if (!res.ok) {
        setRows((prev) => prev.map((item) => item.filename === row.filename ? {
          ...item,
          draftState: "failed",
          draftError: String(body.error || "The draft failed."),
          costUsd: typeof body.costUsd === "number" ? body.costUsd : item.costUsd,
        } : item));
        return;
      }
      setRows((prev) => prev.map((item) => {
        if (item.filename !== row.filename) return item;
        return {
          ...item,
          draftState: "done",
          draftError: "",
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
      }));
    } catch (e: any) {
      if (generation.current !== gen) return;
      setRows((prev) => prev.map((item) => item.filename === row.filename ? { ...item, draftState: "failed", draftError: String(e?.message || e) } : item));
    }
  }

  async function runDrafts(list: ReviewRow[], gen: number) {
    const pending = list.filter((row) => row.source === "draft");
    let cursor = 0;
    async function worker() {
      while (cursor < pending.length) {
        if (generation.current !== gen) return;
        const row = pending[cursor];
        cursor += 1;
        await draftOne(row, gen);
      }
    }
    await Promise.all(Array.from({ length: Math.min(DRAFTS_AT_ONCE, pending.length) }, () => worker()));
  }

  async function onFolder(list: FileList | null) {
    if (!list?.length) return;
    generation.current += 1;
    const gen = generation.current;
    forgetPreviews();
    setBusy("Reading the folder");
    setError("");
    setCreated(null);
    setRows([]);
    setFailures([]);
    try {
      const entries = [...list];
      const nameOf = (file: File) => basename((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
      const csvs = entries.filter((file) => /\.csv$/i.test(nameOf(file)));
      const pngs = entries.filter((file) => /\.png$/i.test(nameOf(file)));
      const otherImages = entries.filter((file) => /\.(jpe?g|webp|gif)$/i.test(nameOf(file)));
      const local = otherImages.map((file) => `${file.name} is not a PNG.`);
      if (csvs.length > 1) {
        setFiles([]);
        filesRef.current = [];
        setFailures([`Drop one CSV. Found ${csvs.map((file) => file.name).join(", ")}.`, ...local]);
        return;
      }
      const text = csvs.length === 1 ? await csvs[0].text() : "";
      const planRes = await apiFetch("/api/platform/catalogue-studio/candidates/import/plan", {
        method: "POST",
        body: JSON.stringify({ csv: text, filenames: pngs.map((file) => file.name) }),
      });
      const plan = await planRes.json();
      if (!planRes.ok) throw new Error(plan.error || "The folder could not be read.");
      if (generation.current !== gen) return;
      const urls = pngs.map((file) => URL.createObjectURL(file));
      urlsRef.current = urls;
      const byName = new Map(pngs.map((file, index) => [file.name.toLowerCase(), urls[index]]));
      const next: ReviewRow[] = (Array.isArray(plan.rows) ? plan.rows : []).map((row: CatalogueImportRow) => ({
        ...row,
        lowConfidence: row.lowConfidence || { style: false, humourOperator: false },
        previewUrl: byName.get(row.filename.toLowerCase()) || "",
        draftState: row.source === "draft" ? "waiting" : "skipped",
        draftError: "",
        costUsd: row.source === "draft" ? null : 0,
      }));
      filesRef.current = pngs;
      setFiles(pngs);
      setRows(next);
      setFailures([...(Array.isArray(plan.failures) ? plan.failures : []), ...local]);
      setBusy("");
      void runDrafts(next, gen);
    } catch (e: any) {
      if (generation.current === gen) setError(String(e?.message || e));
    } finally {
      if (generation.current === gen) setBusy("");
    }
  }

  function edit(filename: string, patch: Partial<CatalogueImportRow>) {
    setRows((prev) => prev.map((row) => {
      if (row.filename !== filename) return row;
      const next = { ...row, ...patch };
      if ("style" in patch) next.lowConfidence = { ...next.lowConfidence, style: false };
      if ("humourOperator" in patch) next.lowConfidence = { ...next.lowConfidence, humourOperator: false };
      return next;
    }));
  }

  async function createBatch() {
    const batchId = crypto.randomUUID();
    const filenames = files.map((file) => file.name);
    setBusy(`Uploading 1 of ${rows.length}`);
    setError("");
    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const file = files.find((item) => item.name.toLowerCase() === row.filename.toLowerCase());
        if (!file) throw new Error(`${row.filename} is not in the folder.`);
        setBusy(`Uploading ${i + 1} of ${rows.length}: ${file.name}`);
        const imageBase64 = await fileToDataUrl(file);
        const res = await apiFetch("/api/platform/catalogue-studio/candidates/import/file", {
          method: "POST",
          body: JSON.stringify({ batchId, filename: file.name, imageBase64 }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `${file.name} was not stored.`);
      }
      setBusy("Creating candidates");
      const res = await apiFetch("/api/platform/catalogue-studio/candidates/import/commit", {
        method: "POST",
        body: JSON.stringify({
          batchId,
          filenames,
          rows: rows.map((row) => ({
            rowNumber: row.rowNumber,
            filename: row.filename,
            style: row.style,
            species: row.species,
            humourOperator: row.humourOperator,
            truth: row.truth,
            device: row.device,
            exactWording: row.exactWording,
            source: row.source,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.failures?.length) {
        setFailures(Array.isArray(body.failures) && body.failures.length ? body.failures : [body.error || "Nothing was created."]);
        setCreated(null);
        return;
      }
      setCreated({ created: Number(body.created) || 0, studioPath: String(body.studioPath || "") });
    } catch (e: any) {
      await apiFetch("/api/platform/catalogue-studio/candidates/import/abort", {
        method: "POST",
        body: JSON.stringify({ batchId, filenames }),
      }).catch(() => undefined);
      setError(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  const draftRows = rows.filter((row) => row.source === "draft");
  const drafted = draftRows.filter((row) => row.draftState === "done" || row.draftState === "failed").length;
  const drafting = draftRows.some((row) => row.draftState === "waiting" || row.draftState === "drafting");
  const fieldIssues = rows.flatMap((row) => catalogueRowIssues(row));
  const spent = rows.reduce((sum, row) => sum + (typeof row.costUsd === "number" ? row.costUsd : 0), 0);
  const ready = rows.length > 0 && !failures.length && !fieldIssues.length && !drafting && !rows.some((row) => row.draftState === "failed") && !created;

  return (
    <AdminLayout>
      <section className="space-y-3" data-testid="catalogue-bulk-import">
        <h1 className="text-lg font-medium">Import catalogue designs</h1>
        <p className="text-xs text-muted-foreground">
          Drop a folder of PNGs. A CSV is optional. Where a CSV row exists, those values are kept and the image is not redrafted.
          Everything else is read by the vision model. Nothing is created until this table is clean, and approval stays on the Studio page.
        </p>
        <label className="block text-xs">
          Folder
          <input
            className="mt-1 block w-full text-xs"
            type="file"
            multiple
            // @ts-expect-error directory upload is non-standard and is the folder the operator has
            webkitdirectory=""
            onChange={(e) => void onFolder(e.target.files)}
          />
        </label>
        {busy ? <p className="text-xs">{busy}</p> : null}
        {draftRows.length ? (
          <p className="text-xs" data-testid="catalogue-bulk-import-progress">
            Drafted {drafted} of {draftRows.length}. Vision cost {drafting ? "so far " : ""}{money(spent)}.
          </p>
        ) : null}
        {error ? <p className="text-xs">{error}</p> : null}
        {failures.length ? (
          <ul className="space-y-1" data-testid="catalogue-bulk-import-failures">
            {failures.map((failure, index) => (
              <li key={`${index}-${failure}`} className="text-xs">{failure}</li>
            ))}
          </ul>
        ) : null}
        {rows.length ? (
          <div className="max-h-[36rem] overflow-auto">
            <table className="w-full text-left text-xs">
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
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const issues = catalogueRowIssues(row);
                  const styleUnsure = row.lowConfidence?.style && !row.style;
                  const humourUnsure = row.lowConfidence?.humourOperator && !row.humourOperator;
                  const locked = row.draftState === "waiting" || row.draftState === "drafting";
                  return (
                    <tr key={`${row.rowNumber}-${row.filename}`} className="align-top">
                      <td className="py-2 pr-2">
                        {row.previewUrl ? <img src={row.previewUrl} alt="" className="h-16 w-16 object-contain" /> : null}
                        <div>{row.filename}</div>
                        <div className="text-muted-foreground">{row.source === "csv" ? "From the CSV" : row.draftState === "drafting" || row.draftState === "waiting" ? "Drafting" : row.draftState === "failed" ? "Draft failed" : "Drafted"}</div>
                        {row.draftError ? <div>{row.draftError}</div> : null}
                        {row.draftState === "failed" ? (
                          <button type="button" className="underline" onClick={() => void draftOne(row, generation.current)}>Retry this draft</button>
                        ) : null}
                        {issues.map((issue) => <div key={issue}>{issue.replace(`${row.filename}: `, "")}</div>)}
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          aria-label={`${row.filename} style`}
                          className={`h-8 w-full rounded border bg-background px-1 ${styleUnsure ? "border-amber-700 bg-amber-50" : ""}`}
                          value={STYLES.some((style) => style.id === row.style) ? row.style : ""}
                          disabled={locked}
                          onChange={(e) => edit(row.filename, { style: e.target.value })}
                        >
                          <option value="">{styleUnsure ? "Low confidence" : "Choose"}</option>
                          {STYLES.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <input aria-label={`${row.filename} species`} className="h-8 w-full rounded border bg-background px-1" value={row.species} disabled={locked} onChange={(e) => edit(row.filename, { species: e.target.value })} />
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          aria-label={`${row.filename} humour`}
                          className={`h-8 max-w-40 rounded border bg-background px-1 ${humourUnsure ? "border-amber-700 bg-amber-50" : ""}`}
                          value={HUMOUR.includes(row.humourOperator) ? row.humourOperator : ""}
                          disabled={locked}
                          onChange={(e) => edit(row.filename, { humourOperator: e.target.value })}
                        >
                          <option value="">{humourUnsure ? "Low confidence" : "Choose"}</option>
                          {HUMOUR.map((id) => <option key={id} value={id}>{id}</option>)}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <textarea aria-label={`${row.filename} truth`} className="w-full rounded border bg-background px-1" rows={2} value={row.truth} disabled={locked} onChange={(e) => edit(row.filename, { truth: e.target.value })} />
                      </td>
                      <td className="py-2 pr-2">
                        <textarea aria-label={`${row.filename} device`} className="w-full rounded border bg-background px-1" rows={2} value={row.device} disabled={locked} onChange={(e) => edit(row.filename, { device: e.target.value })} />
                      </td>
                      <td className="py-2 pr-2">
                        <textarea aria-label={`${row.filename} wording`} className="w-full rounded border bg-background px-1" rows={2} value={row.exactWording} disabled={locked} onChange={(e) => edit(row.filename, { exactWording: e.target.value })} />
                      </td>
                      <td className="py-2">{typeof row.costUsd === "number" ? money(row.costUsd) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {rows.length && !created ? (
          <Button type="button" size="sm" disabled={!!busy || !ready} onClick={() => void createBatch()}>
            Create {rows.length} pending {rows.length === 1 ? "candidate" : "candidates"}{draftRows.length ? ` · vision ${money(spent)}` : ""}
          </Button>
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
