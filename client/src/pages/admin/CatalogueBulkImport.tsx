import { useState } from "react";
import { Link } from "wouter";
import { planCatalogueImport, type CatalogueImportRow } from "@shared/catalogueBulkImport";
import { apiFetch } from "@/lib/queryClient";
import AdminLayout from "@/components/admin-layout";
import { Button } from "@/components/ui/button";

type Created = { created: number; studioPath: string };

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

export default function CatalogueBulkImportPage() {
  const [csv, setCsv] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<CatalogueImportRow[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);

  async function onFolder(list: FileList | null) {
    if (!list?.length) return;
    setBusy("Reading the folder");
    setError("");
    setCreated(null);
    setRows([]);
    setFailures([]);
    try {
      const entries = [...list];
      const csvs = entries.filter((file) => /\.csv$/i.test(basename((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)));
      const pngs = entries.filter((file) => /\.png$/i.test(basename((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)));
      const otherImages = entries.filter((file) => /\.(jpe?g|webp|gif)$/i.test(basename((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)));
      const local: string[] = otherImages.map((file) => `${file.name} is not a PNG.`);
      if (csvs.length !== 1) {
        if (!csvs.length) local.push("No CSV sidecar in the folder.");
        else local.push(`Drop one CSV. Found ${csvs.map((file) => file.name).join(", ")}.`);
        for (const file of pngs) local.push(`${file.name} was uploaded and has no CSV row.`);
        setFiles([]);
        setCsv("");
        setFailures(local);
        return;
      }
      const text = await csvs[0].text();
      const filenames = pngs.map((file) => file.name);
      const planRes = await apiFetch("/api/platform/catalogue-studio/candidates/import/plan", {
        method: "POST",
        body: JSON.stringify({ csv: text, filenames }),
      });
      const plan = await planRes.json();
      if (!planRes.ok) throw new Error(plan.error || "The folder could not be read.");
      setCsv(text);
      setFiles(pngs);
      setRows(Array.isArray(plan.rows) ? plan.rows : []);
      setFailures([...(Array.isArray(plan.failures) ? plan.failures : []), ...local]);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy("");
    }
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
        if (!file) throw new Error(`${row.filename} is in the CSV and was not uploaded.`);
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
        body: JSON.stringify({ batchId, csv, filenames }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.failures?.length) {
        setFailures(Array.isArray(body.failures) && body.failures.length ? body.failures : [body.error || "Nothing was created."]);
        setCreated(null);
        return;
      }
      setCreated({ created: Number(body.created) || 0, studioPath: String(body.studioPath || "") });
      setFailures([]);
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

  const clean = rows.length > 0 && failures.length === 0 && !created;

  return (
    <AdminLayout>
      <section className="space-y-3" data-testid="catalogue-bulk-import">
        <h1 className="text-lg font-medium">Import catalogue designs</h1>
        <p className="text-xs text-muted-foreground">
          Drop one folder. It holds the PNGs and one CSV named with the columns filename, style, species, humour_operator, truth, device, exact_wording.
          Each clean row becomes a pending candidate. Approval stays on the Studio page, one design at a time.
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
        {error ? <p className="text-xs">{error}</p> : null}
        {failures.length ? (
          <ul className="space-y-1" data-testid="catalogue-bulk-import-failures">
            {failures.map((failure, index) => (
              <li key={`${index}-${failure}`} className="text-xs">{failure}</li>
            ))}
          </ul>
        ) : null}
        {rows.length ? (
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Style</th>
                  <th>Species</th>
                  <th>Humour</th>
                  <th>Truth</th>
                  <th>Device</th>
                  <th>Wording</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.rowNumber}-${row.filename}`}>
                    <td>{row.filename}</td>
                    <td>{row.style}</td>
                    <td>{row.species}</td>
                    <td>{row.humourOperator}</td>
                    <td>{row.truth}</td>
                    <td>{row.device}</td>
                    <td>{row.exactWording}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {rows.length && !created ? (
          <Button type="button" size="sm" disabled={!!busy || !clean} onClick={() => void createBatch()}>
            Create {rows.length} pending {rows.length === 1 ? "candidate" : "candidates"}
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
