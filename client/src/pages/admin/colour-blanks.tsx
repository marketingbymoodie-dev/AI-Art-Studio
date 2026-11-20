import { Component, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, isSessionAuthError } from "@/lib/queryClient";
import { SHOPIFY_BASE_COLOURS } from "@shared/flywheelPromote";

type Finish = "solid" | "heather" | "produced";

type Colour = {
  id: string;
  name: string;
  printifyOptionId: number | null;
  printifyTitle: string;
  hex: string;
  finish: Finish;
  shopifyBaseColor: string | null;
  linkStoredName: string | null;
  match: "present" | "name-mismatch" | "missing";
  storedName: string | null;
  storedRows: number;
  storedScenes: number;
  active: boolean;
  lockReason: string | null;
};

type Revision = { id: string; name: string; hex: string; kind: string; createdAt: string };

type Cell = {
  colourId: string;
  state: "present" | "missing";
  photoUrl: string | null;
  compose: { mode: "produced" | "recolour" | "unavailable"; sourceName: string; usesThisBlank: boolean };
  current: Revision | null;
  history: Revision[];
};

type Placement = { widthOfH: number; heightOfH: number; topOfH: number };

type Scene = {
  panelId: string;
  label: string;
  isDefault: boolean;
  placement: Placement | null;
  placementOffsetPx: { left: number; top: number; width: number; height: number } | null;
  cells: Cell[];
};

type Calibration = {
  placement: Placement;
  printWidthPx: number;
  printHeightPx: number;
  bodyLengthIn: number;
};

type SceneBounds = { minX: number; minY: number; maxX: number; maxY: number; centre: number; H: number };

type SceneDraft = {
  name: string;
  raw: string;
  preview: string;
  width: number;
  height: number;
  bounds: SceneBounds;
  placement: Placement;
  note: string;
};

function asFinish(value: string): Finish {
  if (value === "heather" || value === "produced") return value;
  return "solid";
}

type Grid = {
  productType: { id: number; name: string };
  sharedFrom: { id: number; name: string } | null;
  types: Array<{ id: number; name: string }>;
  calibration: Calibration | null;
  colours: Colour[];
  scenes: Scene[];
};

type Alignment = {
  overlap: number;
  edgeOffsetPx: number;
  shiftX: number;
  shiftY: number;
  warning: string | null;
};

type Preview = {
  src: string;
  kind: "paint" | "upload";
  confirm?: string;
  error?: string;
  overlay?: string;
  master?: string;
  compare?: "off" | "overlay" | "flicker";
  alignment?: Alignment;
  resized?: boolean;
  fromWidth?: number;
  fromHeight?: number;
  width?: number;
  height?: number;
};

function px(value: number): string {
  const n = Math.round(value);
  return `${n > 0 ? "+" : ""}${n} px`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "colour";
}

function cellKey(panelId: string, colourId: string): string {
  return `${panelId}::${colourId}`;
}

function composeLabel(cell: Cell): string {
  if (cell.compose.usesThisBlank) return "Compose uses this blank";
  if (cell.compose.mode === "recolour") return "Compose would repaint the white master";
  if (cell.compose.mode === "produced") return `Compose uses ${cell.compose.sourceName}`;
  return "Compose has no blank";
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { error?: string };
    return body.error || text;
  } catch {
    return text || res.statusText;
  }
}

class CellErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error: error?.message || "This preview failed." };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return <p className="text-destructive" data-testid="colour-cell-error">{this.state.error}</p>;
    }
    return this.props.children;
  }
}

class SectionErrorBoundary extends Component<{ title: string; resetKey: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error: error?.message || "This section failed." };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive" data-testid="colour-section-error">
          {this.props.title}: {this.state.error}
        </p>
      );
    }
    return this.props.children;
  }
}

function FlickerFrame({ upload, master, testId }: { upload: string; master: string; testId: string }) {
  const [showMaster, setShowMaster] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setShowMaster((on) => !on), 450);
    return () => window.clearInterval(id);
  }, []);
  return (
    <img
      src={showMaster && master ? master : upload}
      alt=""
      data-testid={testId}
      className="h-28 max-h-28 w-full max-w-full object-contain bg-white"
    />
  );
}

function boxPercent(bounds: SceneBounds, width: number, height: number, placement: Placement) {
  const boxW = placement.widthOfH * bounds.H;
  const boxH = placement.heightOfH * bounds.H;
  return {
    left: ((bounds.centre - boxW / 2) / width) * 100,
    top: ((bounds.minY + placement.topOfH * bounds.H) / height) * 100,
    width: (boxW / width) * 100,
    height: (boxH / height) * 100,
  };
}

