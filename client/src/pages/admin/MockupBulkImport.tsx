import { useState } from "react";
import { parseMockupImport, type MockupPlanRow } from "@shared/mockupBundle";
import { Button } from "@/components/ui/button";

type Held = { row: MockupPlanRow; file: File; width: number; height: number };
type Outline = { panelId: string; uploadId: string; maskPngBase64: string; photoDataUrl: string };
type ReportLine = { panelId: string; garmentColor: string; result: string };

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

async function readZip(file: File): Promise<Array<{ path: string; file: File }>> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That zip has no directory.");
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const found: Array<{ path: string; file: File }> = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Zip directory is unreadable.");
    const method = view.getUint16(cursor + 10, true);
    const compSize = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith("/")) continue;
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.slice(dataStart, dataStart + compSize);
    let raw: ArrayBuffer;
    if (method === 0) raw = compressed.buffer;
    else if (method === 8) {
      const stream = new Blob([compressed.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      raw = await new Response(stream).arrayBuffer();
    } else {
      throw new Error(`${name} uses a zip method this page cannot read.`);
    }
    const base = name.split("/").pop() || name;
    const type = /\.png$/i.test(base) ? "image/png" : "image/jpeg";
    found.push({ path: name, file: new File([raw], base, { type }) });
  }
  return found;
}

