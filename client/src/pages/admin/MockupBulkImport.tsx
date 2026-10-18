import { useEffect, useRef, useState } from "react";
import { mockupSheetMarks, parseMockupImport, sceneMedian, type MockupPlanRow } from "@shared/mockupBundle";
import { apiFetch } from "@/lib/queryClient";
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
  clipped?: boolean;
};

async function postJson(url: string, body: unknown): Promise<{ res: Response; tries: number }> {
  let res!: Response;
  for (let tries = 1; tries <= 3; tries++) {
    if (tries > 1) await new Promise((resolve) => setTimeout(resolve, 400 * (tries - 1)));
    res = await apiFetch(url, { method: "POST", body: JSON.stringify(body) }, 1);
    if (res.status !== 401) return { res, tries };
  }
  return { res, tries: 3 };
}

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

export function MockupBulkImport({
  onImported,
  productType,
  storedScenes,
}: {
  onImported: () => Promise<unknown>;
  productType: { id: number; name: string } | null;
  storedScenes: string[];
}) {
  const [held, setHeld] = useState<Held[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [sheet, setSheet] = useState<SheetCell[]>([]);
  const [storedSheet, setStoredSheet] = useState<SheetCell[]>([]);
  const [reviewBusy, setReviewBusy] = useState("");
  const [destination, setDestination] = useState<{ id: number; name: string } | null>(null);
  const [drawing, setDrawing] = useState<{ uploadId: string; maskPngBase64: string; photoDataUrl: string; label: string } | null>(null);
  const [retried, setRetried] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const sceneKey = storedScenes.join("|");

  useEffect(() => {
    const ids = sceneKey ? sceneKey.split("|") : [];
    if (!ids.length) {
      setStoredSheet([]);
      return;
    }
    let cancel = false;
    (async () => {
      const all: SheetCell[] = [];
      for (let i = 0; i < ids.length; i++) {
        if (cancel) return;
        setReviewBusy(`Reading stored outlines ${i + 1} of ${ids.length}`);
        const res = await apiFetch(`/api/platform/catalogue-studio/panels/review?panelId=${encodeURIComponent(ids[i])}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Stored outlines failed");
        if (body.productTypeId) setDestination({ id: body.productTypeId, name: body.productTypeName });
        for (const cell of body.cells as SheetCell[]) {
          all.push({
            panelId: cell.panelId,
            garmentColor: cell.garmentColor,
            hex: cell.hex,
            areaFraction: Number(cell.areaFraction) || 0,
            touchesEdge: false,
            disconnected: cell.disconnected === true,
            outlineJpegBase64: String(cell.outlineJpegBase64 || ""),
            error: "",
          });
        }
        if (!cancel) setStoredSheet([...all]);
      }
      if (!cancel) setReviewBusy("");
    })().catch((e: any) => {
      if (!cancel) setReviewBusy(String(e?.message || e));
    });
    return () => {
      cancel = true;
    };
  }, [sceneKey]);

  async function loadEntries(entries: Array<{ path: string; file: File }>) {
    setError("");
    setSheet([]);
    const planRes = await apiFetch("/api/platform/catalogue-studio/panels/import/plan", {
      method: "POST",
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
    if (plan.productTypeId) setDestination({ id: plan.productTypeId, name: String(plan.productTypeName || "") });
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
    const stageIds: string[] = [];
    const retriedNames: string[] = [];
    try {
      for (let i = 0; i < held.length; i++) {
        const item = held[i];
        setBusy(`Segmenting ${i + 1} of ${held.length}: ${item.row.panelId} ${item.row.garmentColor}`);
        const imageBase64 = await fileToDataUrl(item.file);
        const { res, tries } = await postJson("/api/platform/catalogue-studio/panels/import/file", {
          label: item.row.panelId,
          panelId: item.row.panelId,
          garmentColor: item.row.garmentColor,
          garmentHex: item.row.hex,
          kind: item.row.kind,
          isDefault: item.row.panelId.toLowerCase() === "mockup_01",
          imageBase64,
          productTypeId: (destination ?? productType)?.id,
        });
        if (tries > 1) retriedNames.push(`${item.row.panelId} ${item.row.garmentColor}`);
        const body = await res.json();
        if (!res.ok || !body.stageId) {
          cells.push({
            panelId: item.row.panelId,
            garmentColor: item.row.garmentColor,
            hex: item.row.hex,
            areaFraction: 0,
            touchesEdge: false,
            disconnected: false,
            outlineJpegBase64: "",
            error: String(body.error || "not stored"),
          });
          continue;
        }
        stageIds.push(String(body.stageId));
      }
      setRetried(retriedNames);
      if (stageIds.length) {
        setBusy("Clipping each scene to the masks that passed");
        const { res, tries } = await postJson("/api/platform/catalogue-studio/panels/import/commit", { stageIds });
        if (tries > 1) retriedNames.push("scene clip");
        setRetried([...retriedNames]);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "The scenes were not stored.");
        for (const scene of body.scenes as Array<{ panelId: string; rows: SheetCell[] }>) {
          for (const row of scene.rows) {
            cells.push({
              panelId: scene.panelId,
              garmentColor: row.garmentColor,
              hex: row.hex,
              areaFraction: Number(row.areaFraction) || 0,
              touchesEdge: false,
              disconnected: row.disconnected === true,
              outlineJpegBase64: String(row.outlineJpegBase64 || ""),
              error: String(row.error || ""),
              clipped: row.clipped === true,
            });
          }
        }
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
  const going = destination ?? productType;

  async function drawFile(file: File, row: MockupPlanRow) {
    setBusy(`Opening ${row.panelId} ${row.garmentColor}`);
    setError("");
    try {
      const imageBase64 = await fileToDataUrl(file);
      const res = await apiFetch("/api/platform/catalogue-studio/panels/prepare", {
        method: "POST",
        body: JSON.stringify({
          label: row.panelId,
          panelId: row.panelId,
          garmentColor: row.garmentColor,
          garmentHex: row.hex,
          kind: row.kind,
          isDefault: row.panelId.toLowerCase() === "mockup_01",
          imageBase64,
          forceConfirm: true,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "The mask could not be opened.");
      if (!body.needsConfirm) {
        setBusy("");
        await onImported();
        return;
      }
      setDrawing({
        uploadId: body.uploadId,
        maskPngBase64: body.maskPngBase64,
        photoDataUrl: imageBase64,
        label: `${row.panelId} ${row.garmentColor}`,
      });
      setBusy("");
    } catch (e: any) {
      setError(String(e?.message || e));
      setBusy("");
    }
  }

  return (
    <section className="space-y-2" data-testid="catalogue-studio-bulk-import">
      <h2 className="font-medium">Import a mockup folder</h2>
      <p className="text-xs" data-testid="catalogue-studio-import-destination">
        {going
          ? `This import stores on ${going.name} (product type ${going.id}). The candidate open on this page is not the destination.`
          : "Product type is still loading."}
      </p>
      <p className="text-xs text-muted-foreground">
        Each Mockup_NN folder is one scene. The hex in the filename is the garment colour. Nothing is stored until the list below is accepted.
      </p>
      {reviewBusy ? <p className="text-xs">{reviewBusy}</p> : null}
      {storedSheet.length ? (
        <div className="space-y-3" data-testid="catalogue-studio-stored-sheet">
          <h3 className="text-xs font-medium">Stored outlines</h3>
          <SheetFigures cells={storedSheet} />
        </div>
      ) : null}
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
      <label className="block text-xs">
        Draw a mask for one file
        <input
          className="mt-1 block w-full text-xs"
          type="file"
          accept="image/png"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const scene = file.name.match(/^(Mockup_\d+)_[0-9A-Fa-f]{6}\.png$/i);
            if (!scene) {
              setError("Name the file Mockup_NN_HEX.png.");
              return;
            }
            const plan = parseMockupImport([`${scene[1]}/${file.name}`]);
            const row = plan.rows[0];
            if (!row) {
              setError(plan.problems[0]?.message || "That file is not a mockup colour.");
              return;
            }
            void drawFile(file, row);
          }}
        />
      </label>
      {drawing ? (
        <MaskDraw
          label={drawing.label}
          maskPngBase64={drawing.maskPngBase64}
          photoDataUrl={drawing.photoDataUrl}
          onConfirm={async (maskPngBase64) => {
            const res = await apiFetch("/api/platform/catalogue-studio/panels/confirm", {
              method: "POST",
              body: JSON.stringify({ uploadId: drawing.uploadId, maskPngBase64 }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || "Confirm failed");
            setDrawing(null);
            await onImported();
          }}
        />
      ) : null}
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
        <Button type="button" size="sm" disabled={!!busy || problems.length > 0 || !going} onClick={() => void importFolder()}>
          Import this list{going ? ` onto ${going.name}` : ""}
        </Button>
      ) : null}
      {sheet.length ? (
        <div className="space-y-3" data-testid="catalogue-studio-import-sheet">
          <p className="text-xs" data-testid="catalogue-studio-import-retried">
            Retried after a session expiry: {retried.length ? retried.join(", ") : "none"}.
          </p>
          <SheetFigures
            cells={sheet}
            onDraw={(cell) => {
              const item = held.find((row) => row.row.panelId === cell.panelId && row.row.hex.toUpperCase() === cell.hex.toUpperCase());
              if (item) void drawFile(item.file, item.row);
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

function SheetFigures({ cells, onDraw }: { cells: SheetCell[]; onDraw?: (cell: SheetCell) => void }) {
  const medians = new Map<string, number | null>();
  for (const panelId of new Set(cells.map((cell) => cell.panelId))) {
    medians.set(panelId, sceneMedian(cells.filter((cell) => cell.panelId === panelId && !cell.error).map((cell) => cell.areaFraction)));
  }
  const failed = cells.filter((cell) => cell.error);
  const marked = cells.filter((cell) => !cell.error && mockupSheetMarks(cell, medians.get(cell.panelId) ?? null).length);
  const scenes = [...new Set(cells.map((cell) => cell.panelId))];
  return (
    <div className="space-y-3">
      <p className="text-xs">
        {failed.length ? `${failed.length} failed.` : ""} {marked.length} of {cells.length - failed.length} stored need a look. A mark does not hold a panel back. A failure is not stored.
      </p>
      {scenes.map((panelId) => (
        <div key={panelId}>
          <h3 className="text-xs font-medium">{panelId}</h3>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {cells.filter((cell) => cell.panelId === panelId).map((cell) => {
              const reasons = mockupSheetMarks(cell, medians.get(panelId) ?? null);
              return (
                <figure key={`${cell.panelId}-${cell.hex}`} className={cell.error ? "rounded border border-red-700 p-1" : reasons.length ? "rounded border border-amber-700 p-1" : "p-1"}>
                  {cell.outlineJpegBase64 ? (
                    <img src={`data:image/jpeg;base64,${cell.outlineJpegBase64}`} alt="" className="w-full" />
                  ) : null}
                  <figcaption className="text-[10px] leading-tight">
                    {cell.garmentColor}
                    {reasons.length ? ` — ${reasons.join(", ")}` : ""}
                    {cell.clipped && !cell.error ? " — clipped" : ""}
                  </figcaption>
                  {cell.error && onDraw ? (
                    <button type="button" className="text-[10px] underline" onClick={() => onDraw(cell)}>Draw this mask</button>
                  ) : null}
                </figure>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function MaskDraw({
  label,
  maskPngBase64,
  photoDataUrl,
  onConfirm,
}: {
  label: string;
  maskPngBase64: string;
  photoDataUrl: string;
  onConfirm: (maskPngBase64: string) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawError, setDrawError] = useState("");
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const mask = new Image();
    mask.onload = () => {
      node.width = mask.width;
      node.height = mask.height;
      node.getContext("2d")?.drawImage(mask, 0, 0);
    };
    mask.src = `data:image/png;base64,${maskPngBase64}`;
  }, [maskPngBase64]);
  return (
    <div className="space-y-2" data-testid="catalogue-studio-mask-draw">
      <p className="text-xs">{label}. White pixels are the garment. Paint to adjust, then store. Alt paints them out.</p>
      <img src={photoDataUrl} alt="" className="max-h-40 w-full object-contain" />
      <canvas
        ref={canvasRef}
        className="max-h-40 w-full bg-neutral-800 object-contain"
        onPointerDown={(event) => {
          const node = canvasRef.current;
          if (!node) return;
          const rect = node.getBoundingClientRect();
          const x = Math.floor(((event.clientX - rect.left) / rect.width) * node.width);
          const y = Math.floor(((event.clientY - rect.top) / rect.height) * node.height);
          const ctx = node.getContext("2d");
          if (!ctx) return;
          ctx.fillStyle = event.altKey ? "#000000" : "#ffffff";
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fill();
        }}
      />
      {drawError ? <p className="text-xs">{drawError}</p> : null}
      <Button
        type="button"
        size="sm"
        onClick={() => {
          const node = canvasRef.current;
          if (!node) return;
          void onConfirm(node.toDataURL("image/png")).catch((e: any) => setDrawError(String(e?.message || e)));
        }}
      >
        Store this mask
      </Button>
    </div>
  );
}