function PlacementEditor({
  draft,
  guide,
  onChange,
}: {
  draft: SceneDraft;
  guide: Placement | null;
  onChange: (placement: Placement) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const { bounds, width, height, placement } = draft;
  const box = boxPercent(bounds, width, height, placement);
  const guideBox = guide ? boxPercent(bounds, width, height, guide) : null;

  function drag(mode: "move" | "resize", event: ReactPointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const frameRect = frame.current?.getBoundingClientRect();
    if (!frameRect) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const start = placement;
    const scaleX = width / frameRect.width;
    const scaleY = height / frameRect.height;
    function move(ev: PointerEvent) {
      const dx = (ev.clientX - startX) * scaleX;
      const dy = (ev.clientY - startY) * scaleY;
      if (mode === "move") {
        onChange({ ...start, topOfH: (bounds.minY + start.topOfH * bounds.H + dy - bounds.minY) / bounds.H });
        return;
      }
      onChange({
        ...start,
        widthOfH: (start.widthOfH * bounds.H + dx) / bounds.H,
        heightOfH: (start.heightOfH * bounds.H + dy) / bounds.H,
      });
    }
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  return (
    <div ref={frame} className="relative mx-auto w-full max-w-[420px]" data-testid="colour-scene-placement">
      <img src={draft.preview} alt="" className="w-full bg-neutral-800" />
      {guideBox ? (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-amber-400"
          style={{ left: `${guideBox.left}%`, top: `${guideBox.top}%`, width: `${guideBox.width}%`, height: `${guideBox.height}%` }}
          data-testid="colour-scene-calibrated"
        />
      ) : null}
      <div
        className="absolute border-2 border-sky-500 bg-sky-400/20"
        style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
        onPointerDown={(event) => drag("move", event)}
      >
        <span
          className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize bg-sky-500"
          onPointerDown={(event) => drag("resize", event)}
        />
      </div>
    </div>
  );
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

export default function ColourBlanksPage() {
  const platform = useQuery<{ defaultProductTypeId?: number; catalogueShop?: string }>({
    queryKey: ["/api/platform/admin/status"],
  });
  const [pickedType, setPickedType] = useState<number | null>(null);
  const stagingShop = "ai-art-studio-staging.myshopify.com";
  const stagingDefault = !platform.data?.catalogueShop || platform.data.catalogueShop === stagingShop;
  const typeId = pickedType ?? platform.data?.defaultProductTypeId ?? (platform.isFetched && stagingDefault ? 54 : 0);
  const [drafts, setDrafts] = useState<Record<string, Colour>>({});
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [historyUrl, setHistoryUrl] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");
  const [sceneDraft, setSceneDraft] = useState<SceneDraft | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const uploads = useRef(new Set<string>());
  // File bytes stay here until Approve. A tab crash is not a React error, so they must not live in state or in an error-boundary key.
  const uploadFiles = useRef(new Map<string, string>());

  function noteSession(res: Response, message: string): string {
    if (res.status === 401 || isSessionAuthError(message)) {
      setSessionExpired(true);
      return "session expired, reload";
    }
    return message;
  }

  async function readOk(res: Response): Promise<void> {
    if (res.ok) return;
    throw new Error(noteSession(res, await readError(res)));
  }

  const grid = useQuery<Grid>({
    queryKey: ["/api/platform/catalogue-studio/colour-blanks", typeId],
    enabled: !sessionExpired && typeId > 0,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const res = await apiFetch(`/api/platform/catalogue-studio/colour-blanks?productTypeId=${typeId}`);
      await readOk(res);
      return res.json();
    },
  });

  useEffect(() => {
    const next: Record<string, Colour> = {};
    for (const colour of grid.data?.colours ?? []) next[colour.id] = colour;
    setDrafts(next);
  }, [grid.data]);

  function patchDraft(id: string, patch: Partial<Colour>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function setColourActive(colour: Colour, active: boolean) {
    setBusy(`active-${colour.id}`);
    setStatus("");
    try {
      const res = await apiFetch(`/api/platform/catalogue-studio/colour-blanks/colours/${colour.id}/active`, {
        method: "POST",
        body: JSON.stringify({ active, productTypeId: typeId }),
      });
      await readOk(res);
      await grid.refetch();
      setStatus(active ? `${colour.name} is active.` : `${colour.name} is hidden from the grid, Studio, and the storefront.`);
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function saveColour(colour: Colour) {
    setBusy(colour.id);
    setStatus("");
    try {
      const res = await apiFetch(`/api/platform/catalogue-studio/colour-blanks/colours/${colour.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          productTypeId: typeId,
          name: colour.name,
          printifyTitle: colour.printifyTitle,
          printifyOptionId: colour.printifyOptionId,
          hex: colour.hex,
          finish: colour.finish,
          shopifyBaseColor: colour.shopifyBaseColor,
          linkStoredName: colour.linkStoredName,
        }),
      });
      await readOk(res);
      await grid.refetch();
      setStatus(`Saved ${colour.name}. Stored blanks were not renamed.`);
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function addColour(form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy("add");
    setStatus("");
    try {
      const res = await apiFetch("/api/platform/catalogue-studio/colour-blanks/colours", {
        method: "POST",
        body: JSON.stringify({
          productTypeId: typeId,
          name: String(data.get("name") || ""),
          printifyTitle: String(data.get("printifyTitle") || ""),
          printifyOptionId: String(data.get("printifyOptionId") || ""),
          hex: String(data.get("hex") || ""),
          finish: String(data.get("finish") || "solid"),
          shopifyBaseColor: String(data.get("shopifyBaseColor") || ""),
          linkStoredName: String(data.get("linkStoredName") || ""),
        }),
      });
      await readOk(res);
      form.reset();
      await grid.refetch();
      setStatus("Colour added. No blanks were created.");
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function paintOne(panelId: string, colour: Colour) {
    const key = cellKey(panelId, colour.id);
    setBusy(key);
    setStatus(`Painting ${colour.name} on ${panelId}…`);
    try {
      const res = await apiFetch("/api/platform/catalogue-studio/colour-blanks/paint", {
        method: "POST",
        body: JSON.stringify({ colourId: colour.id, panelId, productTypeId: typeId }),
      });
      await readOk(res);
      const body = await res.json() as { jpegBase64: string };
      setPreviews((current) => ({
        ...current,
        [key]: { kind: "paint", src: `data:image/jpeg;base64,${body.jpegBase64}` },
      }));
      setStatus(`${colour.name} on ${panelId} is a preview. Nothing is saved until you approve it.`);
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function paintMany(pairs: Array<{ panelId: string; colour: Colour }>, label: string) {
    setBusy("many");
    let done = 0;
    const next = { ...previews };
    try {
      for (const pair of pairs) {
        done += 1;
        setStatus(`Painting ${done} of ${pairs.length} (${label})…`);
        const res = await apiFetch("/api/platform/catalogue-studio/colour-blanks/paint", {
          method: "POST",
          body: JSON.stringify({ colourId: pair.colour.id, panelId: pair.panelId, productTypeId: typeId }),
        });
        await readOk(res);
        const body = await res.json() as { jpegBase64: string };
        next[cellKey(pair.panelId, pair.colour.id)] = { kind: "paint", src: `data:image/jpeg;base64,${body.jpegBase64}` };
        setPreviews({ ...next });
      }
      setStatus(`${pairs.length} previews ready. Nothing is saved until you approve.`);
    } catch (e: any) {
      setPreviews({ ...next });
      setStatus(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function approvePaint(panelId: string, colour: Colour) {
    const key = cellKey(panelId, colour.id);
    setBusy(key);
    setStatus(`Saving ${colour.name} on ${panelId}…`);
    try {
      const res = await apiFetch("/api/platform/catalogue-studio/colour-blanks/approve", {
        method: "POST",
        body: JSON.stringify({ colourId: colour.id, panelId, productTypeId: typeId }),
      });
      await readOk(res);
      setPreviews((current) => {
        const copy = { ...current };
        delete copy[key];
        return copy;
      });
      await grid.refetch();
      setStatus(`${colour.name} on ${panelId} is stored as a produced blank.`);
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function approvePainted(pairs: Array<{ panelId: string; colour: Colour }>) {
    setBusy("many");
    try {
      for (const pair of pairs) {
        setStatus(`Saving ${pair.colour.name} on ${pair.panelId}…`);
        const res = await apiFetch("/api/platform/catalogue-studio/colour-blanks/approve", {
          method: "POST",
          body: JSON.stringify({ colourId: pair.colour.id, panelId: pair.panelId, productTypeId: typeId }),
        });
        await readOk(res);
      }
      setPreviews((current) => {
        const copy = { ...current };
        for (const pair of pairs) delete copy[cellKey(pair.panelId, pair.colour.id)];
        return copy;
      });
      await grid.refetch();
      setStatus(`Saved ${pairs.length} produced blanks.`);
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function stageUpload(panelId: string, colour: Colour, file: File) {
    const key = cellKey(panelId, colour.id);
    if (uploads.current.has(key)) return;
    uploads.current.add(key);
    setBusy(key);
    setStatus(`Checking ${file.name} against the white master…`);
    try {
      const raw = await readFile(file);
      const res = await apiFetch("/api/platform/catalogue-studio/colour-blanks/upload-preview", {
        method: "POST",
        body: JSON.stringify({ colourId: colour.id, panelId, imageBase64: raw, productTypeId: typeId }),
      });
      await readOk(res);
      const body = await res.json() as {
        jpegUrl: string;
        overlayUrl: string;
        masterUrl: string;
        resized: boolean;
        fromWidth: number;
        fromHeight: number;
        width: number;
        height: number;
        displayWidth: number;
        displayHeight: number;
        alignment: Alignment;
      };
      uploadFiles.current.set(key, raw);
      setPreviews((current) => ({
        ...current,
        [key]: {
          kind: "upload",
          src: body.jpegUrl,
          overlay: body.overlayUrl,
          master: body.masterUrl,
          compare: "overlay",
          alignment: body.alignment,
          resized: body.resized,
          fromWidth: body.fromWidth,
          fromHeight: body.fromHeight,
          width: body.width,
          height: body.height,
        },
      }));
      const size = body.resized ? ` Scaled from ${body.fromWidth}×${body.fromHeight} to ${body.width}×${body.height}.` : "";
      setStatus(`${file.name} is a preview for ${colour.name} on ${panelId}.${size} Shown at ${body.displayWidth}×${body.displayHeight}. Nothing is saved until you approve it.`);
    } catch (e: any) {
      const message = String(e?.message || e);
      setPreviews((current) => ({
        ...current,
        [key]: { kind: "upload", src: "", error: message },
      }));
      setStatus(message);
    } finally {
      uploads.current.delete(key);
      setBusy("");
    }
  }

  async function approveUpload(panelId: string, colour: Colour, confirmMask = false) {
    const key = cellKey(panelId, colour.id);
    const preview = previews[key];
    const raw = uploadFiles.current.get(key);
    if (!preview || !raw) return;
    setBusy(key);
    try {
      const res = await apiFetch("/api/platform/catalogue-studio/colour-blanks/upload", {
        method: "POST",
        body: JSON.stringify({ colourId: colour.id, panelId, imageBase64: raw, confirmMask, productTypeId: typeId }),
      });
      await readOk(res);
      const body = await res.json() as { stored?: boolean; needsConfirm?: boolean; message?: string };
      if (body.needsConfirm) {
        setPreviews((current) => ({ ...current, [key]: { ...preview, confirm: body.message } }));
        setStatus(body.message || "Confirm the mask before saving.");
        return;
      }
      uploadFiles.current.delete(key);
      setPreviews((current) => {
        const copy = { ...current };
        delete copy[key];
        return copy;
      });
      await grid.refetch();
      setStatus(`${colour.name} on ${panelId} is stored as a produced blank.`);
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function linkColour(colour: Colour) {
    const from = colour.storedName || colour.linkStoredName;
    if (!window.confirm(`Rename stored blanks from ${from} to ${colour.name}? Products and variants stay as they are.`)) return;
    setBusy(colour.id);
    try {
      const res = await apiFetch("/api/platform/catalogue-studio/colour-blanks/link", {
        method: "POST",
        body: JSON.stringify({ colourId: colour.id, productTypeId: typeId }),
      });
      await readOk(res);
      const body = await res.json() as { rows: number; scenes: number };
      await grid.refetch();
      setStatus(`Linked ${body.rows} blanks on ${body.scenes} scenes as ${colour.name}.`);
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function showHistory(rowId: string) {
    const res = await apiFetch(`/api/platform/catalogue-studio/colour-blanks/rows/${rowId}`);
    if (!res.ok) {
      setStatus(noteSession(res, await readError(res)));
      return;
    }
    const body = await res.json() as { url: string };
    setHistoryUrl((current) => ({ ...current, [rowId]: body.url }));
  }

  async function rollback(row: Revision) {
    if (!window.confirm(`Use the ${row.createdAt.slice(0, 16).replace("T", " ")} copy of ${row.name}? The current blank stays in history.`)) return;
    setBusy(row.id);
    try {
      const res = await apiFetch("/api/platform/catalogue-studio/colour-blanks/rollback", {
        method: "POST",
        body: JSON.stringify({ rowId: row.id, productTypeId: typeId }),
      });
      await readOk(res);
      await grid.refetch();
      setStatus(`Rolled ${row.name} back. The newer copy is still in history.`);
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function previewScene(file: File) {
    setBusy("scene");
    setStatus("");
    try {
      const raw = await readFile(file);
      const res = await apiFetch("/api/platform/catalogue-studio/colour-blanks/scene-preview", {
        method: "POST",
        body: JSON.stringify({ imageBase64: raw }),
      });
      await readOk(res);
      const body = await res.json();
      setSceneDraft({
        name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Scene",
        raw,
        preview: `data:image/jpeg;base64,${body.previewJpegBase64}`,
        width: body.width,
        height: body.height,
        bounds: body.bounds,
        placement: grid.data?.calibration?.placement ?? body.placement,
        note: body.touchesEdge ? "The shirt touches the edge of the photo." : "",
      });
      setStatus(`Preview is ${body.width}×${body.height}. Nothing is stored until you approve the scene.`);
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function approveScene() {
    if (!sceneDraft) return;
    setBusy("scene");
    setStatus("");
    try {
      const res = await apiFetch("/api/platform/catalogue-studio/colour-blanks/scene-approve", {
        method: "POST",
        body: JSON.stringify({
          productTypeId: typeId,
          label: sceneDraft.name,
          imageBase64: sceneDraft.raw,
          widthOfH: sceneDraft.placement.widthOfH,
          heightOfH: sceneDraft.placement.heightOfH,
          topOfH: sceneDraft.placement.topOfH,
        }),
      });
      await readOk(res);
      const body = await res.json();
      setSceneDraft(null);
      await grid.refetch();
      setStatus(`Stored scene ${body.panelId}. Compose can use it now.`);
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  async function deleteScene(scene: Scene) {
    setBusy(`scene-${scene.panelId}`);
    setStatus("");
    try {
      const res = await apiFetch("/api/platform/catalogue-studio/colour-blanks/scene-delete", {
        method: "POST",
        body: JSON.stringify({ productTypeId: typeId, panelId: scene.panelId }),
      });
      await readOk(res);
      await grid.refetch();
      setStatus(`Deleted ${scene.label || scene.panelId}.`);
    } catch (e: any) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy("");
    }
  }

  const data = grid.data;
  const readOnly = Boolean(data?.sharedFrom);
  const colours = data?.colours ?? [];
  const scenes = data?.scenes ?? [];
  const gridColours = colours.filter((colour) => colour.active);
  const inactiveColours = colours.filter((colour) => !colour.active);
  const solids = gridColours.filter((colour) => colour.finish === "solid");
  const paintedPairs = scenes.flatMap((scene) => solids
    .filter((colour) => previews[cellKey(scene.panelId, colour.id)]?.kind === "paint")
    .map((colour) => ({ panelId: scene.panelId, colour })));

  function colourRows(rows: Colour[]) {
    return rows.map((colour) => {
      const draft = drafts[colour.id] || colour;
      return (
        <tr key={colour.id} data-testid={`colour-row-${slug(colour.name)}`}>
          <td className="p-1 align-top">
            <input
              type="checkbox"
              checked={colour.active}
              disabled={readOnly || busy !== "" || Boolean(colour.lockReason)}
              title={colour.lockReason || (colour.active ? "Shown" : "Hidden")}
              data-testid={`colour-active-${slug(colour.name)}`}
              onChange={(event) => void setColourActive(colour, event.target.checked)}
            />
            {colour.lockReason ? (
              <span className="mt-1 block max-w-48 text-muted-foreground" data-testid={`colour-lock-${slug(colour.name)}`}>{colour.lockReason}</span>
            ) : null}
          </td>
          <td className="p-1"><Input value={draft.name} onChange={(event) => patchDraft(colour.id, { name: event.target.value })} /></td>
          <td className="p-1"><Input value={draft.printifyTitle} onChange={(event) => patchDraft(colour.id, { printifyTitle: event.target.value })} /></td>
          <td className="p-1 w-24">
            <Input
              value={draft.printifyOptionId ?? ""}
              onChange={(event) => patchDraft(colour.id, { printifyOptionId: event.target.value === "" ? null : Number(event.target.value) })}
            />
          </td>
          <td className="p-1 w-32">
            <span className="flex items-center gap-1">
              <span className="inline-block h-4 w-4 rounded-sm border" style={{ background: `#${draft.hex}` }} />
              <Input value={draft.hex} onChange={(event) => patchDraft(colour.id, { hex: event.target.value.replace(/^#/, "") })} />
            </span>
          </td>
          <td className="p-1">
            <select
              className="rounded-md border bg-background px-2 py-1"
              value={draft.shopifyBaseColor || ""}
              data-testid={`colour-base-${slug(colour.name)}`}
              onChange={(event) => patchDraft(colour.id, { shopifyBaseColor: event.target.value || null })}
            >
              <option value="">Not set</option>
              {SHOPIFY_BASE_COLOURS.map((base) => <option key={base} value={base}>{base}</option>)}
            </select>
            {colour.active && !draft.shopifyBaseColor ? (
              <span className="mt-1 block text-destructive" data-testid={`colour-base-missing-${slug(colour.name)}`}>Missing</span>
            ) : null}
          </td>
          <td className="p-1">
            <select
              className="rounded-md border bg-background px-2 py-1"
              value={draft.finish}
              onChange={(event) => patchDraft(colour.id, { finish: asFinish(event.target.value) })}
            >
              <option value="solid">Solid</option>
              <option value="heather">Heather</option>
              <option value="produced">Produced</option>
            </select>
          </td>
          <td className="p-1">
            <Input
              value={draft.linkStoredName || ""}
              placeholder="exact blank name"
              onChange={(event) => patchDraft(colour.id, { linkStoredName: event.target.value })}
            />
          </td>
          <td className="p-1">
            {readOnly ? null : (
              <Button type="button" size="sm" variant="outline" disabled={busy === colour.id} onClick={() => void saveColour(draft)}>
                Save
              </Button>
            )}
          </td>
        </tr>
      );
    });
  }

  return (
    <AdminLayout>
      <div className="space-y-4" data-testid="colour-blanks-page">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Colour blanks</h1>
            <p className="text-sm text-muted-foreground">
              <Link href="/admin/catalogue-studio" className="underline">Mockup library</Link>
              {" · "}
              {data ? `${data.productType.name} (${data.productType.id})` : "Loading…"}
              . A painted preview is not stored until you approve it.
            </p>
          </div>
          {data ? (
            <label className="text-sm">
              Product type{" "}
              <select
                className="ml-1 rounded-md border bg-background px-2 py-1"
                value={typeId}
                onChange={(event) => {
                  setPickedType(Number(event.target.value));
                  setSceneDraft(null);
                }}
                data-testid="colour-blanks-type"
              >
                {data.types.map((type) => (
                  <option key={type.id} value={type.id}>{type.name} ({type.id})</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {data?.sharedFrom ? (
          <p className="rounded-md border bg-muted p-3 text-sm" data-testid="colour-blanks-shared">
            These blanks are {data.sharedFrom.name} ({data.sharedFrom.id}), shared by reference.
            A blank painted or approved on that type shows here immediately. Paint and approve on that type.
          </p>
        ) : null}
        {sessionExpired ? <p className="text-sm" data-testid="colour-blanks-session">session expired, reload</p> : null}
        {status && !sessionExpired ? <p className="text-sm" data-testid="colour-blanks-status">{status}</p> : null}
        {grid.error && !sessionExpired ? <p className="text-sm text-destructive">{String((grid.error as Error).message || grid.error)}</p> : null}

        {readOnly ? null : <SectionErrorBoundary title="Add scene" resetKey={String(typeId)}>
        <div className="rounded-md border p-3" data-testid="colour-scene-add">
          <p className="text-sm font-medium">Add scene</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The white master is scaled to 1254×1254. Drag the box to place the print area, or copy another scene. Compose does not use it until you approve.
          </p>
          <label className="mt-2 inline-flex cursor-pointer items-center rounded-md border px-2 py-1 text-sm">
            Choose white master
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              data-testid="colour-scene-file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void previewScene(file);
              }}
            />
          </label>
          {sceneDraft ? (
            <div className="mt-3 space-y-2">
              <Input
                value={sceneDraft.name}
                onChange={(event) => setSceneDraft({ ...sceneDraft, name: event.target.value })}
                data-testid="colour-scene-name"
              />
              <PlacementEditor
                draft={sceneDraft}
                guide={data?.calibration?.placement ?? null}
                onChange={(placement) => setSceneDraft({ ...sceneDraft, placement })}
              />
              {data?.calibration ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="colour-scene-autoplace"
                  onClick={() => setSceneDraft({ ...sceneDraft, placement: data.calibration!.placement })}
                >
                  Auto-place from calibration
                </Button>
              ) : null}
              <label className="block text-xs">
                Copy placement{" "}
                <select
                  className="ml-1 rounded-md border bg-background px-2 py-1"
                  data-testid="colour-scene-copy"
                  defaultValue=""
                  onChange={(event) => {
                    const scene = scenes.find((item) => item.panelId === event.target.value);
                    if (scene?.placement) setSceneDraft({ ...sceneDraft, placement: scene.placement });
                  }}
                >
                  <option value="">This scene</option>
                  {scenes.filter((scene) => scene.placement).map((scene) => (
                    <option key={scene.panelId} value={scene.panelId}>{scene.label || scene.panelId}</option>
                  ))}
                </select>
              </label>
              {sceneDraft.note ? <p className="text-xs text-amber-800">{sceneDraft.note}</p> : null}
              <Button type="button" size="sm" data-testid="colour-scene-approve" disabled={busy !== ""} onClick={() => void approveScene()}>
                Approve scene
              </Button>
            </div>
          ) : null}
        </div>
        </SectionErrorBoundary>}

        {readOnly ? null : colours.filter((colour) => colour.match === "name-mismatch").map((colour) => (
          <div key={colour.id} className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950" data-testid={`colour-mismatch-${slug(colour.name)}`}>
            <p>
              <strong>{colour.name}</strong> has no blank with that name.
              {" "}{colour.storedRows} stored {colour.storedRows === 1 ? "blank is" : "blanks are"} named <strong>{colour.storedName}</strong>
              {colour.storedScenes ? ` across ${colour.storedScenes} ${colour.storedScenes === 1 ? "scene" : "scenes"}` : ""}.
              Compose will repaint the white master until you link them.
            </p>
            <Button type="button" size="sm" className="mt-2" variant="outline" data-testid={`colour-link-${slug(colour.name)}`} disabled={busy === colour.id} onClick={() => void linkColour(colour)}>
              Link {colour.storedName} blanks as {colour.name}
            </Button>
          </div>
        ))}

        <SectionErrorBoundary title="Colour grid" resetKey={String(typeId)}>
        {readOnly ? null : <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="colour-paint-grid"
            disabled={busy !== "" || solids.length === 0 || scenes.length === 0}
            onClick={() => void paintMany(scenes.flatMap((scene) => solids.map((colour) => ({ panelId: scene.panelId, colour }))), "grid")}
          >
            Paint all solids from the white master
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="colour-approve-grid"
            disabled={busy !== "" || paintedPairs.length === 0}
            onClick={() => void approvePainted(paintedPairs)}
          >
            Approve painted previews ({paintedPairs.length})
          </Button>
        </div>}

        <div className="overflow-x-auto rounded-md border">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-36 border-b bg-background p-2 text-left">Scene</th>
                {gridColours.map((colour) => (
                  <th key={colour.id} className="min-w-40 border-b border-l p-2 text-left align-top" data-testid={`colour-column-${slug(colour.name)}`}>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-3 w-3 rounded-sm border" style={{ background: `#${colour.hex}` }} />
                      {colour.name}
                    </span>
                    <span className="block font-normal text-muted-foreground">
                      {colour.finish === "heather" ? "Heather" : colour.finish === "produced" ? "Produced" : "Solid"} · #{colour.hex}
                    </span>
                    {readOnly || colour.finish !== "solid" ? null : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-1"
                        data-testid={`colour-paint-column-${slug(colour.name)}`}
                        disabled={busy !== ""}
                        onClick={() => void paintMany(scenes.map((scene) => ({ panelId: scene.panelId, colour })), colour.name)}
                      >
                        Paint column
                      </Button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenes.map((scene) => (
                <tr key={scene.panelId}>
                  <th className="sticky left-0 z-10 border-t bg-background p-2 text-left font-medium">
                    {scene.label || scene.panelId}
                    {scene.isDefault ? <span className="mt-1 block font-normal text-muted-foreground">Default</span> : null}
                    {scene.placementOffsetPx ? (
                      <span className="mt-1 block max-w-48 font-normal text-muted-foreground" data-testid={`colour-scene-offset-${slug(scene.panelId)}`}>
                        Calibrated minus this box: left {px(scene.placementOffsetPx.left)}, top {px(scene.placementOffsetPx.top)}, width {px(scene.placementOffsetPx.width)}, height {px(scene.placementOffsetPx.height)}. Not saved.
                      </span>
                    ) : null}
                    {readOnly ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      data-testid={`colour-scene-delete-${slug(scene.panelId)}`}
                      disabled={busy !== ""}
                      onClick={() => void deleteScene(scene)}
                    >
                      Delete
                    </Button>
                    )}
                  </th>
                  {scene.cells.filter((cell) => gridColours.some((colour) => colour.id === cell.colourId)).map((cell) => {
                    const colour = colours.find((item) => item.id === cell.colourId);
                    if (!colour) return null;
                    const key = cellKey(scene.panelId, colour.id);
                    const preview = previews[key];
                    const id = `${slug(scene.panelId)}-${slug(colour.name)}`;
                    return (
                      <td key={colour.id} className="border-l border-t p-2 align-top" data-testid={`colour-cell-${id}`}>
                        {cell.state === "present" && cell.photoUrl ? (
                          <img src={cell.photoUrl} alt="" className="h-28 w-full object-contain bg-white" />
                        ) : (
                          <p className="flex h-28 items-center justify-center rounded-sm bg-muted text-muted-foreground" data-testid={`colour-missing-${id}`}>missing</p>
                        )}
                        <p className="mt-1" data-testid={`colour-compose-${id}`}>{composeLabel(cell)}</p>
                        {cell.current ? (
                          <p className="text-muted-foreground">In use · {cell.current.kind} · {cell.current.createdAt.slice(0, 16).replace("T", " ")}</p>
                        ) : null}
                        {preview ? (
                          <CellErrorBoundary resetKey={`${key}:${preview.width ?? ""}:${preview.height ?? ""}:${preview.error || ""}`}>
                          <div className="mt-2 space-y-1">
                            {preview.error ? (
                              <p className="text-destructive" data-testid={`colour-preview-error-${id}`}>{preview.error}</p>
                            ) : preview.compare === "flicker" && preview.master ? (
                              <FlickerFrame upload={preview.src} master={preview.master} testId={`colour-preview-${id}`} />
                            ) : (
                              <img
                                src={preview.compare === "overlay" && preview.overlay ? preview.overlay : preview.src}
                                alt=""
                                className="h-28 max-h-28 w-full max-w-full object-contain bg-white"
                                data-testid={`colour-preview-${id}`}
                              />
                            )}
                            {preview.error ? null : <p className="text-muted-foreground">Preview only</p>}
                            {preview.alignment ? (
                              <div data-testid={`colour-align-${id}`}>
                                <p>
                                  {preview.resized ? `Scaled ${preview.fromWidth}×${preview.fromHeight} to ${preview.width}×${preview.height}. ` : "Same size as the white master. "}
                                  Overlap {Math.round(preview.alignment.overlap * 100)}% · edge {preview.alignment.edgeOffsetPx} px
                                  {preview.alignment.shiftX || preview.alignment.shiftY ? ` · shift ${preview.alignment.shiftX}, ${preview.alignment.shiftY}` : ""}
                                </p>
                                {preview.alignment.warning ? (
                                  <p className="rounded-sm bg-amber-100 p-1 text-amber-950" data-testid={`colour-align-warn-${id}`}>{preview.alignment.warning}</p>
                                ) : (
                                  <p className="text-muted-foreground">Shirt lines up with the white master.</p>
                                )}
                                <span className="flex gap-1">
                                  <button type="button" className="underline" onClick={() => setPreviews((current) => ({ ...current, [key]: { ...preview, compare: "overlay" } }))}>50% overlay</button>
                                  <button type="button" className="underline" onClick={() => setPreviews((current) => ({ ...current, [key]: { ...preview, compare: "flicker" } }))}>Flicker</button>
                                  <button type="button" className="underline" onClick={() => setPreviews((current) => ({ ...current, [key]: { ...preview, compare: "off" } }))}>Upload only</button>
                                </span>
                              </div>
                            ) : null}
                            {preview.confirm ? <p>{preview.confirm}</p> : null}
                            {preview.error ? null : preview.kind === "paint" ? (
                              <Button type="button" size="sm" data-testid={`colour-approve-${id}`} disabled={busy !== ""} onClick={() => void approvePaint(scene.panelId, colour)}>
                                Approve
                              </Button>
                            ) : (
                              <Button type="button" size="sm" data-testid={`colour-approve-upload-${id}`} disabled={busy !== ""} onClick={() => void approveUpload(scene.panelId, colour, Boolean(preview.confirm))}>
                                {preview.confirm ? "Save with the white mask" : "Approve upload"}
                              </Button>
                            )}
                            <Button type="button" size="sm" variant="ghost" onClick={() => {
                              uploadFiles.current.delete(key);
                              setPreviews((current) => {
                                const copy = { ...current };
                                delete copy[key];
                                return copy;
                              });
                            }}
                            >
                              Discard
                            </Button>
                          </div>
                          </CellErrorBoundary>
                        ) : null}
                        {readOnly ? null : <div className="mt-2 flex flex-wrap gap-1">
                          {colour.finish === "solid" ? (
                            <Button type="button" size="sm" variant="outline" data-testid={`colour-paint-${id}`} disabled={busy !== ""} onClick={() => void paintOne(scene.panelId, colour)}>
                              Paint from white master
                            </Button>
                          ) : null}
                          <label className="inline-flex cursor-pointer items-center rounded-md border px-2 py-1">
                            Upload
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="sr-only"
                              data-testid={`colour-upload-${id}`}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (file) void stageUpload(scene.panelId, colour, file);
                              }}
                            />
                          </label>
                        </div>}
                        {cell.history.length ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-muted-foreground">{cell.history.length} older {cell.history.length === 1 ? "copy" : "copies"}</summary>
                            <ul className="mt-1 space-y-1">
                              {cell.history.map((row) => (
                                <li key={row.id}>
                                  <span>{row.createdAt.slice(0, 16).replace("T", " ")} · {row.kind} · #{row.hex}</span>
                                  <span className="ml-1">
                                    <button type="button" className="underline" onClick={() => void showHistory(row.id)}>Show</button>
                                    {" · "}
                                    {readOnly ? null : <button type="button" className="underline" data-testid={`colour-rollback-${row.id}`} onClick={() => void rollback(row)}>Roll back</button>}
                                  </span>
                                  {historyUrl[row.id] ? <img src={historyUrl[row.id]} alt="" className="mt-1 h-20 w-full object-contain bg-white" /> : null}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </SectionErrorBoundary>

        <details className="rounded-md border p-3" open>
          <summary className="cursor-pointer text-sm font-medium" data-testid="colour-list-toggle">Colour list ({gridColours.length} active)</summary>
          {gridColours.some((colour) => !colour.shopifyBaseColor) ? (
            <p className="mt-2 text-sm text-destructive" data-testid="colour-base-missing">
              {gridColours.filter((colour) => !colour.shopifyBaseColor).map((colour) => colour.name).join(", ")} {gridColours.filter((colour) => !colour.shopifyBaseColor).length === 1 ? "has" : "have"} no Shopify base colour. Set it before publishing.
            </p>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            Saving a name here does not rename stored blanks. Heather and produced colours have no paint button until you switch them to solid.
            Inactive colours are hidden from the grid, Studio, and the storefront until you turn them back on.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="p-1 font-medium">Active</th>
                  <th className="p-1 font-medium">Name</th>
                  <th className="p-1 font-medium">Printify colour</th>
                  <th className="p-1 font-medium">Option</th>
                  <th className="p-1 font-medium">Hex</th>
                  <th className="p-1 font-medium">Shopify base colour</th>
                  <th className="p-1 font-medium">Finish</th>
                  <th className="p-1 font-medium">Stored as</th>
                  <th className="p-1" />
                </tr>
              </thead>
              <tbody>{colourRows(gridColours)}</tbody>
            </table>
          </div>
          {inactiveColours.length > 0 ? (
            <details className="mt-3" data-testid="colour-inactive">
              <summary className="cursor-pointer text-xs font-medium">Inactive colours ({inactiveColours.length})</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="p-1 font-medium">Active</th>
                      <th className="p-1 font-medium">Name</th>
                      <th className="p-1 font-medium">Printify colour</th>
                      <th className="p-1 font-medium">Option</th>
                      <th className="p-1 font-medium">Hex</th>
                      <th className="p-1 font-medium">Shopify base colour</th>
                      <th className="p-1 font-medium">Finish</th>
                      <th className="p-1 font-medium">Stored as</th>
                      <th className="p-1" />
                    </tr>
                  </thead>
                  <tbody>{colourRows(inactiveColours)}</tbody>
                </table>
              </div>
            </details>
          ) : null}
          {readOnly ? null : <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void addColour(event.currentTarget);
            }}
          >
            <Input name="name" placeholder="Name" className="w-36" required />
            <Input name="printifyTitle" placeholder="Printify colour" className="w-36" />
            <Input name="printifyOptionId" placeholder="Option id" className="w-24" />
            <Input name="hex" placeholder="Hex" className="w-24" required />
            <select name="shopifyBaseColor" className="rounded-md border bg-background px-2 py-1 text-sm" defaultValue="">
              <option value="">Shopify base colour</option>
              {SHOPIFY_BASE_COLOURS.map((base) => <option key={base} value={base}>{base}</option>)}
            </select>
            <select name="finish" className="rounded-md border bg-background px-2 py-1 text-sm" defaultValue="solid">
              <option value="solid">Solid</option>
              <option value="heather">Heather</option>
              <option value="produced">Produced</option>
            </select>
            <Input name="linkStoredName" placeholder="Stored blank name" className="w-40" />
            <Button type="submit" size="sm" variant="outline" disabled={busy === "add"}>Add colour</Button>
          </form>}
        </details>
      </div>
    </AdminLayout>
  );
}