export function MockupBulkImport({ onImported }: { onImported: () => Promise<unknown> }) {
  const [held, setHeld] = useState<Held[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [outlines, setOutlines] = useState<Outline[]>([]);
  const [report, setReport] = useState<ReportLine[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function loadEntries(entries: Array<{ path: string; file: File }>) {
    setError("");
    setOutlines([]);
    setReport([]);
    const planRes = await fetch("/api/platform/catalogue-studio/panels/import/plan", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: entries.map((entry) => entry.path) }),
    });
    const plan = await planRes.json();
    if (!planRes.ok) throw new Error(plan.error || "The folder could not be read.");
    const byPath = new Map(entries.map((entry) => [entry.path.replace(/\\/g, "/"), entry.file]));
    const next: Held[] = [];
    for (const row of plan.rows as MockupPlanRow[]) {
      const file = byPath.get(row.relativePath.replace(/\\/g, "/"));
      if (!file) continue;
      const size = await imageSize(file);
      next.push({ row, file, width: size.width, height: size.height });
    }
    setHeld(next);
    setProblems((plan.problems as Array<{ message: string }>).map((problem) => problem.message));
  }

  async function onFolder(list: FileList | null) {
    if (!list?.length) return;
    setBusy("Reading the folder");
    try {
      const entries = [...list].map((file) => ({
        path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        file,
      }));
      await loadEntries(entries);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function onZip(file: File | undefined) {
    if (!file) return;
    setBusy("Reading the zip");
    try {
      await loadEntries(await readZip(file));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function importFolder() {
    setBusy("Segmenting the white masters");
    setError("");
    setReport([]);
    const whites = held.filter((item) => item.row.kind === "white-master");
    const pending: Outline[] = [];
    try {
      for (const item of whites) {
        const imageBase64 = await fileToDataUrl(item.file);
        const res = await fetch("/api/platform/catalogue-studio/panels/prepare", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: item.row.panelId,
            panelId: item.row.panelId,
            garmentColor: item.row.garmentColor,
            garmentHex: item.row.hex,
            kind: "white-master",
            isDefault: item.row.panelId.toLowerCase() === "mockup_01",
            imageBase64,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `${item.row.panelId} white master failed`);
        if (body.needsConfirm) {
          pending.push({
            panelId: item.row.panelId,
            uploadId: body.uploadId,
            maskPngBase64: body.maskPngBase64,
            photoDataUrl: imageBase64,
          });
        }
      }
      setOutlines(pending);
      setBusy(pending.length ? "Confirm one outline per scene, then the colours upload." : "");
    } catch (e: any) {
      setError(String(e?.message || e));
      setBusy("");
    }
  }

  async function storeOutlines() {
    setBusy("Storing the white masks");
    setError("");
    try {
      for (const outline of outlines) {
        const res = await fetch("/api/platform/catalogue-studio/panels/confirm", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId: outline.uploadId, maskPngBase64: outline.maskPngBase64 }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `${outline.panelId} mask was not stored`);
      }
      setOutlines([]);
      const lines: ReportLine[] = [];
      const colours = held.filter((item) => item.row.kind === "produced");
      for (const item of colours) {
        setBusy(`Checking ${item.row.panelId} ${item.row.garmentColor}`);
        const imageBase64 = await fileToDataUrl(item.file);
        const res = await fetch("/api/platform/catalogue-studio/panels/prepare", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: item.row.panelId,
            panelId: item.row.panelId,
            garmentColor: item.row.garmentColor,
            garmentHex: item.row.hex,
            kind: "produced",
            isDefault: false,
            imageBase64,
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          lines.push({ panelId: item.row.panelId, garmentColor: item.row.garmentColor, result: body.error || "failed" });
          continue;
        }
        lines.push({
          panelId: item.row.panelId,
          garmentColor: item.row.garmentColor,
          result: body.stored ? "copied mask" : "needs confirmation",
        });
      }
      setReport(lines);
      setBusy("");
      await onImported();
    } catch (e: any) {
      setError(String(e?.message || e));
      setBusy("");
    }
  }

  const whites = new Map(held.filter((item) => item.row.kind === "white-master").map((item) => [item.row.panelId, item]));

  return (
    <section className="space-y-2" data-testid="catalogue-studio-bulk-import">
      <h2 className="font-medium">Import a mockup folder</h2>
      <p className="text-xs text-muted-foreground">
        Each Mockup_NN folder is one scene. The hex in the filename is the garment colour. Nothing is stored until the list below is accepted.
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
      <label className="block text-xs">
        Or a zip of that folder
        <input className="mt-1 block w-full text-xs" type="file" accept=".zip,application/zip" onChange={(e) => void onZip(e.target.files?.[0])} />
      </label>
      {busy ? <p className="text-xs">{busy}</p> : null}
      {error ? <p className="text-xs">{error}</p> : null}
      {problems.map((problem) => <p key={problem} className="text-xs">{problem}</p>)}
      {held.length ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr><th>Scene</th><th>File</th><th>Colour</th><th>Pixels</th></tr>
            </thead>
            <tbody>
              {held.map((item) => {
                const white = whites.get(item.row.panelId);
                const sizeDiffers = item.row.kind === "produced" && white && (white.width !== item.width || white.height !== item.height);
                return (
                  <tr key={item.row.relativePath}>
                    <td>{item.row.panelId}</td>
                    <td>{item.row.filename}</td>
                    <td>{item.row.garmentColor} {item.row.hex}{item.row.kind === "white-master" ? " master" : ""}</td>
                    <td>{item.width}×{item.height}{sizeDiffers ? " size differs" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {held.some((item) => {
        const white = whites.get(item.row.panelId);
        return item.row.kind === "produced" && !!white && (white.width !== item.width || white.height !== item.height);
      }) ? (
        <p className="text-xs">Some colour files are a different pixel size from their white master. Those masks will not be copied.</p>
      ) : null}
      {held.length && !outlines.length ? (
        <Button type="button" size="sm" disabled={!!busy || problems.length > 0} onClick={() => void importFolder()}>
          Import this list
        </Button>
      ) : null}
      {outlines.length ? (
        <div className="space-y-3">
          {outlines.map((outline) => (
            <figure key={outline.panelId} className="space-y-1">
              <figcaption className="text-xs">{outline.panelId} white outline</figcaption>
              <img src={outline.photoDataUrl} alt="" className="max-h-28 w-full object-contain" />
              <canvas data-panel={outline.panelId} ref={(node) => {
                if (!node) return;
                const mask = new Image();
                mask.onload = () => {
                  node.width = mask.width;
                  node.height = mask.height;
                  node.getContext("2d")?.drawImage(mask, 0, 0);
                };
                mask.src = `data:image/png;base64,${outline.maskPngBase64}`;
              }} className="max-h-28 w-full bg-neutral-800 object-contain" />
            </figure>
          ))}
          <Button type="button" size="sm" disabled={!!busy} onClick={() => void storeOutlines()}>
            Store these {outlines.length} outlines and continue
          </Button>
        </div>
      ) : null}
      {report.length ? (
        <ul className="space-y-1 text-xs" data-testid="catalogue-studio-import-report">
          {report.map((line) => (
            <li key={`${line.panelId}-${line.garmentColor}`}>{line.panelId} {line.garmentColor}: {line.result}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
