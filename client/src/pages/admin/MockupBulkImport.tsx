import { useState } from "react";
import { MASK_AREA_FAR, parseMockupImport, type MockupPlanRow } from "@shared/mockupBundle";
import { Button } from "@/components/ui/button";

type Held = { row: MockupPlanRow; file: File; width: number; height: number };
type SheetCell = {
  panelId: string;
  garmentColor: string;
  hex: string;
  areaFraction: number;
  touchesEdge: boolean;
  disconnected: boolean;
  outlineJpegBase64: string;
  error: string;
};

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
  const [notes, setNotes] = useState<string[]>([]);
  const [sheet, setSheet] = useState<SheetCell[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function loadEntries(entries: Array<{ path: string; file: File }>) {
    setError("");
    setSheet([]);
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
    setNotes(Array.isArray(plan.notes) ? plan.notes : []);
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
    setBusy("Segmenting 1 of " + held.length);
    setError("");
    setSheet([]);
    const cells: SheetCell[] = [];
    try {
      for (let i = 0; i < held.length; i++) {
        const item = held[i];
        setBusy(`Segmenting ${i + 1} of ${held.length}: ${item.row.panelId} ${item.row.garmentColor}`);
        const imageBase64 = await fileToDataUrl(item.file);
        const res = await fetch("/api/platform/catalogue-studio/panels/import/file", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: item.row.panelId,
            panelId: item.row.panelId,
            garmentColor: item.row.garmentColor,
            garmentHex: item.row.hex,
            kind: item.row.kind,
            isDefault: item.row.panelId.toLowerCase() === "mockup_01",
            imageBase64,
          }),
        });
        const body = await res.json();
        cells.push({
          panelId: item.row.panelId,
          garmentColor: item.row.garmentColor,
          hex: item.row.hex,
          areaFraction: Number(body.areaFraction) || 0,
          touchesEdge: body.touchesEdge === true,
          disconnected: body.disconnected === true,
          outlineJpegBase64: String(body.outlineJpegBase64 || ""),
          error: res.ok ? "" : String(body.error || "not stored"),
        });
      }
      setSheet(cells);
      setBusy("");
      await onImported();
    } catch (e: any) {
      setSheet(cells);
      setError(String(e?.message || e));
      setBusy("");
    }
  }

  const whites = new Map(held.filter((item) => item.row.kind === "white-master").map((item) => [item.row.panelId, item]));
  const medianByScene = new Map<string, number>();
  for (const panelId of new Set(sheet.map((cell) => cell.panelId))) {
    const areas = sheet.filter((cell) => cell.panelId === panelId && !cell.error).map((cell) => cell.areaFraction).sort((a, b) => a - b);
    if (!areas.length) continue;
    const mid = Math.floor(areas.length / 2);
    medianByScene.set(panelId, areas.length % 2 ? areas[mid] : (areas[mid - 1] + areas[mid]) / 2);
  }
  function attention(cell: SheetCell): string[] {
    const reasons: string[] = [];
    if (cell.error) reasons.push(cell.error);
    const median = medianByScene.get(cell.panelId);
    if (median != null && Math.abs(cell.areaFraction - median) > MASK_AREA_FAR) reasons.push("area far from this scene");
    if (cell.touchesEdge) reasons.push("touches the frame");
    if (cell.disconnected) reasons.push("disconnected");
    return reasons;
  }
  const scenes = [...new Set(sheet.map((cell) => cell.panelId))];

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
      {notes.map((note) => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
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
        <p className="text-xs">Some colour files are a different pixel size from the white file in that scene.</p>
      ) : null}
      {held.length && !sheet.length ? (
        <Button type="button" size="sm" disabled={!!busy || problems.length > 0} onClick={() => void importFolder()}>
          Import this list
        </Button>
      ) : null}
      {sheet.length ? (
        <div className="space-y-3" data-testid="catalogue-studio-import-sheet">
          <p className="text-xs">
            {sheet.filter((cell) => attention(cell).length).length} of {sheet.length} need a look. The rest are stored.
          </p>
          {scenes.map((panelId) => (
            <div key={panelId}>
              <h3 className="text-xs font-medium">{panelId}</h3>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {sheet.filter((cell) => cell.panelId === panelId).map((cell) => {
                  const reasons = attention(cell);
                  return (
                    <figure key={`${cell.panelId}-${cell.hex}`} className={reasons.length ? "rounded border border-amber-700 p-1" : "p-1"}>
                      {cell.outlineJpegBase64 ? (
                        <img src={`data:image/jpeg;base64,${cell.outlineJpegBase64}`} alt="" className="w-full" />
                      ) : null}
                      <figcaption className="text-[10px] leading-tight">
                        {cell.garmentColor}
                        {reasons.length ? ` — ${reasons.join(", ")}` : ""}
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
