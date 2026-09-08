import { useRef, useState, type RefObject } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArtworkPlacement } from "@/components/hoodie-template-mapper/lib/aopPreview";

export type PocketSamplePlacement = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

export type PulloverCalibrationTarget = "hood" | "front-body" | "pocket";

type Row = {
  id: PulloverCalibrationTarget;
  label: string;
  offsetX: number;
  offsetY: number;
  scale: number;
};

/** Canvas drag for pullover pocket sample-window (translate + corner scale). */
export function PocketSampleDragLayer({
  canvasRef,
  mockup,
  scale,
  onTranslate,
  onScale,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  mockup: HTMLImageElement;
  scale: number;
  onTranslate: (dx: number, dy: number) => void;
  onScale: (next: number) => void;
}) {
  const drag = useRef<{
    mode: "translate" | "scale";
    x: number;
    y: number;
    startScale: number;
  } | null>(null);

  const toMockup = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    const mw = mockup.naturalWidth || mockup.width;
    const mh = mockup.naturalHeight || mockup.height;
    return {
      x: ((clientX - rect.left) / rect.width) * mw,
      y: ((clientY - rect.top) / rect.height) * mh,
    };
  };

  return (
    <div
      className="absolute inset-0 z-10 cursor-move"
      data-testid="pullover-pocket-drag-layer"
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const corner = (e.target as HTMLElement).dataset.pocketScale === "1";
        drag.current = {
          mode: corner ? "scale" : "translate",
          x: e.clientX,
          y: e.clientY,
          startScale: scale,
        };
      }}
      onPointerMove={(e) => {
        const cur = drag.current;
        if (!cur) return;
        const from = toMockup(cur.x, cur.y);
        const to = toMockup(e.clientX, e.clientY);
        if (!from || !to) return;
        if (cur.mode === "translate") {
          onTranslate(to.x - from.x, to.y - from.y);
          drag.current = { ...cur, x: e.clientX, y: e.clientY };
          return;
        }
        const start = toMockup(cur.x, cur.y);
        if (!start) return;
        const next = cur.startScale * (1 - (to.y - start.y) / 220);
        onScale(next);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <div
        data-pocket-scale="1"
        className="absolute bottom-2 right-2 h-4 w-4 cursor-nwse-resize rounded-sm border border-amber-500 bg-card"
        title="Drag to scale pocket sample"
      />
    </div>
  );
}

function Field({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className="w-8 shrink-0">{label}</span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? +value.toFixed(4) : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-7 w-full rounded border border-border bg-card px-1.5 text-[11px] text-foreground"
      />
    </label>
  );
}

export function PulloverPlacementDefaultsPanel({
  garment = "pullover",
  hood,
  front,
  pocket,
  selected,
  saving,
  hasOverrides,
  error,
  onSelect,
  onChangeHood,
  onChangeFront,
  onChangePocket,
  onSave,
  onReset,
}: {
  /** Zip pocket row is Y + scale only (X stays locked to the zipper inset). */
  garment?: "pullover" | "zip";
  hood: ArtworkPlacement;
  front: ArtworkPlacement;
  pocket: PocketSamplePlacement;
  selected: PulloverCalibrationTarget;
  saving: boolean;
  hasOverrides: boolean;
  error?: string | null;
  onSelect: (id: PulloverCalibrationTarget) => void;
  onChangeHood: (next: ArtworkPlacement) => void;
  onChangeFront: (next: ArtworkPlacement) => void;
  onChangePocket: (next: PocketSamplePlacement) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const isZip = garment === "zip";
  const rows: Row[] = [
    {
      id: "hood",
      label: "Hood (L/R)",
      offsetX: hood.offsetX,
      offsetY: hood.offsetY,
      scale: hood.scale,
    },
    {
      id: "front-body",
      label: isZip ? "Front body (L/R)" : "Front body",
      offsetX: front.offsetX,
      offsetY: front.offsetY,
      scale: front.scale,
    },
    {
      id: "pocket",
      label: isZip ? "Pocket (L/R)" : "Pocket",
      offsetX: pocket.offsetX,
      offsetY: pocket.offsetY,
      scale: pocket.scale,
    },
  ];

  const patch = (id: PulloverCalibrationTarget, field: "offsetX" | "offsetY" | "scale", n: number) => {
    if (id === "hood") onChangeHood({ ...hood, [field]: n });
    else if (id === "front-body") onChangeFront({ ...front, [field]: n });
    else onChangePocket({ ...pocket, [field]: isZip && field === "offsetX" ? 0 : n });
  };

  return (
    <div
      className="space-y-2 rounded border border-amber-500/40 bg-amber-500/5 p-2"
      data-testid={isZip ? "zip-placement-defaults" : "pullover-placement-defaults"}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
        Template placement
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        {isZip
          ? "Front body moves both zip halves. Pocket Y / scale moves both pocket halves on top of the built-in up-shift. Negative Y lifts the pockets. Save writes hood / front-body / pocket as template defaults."
          : "Drag the selected panel on the preview or edit numbers. Save writes hood / front-body placement and pocket sample-window as template defaults."}
      </p>
      {rows.map((row) => (
        <div
          key={row.id}
          className={`space-y-1 rounded border p-2 ${
            selected === row.id ? "border-foreground bg-card" : "border-border"
          }`}
        >
          <button
            type="button"
            onClick={() => onSelect(row.id)}
            className="text-[11px] font-semibold text-foreground"
            data-testid={`${isZip ? "zip" : "pullover"}-place-select-${row.id}`}
          >
            {row.label}
          </button>
          {!(isZip && row.id === "pocket") ? (
          <Field
            label="X"
            value={row.offsetX}
            step={0.5}
            onChange={(n) => patch(row.id, "offsetX", n)}
          />
          ) : null}
          <Field
            label="Y"
            value={row.offsetY}
            step={0.5}
            onChange={(n) => patch(row.id, "offsetY", n)}
          />
          <Field
            label="Scale"
            value={row.scale}
            step={0.01}
            onChange={(n) => patch(row.id, "scale", n)}
          />
        </div>
      ))}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-[11px]"
          disabled={!hasOverrides || saving}
          onClick={() => {
            setStatus(null);
            onSave();
          }}
          data-testid={`${isZip ? "zip" : "pullover"}-place-save-defaults`}
        >
          {saving ? "Saving…" : "Save as defaults"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-[11px]"
          disabled={!hasOverrides || saving}
          onClick={() => {
            setStatus(null);
            onReset();
          }}
          title="Discard to template values"
          data-testid={`${isZip ? "zip" : "pullover"}-place-reset-defaults`}
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>
      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
      {status ? <p className="text-[10px] text-muted-foreground">{status}</p> : null}
    </div>
  );
}
